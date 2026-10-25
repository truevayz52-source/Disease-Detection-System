"""
One-off ETL: copy legacy MariaDB `dds_db` data into the Supabase Postgres DB.

Reads DATABASE_URL from server/.env (never prints it), reads MySQL at
127.0.0.1:3306 (root, no password — local dev), and copies every table that
exists in both schemas using ON CONFLICT DO NOTHING so existing Supabase rows
(demo seed + anything created since) are never overwritten.

Usage (repo root):
    C:\\dds-venv\\Scripts\\python.exe server\\scripts\\import-legacy-mysql.py

Requires: pip install pymysql psycopg2-binary python-dotenv
"""

import os
import sys
from pathlib import Path

import pymysql
import psycopg2
import psycopg2.extras
from dotenv import dotenv_values

REPO_SERVER = Path(__file__).resolve().parent.parent  # server/
ENV = dotenv_values(REPO_SERVER / ".env")
DATABASE_URL = ENV.get("DATABASE_URL")
if not DATABASE_URL:
    sys.exit("DATABASE_URL not set in server/.env")

if "sslmode" not in DATABASE_URL:
    DATABASE_URL += ("&" if "?" in DATABASE_URL else "?") + "sslmode=require"

# Tables skipped on purpose — sessions/tokens are useless across the move.
SKIP_TABLES = {"sessions"}

# MySQL root has no password on this dev box (verified via `mysql -u root`).
mysql = pymysql.connect(
    host="127.0.0.1",
    port=3306,
    user="root",
    password="",
    database="dds_db",
    charset="utf8mb4",
    cursorclass=pymysql.cursors.DictCursor,
)

pg = psycopg2.connect(DATABASE_URL)
pg.autocommit = False
pcur = pg.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

# --- schema discovery --------------------------------------------------------

with mysql.cursor() as c:
    c.execute("SHOW TABLES")
    mysql_tables = {next(iter(r.values())) for r in c.fetchall()}

pcur.execute(
    "SELECT table_name FROM information_schema.tables "
    "WHERE table_schema = 'public'"
)
pg_tables = {r["table_name"] for r in pcur.fetchall()}

shared = sorted(mysql_tables & pg_tables - SKIP_TABLES)
print(f"[etl] mysql tables: {len(mysql_tables)}, pg tables: {len(pg_tables)}, shared: {len(shared)}")

# Postgres `facilities` never got facility_code ported — preserve FEPMS codes.
pcur.execute("ALTER TABLE facilities ADD COLUMN IF NOT EXISTS facility_code varchar(30)")
pg.commit()

# --- user id remap -----------------------------------------------------------
# Both DBs hold the same accounts under different user_ids (email matches).
# MySQL rows were skipped by ON CONFLICT, so child-table FK columns that
# reference users(user_id) must be rewritten to the Postgres ids.

with mysql.cursor() as c:
    c.execute("SELECT user_id, email FROM users")
    mysql_uid_by_email = {r["email"]: r["user_id"] for r in c.fetchall()}
pcur.execute("SELECT user_id, email FROM users")
pg_uid_by_email = {r["email"]: r["user_id"] for r in pcur.fetchall()}
uid_map = {
    mysql_uid_by_email[email]: pg_uid_by_email[email]
    for email in mysql_uid_by_email.keys() & pg_uid_by_email.keys()
}
print(f"[etl] user id remap entries: {len(uid_map)}")

# Every FK column that points at users(user_id).
pcur.execute(
    """
    SELECT kcu.table_name, kcu.column_name
    FROM information_schema.referential_constraints rc
    JOIN information_schema.key_column_usage kcu
      ON rc.constraint_name = kcu.constraint_name
     AND rc.constraint_schema = kcu.constraint_schema
    JOIN information_schema.constraint_column_usage ccu
      ON rc.unique_constraint_name = ccu.constraint_name
    WHERE ccu.table_name = 'users' AND ccu.column_name = 'user_id'
      AND kcu.table_schema = 'public'
    """
)
user_fk_cols = {(r["table_name"], r["column_name"]) for r in pcur.fetchall()}

