#!/usr/bin/env python3
"""Shorts Studio projects: inspect, patch, rebuild, version and re-render saved video timelines.

  python tools/project.py info <id>                  what's in the project, which clips need making
  python tools/project.py validate <id|file.json>
  python tools/project.py patch <id> <patch.json> [-m "why"]   apply a JSON patch (RFC 6902; /tracks/visuals/@v3/src id paths ok)
  python tools/project.py build <id>                 remake only dirty/missing assets (voice, images, AI clips, downloads)
  python tools/project.py reformat <id> <16:9|9:16|1:1|4:5|WxH> [--regen-images]
  python tools/project.py style <id> <preset> [caption-preset]   e.g. style my-vid documentary | style my-vid - neon
  python tools/project.py history <id>             raw revisions   |  versions <id>  user-facing versions (what /history shows)
  python tools/project.py edits <id> <edits.json>  step 2: apply the bot's queued edits [{id, patch|revert, message}], skip ones
                                                   already applied, rebuild only what changed, one version each
  python tools/project.py scenes <id|file.json>    scenes 1..N with text and visual type (what /scenes shows)
  python tools/project.py diff <old.json> <new.json>   what an edit would remake (lines to re-voice, images to repaint)
  python tools/project.py revert <id> <rev>          make an old revision current again (as a new revision)
  python tools/project.py migrate <props.json> <id> [spec.json]  old StoryShort props -> timeline
  python tools/project.py pull <id> | push <id>      assets <-> GitHub release project-<id> (needs gh)
  python tools/project.py jobspec <id>               write job/spec.json for the publish/Telegram steps
  python tools/project.py render <id> [out.mp4] [--still SECONDS]   local Remotion render (needs remotion/node_modules)
Run from the repo root. Step 2's edit agent only has to write the patch; `patch` + `build` + render do the rest."""
import json, os, subprocess, sys
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import timeline as TL  # noqa: E402

ROOT = TL.ROOT


def die(msg, code=1):
    print(msg, file=sys.stderr)
    sys.exit(code)


def load_any(arg):
    if arg.endswith(".json") and os.path.exists(arg):
        return json.load(open(arg))
    return TL.load(arg)


def cmd_info(pid):
    t = TL.load(pid)
    c = t["canvas"]
    print(f"{t['title']}  [{pid}]  rev {t.get('rev')}  {c['width']}x{c['height']} @{c['fps']}fps  {t.get('duration')}s")
    print(f"style: {t['style'].get('preset', 'bold-pop')}, captions {t['style'].get('caption', {}).get('preset')}, accent {t['style'].get('accent')}")
    for tr in ("visuals", "voice", "music", "sfx", "overlays"):
        clips = t["tracks"].get(tr) or []
        print(f"{tr}: {len(clips)}")
        for x in clips:
            if tr == "visuals":
                print(f"  {x['id']:>5} {x['kind']:<8} {x['start']:6.2f}-{x['end']:6.2f}  {x.get('src') or (x.get('graphic') or {}).get('type', '')}{'  DIRTY' if x.get('dirty') else ''}")
    todo = TL.needs_build(t)
    print("needs build:", ", ".join(c["id"] for _, c in todo) or "nothing")


def cmd_validate(arg):
    errs = TL.validate(load_any(arg))
    print("\n".join(errs) if errs else "ok")
    sys.exit(1 if errs else 0)


def cmd_patch(pid, patch_file, message="edit"):
    t = TL.load(pid)
    ops = json.load(open(patch_file))
    ops = ops.get("patch", ops) if isinstance(ops, dict) else ops
    new, changed = TL.apply_patch(t, ops)
    errs = TL.validate(new)
    if errs:
        die("patch rejected:\n" + "\n".join(errs))
    rev = TL.save(new, message, patch=ops)
    print(f"r{rev} saved. remake: {', '.join(changed) or 'nothing (render only)'}")


def cmd_build(pid):
    t = TL.load(pid)
    if not TL.needs_build(t):
        print("nothing to build")
        return
    rep = build_timeline(pid, t, int(t.get("rev") or 0) + 1)
    rev = TL.save(t, f"rebuilt {', '.join(rep['done']) or 'nothing'}" + (f"; failed {', '.join(rep['failed'])}" if rep["failed"] else ""))
    print(f"r{rev}: rebuilt {rep['done'] or '-'}; failed {rep['failed'] or '-'}")
    if rep["failed"]:
        sys.exit(3)


