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
    # ---- style recipes: a whole look (motion, pacing, texture, captions, graphics backdrop), not just image prompts ----
    "stop-motion": {"recipe": "stop-motion", "caption": {"preset": "bold-pop", "font": "Permanent Marker", "weight": 400, "case": "none"},
                    "transition": {"type": "cut", "duration": 0}, "transitions": ["cut", "cut", "page-turn", "cut", "cut", "slide-up"],
                    "motion": "static", "fx": {"hold": 2, "jitter": 5, "texture": "paper"}, "gfx": {"paper": 0.55, "vignette": 0.35}, "backdrop": "paper",
                    "grade": "contrast(1.06) saturate(1.12) sepia(0.12)", "font": "Permanent Marker", "progress_bar": False, "vignette": False},
    "documentary": {"recipe": "documentary", "caption": {"preset": "subtitle", "font": "Inter"}, "transition": {"type": "dissolve", "duration": 0.8},
                    "transitions": ["dissolve", "focus", "dissolve", "leak"], "motion": "parallax",
                    "fx": {"texture": "film", "letterbox": 0.06}, "gfx": {"grain": 0.18, "vignette": 0.5, "focus_pull": True}, "backdrop": "gradient", "palette": ["#15110c", "#6b4a2b"],
                    "grade": "contrast(1.08) saturate(0.82) sepia(0.2)", "font": "Playfair Display", "progress_bar": False,
                    "title": {"font": "Playfair Display"}},
    "motion-explainer": {"recipe": "motion-explainer", "caption": {"preset": "clean", "font": "Montserrat"}, "transition": {"type": "slide-left", "duration": 0.4},
                         "transitions": ["slide-left", "zoom-in", "page-turn", "wipe", "zoom-out", "slide-right"], "motion": "static",
                         "backdrop": "grid", "vignette": False, "font": "Montserrat", "gfx": {"grain": 0.05, "vignette": 0.25}},
    "blueprint": {"recipe": "blueprint", "caption": {"preset": "clean", "font": "Space Grotesk"}, "transition": {"type": "wipe", "duration": 0.4},
                  "transitions": ["wipe", "slide-up", "zoom-in"], "motion": "static", "backdrop": "blueprint", "accent": "#7fd1ff", "gfx": {"scanlines": 0.12, "grain": 0.06, "vignette": 0.35},
                  "vignette": False, "font": "Space Grotesk"},
    "kinetic-news": {"recipe": "kinetic-news", "caption": {"preset": "word-by-word", "font": "Anton", "weight": 400},
                     "transition": {"type": "flash", "duration": 0.25}, "transitions": ["flash", "zoom-in", "slide-left", "cut", "zoom-out"],
                     "motion": "kenburns", "backdrop": "dots", "grade": "contrast(1.12) saturate(1.15)", "gfx": {"chroma_hit": 14, "grain": 0.08, "vignette": 0.3}, "font": "Anton"},
    "cinematic": {"recipe": "cinematic", "caption": {"preset": "clean", "font": "Inter"}, "transition": {"type": "dissolve", "duration": 0.7},
                  "transitions": ["dissolve", "leak", "focus", "fade"], "motion": "drift", "fx": {"texture": "grain", "letterbox": 0.1}, "gfx": {"grain": 0.14, "vignette": 0.55, "focus_pull": True},
                  "backdrop": "gradient", "grade": "contrast(1.1) saturate(1.05) brightness(0.95)", "progress_bar": False, "font": "DM Serif Display"},
    "retro-vhs": {"recipe": "retro-vhs", "caption": {"preset": "neon", "font": "Rubik Mono One", "weight": 400},
                  "transition": {"type": "blur", "duration": 0.3}, "transitions": ["blur", "flash", "slide-left", "cut"], "motion": "kenburns",
                  "fx": {"texture": "vhs", "jitter": 2}, "gfx": {"scanlines": 0.4, "grain": 0.16, "chroma": 5, "barrel": 0.08, "vignette": 0.6}, "backdrop": "grid", "grade": "saturate(1.35) contrast(1.12) hue-rotate(-8deg)", "font": "Rubik Mono One"},
    "anime": {"recipe": "anime", "caption": {"preset": "bold-pop", "font": "Bangers", "weight": 400}, "transition": {"type": "slide-left", "duration": 0.3},
              "transitions": ["slide-left", "zoom-in", "flash", "slide-right"], "motion": "kenburns", "backdrop": "gradient",
              "grade": "saturate(1.25) contrast(1.05)", "gfx": {"glow": 0.45, "vibrance": 0.35, "vignette": 0.25}, "font": "Bangers"},
    "vlog": {"recipe": "vlog", "caption": {"preset": "karaoke-box", "font": "Poppins"}, "transition": {"type": "cut", "duration": 0},
             "transitions": ["cut", "leak", "cut", "zoom-in", "cut"], "motion": "handheld", "backdrop": "gradient", "gfx": {"vibrance": 0.2, "vignette": 0.3},
             "grade": "contrast(1.04) saturate(1.1)", "progress_bar": False, "font": "Poppins"},
}
RECIPES = [k for k, v in STYLE_PRESETS.items() if v.get("recipe")]


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


