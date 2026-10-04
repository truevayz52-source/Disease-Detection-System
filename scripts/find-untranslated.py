"""List likely-prose string literals in mobile/lib that are NOT already
wrapped in tr(). Heuristic lint — review output, not authoritative.
Comment lines are stripped before matching."""
import re, sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parent.parent
MOBILE = ROOT / "mobile" / "lib"

SKIP_PREFIX = ("assets/", "import ", "package:", "/", "http", "dds_", "cache:",
               "[auth]", "[api]", "[sync]", "Bearer ", "uploads/", "icons/")

lit_re = re.compile(r"'((?:[^'\\]|\\.)*)'|\"((?:[^\"\\]|\\.)*)\"")

for f in sorted(MOBILE.rglob("*.dart")):
    if "l10n" in f.parts:
        continue
    lines = f.read_text(encoding="utf-8").split("\n")
    for lineno, line in enumerate(lines, 1):
        stripped = line.strip()
        if stripped.startswith(("//", "/*", "*", "import ", "export ")):
            continue
        code = line.split("//")[0] if "//" in line and "://" not in line else line
        for m in lit_re.finditer(code):
            lit = m.group(1) if m.group(1) is not None else m.group(2)
            if not lit or "$" in lit:
                continue
            if not any(c.isalpha() for c in lit):
                continue
            if " " not in lit and not lit[0].isupper():
                continue
            if lit.startswith(SKIP_PREFIX):
                continue
            if "tr(" in code[: m.start()]:
                continue
            print(f"{f.relative_to(MOBILE)}:{lineno}: {lit[:95]}")