# ---------- voice: re-record only the scenes whose narration changed ----------
def _ff(*args):
    r = subprocess.run(["ffmpeg", "-y", "-loglevel", "error", *args], capture_output=True, text=True)
    if r.returncode:
        raise RuntimeError("ffmpeg: " + r.stderr.strip()[-300:])


def _wav_seconds(path):
    import wave
    with wave.open(path) as w:
        return w.getnframes() / float(w.getframerate())


def revoice(pid, t, nxt, B):
    """Rebuild the voiceover from per-scene segments: unchanged lines are reused (cut from the old file or their
    own segment file), changed lines are re-recorded alone with edge-tts, then everything is joined and every clip,
    caption word and anchored SFX is re-timed from the real segment lengths. Returns {revoiced, reused}."""
    import tempfile
    vo = t["tracks"]["voice"][0]
    g = vo.get("gen") or {}
    key = TL._voice_key(g)
    have = [s for s in vo.get("segments") or [] if s.get("voice") == key]
    by_clip = {(s["clip"], TL.norm_text(s["text"])): s for s in have}
    by_text = {TL.norm_text(s["text"]): s for s in have}
    tmp = tempfile.mkdtemp(prefix="vo-")
    pieces, segs, revoiced, reused = [], [], [], []
    for i, v in enumerate(t["tracks"]["visuals"]):
        text = (v.get("narration") or "").strip()
        wav = os.path.join(tmp, f"{i:03d}.wav")
        if not text:  # a silent scene keeps its length
            _ff("-f", "lavfi", "-t", f"{max(0.4, float(v['end']) - float(v['start'])):.3f}", "-i", "anullsrc=r=24000:cl=mono", wav)
            pieces.append((v, wav, []))
            continue
        old = by_clip.get((v["id"], TL.norm_text(text))) or by_text.get(TL.norm_text(text))
        seg_src = None
        if old:
            src_file = TL.asset_path(pid, old.get("src")) if old.get("src") else None
            from_file = TL.asset_path(pid, old.get("from")) if old.get("from") else None
            try:
                if src_file and os.path.exists(src_file):
                    _ff("-i", src_file, "-ac", "1", "-ar", "24000", wav)
                    seg_src = old["src"]
                elif from_file and os.path.exists(from_file):
                    _ff("-ss", f"{old['t0']:.3f}", "-to", f"{old['t1']:.3f}", "-i", from_file, "-ac", "1", "-ar", "24000", wav)
                else:
                    old = None
            except Exception as e:
                print("segment reuse failed, re-recording:", e)
                old = None
        if old:
            words = old.get("words") or []
            reused.append(v["id"])
        else:
            mp3 = os.path.join(tmp, f"{i:03d}.mp3")
            words, _ = B.voice(text, g.get("voice"), g.get("rate"), mp3)
            _ff("-i", mp3, "-ac", "1", "-ar", "24000", wav)
            revoiced.append(v["id"])
        if not seg_src:  # keep this line as its own file for the next edit
            seg_src = f"assets/vo_{v['id']}_{TL.file_hash(wav)[:8]}.mp3"
            dest = TL.asset_path(pid, seg_src)
            if not os.path.exists(dest):
                _ff("-i", wav, "-c:a", "libmp3lame", "-b:a", "64k", dest)
        segs.append({"clip": v["id"], "text": text, "src": seg_src, "words": words, "voice": key})
        pieces.append((v, wav, words))
    # join in order (WAV keeps sample-exact lengths), then one mp3 for the render
    lst = os.path.join(tmp, "list.txt")
    open(lst, "w").write("".join(f"file '{w}'\n" for _, w, _ in pieces))
    full_wav = os.path.join(tmp, "voice.wav")
    _ff("-f", "concat", "-safe", "0", "-i", lst, "-c", "copy", full_wav)
    name = f"assets/voice_r{nxt}.mp3"
    _ff("-i", full_wav, "-c:a", "libmp3lame", "-b:a", "96k", TL.asset_path(pid, name))
    at, all_words = 0.0, []
    for v, wav, words in pieces:
        d = _wav_seconds(wav)
        v["start"], v["end"] = round(at, 3), round(at + d, 3)
        all_words += [{"word": w["word"], "start": round(w["start"] + at, 3), "end": round(w["end"] + at, 3)} for w in words]
        at += d
    total = at
    vo.update(src=name, hash=TL.file_hash(TL.asset_path(pid, name)), segments=segs)
    vo.pop("dirty", None)
    g["text"] = TL.voice_text(t)
    t["tracks"]["captions"] = {**(t["tracks"].get("captions") or {}), "words": all_words}
    t["duration"] = round(total + 0.8, 2)
    byid = {v["id"]: v for v in t["tracks"]["visuals"]}
    for s in t["tracks"].get("sfx") or []:
        if s.get("anchor") in byid:
            s["at"] = round(byid[s["anchor"]]["start"] + (s.get("offset") or 0), 3)
    for o in t["tracks"].get("overlays") or []:
        if o.get("anchor") in byid:
            o["start"], o["end"] = byid[o["anchor"]]["start"], byid[o["anchor"]]["end"]
    print(f"voice: re-recorded {revoiced or 'nothing'}, reused {len(reused)} line(s), {total:.1f}s")
    return {"revoiced": revoiced, "reused": reused}


