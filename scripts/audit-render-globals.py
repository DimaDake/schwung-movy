#!/usr/bin/env python3
"""Audit what every plugin's render_block reaches: file-scope mutable state.

Same shape as schwung/tools/spike/create_instance_audit.py, but the question is
the one movy's parallel-render plan gates on: if two chains render concurrently
and both hold an instance of the SAME .so (dlopen dedups by realpath), what
non-instance state do they share?

Run from the directory holding the module repos.
"""
import re, os, glob, sys

# Every checked-out repo, not a list of name patterns. The fleet is named by
# ~six unrelated conventions (`schwung-*`, `move-anything-*`, `move-everything-*`,
# `*-move`, and several bare names), so a pattern list silently audits a subset
# and reports a fleet verdict — it missed 28 of 93 repos, drums and FX included.
SELF = {'movy', 'movy-pr2', 'schwung', 'schwung-catalog-site', 'docs'}
roots = sorted(d for d in os.listdir('.')
               if d not in SELF and os.path.isdir(os.path.join(d, '.git')))

HOSTCALL = re.compile(r'->\s*(log|midi_send_internal|midi_send_external|midi_inject_to_move|'
                      r'mod_emit_value|mod_clear_source|get_clock_status|get_bpm|get_beat_position|'
                      r'slot_recv_channel|mapped_memory)\b')
RISK = re.compile(r'\b(pthread_create|pthread_mutex_lock|dlopen|fopen|malloc|calloc|realloc|free|'
                  r'rand|srand|localtime|strtok|system)\s*\(')

# file-scope mutable statics: `static <type> name` at column 0, not const, not a function
# `const\b` alone does NOT exclude `constexpr` — the \b fails against the 'e',
# so the lookahead passes and every C++ compile-time constant is reported as
# shared mutable state. That produced three of eight fleet hits (plaits'
# kGainTable, virus' VIRUS_MAX_*), which is enough noise to discredit the list.
STATIC_DEF = re.compile(r'^static\s+(?!const\b|constexpr\b)([A-Za-z_][\w\s\*]*?)\s*([A-Za-z_]\w*)\s*(\[[^;]*\])?\s*(=[^;]*)?;',
                        re.M)


def fnbody(src, name):
    for m in re.finditer(r'(?<![\w.])' + re.escape(name) + r'\s*\(', src):
        i = m.end() - 1
        d = 0
        j = i
        while j < len(src):
            if src[j] == '(':
                d += 1
            elif src[j] == ')':
                d -= 1
                if d == 0:
                    break
            j += 1
        k = j + 1
        while k < len(src) and src[k] in ' \t\r\n':
            k += 1
        if k < len(src) and src[k] == '{':
            d = 0
            e = k
            while e < len(src):
                if src[e] == '{':
                    d += 1
                elif src[e] == '}':
                    d -= 1
                    if d == 0:
                        break
                e += 1
            return src[k:e + 1]
    return None


CALL = re.compile(r'(?<![\w.>])([a-zA-Z_]\w{2,})\s*\(')
KW = set('if for while switch return sizeof snprintf memset memcpy strcmp strncmp strcpy '
         'strncpy atoi atof strdup printf fprintf sprintf strlen static_cast reinterpret_cast '
         'const_cast dynamic_cast new delete catch strstr strchr sscanf fmin fmax fabs sqrt '
         'sin cos tan exp log pow floor ceil round abs min max expf logf powf sinf cosf tanf '
         'sqrtf fabsf floorf ceilf roundf tanhf assert'.split())

# A repo that prints nothing is either CLEAN or INVISIBLE, and the difference
# decides whether "6 of 65 touch shared statics" is a verdict or a floor. Track
# the three outcomes separately rather than inferring them from silence.
flagged, clean, blind = set(), set(), set()

any_hit = False
for r in roots:
    files = [f for f in glob.glob(r + '/src/**/*', recursive=True) if f.endswith(('.c', '.cpp', '.cc'))]
    files += [f for f in glob.glob(r + '/*') if f.endswith(('.c', '.cpp', '.cc'))]
    for f in sorted(set(files)):
        try:
            s = open(f, errors='ignore').read()
        except Exception:
            continue
        m = re.search(r'\.render_block\s*=\s*([A-Za-z_]\w*)', s)
        entry = m.group(1) if m else None
        if entry is None:
            # A POSITIONAL initializer names the field only in a comment —
            # plaits writes `/* render_block = */ render_block,`. Fall back to
            # the v2 signature, which is unambiguous in these sources.
            m = re.search(r'\bvoid\s+([A-Za-z_]\w*)\s*\(\s*void\s*\*\s*\w+\s*,\s*'
                          r'(?:const\s+)?int16_t\s*\*\s*\w+\s*,\s*int\s+\w+\s*\)\s*\{', s)
            entry = m.group(1) if m else None
        if entry is None:
            if re.search(r'\brender_block\b', s):
                blind.add(r)
            continue
        statics = {}
        for sm in STATIC_DEF.finditer(s):
            nm = sm.group(2)
            if nm and not re.match(r'^\s*$', nm):
                statics[nm] = sm.group(0).strip()[:90]
        seen, stack = set(), [entry]
        host, risk, touched = set(), set(), set()
        while stack:
            n = stack.pop()
            if n in seen or len(seen) > 120:
                continue
            seen.add(n)
            b = fnbody(s, n)
            if b is None:
                continue
            host |= set(HOSTCALL.findall(b))
            risk |= set(x[0] if isinstance(x, tuple) else x for x in RISK.findall(b))
            for nm in statics:
                if re.search(r'(?<![\w.>])' + re.escape(nm) + r'(?![\w(])', b):
                    touched.add(nm)
            for c in CALL.findall(b):
                if c not in KW and c not in seen:
                    stack.append(c)
        blind.discard(r)
        (flagged if touched else clean).add(r)
        if touched or host or risk:
            any_hit = True
            print(f"\n{r}  [{os.path.relpath(f, r)}]  entry={entry}  fns={len(seen)}")
            if touched:
                print("   SHARED STATICS TOUCHED:")
                for nm in sorted(touched):
                    print(f"      {nm:28s} {statics[nm]}")
            if host:
                print(f"   host calls: {', '.join(sorted(host))}")
            if risk:
                print(f"   risk calls: {', '.join(sorted(risk))}")

if not any_hit:
    print("no render_block entry points resolved", file=sys.stderr)

clean -= flagged
blind -= flagged | clean
print(f"\n{'=' * 62}\nSUMMARY over {len(roots)} checked-out repos")
print(f"  render_block resolved, TOUCHES shared statics : {len(flagged):3d}  {' '.join(sorted(flagged))}")
print(f"  render_block resolved, clean                  : {len(clean):3d}")
print(f"  mentions render_block, NOT resolved (blind)   : {len(blind):3d}  {' '.join(sorted(blind))}")
print(f"  no render_block at all                        : "
      f"{len(roots) - len(flagged) - len(clean) - len(blind):3d}")
if blind:
    print("\n  The blind set is not evidence of safety. Read those by hand before\n"
          "  treating the flagged count as a fleet verdict.")
