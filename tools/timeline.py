#!/usr/bin/env python3
"""Project timelines: the saved, editable source of truth for every Shorts Studio video.

A project lives in media/projects/<id>/:
    timeline.json        current timeline (rendered by the Remotion "Studio" composition)
    history/r<N>.json    every saved revision (full snapshot)
    history/log.jsonl    one line per revision: rev, time, message, the JSON patch that made it
    assets/              voice, images, clips (gitignored; kept on the GitHub release project-<id>)

This module is used by tools/build_short.py (spec -> timeline) and tools/project.py (patch, rebuild,
revert, reformat). Step 2's re-edit agent only has to produce a JSON patch: apply_patch() applies it,
marks the clips whose recipe changed as dirty, and project.py build remakes only those.
"""
import copy, hashlib, json, math, os, re, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MEDIA = os.path.join(ROOT, "media")
SCHEMA = "shorts-studio/timeline@1"

# ---------- canvas ----------
CANVASES = {
    "vertical": (1080, 1920), "9:16": (1080, 1920), "shorts": (1080, 1920), "reels": (1080, 1920), "tiktok": (1080, 1920),
    "landscape": (1920, 1080), "16:9": (1920, 1080), "youtube": (1920, 1080),
    "square": (1080, 1080), "1:1": (1080, 1080),
    "portrait": (1080, 1350), "4:5": (1080, 1350),
    "cinema": (2520, 1080), "21:9": (2520, 1080),
}


def canvas(fmt=None, fps=30):
    """'vertical' | 'landscape' | 'square' | 'portrait' | '9:16' | '4:5' | '1280x720' | {width,height,fps} -> canvas dict."""
    if isinstance(fmt, dict):
        w, h = int(fmt.get("width") or 1080), int(fmt.get("height") or 1920)
        return {"width": w - w % 2, "height": h - h % 2, "fps": int(fmt.get("fps") or fps), **({"background": fmt["background"]} if fmt.get("background") else {})}
    f = str(fmt or "vertical").strip().lower()
    if f in CANVASES:
        w, h = CANVASES[f]
    elif re.fullmatch(r"\d{2,5}x\d{2,5}", f):
        w, h = map(int, f.split("x"))
    elif re.fullmatch(r"\d+(\.\d+)?:\d+(\.\d+)?", f):
        a, b = map(float, f.split(":"))
        short = 1080
        w, h = (round(short * a / b), short) if a >= b else (short, round(short * b / a))
    else:
        w, h = CANVASES["vertical"]
    return {"width": int(w) - int(w) % 2, "height": int(h) - int(h) % 2, "fps": int(fps)}


def format_name(c):
    a = c["width"] / c["height"]
    return "vertical" if a < 0.7 else "portrait" if a < 0.9 else "square" if a < 1.25 else "landscape"


def gen_size(c, area=768 * 1344, step=16):
    """Image-model size with the canvas aspect, ~1 MP, multiples of 16 (FLUX friendly)."""
    a = c["width"] / c["height"]
    w = math.sqrt(area * a)
    h = w / a
    return int(round(w / step) * step), int(round(h / step) * step)


def aspect_label(c, choices=("1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9")):
    a = c["width"] / c["height"]
    return min(choices, key=lambda s: abs(math.log(a / (float(s.split(":")[0]) / float(s.split(":")[1])))))


# ---------- style ----------
# Named looks. Every token can be overridden per project (style.caption.font, style.transition, ...).
STYLE_PRESETS = {
    "bold-pop": {"caption": {"preset": "bold-pop"}, "transition": {"type": "fade", "duration": 0.35}, "motion": "kenburns"},
    "documentary": {"caption": {"preset": "clean", "font": "Inter"}, "transition": {"type": "dissolve", "duration": 0.6},
                    "grade": "contrast(1.06) saturate(0.92) sepia(0.08)", "font": "Playfair Display", "progress_bar": False},
    "minimal": {"caption": {"preset": "subtitle"}, "transition": {"type": "fade", "duration": 0.4}, "motion": "kenburns",
                "vignette": False, "progress_bar": False, "font": "Inter"},
    "neon": {"caption": {"preset": "neon"}, "transition": {"type": "flash", "duration": 0.3}, "grade": "contrast(1.12) saturate(1.3)"},
    "karaoke": {"caption": {"preset": "karaoke-box"}, "transition": {"type": "slide-left", "duration": 0.35}},
    "punchy": {"caption": {"preset": "word-by-word"}, "transition": {"type": "zoom-in", "duration": 0.25}, "grade": "contrast(1.1) saturate(1.15)"},
    "comic": {"caption": {"preset": "bold-pop", "font": "Bangers", "weight": 400}, "transition": {"type": "wipe", "duration": 0.3}, "font": "Bangers"},
}


