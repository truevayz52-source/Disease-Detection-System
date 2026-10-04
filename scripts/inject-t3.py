"""Inject `const{t}=usePreferences()` at the enclosing top-level function body
for every 'Cannot find name t' error — unless `t` is already bound before that
position (destructured from usePreferences or a const)."""
import re, subprocess, sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parent.parent
CLIENT = ROOT / "client"
IMPORT = 'import { usePreferences } from "@/lib/preferences"'


def collect_errors():
    proc = subprocess.run(
        ["pnpm", "--filter", "client", "typecheck"], cwd=ROOT,
        capture_output=True, text=True, shell=True,
    )
    errs = []
    for line in proc.stdout.splitlines() + proc.stderr.splitlines():
        m = re.match(r"src/(pages|components)/([\w.-]+\.tsx?)\((\d+),(\d+)\): error TS2304: Cannot find name 't'", line)
        if m:
            errs.append((CLIENT / "src" / m.group(1) / m.group(2), int(m.group(3)), int(m.group(4))))
    return errs


def skip_str(s, i):
    q = s[i]
    i += 1
    while i < len(s):
        if s[i] == "\\":
            i += 2
        elif s[i] == q:
            return i + 1
        i += 1
    return i


def enclosing_top_body(s, pos):
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


BOUND = re.compile(r'[{(,]\s*\bt\b\s*[,}]|\bconst\s+t\s*=|\bfunction\s+t\b|\.t\s*=')


def is_fn_body(s, ob):
    pre = s[:ob].rstrip()
    return bool(re.search(r'(\)|=>)\s*$', pre))


for _round in range(4):
    errors = collect_errors()
    if not errors:
        print("clean")
        break
    by_file = {}
    for f, ln, col in errors:
        by_file.setdefault(f, []).append((ln, col))
    for f, locs in by_file.items():
        src = f.read_text(encoding="utf-8")
        line_starts = [0] + [m.end() for m in re.finditer("\n", src)]
        injected = 0
        stray = []
        done = set()
        for ln, col in sorted(locs, reverse=True):
            pos = line_starts[ln - 1] + col - 1
            ob, depth = enclosing_top_body(src, pos)
            if ob is None or depth == 0 or not is_fn_body(src, ob):
                stray.append(ln)
                continue
            if ob in done:
                continue
            if BOUND.search(src[ob:pos]):
                continue  # t bound before this site — different scope issue
            src = src[: ob + 1] + "const{t}=usePreferences();" + src[ob + 1 :]
            line_starts = [0] + [m.end() for m in re.finditer("\n", src)]
            done.add(ob)
            injected += 1
        if injected and IMPORT not in src:
            imps = list(re.finditer(r'^import[^\n]*\n', src, re.M))
            j = imps[-1].end() if imps else 0
            src = src[:j] + IMPORT + "\n" + src[j:]
        if injected:
            f.write_text(src, encoding="utf-8")
        if stray:
            print(f"{f.name}: STRAY {stray}")
    print(f"round {_round}: {len(errors)} errors -> injected")
