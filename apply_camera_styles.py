#!/usr/bin/env python3
"""Usage (from ~/shorts-studio):  python3 apply_camera_styles.py [--apply] [file=tools/timeline.py]
Run AFTER apply_director_styles.py. Adds (1) camera styles to camera_pass, (2) spelled-out year callouts to director_pass.
Dry run by default; backs up; restores if py_compile fails. Without tools/director_styles.py the code behaves as before."""
import sys, shutil, time, subprocess

apply = "--apply" in sys.argv
path = next((a[5:] for a in sys.argv if a.startswith("file=")), "tools/timeline.py")
src = open(path, encoding="utf-8").read()
orig = src


def die(m):
    print("ABORT: %s (no changes made)" % m); sys.exit(1)


if "cstyle" in src:
    die("already patched")
if "dstyle" not in src:
    die("run apply_director_styles.py first")


def rep(old, new, label):
    global src
    if src.count(old) != 1:
        die("anchor not found exactly once: " + label)
    src = src.replace(old, new)


# --- director_pass: spelled-out years ("nineteen eighty-five") become callouts for non-classic styles
rep('        if fact and n_callout < cap_callout and last_kind != "callout":\n',
    '''        if not fact and dstyle.get("spoken"):
            fact = _dst.spoken_fact(text) or ""
        if fact and n_callout < cap_callout and last_kind != "callout":
''', "fact check")

# --- camera_pass
rep('    notes, whips, last_whip = [], 0, -99.0\n',
    '''    notes, whips, last_whip = [], 0, -99.0
    cstyle = {"name": "classic", "blurb": "the standard camera", "orbit_every": 3, "orbit_phase": 0, "truck_every": 4,
              "truck_phase": 2, "base": ["drift"], "amp_mul": 1.0, "whips": 2, "last": "pull-out", "pt_mod": 2}   # = old behaviour
    try:
        try:
            from tools import director_styles as _dcs
        except ImportError:
            import director_styles as _dcs
        cstyle = _dcs.pick_camera(t, spec)
    except Exception as _e:
        print("camera styles off:", _e)
''', "notes, whips")
rep('        amp = round(max(0.35, min(0.8, 0.3 + 0.12 * dur)), 2)\n',
    '        amp = round(max(0.35, min(0.8, 0.3 + 0.12 * dur)) * cstyle["amp_mul"], 2)\n', "amp")
rep('        elif has_cut and i % 3 == 0:\n', '        elif has_cut and i % cstyle["orbit_every"] == cstyle["orbit_phase"]:\n', "orbit")
rep('        elif i % 4 == 2:\n', '        elif i % cstyle["truck_every"] == cstyle["truck_phase"]:\n', "truck")
rep('            move, why = "drift", "alive baseline"\n',
    '            move, why = cstyle["base"][i % len(cstyle["base"])], "alive baseline"\n', "baseline")
rep('            move, why = "pull-out", "last picture: slow pull-out"\n',
    '            move, why = cstyle["last"], "last picture: " + ("slow pull-out" if cstyle["last"] == "pull-out" else cstyle["last"])\n', "last picture")
rep('if ends and whips < 2 and b["start"] - last_whip > 8.0', 'if ends and whips < cstyle["whips"] and b["start"] - last_whip > 8.0', "whips")
rep('(carried % 2 == 0 and pm in ("hold", "orbit", "pull-out", None))', '(carried % cstyle["pt_mod"] == 0 and pm in ("hold", "orbit", "pull-out", None))', "push-through")
rep('elif pm in ("drift", "truck") and carried % 2 == 1:', 'elif pm in ("drift", "truck") and carried % cstyle["pt_mod"] != 0:', "carry")
rep('["- " + n for n in notes[:24]])',
    '["- " + n for n in notes[:24]] + ["- Camera style: %s (%s)." % (cstyle["name"], cstyle["blurb"])])', "camera notes")

print("camera styles + spoken years wired in (12 edits). delta %d chars" % (len(src) - len(orig)))
if not apply:
    print("dry run only; re-run with --apply"); sys.exit(0)
bak = "%s.pre-cstyles-%d" % (path, int(time.time()))
shutil.copy2(path, bak)
open(path, "w", encoding="utf-8").write(src)
r = subprocess.run([sys.executable, "-m", "py_compile", path], capture_output=True, text=True)
if r.returncode:
    shutil.copy2(bak, path); die("py_compile failed, restored backup\n" + r.stderr)
print("applied; backup at " + bak)