def deep_merge(a, b):
    out = copy.deepcopy(a)
    for k, v in (b or {}).items():
        out[k] = deep_merge(out[k], v) if isinstance(v, dict) and isinstance(out.get(k), dict) else copy.deepcopy(v)
    return out


def style_from(spec):
    """Spec fields -> style tokens. spec.style is the image-prompt style text (kept in meta);
    spec.style_preset / spec.style_tokens / spec.caption_style choose the look."""
    st = deep_merge(STYLE_PRESETS["bold-pop"], STYLE_PRESETS.get(spec.get("style_preset") or "", {}))
    if spec.get("style_preset"):
        st["preset"] = spec["style_preset"]
    if spec.get("caption_style"):
        st = deep_merge(st, {"caption": {"preset": spec["caption_style"]}})
    if spec.get("caption_font"):
        st = deep_merge(st, {"caption": {"font": spec["caption_font"]}})
    st = deep_merge(st, spec.get("style_tokens") or {})
    st["accent"] = spec.get("accent") or st.get("accent") or "#FFD43B"
    return st


# ---------- paths ----------
def project_dir(pid):
    return os.path.join(MEDIA, "projects", pid)


def asset_path(pid, src):
    """Local file for a timeline src (None for remote URLs)."""
    if not src or re.match(r"^(https?:|data:)", src):
        return None
    s = src.lstrip("/")
    if s.startswith(("library/", "projects/")):
        return os.path.join(MEDIA, s)
    return os.path.join(project_dir(pid), s)


def rel_src(pid, public_path):
    """'projects/<pid>/assets/x.jpg' -> 'assets/x.jpg' (portable inside the project)."""
    pre = f"projects/{pid}/"
    return public_path[len(pre):] if public_path and public_path.startswith(pre) else public_path


def slug(s, n=36):
    s = re.sub(r"[^a-z0-9]+", "-", (s or "video").lower()).strip("-")
    return (s[:n].rstrip("-") or "video")


def new_id(title, salt=None):
    salt = salt or os.getenv("GITHUB_RUN_NUMBER") or base36(int(time.time()))
    return f"{slug(title)}-{salt}"


def base36(n):
    d = "0123456789abcdefghijklmnopqrstuvwxyz"
    out = ""
    while n:
        n, r = divmod(n, 36)
        out = d[r] + out
    return out or "0"


def file_hash(path):
    h = hashlib.sha1()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()[:12]


def image_size(path):
    try:
        from PIL import Image
        with Image.open(path) as im:
            return im.size
    except Exception:
        return None