def mysql_cols(table):
    with mysql.cursor() as c:
        c.execute(f"SHOW COLUMNS FROM `{table}`")
        return [r["Field"] for r in c.fetchall()]

def pg_cols(table):
    pcur.execute(
        "SELECT column_name, data_type FROM information_schema.columns "
        "WHERE table_schema = 'public' AND table_name = %s",
        (table,),
    )
    return {r["column_name"]: r["data_type"] for r in pcur.fetchall()}

def pg_pk(table):
    pcur.execute(
        """
        SELECT kcu.column_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name
         AND tc.table_schema = kcu.table_schema
        WHERE tc.constraint_type = 'PRIMARY KEY'
          AND tc.table_schema = 'public' AND tc.table_name = %s
        """,
        (table,),
    )
    return [r["column_name"] for r in pcur.fetchall()]

# --- copy loop: retry until FK order resolves --------------------------------

pending = list(shared)
done, failed_tables = {}, {}
dropped_cols = {}

for _round in range(len(shared) + 1):
    if not pending:
        break
    still_pending = []
    for table in pending:
        cols = sorted(set(mysql_cols(table)) & set(pg_cols(table)))
        missing = sorted(set(mysql_cols(table)) - set(pg_cols(table)))
        if missing:
            dropped_cols[table] = missing
        coltypes = pg_cols(table)
        bool_cols = {c for c in cols if coltypes.get(c) == "boolean"}
        pk = pg_pk(table)

        with mysql.cursor() as c:
            c.execute(f"SELECT `{ '`, `'.join(cols) }` FROM `{table}`")
            rows = c.fetchall()
        if not rows:
            done[table] = (0, 0)
            continue

        # No conflict target — covers PK AND other unique constraints
        # (users.email, audit chain sequence) so seed rows are skipped.
        sql = (
            f"INSERT INTO {table} ({', '.join(cols)}) VALUES "
            f"({', '.join(['%s'] * len(cols))}) ON CONFLICT DO NOTHING"
        )

        def fix(col, v):
            if col in bool_cols and v is not None:
                return bool(v)
            # MySQL permits '0000-00-00' dates — Postgres does not.
            if v is not None and isinstance(v, str) and v.startswith("0000-"):
                return None
            if v is not None and hasattr(v, "year") and getattr(v, "year", 1) < 1:
                return None
            # Rewrite user references to the Postgres ids (email-matched).
            # audit_log is excluded — record_hash covers user_id, so a remap
            # would corrupt the tamper-evident chain (and it has no FK).
            if table != "audit_log" and (table, col) in user_fk_cols and v is not None:
                return uid_map.get(v, v)
            return v

        try:
            converted = [
                tuple(fix(col, v) for col, v in row.items())
                for row in rows
            ]
            psycopg2.extras.execute_batch(pcur, sql, converted, page_size=500)
            pg.commit()
            done[table] = (len(rows), pcur.rowcount)
            print(f"[etl] {table}: {len(rows)} rows copied")
        except psycopg2.errors.ForeignKeyViolation as e:
            pg.rollback()
            still_pending.append(table)  # parent not loaded yet — retry later
        except Exception as e:
            pg.rollback()
            failed_tables[table] = str(e).splitlines()[0]
            print(f"[etl] {table}: FAILED — {str(e).splitlines()[0]}")
    if len(still_pending) == len(pending):
        break  # no progress — FK cycle or missing parents
    pending = still_pending

for t in pending:
    failed_tables[t] = "unresolved FK order (referenced rows missing)"
    print(f"[etl] {t}: FAILED — unresolved FK order")

print("\n[etl] === SUMMARY ===")
print(f"[etl] tables copied: {len(done)}")
for t, (src, _) in sorted(done.items()):
    print(f"      {t}: {src} source rows")
if dropped_cols:
    print("[etl] columns dropped (absent on Postgres):")
    for t, cs in sorted(dropped_cols.items()):
        print(f"      {t}: {', '.join(cs)}")
if failed_tables:
    print("[etl] failures:")
    for t, e in sorted(failed_tables.items()):
        print(f"      {t}: {e}")

mysql.close()
pg.close()
