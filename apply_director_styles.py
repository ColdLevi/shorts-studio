#!/usr/bin/env python3
"""Usage (from ~/shorts-studio):  python3 apply_director_styles.py [--apply] [file=tools/timeline.py]
Adds directing styles to director_pass. Dry run by default; backs up; restores if py_compile fails.
Without tools/director_styles.py the patched code falls back to the exact old behaviour."""
import sys, shutil, time, subprocess

apply = "--apply" in sys.argv
path = next((a[5:] for a in sys.argv if a.startswith("file=")), "tools/timeline.py")
src = open(path, encoding="utf-8").read()
orig = src


def die(m):
    print("ABORT: %s (no changes made)" % m); sys.exit(1)


if "dstyle" in src:
    die("already patched")


def rep(old, new, label):
    global src
    if src.count(old) != 1:
        die("anchor not found exactly once: " + label)
    src = src.replace(old, new)


rep('    rnd = _random.Random(str(t.get("id")))\n',
    '''    rnd = _random.Random(str(t.get("id")))
    dstyle = {"name": "classic", "blurb": "the standard plan", "gap_mul": 1.0, "callout_mul": 1.0, "icon_mul": 1.0,
              "hook": "behind", "wash": 0.35, "callout": "mixed"}          # = behaviour before styles existed
    try:
        try:
            from tools import director_styles as _dst
        except ImportError:
            import director_styles as _dst
        dstyle = _dst.pick(t, spec)
    except Exception as _e:
        print("director styles off:", _e)
''', "rnd line")
rep('        gap = 5.0\n', '        gap = 5.0\n    gap *= dstyle["gap_mul"]\n', "gap = 5.0")
rep('    cap_callout, cap_icon = 3 + int(dur // 60), 2 + int(dur // 45)\n',
    '''    cap_callout, cap_icon = 3 + int(dur // 60), 2 + int(dur // 45)
    cap_callout = max(1, round(cap_callout * dstyle["callout_mul"]))
    cap_icon = max(1, round(cap_icon * dstyle["icon_mul"]))
''', "caps line")
rep('    layers, notes = [], []\n',
    '''    layers, notes = [], []
    notes.append("Directing style: %s (%s)." % (dstyle["name"], dstyle["blurb"]))
''', "layers, notes")
rep('            word = co or _key_word(text) or text.split()[0]\n',
    '''            word = co or _key_word(text) or text.split()[0]
            if dstyle["hook"] == "quiet":
                notes.append('%s: a quiet open. No hook text, the picture and the voice carry it.' % tag)
                put("color-wash", c, 0.0, opacity=dstyle["wash"], seed=round(rnd.random() * 6, 2))
                last_end, last_kind = c["end"], "hook"
                continue
''', "hook word line")
rep('            if cut:\n                put("depth-text"', '            if cut and dstyle["hook"] == "behind":\n                put("depth-text"', "if cut")
rep('put("color-wash", c, 0.0, opacity=0.35, seed=round(rnd.random() * 6, 2))',
    'put("color-wash", c, 0.0, opacity=dstyle["wash"], seed=round(rnd.random() * 6, 2))', "hook wash")
rep('            corner = n_callout % 2 == 1 and len(fact) <= 12 ',
    '            corner = len(fact) <= 12 and (dstyle["callout"] == "corner" or (dstyle["callout"] == "mixed" and n_callout % 2 == 1)) ', "corner line")
rep('                put("draw-line", c, 0.7, shape="underline", x=0.2, y=0.21, w=0.6)\n',
    '                if dstyle["callout"] != "plain":\n                    put("draw-line", c, 0.7, shape="underline", x=0.2, y=0.21, w=0.6)\n', "draw-line")

print("director styles wired in (8 edits). delta %d chars" % (len(src) - len(orig)))
if not apply:
    print("dry run only; re-run with --apply"); sys.exit(0)
bak = "%s.pre-dstyles-%d" % (path, int(time.time()))
shutil.copy2(path, bak)
open(path, "w", encoding="utf-8").write(src)
r = subprocess.run([sys.executable, "-m", "py_compile", path], capture_output=True, text=True)
if r.returncode:
    shutil.copy2(bak, path); die("py_compile failed, restored backup\n" + r.stderr)
print("applied; backup at " + bak)
