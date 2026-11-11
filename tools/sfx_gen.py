#!/usr/bin/env python3
"""Procedural sound effects (step4-sound). No downloads, no licences: ffmpeg synthesises them, the same every run.
Writes media/library/sfx/gen/<name>.wav (44.1 kHz stereo, peaks limited). Needs ffmpeg (the Actions runner has it).
CLI: python3 tools/sfx_gen.py [--force]"""
import os, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "media", "library", "sfx", "gen")
N = lambda d, a, c="pink": "anoisesrc=d=%s:c=%s:a=%s:r=44100" % (d, c, a)
E = lambda expr, d: "aevalsrc='%s':d=%s:s=44100" % (expr, d)
ST = "pan=stereo|c0=c0|c1=c0"

# name -> (inputs, filter_complex). Every graph ends in one stereo stream labelled [o].
SFX = {
    "whoosh_fast": ([N(0.5, 0.9), E("0.35*sin(2*PI*(250*t+9000*t*t))", 0.5)],
                    "[0]highpass=f=350,lowpass=f=7000,afade=t=in:d=0.18,afade=t=out:st=0.2:d=0.3[n];[1]afade=t=in:d=0.1,afade=t=out:st=0.25:d=0.25[c];"
                    "[n][c]amix=inputs=2:normalize=0,alimiter=limit=0.7:level=0," + ST + "[o]"),
    "whoosh_soft": ([N(0.75, 0.7), E("0.2*sin(2*PI*(180*t+3000*t*t))", 0.75)],
                    "[0]highpass=f=200,lowpass=f=4200,afade=t=in:d=0.3,afade=t=out:st=0.3:d=0.45[n];[1]afade=t=in:d=0.25,afade=t=out:st=0.35:d=0.4[c];"
                    "[n][c]amix=inputs=2:normalize=0,alimiter=limit=0.6:level=0," + ST + "[o]"),
    "swish": ([N(0.5, 0.8)],
              "[0]highpass=f=1200,lowpass=f=5200,afade=t=in:d=0.15,afade=t=out:st=0.18:d=0.32,alimiter=limit=0.55:level=0," + ST + "[o]"),
    "hit_low": ([E("0.9*sin(2*PI*(95*t-60*t*t))*exp(-8*t)", 0.6), N(0.6, 0.5, "white")],
                "[1]highpass=f=1500,afade=t=out:st=0:d=0.035[k];[0][k]amix=inputs=2:normalize=0,alimiter=limit=0.8:level=0," + ST + "[o]"),
    "pop": ([E("0.6*sin(2*PI*(650*t+3000*t*t))*exp(-16*t)", 0.22)], "[0]alimiter=limit=0.6:level=0," + ST + "[o]"),
    "tick": ([N(0.1, 0.55, "white")], "[0]highpass=f=2500,afade=t=out:st=0:d=0.06,alimiter=limit=0.5:level=0," + ST + "[o]"),
    "riser": ([N(1.4, 0.7), E("0.22*sin(2*PI*(200*t+1500*t*t))", 1.4)],
              "[0]highpass=f=700,afade=t=in:d=1.2,afade=t=out:st=1.3:d=0.1[n];[1]afade=t=in:d=1.2,afade=t=out:st=1.3:d=0.1[c];"
              "[n][c]amix=inputs=2:normalize=0,alimiter=limit=0.6:level=0," + ST + "[o]"),
}


def make(name, force=False):
    p = os.path.join(OUT, name + ".wav")
    if not force and os.path.exists(p) and os.path.getsize(p) > 1000:
        return True
    ins, graph = SFX[name]
    cmd = ["ffmpeg", "-y", "-loglevel", "error"]
    for i in ins:
        cmd += ["-f", "lavfi", "-i", i]
    cmd += ["-filter_complex", graph, "-map", "[o]", "-ar", "44100", "-ac", "2", p]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0 or not os.path.exists(p):
        print("sfx_gen: %s failed: %s" % (name, r.stderr.strip()[:200]))
        return False
    return True


def main(force=False):
    os.makedirs(OUT, exist_ok=True)
    ok = [n for n in SFX if make(n, force)]
    print("sfx_gen: %d/%d ready in media/library/sfx/gen" % (len(ok), len(SFX)))
    return ok


if __name__ == "__main__":
    try:
        main("--force" in sys.argv)
    except Exception as e:
        print("sfx_gen: skipped (", e, ")")
