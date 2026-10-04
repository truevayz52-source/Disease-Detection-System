"""Dump every suspicious t( fusion site: identifier ending in t directly
fused with a call (split"...") — remnants of the codemod/repair passes."""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DIRS = [ROOT / "client" / "src" / "pages", ROOT / "client" / "src" / "components"]

# fused forms: word"t("s")", word")Xt(", word"t"str, ")xt("
PAT = re.compile(r'([A-Za-z_$][\w$]*t\("[^"]{0,40}|"[\)\w]*t\("|t\("[^"\\]{0,3}")')

for d in DIRS:
    for f in sorted(d.glob("*.tsx")) + sorted(d.glob("*.ts")):
        src = f.read_text(encoding="utf-8")
        for m in PAT.finditer(src):
            s = m.group(0)
            # legit t("x") on its own or after non-word char is fine
            if re.fullmatch(r't\("[^"\\]{0,3}"', s):
                continue
            line = src[: m.start()].count("\n") + 1
            ctx = src[max(0, m.start() - 30): m.end() + 30].replace("\n", " ")
            print(f"{f.name}:{line}: {ctx}")