# ---------- build from the bot's spec + the props build_short made ----------
def from_props(props, spec=None, pid="job", cv=None):
    """Legacy StoryShort props (+ the spec that made them) -> timeline. Also used to migrate old props.json."""
    spec = spec or {}
    cv = cv or canvas(spec.get("canvas") or props.get("format") or spec.get("format"))
    beats = spec.get("beats") or []
    visuals = []
    for i, b in enumerate(props.get("beats", [])):
        sb = beats[i] if i < len(beats) else {}
        clip = {"id": f"v{i + 1}", "start": b["start"], "end": b["end"], "narration": b.get("text") or sb.get("narration", "")}
        if b.get("graphic"):
            clip.update(kind="graphic", graphic=b["graphic"], gen={"tool": "graphic"})
        elif b.get("video"):
            clip.update(kind="ai_video", src=rel_src(pid, b["video"]), duration=b.get("videoDuration"),
                        still=rel_src(pid, b.get("image")),
                        gen={"tool": "higgsfield", "prompt": sb.get("image_prompt", ""), "motion": sb.get("motion", ""), "still": sb.get("still") or "flux"})
        else:
            clip.update(kind="image", src=rel_src(pid, b.get("image")),
                        gen={"tool": (sb.get("tool") or "flux") if (sb.get("tool") or "flux") != "higgsfield" else (sb.get("still") or "flux"),
                             "prompt": sb.get("image_prompt", "")})
        if b.get("pixel"):
            clip["pixel"] = True
        p = asset_path(pid, clip.get("src"))
        if p and os.path.exists(p):
            sz = image_size(p) if clip["kind"] == "image" else None
            if sz:
                clip["w"], clip["h"] = sz
            clip["hash"] = file_hash(p)
        visuals.append(clip)
    text = " ".join(v["narration"].strip() for v in visuals if v.get("narration"))
    style = style_from(spec)
    if props.get("accent"):
        style["accent"] = props["accent"]
    tracks = {
        "visuals": visuals,
        "captions": {"enabled": True, "words": props.get("words", [])},
        "voice": [{"id": "vo", "src": rel_src(pid, props.get("audio")), "start": 0, "volume": 1,
                   "gen": {"tool": "edge-tts", "voice": spec.get("voice") or "en-US-AndrewMultilingualNeural", "rate": spec.get("rate", "+0%"), "text": text}}]
        if props.get("audio") else [],
        "music": [{"id": "m1", "src": props["music"], "start": 0, "volume": float(props.get("musicVolume", 0.1)), "loop": True,
                   "fade_in": 0.5, "fade_out": 1.0, "duck": True, "gen": {"tool": "library", "name": spec.get("music") or ""}}]
        if props.get("music") else [],
        "sfx": [],
        "overlays": [{"id": "title", "kind": "title", "start": 0, "end": 3, "text": props.get("title", "")}] if props.get("title") else [],
    }
    now = int(time.time() * 1000)
    return {
        "schema": SCHEMA, "id": pid, "rev": 0, "title": props.get("title") or spec.get("title", ""),
        "duration": props.get("duration") or (visuals[-1]["end"] + 0.8 if visuals else 5),
        "canvas": cv, "style": style, "tracks": tracks,
        "meta": {"created": now, "updated": now, "topic": spec.get("topic", ""), "hook": spec.get("hook", ""),
                 "image_style": spec.get("style", ""), "format": format_name(cv), "assets_release": f"project-{pid}",
                 "spec": {k: v for k, v in spec.items() if k not in ("beats",)}, "renders": []},
    }


# ---------- validation ----------
KINDS = {"image", "ai_video", "graphic", "stock", "upload", "color"}


def validate(t):
    errs = []
    if t.get("schema") != SCHEMA:
        errs.append(f"schema must be {SCHEMA}")
    for k in ("id", "title", "canvas", "tracks"):
        if k not in t:
            errs.append(f"missing {k}")
    c = t.get("canvas") or {}
    if not (16 <= int(c.get("width") or 0) <= 7680 and 16 <= int(c.get("height") or 0) <= 7680):
        errs.append("canvas width/height out of range")
    if not (1 <= int(c.get("fps") or 0) <= 120):
        errs.append("canvas fps out of range")
    ids = set()
    for track in ("visuals", "voice", "music", "sfx", "overlays"):
        for x in (t.get("tracks") or {}).get(track) or []:
            if not x.get("id"):
                errs.append(f"{track}: clip without id")
            elif x["id"] in ids:
                errs.append(f"duplicate id {x['id']}")
            ids.add(x.get("id"))
    for v in (t.get("tracks") or {}).get("visuals") or []:
        if v.get("kind") not in KINDS:
            errs.append(f"{v.get('id')}: kind must be one of {sorted(KINDS)}")
        if not (isinstance(v.get("start"), (int, float)) and isinstance(v.get("end"), (int, float)) and v["end"] > v["start"] >= 0):
            errs.append(f"{v.get('id')}: needs 0 <= start < end")
        if v.get("kind") == "graphic" and not isinstance(v.get("graphic"), dict):
            errs.append(f"{v.get('id')}: graphic clip needs a graphic object")
    try:  # full JSON Schema check when jsonschema is installed
        import jsonschema
        schema = json.load(open(os.path.join(ROOT, "timeline", "timeline.schema.json")))
        for e in jsonschema.Draft202012Validator(schema).iter_errors(t):
            errs.append("schema: " + "/".join(map(str, e.path)) + " " + e.message[:160])
    except ImportError:
        pass
    except FileNotFoundError:
        pass
    return errs