def expand_recipe(t):
    """An edit may set style.apply_recipe = "documentary" (the bot does not know the render tokens):
    swap in that recipe's whole look, keeping the accent and any caption size the user asked for."""
    st = t.get("style") or {}
    name = st.pop("apply_recipe", None)
    if not name or name not in STYLE_PRESETS:
        return t
    keep = {k: st[k] for k in ("accent",) if st.get(k)}
    new = deep_merge(STYLE_PRESETS["bold-pop"], STYLE_PRESETS[name])
    new.update(keep)
    new["preset"] = name
    t["style"] = new
    return t


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
    # Long-form chapters: {"title", "beat"} -> documentary chapter cards at the start of that beat.
    for n, ch in enumerate(spec.get("chapters") or []):
        try:
            bi = int(ch.get("beat", 0))
        except (TypeError, ValueError):
            continue
        if 0 < bi < len(visuals) and ch.get("title"):
            st0 = visuals[bi]["start"]
            tracks["overlays"].append({"id": f"ch{n + 1}", "kind": "chapter", "start": round(st0, 2), "end": round(min(st0 + 2.6, visuals[bi]["end"] + 1.5), 2),
                                       "text": str(ch["title"])[:48], "sub": f"Chapter {n + 2}"})
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
    """Apply an edit patch: old timeline -> (new timeline, ids that must be remade).
    Before patching, a single-file voiceover is described as per-scene segments so a later build
    re-voices only the lines that changed (see voice_segments / project.py revoice)."""
    t = copy.deepcopy(t)
    ensure_segments(t)
    new = json_patch(t, ops)
    expand_recipe(new)
    normalize(new)
    changed = mark_dirty(t, new)
    return new, changed


# ---------- step 2: edit helpers (scene ids, voice segments, diffs, versions) ----------
def norm_text(s):
    return re.sub(r"\s+", " ", (s or "").strip()).lower()


def next_id(t, prefix="v"):
    used = {c.get("id") for tr in ("visuals", "voice", "music", "sfx", "overlays") for c in (t["tracks"].get(tr) or [])}
    n = 1
    while f"{prefix}{n}" in used:
        n += 1
    return f"{prefix}{n}"


