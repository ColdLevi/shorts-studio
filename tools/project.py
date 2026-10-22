#!/usr/bin/env python3
"""Shorts Studio projects: inspect, patch, rebuild, version and re-render saved video timelines.

  python tools/project.py info <id>                  what's in the project, which clips need making
  python tools/project.py validate <id|file.json>
  python tools/project.py patch <id> <patch.json> [-m "why"]   apply a JSON patch (RFC 6902; /tracks/visuals/@v3/src id paths ok)
  python tools/project.py build <id>                 remake only dirty/missing assets (voice, images, AI clips, downloads)
  python tools/project.py reformat <id> <16:9|9:16|1:1|4:5|WxH> [--regen-images]
  python tools/project.py style <id> <preset> [caption-preset]   e.g. style my-vid documentary | style my-vid - neon
  python tools/project.py history <id>
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
    import build_short as B
    t = TL.load(pid)
    B.set_project(pid, t["canvas"])
    todo = TL.needs_build(t)
    if not todo:
        print("nothing to build")
        return
    nxt = int(t.get("rev") or 0) + 1
    adir = os.path.join(TL.project_dir(pid), "assets")
    os.makedirs(adir, exist_ok=True)
    style = (t.get("meta") or {}).get("image_style", "")
    done, failed = [], []

    # 1) voice first: it moves every clip's timing
    for tr, c in [x for x in todo if x[0] == "voice"]:
        g = c.get("gen") or {}
        text = g.get("text") or TL.voice_text(t)
        name = f"assets/voice_r{nxt}.mp3"
        try:
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
            return c["id"], True
        except BaseException as e:
            print(f"{c['id']} failed: {e}")
            return c["id"], False

    rest = [x for x in todo if x[0] != "voice"]
    with ThreadPoolExecutor(4) as ex:
        for cid, ok in ex.map(make, rest):
            (done if ok else failed).append(cid)
    rev = TL.save(t, f"rebuilt {', '.join(done) or 'nothing'}" + (f"; failed {', '.join(failed)}" if failed else ""))
    print(f"r{rev}: rebuilt {done or '-'}; failed {failed or '-'}")
    if failed:
        sys.exit(3)


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
    for h in TL.history(pid):
        print(f"r{h['rev']}  {h['message']}" + (f"  ({len(h['patch'])} op)" if h.get("patch") else ""))


def cmd_revert(pid, rev):
    old = TL.revision(pid, rev)
    cur = TL.load(pid)
    old["rev"] = cur.get("rev")
    print(f"r{TL.save(old, f'revert to r{rev}')}: now matches r{rev}")


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
