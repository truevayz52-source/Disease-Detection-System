"""Undo repair-v3 corruption: `Xt("Y")` -> `X"Y"`.
v3 matched word + '"' + gap-to-next-quote and fused them as word+t("gap").
Inverse removes the inserted `t(` and trailing `)` — restoring the original
string boundary and gap text exactly.

Protected: `.Xt(` (method calls) and a whitelist of legit identifiers ending
in t (split, useEffect, format, alert, …)."""
import re, sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parent.parent
DIRS = [ROOT / "client" / "src" / "pages", ROOT / "client" / "src" / "components"]

FUSED = re.compile(r'([A-Za-z_$][\w$]*)t\("((?:\\.|[^"\\])*)"\)')

# legit bare calls ending in t:  name => prefix captured by group(1)
WHITELIST = {
    "useEffec", "useLayoutEffec", "spli", "sor", "forma", "seTex", "setSecre",
    "setPasswor", "aler", "submi", "impor", "reques", "prin", "se", "ge",
    "a", "i", "ou", "tes", "expec", "wai", "seTimeou", "seInterva",
    "closes", "inser", "repea", "writeTex", "lis", "cos", "diges", "pu",
    "cu", "selec", "ac", "asser", "fla", "splices", "Repea", "paddinglef",
}

n_total = 0
for d in DIRS:
    for f in sorted(d.glob("*.tsx")) + sorted(d.glob("*.ts")):
        src = f.read_text(encoding="utf-8")
        def rep(m):
            global n_total
            name, x = m.group(1), m.group(2)
            prev = src[m.start() - 1] if m.start() > 0 else ""
            if prev == "." or name in WHITELIST:
                return m.group(0)
            n_total += 1
            return f'{name}"{x}"'
        out = FUSED.sub(rep, src)
        if out != src:
            f.write_text(out, encoding="utf-8")
print(f"{n_total} fused pairs unwrapped")
