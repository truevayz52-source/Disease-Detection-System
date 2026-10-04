"""v2: revert every t("X") where X looks like a code fragment, restoring the
ORIGINAL syntax per context:
   ={t("x")}  -> ="x"
   : t("x")   -> : "x"
   (t("x")    -> ("x")
   {t("x")}   -> x          (raw JSX text / code fragment)
Multi-word prose stays wrapped. Re-run of the fixed codemod re-wraps real
UI literals, so aggressive unwrap is safe."""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DIRS = [ROOT / "client" / "src" / "pages", ROOT / "client" / "src" / "components"]

# t("X") with optional { } braces
ANY = re.compile(r'(?P<brace>\{)?t\("(?P<x>(?:\\.|[^"\\])*)"\)(?(brace)\})')


def unescape(s: str) -> str:
    return s.replace('\\"', '"').replace("\\\\", "\\")


def is_code_frag(content: str) -> bool:
    c = content.strip()
    if len(c) < 2:
        return True
    if c[0] in '("\'\\`=,&|!;<>[]{}':
        return True
    if not re.search(r"[A-Za-z]", c):
        return True
    if re.search(r'["\'],\s*[\w$]+\)|\)\s*[,;:)]|=>|\{|\}|\[|\]|===|!==|\+\+|--|\.\w+\(', c):
        return True
    return False


def bare_word(c: str) -> bool:
    return re.fullmatch(r"[A-Za-z_$][\w$.]*", c.strip()) is not None


total = 0
for d in DIRS:
    for f in sorted(d.glob("*.tsx")) + sorted(d.glob("*.ts")):
        src = f.read_text(encoding="utf-8")
        count = [0]

        def rep(m):
            x = unescape(m.group("x"))
            prev = src[m.start() - 1] if m.start() > 0 else ""
            if is_code_frag(x) or bare_word(x):
                # revert — but only when it's plausible corruption or a bare
                # word (legit bare-word wraps get re-wrapped by the codemod)
                count[0] += 1
                if prev == "=":
                    return f'"{x}"' if not m.group("brace") else f'"{x}"'
                if prev == ":":
                    return f' "{x}"' if not m.group("brace") else f'"{x}"'
                if prev == "(":
                    return f'"{x}"'
                # bare JSX text position {t("x")} -> x
                if m.group("brace"):
                    return x
                return f'"{x}"'
            return m.group(0)

        out = ANY.sub(rep, src)
        if out != src:
            f.write_text(out, encoding="utf-8")
            print(f"{f.name}: {count[0]} reverted")
print("done")
