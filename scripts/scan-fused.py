"""Enumerate identifiers fused with t("...") — the Xt(" pattern."""
import re, sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parent.parent
DIRS = [ROOT / "client" / "src" / "pages", ROOT / "client" / "src" / "components"]

FUSED = re.compile(r'([A-Za-z_$][\w$]*)t\("((?:\\.|[^"\\])*)"\)')

names = {}
for d in DIRS:
    for f in sorted(d.glob("*.tsx")) + sorted(d.glob("*.ts")):
        src = f.read_text(encoding="utf-8")
        for m in FUSED.finditer(src):
            names.setdefault(m.group(1), []).append((f.name, m.group(2)[:40]))

for name in sorted(names):
    ex = names[name][0]
    print(f"{name:30} x{len(names[name]):4}  e.g. {ex[0]} :: {ex[1]!r}")
print(len(names), "distinct identifiers")
