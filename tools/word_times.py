#!/usr/bin/env python3
"""word_times.py AUDIO SCRIPT.md OUTDIR [--model base]
Transcribes the voice-over with word timestamps (faster-whisper), then finds where each scene of the script
starts and ends in the recording. Writes OUTDIR/words.json and OUTDIR/scenes.json.
Scene format: '## Scene N: title' followed by 'narration: ...'."""
import json, os, re, sys, difflib

def norm(w):
    return re.sub(r"[^a-z0-9]", "", w.lower())

def script_scenes(md):
    out = []
    for m in re.finditer(r"^##\s*Scene\s*(\d+)[^\n]*\n(?:.*\n)*?narration:\s*([^\n]*)", md, re.M):
        out.append((int(m.group(1)), m.group(2).strip()))
    return out

def align(words, scenes):
    """words: [(start,end,text)]. Returns [{n,start,end,matched,total}] by matching the script's word sequence to the transcript."""
    tw = [norm(w[2]) for w in words]
    keep = [i for i, w in enumerate(tw) if w]
    tw = [tw[i] for i in keep]
    tt = [words[i] for i in keep]
    sw, owner = [], []
    for n, text in scenes:
        for w in text.split():
            if norm(w):
                sw.append(norm(w)); owner.append(n)
    sm = difflib.SequenceMatcher(None, sw, tw, autojunk=False)
    first, last, cnt = {}, {}, {}
    for a, b, size in sm.get_matching_blocks():
        for k in range(size):
            n = owner[a + k]
            t = tt[b + k]
            first[n] = min(first.get(n, 1e9), t[0])
            last[n] = max(last.get(n, 0), t[1])
            cnt[n] = cnt.get(n, 0) + 1
    res = []
    total = {n: sum(1 for o in owner if o == n) for n, _ in scenes}
    for n, _ in scenes:
        res.append({"n": n, "start": round(first.get(n, -1), 3), "end": round(last.get(n, -1), 3), "matched": cnt.get(n, 0), "total": total[n]})
    # scene boundaries: a scene runs from its first word to the next scene's first word (the last one to the end of speech)
    for i, r in enumerate(res):
        nxt = res[i + 1]["start"] if i + 1 < len(res) and res[i + 1]["start"] >= 0 else None
        r["cut_end"] = round(nxt if nxt is not None else r["end"], 3)
    return res

def main():
    audio, script, out = sys.argv[1], sys.argv[2], sys.argv[3]
    model = sys.argv[sys.argv.index("--model") + 1] if "--model" in sys.argv else "base"
    os.makedirs(out, exist_ok=True)
    from faster_whisper import WhisperModel
    m = WhisperModel(model, device="cpu", compute_type="int8")
    segs, info = m.transcribe(audio, word_timestamps=True, vad_filter=True)
    words = [(float(w.start), float(w.end), w.word.strip()) for s in segs for w in (s.words or [])]
    json.dump({"duration": info.duration, "words": words}, open(os.path.join(out, "words.json"), "w"))
    sc = align(words, script_scenes(open(script, encoding="utf-8").read()))
    json.dump(sc, open(os.path.join(out, "scenes.json"), "w"), indent=1)
    for r in sc:
        print("scene %d  %7.2f -> %7.2f  (matched %d/%d words)" % (r["n"], r["start"], r["cut_end"], r["matched"], r["total"]))

if __name__ == "__main__":
    main()