def normalize(t):
    """Make an edited timeline well-formed: ids on new clips, sane placeholder times, library music src,
    a gen recipe on new image scenes. Safe to run on any timeline (idempotent)."""
    tr = t.setdefault("tracks", {})
    for name, prefix in (("visuals", "v"), ("music", "m"), ("sfx", "s"), ("overlays", "o"), ("voice", "vo")):
        seen = set()
        for c in tr.get(name) or []:
            if not isinstance(c, dict):
                continue
            if not c.get("id") or c["id"] in seen:
                c["id"] = None
                c["id"] = next_id(t, prefix)
            seen.add(c["id"])
    prev_end = 0.0
    for v in tr.get("visuals") or []:
        if not isinstance(v.get("start"), (int, float)) or v["start"] < 0:
            v["start"] = prev_end
        if not isinstance(v.get("end"), (int, float)) or v["end"] <= v["start"]:
            v["end"] = round(v["start"] + 2.5, 3)
        prev_end = v["end"]
        v.setdefault("kind", "image")
        if v["kind"] == "image" and not v.get("src") and not v.get("gen"):
            v["gen"] = {"tool": "flux", "prompt": v.get("narration", "")}
        if v["kind"] == "graphic":
            v.setdefault("gen", {"tool": "graphic"})
    for m in tr.get("music") or []:
        g = m.get("gen") or {}
        if g.get("tool") == "library" and g.get("name"):
            want = f"library/music/clips/{g['name']}.mp3"
            if m.get("src") != want:
                m["src"] = want
    return t


def _voice_key(g):
    g = g or {}
    return f"{g.get('voice') or 'en-US-AndrewMultilingualNeural'}|{g.get('rate') or '+0%'}|{g.get('pitch') or ''}"


def ensure_segments(t):
    """Describe a voiceover as one segment per spoken scene, so edits re-voice only changed lines.
    Legacy projects (one voice file, no segments) get segments that point at time ranges of that file;
    project.py cuts them out when the voice is rebuilt. Returns the segment list (or [])."""
    vo = (t["tracks"].get("voice") or [None])[0]
    if not vo or (vo.get("gen") or {}).get("tool") != "edge-tts" or vo.get("dirty"):
        return (vo or {}).get("segments") or []
    if vo.get("segments"):
        return vo["segments"]
    if not vo.get("src"):
        return []
    words = (t["tracks"].get("captions") or {}).get("words") or []
    vis = [v for v in t["tracks"]["visuals"] if (v.get("narration") or "").strip()]
    end_all = max([w["end"] for w in words] + [vis[-1]["end"] if vis else 0])
    segs = []
    for i, v in enumerate(vis):
        t0 = 0.0 if i == 0 else float(v["start"])
        t1 = float(vis[i + 1]["start"]) if i + 1 < len(vis) else float(end_all) + 0.25
        if t1 <= t0:
            return []
        ws = [{"word": w["word"], "start": round(w["start"] - t0, 3), "end": round(w["end"] - t0, 3)}
              for w in words if t0 - 0.02 <= w["start"] < t1 - 0.02]
        segs.append({"clip": v["id"], "text": v["narration"].strip(), "from": vo["src"], "t0": round(t0, 3), "t1": round(t1, 3),
                     "words": ws, "voice": _voice_key(vo.get("gen"))})
    vo["segments"] = segs
    return segs


def scenes(t):
    """User-facing scene list: 1..N in visual order."""
    out = []
    for i, v in enumerate(t["tracks"].get("visuals") or []):
        what = (v.get("graphic") or {}).get("type") if v.get("kind") == "graphic" else ((v.get("gen") or {}).get("prompt") or v.get("src") or "")
        out.append({"n": i + 1, "id": v["id"], "kind": v.get("kind"), "tool": (v.get("gen") or {}).get("tool"),
                    "start": v.get("start"), "end": v.get("end"), "text": (v.get("narration") or "").strip(), "visual": str(what)[:90]})
    return out