def build_timeline(pid, t, nxt):
    """Remake only dirty/missing assets of timeline t (in place). Returns a report dict."""
    import build_short as B
    B.set_project(pid, t["canvas"])
    todo = TL.needs_build(t, pid)
    rep = {"done": [], "failed": [], "revoiced": [], "reused_lines": 0, "repainted": []}
    if not todo:
        return rep
    adir = os.path.join(TL.project_dir(pid), "assets")
    os.makedirs(adir, exist_ok=True)
    style = (t.get("meta") or {}).get("image_style", "")
    done, failed = rep["done"], rep["failed"]

    # 1) voice first: it moves every clip's timing
    for tr, c in [x for x in todo if x[0] == "voice"]:
        g = c.get("gen") or {}
        try:
            if g.get("tool") == "edge-tts" and t["tracks"]["visuals"] and c is t["tracks"]["voice"][0]:
                r = revoice(pid, t, nxt, B)
                rep["revoiced"], rep["reused_lines"] = r["revoiced"], len(r["reused"])
            else:
                text = g.get("text") or TL.voice_text(t)
                name = f"assets/voice_r{nxt}.mp3"
                words, total = B.voice(text, g.get("voice"), g.get("rate"), TL.asset_path(pid, name))
                c["src"], c["hash"] = name, TL.file_hash(TL.asset_path(pid, name))
                c.pop("dirty", None)
                TL.retime(t, words, total)
            done.append(c["id"])
        except BaseException as e:
            print("voice failed:", e); failed.append(c["id"])

    vis = t["tracks"]["visuals"]
    first = vis[0]["id"] if vis else None

    def make(item):
        tr, c = item
        g = c.get("gen") or {}
        tool = (g.get("tool") or "flux").lower()
        try:
            if tr == "music":
                if tool == "library" and g.get("name"):
                    c["src"] = f"library/music/clips/{g['name']}.mp3"
                    c.pop("dirty", None)
                    return c["id"], True
                return c["id"], False
            if tool in ("url", "stock", "upload") or g.get("url"):
                ext = os.path.splitext(g["url"].split("?")[0])[1] or (".mp4" if c["kind"] in ("stock", "ai_video") else ".jpg")
                name = f"assets/{c['id']}_r{nxt}{ext}"
                import urllib.request
                urllib.request.urlretrieve(g["url"], TL.asset_path(pid, name))
                c["src"] = name
                if ext.lower() in (".mp4", ".mov", ".webm", ".m4v"):
                    c["duration"] = round(B.duration(TL.asset_path(pid, name)), 2)
            elif c["kind"] == "ai_video" or tool == "higgsfield":
                still = f"assets/{c['id']}_r{nxt}.jpg"
                B.paint(g.get("prompt", ""), TL.asset_path(pid, still), g.get("still") or "flux", style, hero=False)
                clip = f"assets/{c['id']}_r{nxt}.mp4"
                d = B.higgsfield(TL.asset_path(pid, still), g.get("motion") or g.get("prompt", ""), TL.asset_path(pid, clip))
                c.update(kind="ai_video", src=clip, still=still, duration=round(d, 2))
            else:
                name = f"assets/{c['id']}_r{nxt}.jpg"
                r = B.paint(g.get("prompt", ""), TL.asset_path(pid, name), tool, style, hero=(c["id"] == first),
                            gemini_ok=bool((t.get("meta") or {}).get("spec", {}).get("gemini_images")))
                c["src"] = name
                c["kind"] = "image" if c["kind"] not in ("upload",) else c["kind"]
                sz = TL.image_size(TL.asset_path(pid, name))
                if sz:
                    c["w"], c["h"] = sz
                c["pixel"] = bool(r.get("pixel"))
            p = TL.asset_path(pid, c["src"])
            if p and os.path.exists(p):
                c["hash"] = TL.file_hash(p)
            c.pop("dirty", None)
            if tr == "visuals":
                rep["repainted"].append(c["id"])
            return c["id"], True
        except BaseException as e:
            print(f"{c['id']} failed: {e}")
            return c["id"], False

    rest = [x for x in todo if x[0] != "voice"]
    with ThreadPoolExecutor(4) as ex:
        for cid, ok in ex.map(make, rest):
            (done if ok else failed).append(cid)
    return rep


