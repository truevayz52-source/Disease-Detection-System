"""One-shot codemod: wrap user-visible English literals in tr() across
mobile/lib, and strip `const` from constructor calls that now contain tr().

Rules (conservative — UI slots only):
  Text('lit')            -> Text(tr('lit'))          (skips interpolated $)
  Text("lit")            -> Text(tr("lit"))
  hintText|labelText|helperText|counterText|tooltip|errorText: 'lit'
                       -> : tr('lit')
Skipped literals: assets/, empty, '—', '·', strings containing $ (manual),
pure numbers/ids.
Adds the app_localizations import when a file gained tr().
"""
import re, sys
from pathlib import Path

MOBILE = Path(__file__).resolve().parent.parent / "mobile" / "lib"

LIT = r"'((?:[^'\\$]|\\.)+)'"
DLIT = r'"((?:[^"\\$]|\\.)+)"'
SLOTS = r"(hintText|labelText|helperText|counterText|tooltip|errorText)"

def wrap_text_sq(s, m): return "Text(tr('" + s + "')"
def wrap_text_dq(s, m): return 'Text(tr("' + s + '"))'
def wrap_slot_sq(s, m): return m.group(1) + ": tr('" + s + "')"
def wrap_slot_dq(s, m): return m.group(1) + ': tr("' + s + '")'

PATTERNS = [
    (re.compile(r"\bText\(\s*" + LIT), 1, wrap_text_sq),
    (re.compile(r"\bText\(\s*" + DLIT), 1, wrap_text_dq),
    (re.compile(SLOTS + r"\s*:\s*" + LIT), 2, wrap_slot_sq),
    (re.compile(SLOTS + r"\s*:\s*" + DLIT), 2, wrap_slot_dq),
]

def is_prose(s: str) -> bool:
    if not s or s.startswith("assets/") or "/" in s[:1]:
        return False
    if s in {"—", "·", "•", "–", "-", "|", "…"}:
        return False
    return any(ch.isalpha() for ch in s)

def skip_string(src: str, i: int) -> int:
    q = src[i]
    i += 1
    while i < len(src):
        if src[i] == "\\":
            i += 2
            continue
        if src[i] == q:
            return i + 1
        i += 1
    return i

def strip_consts(src: str) -> str:
    """Remove `const ` from every `const Name(...)` whose arg span contains tr(."""
    changed = True
    while changed:
        changed = False
        for m in re.finditer(r"\bconst\s+([A-Z]\w*)\s*\(", src):
            depth, i = 1, m.end()
            while i < len(src) and depth:
                c = src[i]
                if c == "(":
                    depth += 1
                elif c == ")":
                    depth -= 1
                elif c in "'\"":
                    i = skip_string(src, i) - 1
                i += 1
            if "tr(" in src[m.end() : i]:
                src = src[: m.start()] + src[m.start() :].replace("const ", "", 1)
                changed = True
                break
    return src

def transform(path: Path) -> bool:
    src = path.read_text(encoding="utf-8")
    out = src
    for rx, lit_idx, fmt in PATTERNS:
        def repl(m):
            lit = m.group(lit_idx)
            if not is_prose(lit):
                return m.group(0)
            return fmt(lit, m)
        out = rx.sub(repl, out)
    if out == src:
        return False
    out = strip_consts(out)
    depth = len(path.relative_to(MOBILE).parts) - 1
    imp = "import '" + "../" * depth + "l10n/app_localizations.dart';\n"
    if imp not in out:
        ims = list(re.finditer(r"^import .*;\n", out, re.M))
        out = out[: ims[-1].end()] + "\n" + imp + out[ims[-1].end() :]
    path.write_text(out, encoding="utf-8")
    return True

def main():
    touched = []
    for f in sorted(MOBILE.rglob("*.dart")):
        if "l10n" in f.parts:
            continue
        try:
            if transform(f):
                touched.append(str(f.relative_to(MOBILE)))
        except Exception as e:
            print(f"!! {f.name}: {e}", file=sys.stderr)
    print("\n".join(touched) if touched else "no changes")

if __name__ == "__main__":
    main()
