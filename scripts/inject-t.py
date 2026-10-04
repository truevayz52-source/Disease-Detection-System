"""Inject `const { t } = usePreferences()` into every function body that
references t( and lacks it; ensure the import exists. Reports module-scope
t( references (cannot be fixed by injection) for manual handling."""
import re, sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parent.parent
DIRS = [ROOT / "client" / "src" / "pages", ROOT / "client" / "src" / "components"]
IMPORT = 'import { usePreferences } from "@/lib/preferences"'
SKIP = {"language-menu.tsx", "preferences.tsx", "service-worker-registration.tsx"}


def skip_str(s, i):
    q = s[i]
    i += 1
    while i < len(s):
        if s[i] == "\\":
            i += 2
        elif q == "`" and s[i] == "$" and i + 1 < len(s) and s[i + 1] == "{":
            depth = 1
            i += 2
            while i < len(s) and depth:
                if s[i] == "{":
                    depth += 1
                elif s[i] == "}":
                    depth -= 1
                elif s[i] in "\"'":
                    i = skip_str(s, i)
                    continue
                i += 1
        elif s[i] == q:
            return i + 1
        i += 1
    return i


def body_end(s, open_idx):
    depth = 0
    i = open_idx
    while i < len(s):
        c = s[i]
        if c in "\"'`":
            i = skip_str(s, i)
            continue
        if c == "/" and i + 1 < len(s) and s[i + 1] == "/":
            nl = s.find("\n", i)
            i = nl if nl > 0 else len(s)
            continue
        if c == "/" and i + 1 < len(s) and s[i + 1] == "*":
            i = s.find("*/", i) + 2
            continue
        if c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                return i
        i += 1
    return len(s) - 1


def fn_bodies(s):
    """Yield (open_brace_idx, close_idx) for top-level function bodies only."""
    bodies = []
    i, n = 0, len(s)
    brace_depth = 0
    top_end = -1
    while i < n:
        c = s[i]
        if c in "\"'`":
            i = skip_str(s, i)
            continue
        if c == "/" and i + 1 < n and s[i + 1] == "/":
            nl = s.find("\n", i)
            i = nl if nl > 0 else n
            continue
        if c == "/" and i + 1 < n and s[i + 1] == "*":
            j = s.find("*/", i)
            i = j + 2 if j > 0 else n
            continue
        # detect function bodies: =>{ or function ... {
        m = re.compile(r'(?:function\s*\w*\s*\([^)]*\)\s*(?::\s*[^{]+)?\{|(?:\([^()]*(?:\([^()]*\)[^()]*)*\)|[\w$]+)\s*=>\s*\{)').match(s, i)
        if m and i > top_end:
            ob = m.end() - 1
            ce = body_end(s, ob)
            bodies.append((ob, ce))
            top_end = ce
            i = ob + 1
            continue
        if c == "{":
            brace_depth += 1
        elif c == "}":
            brace_depth -= 1
        i += 1
    return bodies


for d in DIRS:
    for f in sorted(d.glob("*.tsx")) + sorted(d.glob("*.ts")):
        if f.name in SKIP:
            continue
        src = f.read_text(encoding="utf-8")
        if "t(" not in src or src.count("t(") == 0:
            continue
        bodies = fn_bodies(src)
        used_ranges = []
        injected = 0
        out = src
        for ob, ce in bodies:
            seg = out[ob:ce]
        # work on src, inject from last to first
        for ob, ce in reversed(bodies):
            seg = src[ob:ce]
            if "t(" in seg and "usePreferences(" not in seg:
                src = src[: ob + 1] + "const{t}=usePreferences();" + src[ob + 1 :]
                injected += 1
        # module-scope leftovers: t( outside every body
        # crude check: t( at depth 0
        depth = 0
        i = 0
        stray = []
        while i < len(src):
            c = src[i]
            if c in "\"'`":
                i = skip_str(src, i)
                continue
            if c == "{":
                depth += 1
            elif c == "}":
                depth -= 1
            elif c == "t" and src[i + 1] == "(" and depth == 0:
                # module scope t(
                if not re.search(r'[\w$.]', src[i - 1]):
                    stray.append(src.count("\n", 0, i) + 1)
            i += 1
        if injected:
            if IMPORT not in src:
                imps = list(re.finditer(r'^import[^\n]*\n', src, re.M))
                if imps:
                    j = imps[-1].end()
                    src = src[:j] + IMPORT + "\n" + src[j:]
                else:
                    src = IMPORT + "\n" + src
            f.write_text(src, encoding="utf-8")
            print(f"{f.name}: +{injected} hooks" + (f" STRAY t()@lines {stray}" if stray else ""))
        elif stray:
            print(f"{f.name}: STRAY t() @lines {stray}")
