"""Codemod: wrap user-visible English literals in client/src with t().
  - JSX text children: >Some label< -> >{t("Some label")}<
  - attribute literals: title|label|placeholder|description|aria-label="..." -> ={t("...")}
  - object props:     (title|label|description|message|tooltip|header): "..." -> : t("...")
  - toast/confirm:    toast.success("...") -> toast.success(t("..."))
Then injects `const{t}=usePreferences()` into each outermost function body
that gained a t() reference, plus the import. Review `git diff` after."""
import re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DIRS = [ROOT / "client" / "src" / "pages", ROOT / "client" / "src" / "components"]
SKIP_FILES = {"language-menu.tsx", "service-worker-registration.tsx"}
IMPORT = 'import { usePreferences } from "@/lib/preferences"'

def is_prose(s: str) -> bool:
    if len(s.strip()) < 2 or not re.search(r"[A-Za-z]", s):
        return False
    if s.startswith(("/", "http", "data:", "#", "uuid", "dds_")):
        return False
    if "&" in s or s.strip().startswith(("e.g.",)):
        pass  # still prose-worthy
    return True

def esc(s: str) -> str:
    return s.replace("\\", "\\\\").replace('"', '\\"')

ATTR = re.compile(
    r'(\s(?:title|label|placeholder|description|aria-label|tooltip|caption))="([^"{<>\n]*[A-Za-z][^"{<>\n]*)"')
PROP = re.compile(
    r'\b(label|title|description|message|tooltip|header|subtitle|emptyText|hint|okText|cancelText):\s*"([^"\n]*[A-Za-z][^"\n]*)"')
TOAST = re.compile(
    r'\b(toast\.(?:success|error|info|warning|message)|confirm|alert)\(\s*"([^"\n]*[A-Za-z][^"\n]*)"')
JTEXT = re.compile(r'>([^<>{}\n]*[A-Za-z][^<>{}\n]*)<')
STRSET = re.compile(r'\b(setError|setMessage|setStatus|setVerifyResult|setNote|throw new Error|Error)\(\s*"([^"\n]*[A-Za-z][^"\n]*)"')

def wrap_attrs(src: str) -> str:
    def rep(m):
        return f'{m.group(1)}={{t("{esc(m.group(2).strip())}")}}'
    return ATTR.sub(rep, src)

def wrap_props(src: str) -> str:
    def rep(m):
        return f'{m.group(1)}: t("{esc(m.group(2))}")'
    return PROP.sub(rep, src)

def wrap_toasts(src: str) -> str:
    def rep(m):
        return f'{m.group(1)}(t("{esc(m.group(2))}")'
    return TOAST.sub(rep, src)

def wrap_setters(src: str) -> str:
    def rep(m):
        return f'{m.group(1)}(t("{esc(m.group(2))}")'
    return STRSET.sub(rep, src)

def wrap_text(src: str) -> str:
    def rep(m):
        raw = m.group(1)
        lead = raw[: len(raw) - len(raw.lstrip())]
        trail = raw[len(raw.rstrip()):]
        core = raw.strip()
        if not is_prose(core):
            return m.group(0)
        # keep punctuation glue (bullets, dashes, pipes) outside the key
        core2 = re.sub(r'^[·•|—–\-\s]+|[·•|—–\-\s]+$', "", core)
        if not core2:
            return m.group(0)
        glue_l = core[: len(core) - len(core.lstrip("·•|—–- "))]
        glue_r = core[len(core.rstrip("·•|—–- ")):]
        return f'>{lead}{glue_l}{{t("{esc(core2)}")}}{glue_r}{trail}<'
    return JTEXT.sub(rep, src)

def find_body_end(src: str, open_idx: int) -> int:
    """Index of the `}` matching src[open_idx]=='{'. Strings/comments handled
    crudely — good enough for this minified-ish codebase."""
    depth, i, n = 0, open_idx, len(src)
    while i < n:
        c = src[i]
        if c in '"\'`':
            j = i + 1
            while j < n and src[j] != c:
                j += 2 if src[j] == "\\" else 1
            i = j + 1
            continue
        if c == "/" and i + 1 < n and src[i + 1] == "/":
            i = src.find("\n", i)
            if i < 0:
                return n - 1
            continue
        if c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                return i
        i += 1
    return n - 1

FN_OPEN = re.compile(r'(?:function\s+\w+|[A-Za-z_$][\w$]*\s*=\s*(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>)\s*\{')
ALSO_ARROW = re.compile(r'\)\s*=>\s*\{')  # callbacks — covered via outermost span

def inject_hooks(src: str) -> str:
    """Add const{t}=usePreferences() at top of every outermost function body
    that contains t( and doesn't already call usePreferences()."""
    opens = [m for m in FN_OPEN.finditer(src)]
    # compute outermost bodies
    bodies = []
    covered_until = -1
    for m in opens:
        start = m.end() - 1  # index of '{'
        if start <= covered_until:
            continue  # nested — inherits t from the enclosing body
        end = find_body_end(src, start)
        bodies.append((start, end))
        covered_until = end
    injected = 0
    for start, end in reversed(bodies):
        body = src[start:end]
        if "t(" in body and "usePreferences(" not in body:
            src = src[: start + 1] + "const{t}=usePreferences();" + src[start + 1 :]
            injected += 1
    return src

def process(path: Path) -> bool:
    src = path.read_text(encoding="utf-8")
    if "usePreferences" in src and "{ t }" in src or "const{t}" in src:
        pass
    orig = src
    src = wrap_setters(src)
    src = wrap_toasts(src)
    src = wrap_props(src)
    src = wrap_attrs(src)
    src = wrap_text(src)
    if "t(" not in src or src == orig:
        return False
    src = inject_hooks(src)
    if IMPORT not in src:
        # insert after the last import line
        imports = list(re.finditer(r'^import[^\n]*\n', src, re.M))
        if imports:
            i = imports[-1].end()
            src = src[:i] + IMPORT + "\n" + src[i:]
        else:
            src = IMPORT + "\n" + src
    path.write_text(src, encoding="utf-8")
    return True

changed = []
for d in DIRS:
    for f in sorted(d.glob("*.tsx")) + sorted(d.glob("*.ts")):
        if f.name in SKIP_FILES or f.name == "preferences.tsx":
            continue
        try:
            if process(f):
                changed.append(str(f.relative_to(ROOT)))
        except Exception as e:
            print(f"ERR {f.name}: {e}", file=sys.stderr)
print("\n".join(changed))
print(f"\n{len(changed)} files migrated")
