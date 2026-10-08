"""Line-targeted tr() wrapper for flagged literals from find-untranslated.py.
Wraps 'lit' / "lit" occurrences not already inside tr( on the flagged line,
strips a same-line enclosing `const`, and adds the app_localizations import
when a file gains tr() without it."""
import re
import subprocess
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parent.parent / "mobile" / "lib"
SCAN = Path(__file__).resolve().parent / "find-untranslated.py"

SKIP_FILES = {
    "data/api_client.dart", "data/translation_service.dart", "data/secure_store.dart",
    "data/draft_store.dart", "data/sync_service.dart",
}
SKIP_LITERALS = {
    "data/models.dart": {"Africa/Harare"},
    "ui/widgets.dart": {"dd MMM yyyy", "dd MMM yyyy, HH:mm"},
}
# Lines that are continuation halves of multi-line literals already inside tr()
SKIP_LINES = {("ui/app_shell.dart", 26), ("ui/language_menu.dart", 46),
              ("features/admin/admin_screens.dart", 372)}

lit_re = re.compile(r"'((?:[^'\\]|\\.)*)'|\"((?:[^\"\\]|\\.)*)\"")

cands = {}
out = subprocess.run([sys.executable, str(SCAN)], capture_output=True, text=True).stdout
for line in out.splitlines():
    m = re.match(r"(.+\.dart):(\d+): (.*)", line)
    if not m:
        continue
    f = m.group(1).replace("\\", "/")
    cands.setdefault(f, []).append((int(m.group(2)), m.group(3)))


def dart_escape(s: str) -> str:
    return s.replace("\\", "\\\\").replace("'", "\\'")


def wrap_line(line: str, literal: str) -> str:
    for q in ("'", '"'):
        pat = re.escape(q + literal + q)
        for m in reversed(list(re.finditer(pat, line))):
            before = line[: m.start()]
            if re.search(r"\btr\(\s*$|\bcontext\.tr\(\s*$", before):
                continue
            esc = dart_escape(literal) if q == "'" else literal.replace('"', '\\"')
            line = line[: m.start()] + f"tr('{esc}')" + line[m.end():]
            # strip a same-line `const` enclosing this expression
            pre = line[: m.start()]
            cm = re.search(r"\bconst\s+([{(\[]|\w+\()", pre)
            if cm:
                line = line[: cm.start()] + line[cm.start():].replace("const ", "", 1)
    return line


total = 0
for rel, items in cands.items():
    if rel in SKIP_FILES:
        continue
    p = ROOT / rel
    if not p.exists():
        continue
    lines = p.read_text(encoding="utf-8").split("\n")
    changed = False
    for ln, lit in items:
        if (rel, ln) in SKIP_LINES or lit in SKIP_LITERALS.get(rel, set()):
            continue
        i = ln - 1
        if i >= len(lines):
            continue
        new = wrap_line(lines[i], lit)
        if new != lines[i]:
            lines[i] = new
            changed = True
            total += 1
        else:
            print(f"  nowrap {rel}:{ln}: {lit[:50]!r} -> {lines[i].strip()[:80]!r}")
    if changed:
        src = "\n".join(lines)
        if "app_localizations" not in src:
            depth = len(Path(rel).parent.parts)
            imp = "import '" + ("../" * depth) + "l10n/app_localizations.dart';\n"
            idx = src.rfind("import ")
            if idx >= 0:
                eol = src.find("\n", idx)
                src = src[: eol + 1] + imp + src[eol + 1:]
            else:
                src = imp + src
        p.write_text(src, encoding="utf-8")
        print(f"{rel}: wrapped")
print("TOTAL wrapped:", total)