# ---------- JSON patch (RFC 6902) with id paths ----------
# Paths may address clips by id instead of index: /tracks/visuals/@v3/src  ==  /tracks/visuals/2/src
def _tokens(t, path):
    if path in ("", "/"):
        return []
    toks = [p.replace("~1", "/").replace("~0", "~") for p in path.lstrip("/").split("/")]
    out, cur = [], t
    for tok in toks:
        if isinstance(cur, list) and tok.startswith("@"):
            idx = next((i for i, x in enumerate(cur) if isinstance(x, dict) and x.get("id") == tok[1:]), None)
            if idx is None:
                raise KeyError(f"no clip with id {tok[1:]}")
            tok = str(idx)
        out.append(tok)
        try:
            cur = cur[int(tok)] if isinstance(cur, list) and tok != "-" else (cur.get(tok) if isinstance(cur, dict) else None)
        except (ValueError, IndexError):
            cur = None
    return out


def _parent(doc, toks):
    cur = doc
    for tok in toks[:-1]:
        cur = cur[int(tok)] if isinstance(cur, list) else cur[tok]
    return cur, toks[-1]


def _get(doc, toks):
    cur = doc
    for tok in toks:
        cur = cur[int(tok)] if isinstance(cur, list) else cur[tok]
    return cur


def _add(doc, toks, val):
    par, key = _parent(doc, toks)
    if isinstance(par, list):
        par.append(val) if key == "-" else par.insert(int(key), val)
    else:
        par[key] = val


def _remove(doc, toks):
    par, key = _parent(doc, toks)
    return par.pop(int(key)) if isinstance(par, list) else par.pop(key)


def json_patch(doc, ops):
    doc = copy.deepcopy(doc)
    for op in ops:
        kind, toks = op["op"], _tokens(doc, op["path"])
        if kind == "add":
            _add(doc, toks, copy.deepcopy(op["value"]))
        elif kind == "remove":
            _remove(doc, toks)
        elif kind == "replace":
            par, key = _parent(doc, toks)
            if isinstance(par, list):
                par[int(key)] = copy.deepcopy(op["value"])
            else:
                if key not in par:
                    raise KeyError(f"replace: {op['path']} does not exist")
                par[key] = copy.deepcopy(op["value"])
        elif kind == "move":
            val = _remove(doc, _tokens(doc, op["from"]))
            _add(doc, _tokens(doc, op["path"]), val)
        elif kind == "copy":
            _add(doc, toks, copy.deepcopy(_get(doc, _tokens(doc, op["from"]))))
        elif kind == "test":
            if _get(doc, toks) != op["value"]:
                raise ValueError(f"test failed at {op['path']}")
        elif kind == "merge":  # extension: shallow merge an object into the target (handy for LLM edits)
            tgt = _get(doc, toks)
            tgt.update(copy.deepcopy(op["value"]))
        else:
            raise ValueError(f"unknown op {kind}")
    return doc


# ---------- what needs remaking ----------
def voice_text(t):
    return " ".join((v.get("narration") or "").strip() for v in t["tracks"]["visuals"] if (v.get("narration") or "").strip())


