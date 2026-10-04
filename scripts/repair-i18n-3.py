"""v3: the v2 unwrap regex `t("...")` also matched the trailing `t` of
identifiers (setText("") -> setTex"", createElement("a") -> createElemen"a",
split(",") -> spli","). An identifier directly followed by a string literal
is never valid TypeScript, so every word+"str" adjacency is restored as
word+t("str")."""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DIRS = [ROOT / "client" / "src" / "pages", ROOT / "client" / "src" / "components"]

WORDSTR = re.compile(r'\b([A-Za-z_$][\w$]*)("(?:\\.|[^"\\])*")')

total = 0
for d in DIRS:
    for f in sorted(d.glob("*.tsx")) + sorted(d.glob("*.ts")):
        src = f.read_text(encoding="utf-8")
        out, n = WORDSTR.subn(lambda m: f'{m.group(1)}t({m.group(2)})', src)
        if n:
            f.write_text(out, encoding="utf-8")
            print(f"{f.name}: {n} restored")
            total += n
print(f"{total} identifier+string joins restored")