def diff(old, new):
    """What an edit changes, for the user summary and the rebuild report."""
    ov = {v["id"]: v for v in old["tracks"].get("visuals") or []}
    nv = {v["id"]: v for v in new["tracks"].get("visuals") or []}
    oorder = [v["id"] for v in old["tracks"].get("visuals") or []]
    norder = [v["id"] for v in new["tracks"].get("visuals") or []]
    d = {"added": [i for i in norder if i not in ov], "removed": [i for i in oorder if i not in nv],
         "narration": [], "visual": [], "visual_props": [], "reordered": False, "style": [], "canvas": None,
         "music": False, "voice": False, "captions": False, "overlays": False, "title": old.get("title") != new.get("title")}
    common_o = [i for i in oorder if i in nv]
    common_n = [i for i in norder if i in ov]
    d["reordered"] = common_o != common_n
    for i in common_n:
        a, b = ov[i], nv[i]
        if norm_text(a.get("narration")) != norm_text(b.get("narration")):
            d["narration"].append(i)
        if a.get("gen") != b.get("gen") or a.get("kind") != b.get("kind") or a.get("graphic") != b.get("graphic") or (b.get("dirty") and not a.get("dirty")):
            d["visual"].append(i)
        elif any(a.get(k) != b.get(k) for k in ("fit", "motion", "transition", "focus", "trim", "playbackRate", "color", "src")):
            d["visual_props"].append(i)
    os_, ns = old.get("style") or {}, new.get("style") or {}
    d["style"] = sorted(k for k in set(os_) | set(ns) if os_.get(k) != ns.get(k))
    if old.get("canvas") != new.get("canvas"):
        d["canvas"] = f"{new['canvas']['width']}x{new['canvas']['height']}"
    strip = lambda x: [{k: v for k, v in c.items() if k not in ("hash",)} for c in x or []]
    d["music"] = strip(old["tracks"].get("music")) != strip(new["tracks"].get("music"))
    og = ((old["tracks"].get("voice") or [{}])[0]).get("gen") or {}
    ng = ((new["tracks"].get("voice") or [{}])[0]).get("gen") or {}
    d["voice"] = _voice_key(og) != _voice_key(ng)
    oc = {k: v for k, v in (old["tracks"].get("captions") or {}).items() if k != "words"}
    nc = {k: v for k, v in (new["tracks"].get("captions") or {}).items() if k != "words"}
    d["captions"] = oc != nc
    d["overlays"] = old["tracks"].get("overlays") != new["tracks"].get("overlays")
    return d


def plan(old, new):
    """What a rebuild will remake: lines to re-voice, images to repaint (everything else is reused)."""
    d = diff(old, new)
    vo = (new["tracks"].get("voice") or [None])[0]
    segs = {(s["clip"], norm_text(s["text"])) for s in (vo or {}).get("segments") or [] if s.get("voice") == _voice_key((vo or {}).get("gen"))}
    texts = {norm_text(s["text"]) for s in (vo or {}).get("segments") or [] if s.get("voice") == _voice_key((vo or {}).get("gen"))}
    revoice = []
    if vo and vo.get("dirty"):
        for v in new["tracks"]["visuals"]:
            n = norm_text(v.get("narration"))
            if n and (v["id"], n) not in segs and n not in texts:
                revoice.append(v["id"])
    repaint = [v["id"] for v in new["tracks"]["visuals"] if v.get("dirty")]
    return {"diff": d, "revoice": revoice, "repaint": repaint, "retime": bool(vo and vo.get("dirty"))}


def versions(log):
    """Collapse history into user-facing versions: a 'rebuilt ...' revision belongs to the edit before it."""
    out = []
    for h in log:
        msg = h.get("message") or ""
        if out and msg.startswith("rebuilt") and not h.get("edit_id"):
            out[-1] = {**out[-1], "rev": h["rev"], "at": h.get("at"), "built": True}
            continue
        out.append({"rev": h["rev"], "at": h.get("at"), "message": msg, "edit_id": h.get("edit_id"), "kind": h.get("kind")})
    return out


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


def save(t, message="save", patch=None, extra=None):
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
        f.write(json.dumps({"rev": t["rev"], "at": t["meta"]["updated"], "message": message, **({"patch": patch} if patch else {}), **(extra or {})}, ensure_ascii=False) + "\n")
    return t["rev"]


def applied_edits(pid):
    return {h["edit_id"] for h in history(pid) if h.get("edit_id")}


def history(pid):
    p = os.path.join(project_dir(pid), "history", "log.jsonl")
    return [json.loads(l) for l in open(p)] if os.path.exists(p) else []


def revision(pid, rev):
    return json.load(open(os.path.join(project_dir(pid), "history", f"r{int(rev)}.json")))