def mark_dirty(old, new):
    """Compare two timelines; flag clips whose recipe changed (dirty=True) so `project.py build` remakes only them."""
    oldv = {c["id"]: c for tr in ("visuals", "voice", "music") for c in (old["tracks"].get(tr) or [])}
    changed = []
    for tr in ("visuals", "voice", "music"):
        for c in new["tracks"].get(tr) or []:
            o = oldv.get(c["id"])
            if o is None or (o.get("gen") != c.get("gen")) or (tr == "visuals" and o.get("kind") != c.get("kind")):
                if c.get("gen") and c["gen"].get("tool") not in ("graphic", "library") and not c.get("src_locked"):
                    c["dirty"] = True
                    changed.append(c["id"])
    vo = (new["tracks"].get("voice") or [None])[0]
    if vo and vo.get("gen", {}).get("tool") == "edge-tts":
        text = voice_text(new)
        if text and text != vo["gen"].get("text"):
            vo["gen"]["text"] = text
            vo["dirty"] = True
            if vo["id"] not in changed:
                changed.append(vo["id"])
    if old.get("canvas") != new.get("canvas"):
        new.setdefault("meta", {})["format"] = format_name(new["canvas"])
    return changed


def needs_build(t, pid=None):
    """Clips that are dirty, or whose local file is missing (and can be made)."""
    pid = pid or t["id"]
    out = []
    for tr in ("visuals", "voice", "music"):
        for c in t["tracks"].get(tr) or []:
            if c.get("kind") in ("graphic", "color"):
                continue
            p = asset_path(pid, c.get("src"))
            if c.get("dirty") or (c.get("src") is None and c.get("gen")) or (p and not os.path.exists(p)):
                out.append((tr, c))
    return out


def apply_patch(t, ops):
    new = json_patch(t, ops)
    changed = mark_dirty(t, new)
    return new, changed


# ---------- timing helpers ----------
def retime(t, words, total):
    """After a new voice: re-split visual clip times by narration share, move captions, sfx anchors, duration."""
    from build_short import split_beats  # same splitter the first build used
    vis = t["tracks"]["visuals"]
    spoken = [v for v in vis if (v.get("narration") or "").strip()]
    if spoken:
        times = split_beats([{"narration": v["narration"]} for v in spoken], words, total)
        for v, tm in zip(spoken, times):
            v["start"], v["end"] = tm["start"], tm["end"]
    t["tracks"]["captions"] = {**(t["tracks"].get("captions") or {}), "words": words}
    t["duration"] = round(total + 0.8, 2)
    byid = {v["id"]: v for v in vis}
    for s in t["tracks"].get("sfx") or []:
        if s.get("anchor") in byid:
            s["at"] = round(byid[s["anchor"]]["start"] + (s.get("offset") or 0), 3)
    for o in t["tracks"].get("overlays") or []:
        if o.get("anchor") in byid:
            a = byid[o["anchor"]]
            o["start"], o["end"] = a["start"], a["end"]


# ---------- persistence + version history ----------
def load(pid):
    return json.load(open(os.path.join(project_dir(pid), "timeline.json")))


def save(t, message="save", patch=None):
    """Write timeline.json and a new revision in history/. Returns the new rev."""
    pid = t["id"]
    d = project_dir(pid)
    os.makedirs(os.path.join(d, "history"), exist_ok=True)
    t["rev"] = int(t.get("rev") or 0) + 1
    t.setdefault("meta", {})["updated"] = int(time.time() * 1000)
    body = json.dumps(t, indent=1, ensure_ascii=False)
    open(os.path.join(d, "timeline.json"), "w").write(body)
    open(os.path.join(d, "history", f"r{t['rev']}.json"), "w").write(body)
    with open(os.path.join(d, "history", "log.jsonl"), "a") as f:
        f.write(json.dumps({"rev": t["rev"], "at": t["meta"]["updated"], "message": message, **({"patch": patch} if patch else {})}, ensure_ascii=False) + "\n")
    return t["rev"]


def history(pid):
    p = os.path.join(project_dir(pid), "history", "log.jsonl")
    return [json.loads(l) for l in open(p)] if os.path.exists(p) else []


def revision(pid, rev):
    return json.load(open(os.path.join(project_dir(pid), "history", f"r{int(rev)}.json")))