# ---------- step 2: queued edits from the bot (each one becomes a version) ----------
def cmd_edits(pid, edits_file):
    """Apply the bot's queued edits in order, skipping any already in history (matched by edit id), rebuild only
    what each one changed, save one version per edit. Writes job/edit_report.json for the Telegram message."""
    edits = json.load(open(edits_file))
    edits = edits.get("edits", edits) if isinstance(edits, dict) else edits
    applied = TL.applied_edits(pid)
    t = TL.load(pid)
    reports = []
    for e in edits:
        eid = e.get("id")
        if eid and eid in applied:
            print(f"{eid}: already applied, skipping")
            continue
        msg = (e.get("message") or "edit")[:200]
        try:
            if e.get("revert") is not None:
                new = TL.revision(pid, e["revert"])
                new["rev"] = t.get("rev")
                kind, ops, before = "revert", None, t
            else:
                ops = e.get("patch") or []
                new, _ = TL.apply_patch(t, ops)
                kind, before = "edit", t
            errs = TL.validate(new)
            if errs:
                raise ValueError("; ".join(errs[:4]))
        except Exception as ex:
            print(f"{eid}: rejected: {ex}")
            reports.append({"edit_id": eid, "message": msg, "error": str(ex)[:300]})
            continue
        pl = TL.plan(before, new) if kind == "edit" else {"revoice": [], "repaint": []}
        rep = build_timeline(pid, new, int(t.get("rev") or 0) + 1)
        extra = {"edit_id": eid, "kind": kind, **({"revert_to": int(e["revert"])} if kind == "revert" else {}),
                 "remade": {"revoiced": rep["revoiced"], "repainted": rep["repainted"], "failed": rep["failed"]}}
        rev = TL.save(new, msg, patch=ops, extra=extra)
        print(f"v{rev}: {msg} | re-voiced {rep['revoiced'] or '-'} | repainted {rep['repainted'] or '-'} | failed {rep['failed'] or '-'}")
        reports.append({"edit_id": eid, "rev": rev, "message": msg, "kind": kind, "planned": {k: pl[k] for k in ("revoice", "repaint")},
                        **{k: rep[k] for k in ("revoiced", "repainted", "failed", "reused_lines")}})
        t = new
    os.makedirs(os.path.join(ROOT, "job"), exist_ok=True)
    json.dump({"project_id": pid, "rev": t.get("rev"), "edits": reports}, open(os.path.join(ROOT, "job", "edit_report.json"), "w"), indent=1)
    open(os.path.join(ROOT, "job", "edit_report.txt"), "w").write(report_text(t, reports))
    print(report_text(t, reports))
    if not reports:
        return 5  # every edit was already applied (and rendered): nothing new to do
    if all(r.get("error") for r in reports):
        return 4  # nothing could be applied: the project is unchanged
    return 0


