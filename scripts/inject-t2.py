"""Drive injection off tsc 'Cannot find name t' errors: for each error
position, find the enclosing TOP-LEVEL body (the { where depth goes 0->1)
and inject const{t}=usePreferences() if missing. If the enclosing { isn't a
function body (object literal / module scope), report it."""
import re, subprocess, sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parent.parent
CLIENT = ROOT / "client"
IMPORT = 'import { usePreferences } from "@/lib/preferences"'

proc = subprocess.run(
    ["pnpm", "--filter", "client", "typecheck"], cwd=ROOT,
    capture_output=True, text=True, shell=True,
)
errors = []
for line in proc.stdout.splitlines() + proc.stderr.splitlines():
    m = re.match(r"src/(pages|components)/([\w.-]+\.tsx?)\((\d+),(\d+)\): error TS2304: Cannot find name 't'", line)
    if m:
        errors.append((CLIENT / "src" / m.group(1) / m.group(2), int(m.group(3)), int(m.group(4))))
print(f"{len(errors)} 't' errors")


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
                elif s[i] in "\"'`":
                    i = skip_str(s, i)
                    continue
                i += 1
            continue
        elif s[i] == q:
            return i + 1
        i += 1
    return i


def enclosing_top_body(s, pos):
    """Return index of the '{' where brace depth goes 0->1 on the path to pos,
    i.e. the top-level block containing pos."""
    depth = 0
    i = 0
    top_open = None
    while i < pos:
        c = s[i]
        if c in "\"'`":
            i = skip_str(s, i)
            continue
        if c == "/" and i + 1 < len(s) and s[i + 1] == "/":
            nl = s.find("\n", i)
            i = nl if nl > 0 else len(s)
            continue
        if c == "/" and i + 1 < len(s) and s[i + 1] == "*":
            j = s.find("*/", i)
            i = j + 2 if j > 0 else len(s)
            continue
        if c == "{":
            if depth == 0:
                top_open = i
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                top_open = None
        i += 1
    return top_open, depth


def is_fn_body(s, ob):
    # look back: (...) {   or  x => {   or  ... => {
    pre = s[:ob].rstrip()
    return bool(re.search(r'(\)|=>)\s*$', pre))


by_file = {}
for f, ln, col in errors:
    by_file.setdefault(f, []).append((ln, col))

for f, locs in by_file.items():
    src = f.read_text(encoding="utf-8")
    line_starts = [0]
    for m in re.finditer("\n", src):
        line_starts.append(m.end())
    done = set()
    injected = 0
    stray = []
    for ln, col in sorted(locs, reverse=True):
        pos = line_starts[ln - 1] + col - 1
        ob, depth = enclosing_top_body(src, pos)
        if ob is None or depth == 0:
            stray.append(ln)
            continue
        if ob in done:
            continue
        if not is_fn_body(src, ob):
            stray.append(ln)
            continue
        seg = src[ob:]
        # does this body already contain usePreferences( before the error pos?
        if "usePreferences(" in src[ob : min(pos + 200, len(src))]:
            continue
        src = src[: ob + 1] + "const{t}=usePreferences();" + src[ob + 1 :]
        line_starts = [0] + [m.end() for m in re.finditer("\n", src)]
        done.add(ob)
        injected += 1
    if injected and IMPORT not in src:
        imps = list(re.finditer(r'^import[^\n]*\n', src, re.M))
        j = imps[-1].end() if imps else 0
        src = src[:j] + IMPORT + "\n" + src[j:]
    if injected or stray:
        f.write_text(src, encoding="utf-8")
    print(f"{f.name}: +{injected}" + (f" STRAY {stray}" if stray else ""))