def report_text(t, reports):
    lines = []
    for r in reports:
        if r.get("error"):
            lines.append(f"⚠️ Skipped \"{r['message']}\": {r['error'][:120]}")
            continue
        bits = []
        if r.get("revoiced"):
            bits.append(f"re-voiced {len(r['revoiced'])} line(s)")
        if r.get("repainted"):
            bits.append(f"repainted {len(r['repainted'])} image(s)")
        if r.get("failed"):
            bits.append(f"kept the old version of {', '.join(r['failed'])}")
        lines.append(f"v{r['rev']}: {r['message']}" + (f" ({', '.join(bits)})" if bits else " (render only)"))
    return "\n".join(lines)[:700]


def cmd_scenes(pid_or_file):
    t = load_any(pid_or_file)
    for s in TL.scenes(t):
        print(f"{s['n']:>2}. [{s['kind']}{'/' + s['tool'] if s['tool'] and s['tool'] not in (s['kind'],) else ''}] {s['start']:.1f}-{s['end']:.1f}s  {s['text'][:70]}  | {s['visual'][:50]}  (@{s['id']})")


def cmd_versions(pid):
    for v in TL.versions(TL.history(pid)):
        print(f"v{v['rev']}  {v['message']}")


def cmd_diff(a, b):
    print(json.dumps(TL.plan(load_any(a), load_any(b)), indent=1))


def cmd_reformat(pid, fmt, regen=False):
    t = TL.load(pid)
    cv = TL.canvas(fmt, t["canvas"].get("fps", 30))
    ops = [{"op": "replace", "path": "/canvas", "value": {**t["canvas"], **cv}}]
    if regen:  # new stills framed for the new shape (cost: one image each)
        for c in t["tracks"]["visuals"]:
            if c["kind"] == "image" and c.get("gen"):
                ops.append({"op": "merge", "path": f"/tracks/visuals/@{c['id']}", "value": {"dirty": True}})
    new, _ = TL.apply_patch(t, ops)
    rev = TL.save(new, f"reformat to {cv['width']}x{cv['height']}", patch=ops)
    print(f"r{rev}: canvas {cv['width']}x{cv['height']}" + (" (images marked for remake)" if regen else " (stills reframed with blur fill where needed)"))


def cmd_style(pid, preset, caption=None):
    t = TL.load(pid)
    st = t["style"]
    if preset and preset != "-":
        if preset not in TL.STYLE_PRESETS:
            die(f"unknown style; choose from {', '.join(TL.STYLE_PRESETS)}")
        st = TL.deep_merge(TL.deep_merge(TL.STYLE_PRESETS["bold-pop"], TL.STYLE_PRESETS[preset]), {"accent": st.get("accent"), "preset": preset})
    if caption:
        st = TL.deep_merge(st, {"caption": {"preset": caption}})
    ops = [{"op": "replace", "path": "/style", "value": st}]
    new, _ = TL.apply_patch(t, ops)
    print(f"r{TL.save(new, f'style {preset} {caption or ''}'.strip(), patch=ops)}: style updated (render only)")


def cmd_history(pid):
    for h in TL.history(pid):  # raw revisions; `versions` shows the user-facing list
        print(f"r{h['rev']}  {h['message']}" + (f"  ({len(h['patch'])} op)" if h.get("patch") else ""))


def cmd_revert(pid, rev):
    old = TL.revision(pid, rev)
    cur = TL.load(pid)
    old["rev"] = cur.get("rev")
    print(f"r{TL.save(old, f'revert to r{rev}', extra={'kind': 'revert', 'revert_to': int(rev)})}: now matches r{rev}")


def cmd_migrate(props_file, pid, spec_file=None):
    props = json.load(open(props_file))
    spec = json.load(open(spec_file)) if spec_file else {}
    os.makedirs(TL.project_dir(pid), exist_ok=True)
    t = TL.from_props(props, spec, pid)
    print(f"r{TL.save(t, 'migrated from props.json')}: media/projects/{pid}/timeline.json")
    errs = TL.validate(t)
    if errs:
        print("warnings:", errs)


def gh(*args, check=False):
    return subprocess.run(["gh", *args], capture_output=True, text=True, check=check)


def cmd_pull(pid):
    adir = os.path.join(TL.project_dir(pid), "assets")
    os.makedirs(adir, exist_ok=True)
    r = gh("release", "download", f"project-{pid}", "-D", adir, "--skip-existing")
    print("pulled" if r.returncode == 0 else f"no saved assets yet ({r.stderr.strip()[:120]})")


def cmd_push(pid):
    adir = os.path.join(TL.project_dir(pid), "assets")
    tag = f"project-{pid}"
    if gh("release", "view", tag).returncode != 0:
        t = TL.load(pid)
        gh("release", "create", tag, "--title", f"Project: {t['title']}"[:120], "--notes",
           "Assets of a Shorts Studio project (voice, images, clips). The timeline lives in media/projects/" + pid,
           "--latest=false", check=True)
    sent_file = os.path.join(adir, ".pushed.json")
    sent = json.load(open(sent_file)) if os.path.exists(sent_file) else {}
    files = [f for f in sorted(os.listdir(adir)) if not f.startswith(".") and os.path.isfile(os.path.join(adir, f))]
    new = [f for f in files if sent.get(f) != TL.file_hash(os.path.join(adir, f))]
    for i in range(0, len(new), 10):
        gh("release", "upload", tag, *[os.path.join(adir, f) for f in new[i:i + 10]], "--clobber", check=True)
    for f in new:
        sent[f] = TL.file_hash(os.path.join(adir, f))
    json.dump(sent, open(sent_file, "w"))
    print(f"pushed {len(new)} asset(s) to release {tag}")


def cmd_jobspec(pid):
    t = TL.load(pid)
    spec = {"title": t["title"], "hook": (t.get("meta") or {}).get("hook") or "", "accent": t["style"].get("accent", "#FFD43B"),
            "project_id": pid, "beats": [{"narration": v.get("narration", "")} for v in t["tracks"]["visuals"]] or [{"narration": t["title"]}]}
    os.makedirs(os.path.join(ROOT, "job"), exist_ok=True)
    json.dump(spec, open(os.path.join(ROOT, "job", "spec.json"), "w"))
    open(os.path.join(ROOT, "job", "project_id.txt"), "w").write(pid)
    print("job/spec.json written")


def cmd_render(pid, out=None, still=None):
    props = os.path.join("..", "media", "projects", pid, "timeline.json")
    if still is not None:
        out = out or f"out/{pid}-{still}s.png"
        args = ["npx", "remotion", "still", "src/studio-index.ts", "Studio", out, f"--props={props}", f"--frame={int(float(still) * TL.load(pid)['canvas']['fps'])}"]
    else:
        out = out or f"out/{pid}.mp4"
        args = ["npx", "remotion", "render", "src/studio-index.ts", "Studio", out, f"--props={props}", "--log=error"]
    sys.exit(subprocess.call(args, cwd=os.path.join(ROOT, "remotion")))


def main(a):
    if len(a) < 2:
        die(__doc__, 0)
    cmd, rest = a[0], a[1:]
    flags = [x for x in rest if x.startswith("--")]
    pos = [x for x in rest if not x.startswith("--")]
    if cmd == "info": cmd_info(pos[0])
    elif cmd == "validate": cmd_validate(pos[0])
    elif cmd == "patch":
        msg = rest[rest.index("-m") + 1] if "-m" in rest else "edit"
        cmd_patch(pos[0], pos[1], msg)
    elif cmd == "build": cmd_build(pos[0])
    elif cmd == "edits": sys.exit(cmd_edits(pos[0], pos[1]))
    elif cmd == "scenes": cmd_scenes(pos[0])
    elif cmd == "versions": cmd_versions(pos[0])
    elif cmd == "diff": cmd_diff(pos[0], pos[1])
    elif cmd == "reformat": cmd_reformat(pos[0], pos[1], "--regen-images" in flags)
    elif cmd == "style": cmd_style(pos[0], pos[1], pos[2] if len(pos) > 2 else None)
    elif cmd == "history": cmd_history(pos[0])
    elif cmd == "revert": cmd_revert(pos[0], pos[1])
    elif cmd == "migrate": cmd_migrate(pos[0], pos[1], pos[2] if len(pos) > 2 else None)
    elif cmd == "pull": cmd_pull(pos[0])
    elif cmd == "push": cmd_push(pos[0])
    elif cmd == "jobspec": cmd_jobspec(pos[0])
    elif cmd == "render":
        st = rest[rest.index("--still") + 1] if "--still" in rest else None
        outs = [p for p in pos[1:] if p != st]
        cmd_render(pos[0], outs[0] if outs else None, st)
    else:
        die(__doc__)


if __name__ == "__main__":
    main(sys.argv[1:])
