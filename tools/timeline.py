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
    # stage5: the What If look. Hard cuts, word-highlight bold-pop captions, two words at a time.
    # position is the one thing a render has to confirm: top | middle | bottom (edit: "captions at the top").
    "whatif": {"caption": {"preset": "bold-pop", "position": "top", "words_per_group": 2}, "transition": {"type": "cut", "duration": 0}},
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
    "documentary": {"recipe": "documentary", "caption": {"preset": "none", "font": "Inter"}, "transition": {"type": "dissolve", "duration": 0.8},
                    "transitions": ["dissolve", "focus", "dissolve", "leak"], "motion": "parallax",
                    "fx": {"texture": "film", "letterbox": 0.06}, "gfx": {"grain": 0.18, "vignette": 0.5, "focus_pull": True}, "backdrop": "gradient", "palette": ["#15110c", "#6b4a2b"],
                    "grade": "contrast(1.08) saturate(0.82) sepia(0.2)", "font": "Playfair Display", "progress_bar": False,
                    "title": {"font": "Playfair Display"}},
    "motion-explainer": {"recipe": "motion-explainer", "caption": {"preset": "none", "font": "Montserrat"}, "transition": {"type": "slide-left", "duration": 0.4},
                         "transitions": ["slide-left", "zoom-in", "page-turn", "wipe", "zoom-out", "slide-right"], "motion": "static",
                         "backdrop": "grid", "vignette": False, "font": "Montserrat", "gfx": {"grain": 0.05, "vignette": 0.25}},
    "blueprint": {"recipe": "blueprint", "caption": {"preset": "none", "font": "Space Grotesk"}, "transition": {"type": "wipe", "duration": 0.4},
                  "transitions": ["wipe", "slide-up", "zoom-in"], "motion": "static", "backdrop": "blueprint", "accent": "#7fd1ff", "gfx": {"scanlines": 0.12, "grain": 0.06, "vignette": 0.35},
                  "vignette": False, "font": "Space Grotesk"},
    "kinetic-news": {"recipe": "kinetic-news", "caption": {"preset": "word-by-word", "font": "Anton", "weight": 400},
                     "transition": {"type": "flash", "duration": 0.25}, "transitions": ["flash", "zoom-in", "slide-left", "cut", "zoom-out"],
                     "motion": "kenburns", "backdrop": "dots", "grade": "contrast(1.12) saturate(1.15)", "gfx": {"chroma_hit": 14, "grain": 0.08, "vignette": 0.3}, "font": "Anton"},
    "cinematic": {"recipe": "cinematic", "caption": {"preset": "none", "font": "Inter"}, "transition": {"type": "dissolve", "duration": 0.7},
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

# ---- learned styles (style-fix): styles/<id>.json committed by learn-style.yml ----
_learned_cache = None


def learned_styles():
    """id -> full learned style recipe, read from styles/ (every *.json except index.json)."""
    global _learned_cache
    if _learned_cache is None:
        out = {}
        d = os.path.join(ROOT, "styles")
        try:
            for f in sorted(os.listdir(d)):
                if f.endswith(".json") and f != "index.json":
                    try:
                        s = json.load(open(os.path.join(d, f)))
                        out[str(s.get("id") or f[:-5])] = s
                    except Exception:
                        pass
        except Exception:
            pass
        _learned_cache = out
    return _learned_cache


def find_learned(name):
    """Resolve a learned style by id or display name (exact first, then inside the text)."""
    n = (name or "").strip().lower()
    if not n:
        return None, None
    for sid, s in learned_styles().items():
        if n == sid.lower() or n == (s.get("name") or "").lower():
            return sid, s
    cands = []
    for sid, s in learned_styles().items():
        for key in {sid.lower(), (s.get("name") or "").lower()} - {""}:
            if key in n:
                cands.append((len(key), sid, s))
    if cands:
        cands.sort(key=lambda x: -x[0])  # longest match wins: 'fastedit2' beats 'fastedit'
        return cands[0][1], cands[0][2]
    return None, None


RECIPES = RECIPES + sorted(learned_styles().keys())
# ---- end learned styles (style-fix) ----


def deep_merge(a, b):
    out = copy.deepcopy(a)
    for k, v in (b or {}).items():
        out[k] = deep_merge(out[k], v) if isinstance(v, dict) and isinstance(out.get(k), dict) else copy.deepcopy(v)
    return out


def style_from(spec):
    """Spec fields -> style tokens. spec.style is the image-prompt style text (kept in meta);
    spec.style_preset / spec.style_tokens / spec.caption_style choose the look."""
    st = deep_merge(STYLE_PRESETS["bold-pop"], STYLE_PRESETS.get(spec.get("style_preset") or "", {}))
    # stage5: a spec whose beats are What If scenes gets the What If look unless a named look was chosen.
    # captions="auto" keeps the look's own captions (the plain bold-pop look would be softened to subtitles below).
    if (spec.get("style_preset") or "bold-pop") == "bold-pop" and any(
            isinstance(b.get("scene"), dict) and b["scene"].get("pack", "whatif") == "whatif" for b in spec.get("beats") or []):
        st = deep_merge(st, STYLE_PRESETS["whatif"])
        spec = {**spec, "captions": spec.get("captions") or "auto"}
    # learned styles (style-fix): spec.style_preset may name a learned look -> merge its tokens
    _lid, _learned = find_learned(spec.get("style_preset") or "")
    if _learned:
        st = deep_merge(st, _learned.get("style_tokens") or {})
        st["learned"] = _lid
    if spec.get("style_preset"):
        st["preset"] = spec["style_preset"]
    if spec.get("caption_style"):
        st = deep_merge(st, {"caption": {"preset": spec["caption_style"]}})
    if spec.get("caption_font"):
        st = deep_merge(st, {"caption": {"font": spec["caption_font"]}})
    st = deep_merge(st, spec.get("style_tokens") or {})
    # Captions are subtle by default. captions="none" switches them off, "bold" keeps the loud pop style, "auto" keeps whatever
    # the look chose. Named recipes and presets (comic, anime, neon, ...) keep their own captions.
    cap = str(spec.get("captions") or "").lower()
    cur = (st.get("caption") or {}).get("preset") or "bold-pop"
    plain_look = not st.get("recipe") and (spec.get("style_preset") or "bold-pop") == "bold-pop"
    want = {"none": "none", "off": "none", "subtle": "subtitle"}.get(cap) or ("subtitle" if cur == "bold-pop" and plain_look and cap not in ("bold", "auto") else None)
    if want:
        st = deep_merge(st, {"caption": {"preset": want}})
    st["accent"] = spec.get("accent") or st.get("accent") or "#FFD43B"
    return st


def expand_recipe(t):
    """An edit may set style.apply_recipe = "documentary" (the bot does not know the render tokens):
    swap in that recipe's whole look, keeping the accent and any caption size the user asked for."""
    st = t.get("style") or {}
    name = st.pop("apply_recipe", None)
    if not name:
        return t
    keep = {k: st[k] for k in ("accent",) if st.get(k)}
    if name in STYLE_PRESETS:
        new = deep_merge(STYLE_PRESETS["bold-pop"], STYLE_PRESETS[name])
    else:
        # learned styles (style-fix): apply_recipe may name a learned look, e.g. "fastedit"
        _lid, _learned = find_learned(name)
        if not _learned:
            return t
        new = deep_merge(STYLE_PRESETS["bold-pop"], _learned.get("style_tokens") or {})
        new["learned"] = _lid
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
        if b.get("scene"):
            clip.update(kind="scene", scene=b["scene"], gen={"tool": "scene"})
        elif b.get("graphic"):
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
        "music": [{"id": "m1", "src": props["music"], "start": 0, "volume": float(props.get("musicVolume", 0.22)), "loop": True,
                   "fade_in": 0.5, "fade_out": 1.0, "duck": True, "gen": {"tool": "library", "name": spec.get("music") or ""}}]
        if props.get("music") else [],
        "sfx": [],
        "overlays": [{"id": "title", "kind": "title", "start": 0, "end": 3, "text": props.get("title", "")}] if props.get("title") and spec.get("title_card") else [],
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
KINDS = {"image", "ai_video", "graphic", "stock", "upload", "color", "scene"}


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
        if v.get("kind") == "scene" and not isinstance(v.get("scene"), dict):
            errs.append(f"{v.get('id')}: scene clip needs a scene object")
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
                if c.get("gen") and c["gen"].get("tool") not in ("graphic", "library", "scene") and not c.get("src_locked"):
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
            if c.get("kind") in ("graphic", "color", "scene"):
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
        if v["kind"] == "scene":
            v.setdefault("gen", {"tool": "scene"})
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
        if v.get("kind") == "scene":
            sc = v.get("scene") or {}
            what = f"{sc.get('scene', 'scene')} ({sc.get('shot', 'wide')})"
        else:
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
        if a.get("gen") != b.get("gen") or a.get("kind") != b.get("kind") or a.get("graphic") != b.get("graphic") or a.get("scene") != b.get("scene") or (b.get("dirty") and not a.get("dirty")):
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


# ---- director (layers): decides the layer stack per beat and narrates its choices ----
import random as _random

_STOP = set("the a an and or but if then than that this those these with from into onto over under about after before while when where which what who your you they them their its is are was were be been being have has had do does did will would can could should may might must not no so too very just only also more most some any each every both few many much such because since until between during without within through across along around his her him our we i me my to of in on at by for as up out off down how why".split())
_ICONS = [
    (r"\b(money|cost|price|pay|paid|cash|dollar|naira|profit|earn|salary|rich)\b", "coin"),
    (r"\b(danger|risk|warn|scam|fake|fraud|threat|careful|never)\b", "warn"),
    (r"\b(fast|speed|quick|instant|power|energy|charge|battery)\b", "bolt"),
    (r"\b(time|hour|hours|minute|minutes|second|seconds|year|years|day|days|wait)\b", "clock"),
    (r"\b(safe|protect|secure|trust|guard|safety)\b", "shield"),
    (r"\b(love|heart|care|health)\b", "heart"),
    (r"\b(idea|think|smart|brain|learn|tip|trick)\b", "bulb"),
    (r"\b(true|correct|real|proven|works|fix|solved)\b", "check"),
    (r"\b(hot|fire|burn|heat|warm)\b", "fire"),
    (r"\b(best|top|win|winner|favorite)\b", "star"),
]
_ROUTE = r"\b(travel|journey|route|flight|road trip|distance|miles|kilometers|km|across the|border|migrat|arrive|shipping|delivery)\b"


def _key_word(text):
    ws = [w for w in re.findall(r"[A-Za-z]{4,}", text) if w.lower() not in _STOP][:8]
    return max(ws, key=len) if ws else ""


def _director_say(lines):
    msg = "\n".join(lines)[:3800]
    print(msg)
    if os.getenv("DIRECTOR_DEFER") == "1":   # step1-subjects: notes are sent by tools/subjects.py after the re-run
        return
    tok, chat = os.getenv("TELEGRAM_TOKEN"), os.getenv("CHAT_ID")
    if not (tok and chat):
        return
    try:
        import urllib.request
        urllib.request.urlopen(urllib.request.Request("https://api.telegram.org/bot%s/sendMessage" % tok,
            data=json.dumps({"chat_id": chat, "text": msg, "disable_notification": True}).encode(),
            headers={"Content-Type": "application/json"}), timeout=15)
    except Exception as e:
        print("director tg", e)


# ---- illustration tier (step3-assets): which code illustration plays which noun ----
_ILLUS = [
    (r"\b(houses?|homes?|property|properties|mortgage|landlords?|rent|real estate|housing|apartments?)\b", "house"),
    (r"\b(buildings?|towers?|skyscrapers?|offices?|downtown|headquarters)\b", "building"),
    (r"\b(phones?|smartphones?|iphones?|android|mobile|apps?)\b", "phone"),
    (r"\b(batter(?:y|ies)|charging|charged|power bank)\b", "battery"),
    (r"\b(cold|freezing|frozen|frost|temperatures?|winter|degrees)\b", "thermometer"),
    (r"\b(banks?|loans?|credit|debts?|interest rates?|invest(?:ing|ment|ments|ors?)?|funds?)\b", "bank"),
    (r"\b(crash(?:ed|es)?|fell|dropped|declin(?:e|ed|ing)|collaps(?:e|ed|ing)|plunged?|recession|losses|lost)\b", "chart-down"),
    (r"\b(growth|grew|rose|increased?|soared|surged?|boom(?:ed|ing)?|profits?|revenue|record sales)\b", "chart-up"),
    (r"\b(money|cash|dollars?|prices?|costs?|paid|salary|salaries|naira|cheap|expensive|worth)\b", "coin"),
    (r"\b(stores?|shops?|retail|thrift|mall|customers?|brands?)\b", "store"),
    (r"\b(cars?|drive|driving|vehicles?|trucks?|uber)\b", "car"),
    (r"\b(contracts?|documents?|papers?|law|legal|reports?|files?|forms?|records?|deeds?|certificates?|tax(?:es)?)\b", "document"),
    (r"\b(passwords?|security|secure|hacked?|privacy|encrypt(?:ed|ion)?|locked|breach(?:ed)?)\b", "lock"),
    (r"\b(world|global|countries|country|international|worldwide|planet|africa|nigeria)\b", "globe"),
    (r"\b(ideas?|innovation|invention|genius|smart|tricks?)\b", "bulb"),
    (r"\b(workers?|employees?|bosses|boss|founders?|ceo|neighbou?rs?|people|man|woman)\b", "person"),
]
# concrete things only: a real-style cutout of an abstract idea (a chart, a price) or a person would be wrong
_ILLUS_REAL = {"house": "modern suburban house", "building": "glass office building", "phone": "smartphone", "coin": "stack of gold coins",
               "bank": "classical bank building with columns", "store": "small shop storefront", "car": "sedan car", "document": "paper contract document",
               "thermometer": "mercury thermometer", "battery": "battery", "lock": "brass padlock", "globe": "world globe", "bulb": "glowing light bulb"}

_ICONS2 = [
    (r"\b(money|cost|costs|price|paid|cash|dollars?|naira|profit|salary|rich|broke)\b", "coin"),
    (r"\b(danger|dangerous|risk|warning|scam|fraud|threat|deadly)\b", "warn"),
    (r"\b(speed|instant|battery|electric|lightning)\b", "bolt"),
    (r"\b(safe|protect|secure|safety|guard)\b", "shield"),
    (r"\b(heart|love|health)\b", "heart"),
    (r"\b(idea|genius|trick|brain)\b", "bulb"),
    (r"\b(proven|solved|fixed|worked)\b", "check"),
    (r"\b(fire|burning|burned|flames?)\b", "fire"),
    (r"\b(winner|champion|record)\b", "star"),
]
# ---- data tier (step6-data): chapters and charts the director can see in the words ----
_NUMW = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10}
_CHAPTER_RX = re.compile(r"^\s*(?:rule|law|lesson|tip|step|reason|mistake|number|part|chapter)\s*(?:#|no\.?\s*)?(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)\b[\s:,.\u2013\u2014-]*(.*)$", re.I | re.S)
_PAIR_RX = re.compile(r"\b((?:19|20)\d\d)\b[^.!?\n]{0,48}?([$\u00a3\u20ac\u20a6])\s?(\d[\d,]*(?:\.\d+)?)\s?(k|m|bn|million|billion|thousand)?\b", re.I)
_MULT = {"k": 1e3, "thousand": 1e3, "m": 1e6, "million": 1e6, "bn": 1e9, "billion": 1e9}


def _chapter_of(text, given=None):
    """(number, title) when the line opens a numbered chapter ("Rule three: ..."), or the writer gave one."""
    if isinstance(given, dict) and given.get("n") is not None:
        try:
            return int(given["n"]), str(given.get("title") or "")[:46]
        except (TypeError, ValueError):
            return None
    m = _CHAPTER_RX.match(text or "")
    if not m:
        return None
    n = m.group(1).lower()
    n = int(n) if n.isdigit() else _NUMW.get(n, 0)
    rest = re.sub(r"^(?:is|are|was)\s+", "", re.split(r"[.!?]", m.group(2).strip(), 1)[0].strip(), flags=re.I)
    return (n, rest[:46]) if n else None


def _chart_of(text, given=None):
    """Bar-chart data: from the writer ({labels, values, unit, title}) or three or more year + amount pairs in the line."""
    if isinstance(given, dict) and given.get("labels") and given.get("values"):
        try:
            labs, vals = [str(x)[:8] for x in given["labels"]][:6], [float(x) for x in given["values"]][:6]
        except (TypeError, ValueError):
            return None
        if len(labs) == len(vals) >= 2:
            return {"title": str(given.get("title") or "")[:40], "labels": labs, "values": vals, "unit": str(given.get("unit") or "")[:2]}
        return None
    pairs = _PAIR_RX.findall(text or "")
    if len(pairs) < 3:
        return None
    labs, vals = [], []
    for yr, cur, num, mult in pairs[:6]:
        try:
            v = float(num.replace(",", "").rstrip(".")) * _MULT.get((mult or "").lower(), 1)
        except ValueError:
            return None
        labs.append(yr)
        vals.append(v)
    if labs != sorted(labs) or len(set(labs)) < len(labs):
        return None
    return {"title": "By year", "labels": labs, "values": vals, "unit": pairs[0][1]}

_FACT_RX = [
    r"\b(?:1[0-9]{3}|20[0-9]{2})\b",
    r"[$£€₦]\s?\d[\d,.]*\s?(?:k|m|bn|million|billion|thousand)?",
    r"\b\d[\d,.]*\s?(?:%|percent)",
    r"\b\d[\d,.]*\s?(?:million|billion|trillion|thousand|times)\b",
]


def _subject_box(c, pid):
    """(top, bottom) of the subject or a face as fractions of the frame height, or None when unknown.
    Uses the subject cutout when one exists, else OpenCV face detection when it is installed."""
    try:
        src = c.get("src")
        if not src:
            return None
        cut = asset_path(pid, os.path.splitext(src)[0] + "_cut.png")
        if cut and os.path.exists(cut):
            from PIL import Image
            im = Image.open(cut).convert("RGBA")
            bb = im.split()[3].point(lambda v: 255 if v > 40 else 0).getbbox()
            if bb:
                return (bb[1] / float(im.height), bb[3] / float(im.height))
        base = asset_path(pid, src)
        if base and os.path.exists(base):
            import cv2
            img = cv2.imread(base)
            if img is None:
                return None
            g = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
            cas = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
            faces = cas.detectMultiScale(g, 1.1, 5, minSize=(max(24, g.shape[1] // 14),) * 2)
            if len(faces):
                return (min(f[1] for f in faces) / float(g.shape[0]), max(f[1] + f[3] for f in faces) / float(g.shape[0]))
    except Exception:
        return None
    return None


def director_pass(t, spec=None):
    """Director v2. Few layers, each one motivated, none over a face.
    - hook beat: the key word behind the subject when a cutout exists, else big in the top band
    - a number, year or money amount (the writer's "callout", or a strong match in the line): big in the top band with an underline
    - an icon in a top corner, only on a strong word
    No random marks, no map lines, no colour wash except one soft one on the hook."""
    spec = spec or {}
    tr = t.setdefault("tracks", {})
    vis = tr.get("visuals") or []
    if not vis or str(spec.get("layers", "")).lower() in ("off", "none", "false"):
        return t
    st = t.get("style") or {}
    sb = spec.get("beats") or []
    pid = t.get("id") or "job"
    rnd = _random.Random(str(t.get("id")))
    dur = float(t.get("duration") or vis[-1]["end"])
    gap = {"documentary": 4.5, "cinematic": 4.5, "stop-motion": 4.5, "kinetic-news": 2.2}.get(st.get("recipe") or "", 3.0)
    if (st.get("preset") or "") == "minimal":
        gap = 5.0
    cap_callout, cap_icon = 3 + int(dur // 60), 2 + int(dur // 45)
    n_callout = n_icon = 0
    layers, notes = [], []
    last_end, last_kind, left_clean = -99.0, None, 0

    def put(kind, c, delay=0.15, **kw):
        s = round(c["start"] + delay, 2)
        e = round(max(s + 0.6, c["end"] - 0.05), 2)
        layers.append(dict({"id": "ly%d" % (len(layers) + 1), "kind": kind, "anchor": c["id"], "delay": delay, "start": s, "end": e}, **kw))

    for i, c in enumerate(vis):
        text = (c.get("narration") or "").strip()
        if not text or (c["end"] - c["start"]) < 1.4:
            continue
        low = text.lower()
        snip = text if len(text) <= 38 else text[:35] + "..."
        tag = 'Beat %d ("%s")' % (i + 1, snip)
        sbi = sb[i] if i < len(sb) and isinstance(sb[i], dict) else {}
        co = str(sbi.get("callout") or "").strip()[:14]
        if i == 0:
            word = co or _key_word(text) or text.split()[0]
            cut = None
            if c.get("kind") == "image" and c.get("src"):
                cand = os.path.splitext(c["src"])[0] + "_cut.png"
                p = asset_path(pid, cand)
                if p and os.path.exists(p):
                    cut = cand
            if cut:
                put("depth-text", c, 0.1, src=c["src"], cutout=cut, text=word, y=0.3, push=0.12)
                notes.append('%s: the hook. I set %s huge BEHIND the subject (real cutout) and push in slowly.' % (tag, word.upper()))
            else:
                put("kinetic", c, 0.1, text=word, y=0.14)
                notes.append('%s: the hook. No subject cutout, so I put %s in the top band where it cannot cover the face.' % (tag, word.upper()))
            put("color-wash", c, 0.0, opacity=0.35, seed=round(rnd.random() * 6, 2))
            last_end, last_kind = c["end"], "hook"
            continue
        ch = _chapter_of(text, sbi.get("chapter"))                    # step6-data
        if ch:
            put("chapter-card", c, 0.1, n=ch[0], title=ch[1])
            notes.append('%s: a numbered chapter card, chapter %d.' % (tag, ch[0]))
            last_end, last_kind = c["end"], "chapter"
            continue
        cd = _chart_of(text, sbi.get("chart"))
        if cd and last_kind != "chart" and (c["end"] - c["start"]) >= 2.4:
            put("chart", c, 0.45, **cd)
            notes.append('%s: %d numbers in one line, so a real bar chart (%s).' % (tag, len(cd["labels"]), ", ".join(cd["labels"])))
            last_end, last_kind = c["end"], "chart"
            continue
        pn = sbi.get("panel")
        if isinstance(pn, dict) and (pn.get("tiles") or pn.get("log") or pn.get("alert")) and (c["end"] - c["start"]) >= 2.4:
            tiles = [{"label": str(x.get("label", ""))[:22], "value": str(x.get("value", ""))[:12]} for x in (pn.get("tiles") or []) if isinstance(x, dict)][:4]
            put("panel", c, 0.3, title=str(pn.get("title") or "")[:34], tiles=tiles, alert=str(pn.get("alert") or "")[:60], log=[str(x)[:44] for x in (pn.get("log") or [])][:4])
            notes.append('%s: a dashboard panel the writer asked for.' % tag)
            last_end, last_kind = c["end"], "panel"
            continue
        if c["start"] < last_end + gap and not co:   # a callout the writer chose skips the spacing rule
            left_clean += 1
            continue
        fact = co
        if not fact:
            for rx in _FACT_RX:
                m = re.search(rx, text)
                if m:
                    fact = m.group(0).strip()
                    break
        if fact and n_callout < cap_callout and last_kind != "callout":
            box = _subject_box(c, pid)
            if box and box[0] < 0.22:
                notes.append('%s: %s is worth showing, but the subject is up in the top of the frame, so I left it off rather than cover it.' % (tag, fact))
                left_clean += 1
                continue
            corner = n_callout % 2 == 1 and len(fact) <= 12     # step3-assets: alternate with tilted corner text
            if corner:
                put("corner-text", c, 0.2, text=fact, side=("tr" if n_callout % 4 == 1 else "tl"), y=0.12)
            else:
                put("kinetic", c, 0.2, text=fact, y=0.14)
                put("draw-line", c, 0.7, shape="underline", x=0.2, y=0.21, w=0.6)
            n_callout += 1
            last_end, last_kind = c["end"], "callout"
            notes.append(('%s: %s sits tilted in a corner, revealed through a mask, clear of the subject.' if corner else
                          '%s: %s goes big in the top band with an underline, clear of the subject.') % (tag, fact))
            continue
        want = str(sbi.get("asset") or "").strip()[:48]          # step3-assets: props from the library
        ill = next((iid for rx, iid in _ILLUS if re.search(rx, low)), None)
        if (want or ill) and n_icon < cap_icon and last_kind != "icon":
            pbox = _subject_box(c, pid)
            if pbox and pbox[0] < 0.28:
                notes.append('%s: a "%s" prop fits, but the subject is up in the top of the frame, so I skipped it.' % (tag, want or ill))
                left_clean += 1
                continue
            side_x = 0.8 if n_icon % 2 == 0 else 0.2
            if want:
                put("asset", c, 0.4, subject=want, fallback=ill, x=side_x, y=0.22, w=0.33)
                notes.append('%s: the writer asked for a real "%s" cutout. It comes from the asset library (made once, then reused).' % (tag, want))
            elif str(spec.get("assets", "")).lower() in ("real", "photo", "cutout") and ill in _ILLUS_REAL:
                put("asset", c, 0.4, subject=_ILLUS_REAL[ill], fallback=ill, x=side_x, y=0.22, w=0.33)
                notes.append('%s: a real-style cutout of a %s comes from the asset library.' % (tag, _ILLUS_REAL[ill]))
            else:
                put("illustration", c, 0.4, asset=ill, x=side_x, y=0.2, w=0.3)
                notes.append('%s: a "%s" illustration builds itself on the %s after the words land.' % (tag, ill, "right" if side_x > 0.5 else "left"))
            n_icon += 1
            last_end, last_kind = c["end"], "icon"
            continue
        icon = next((ic for rx, ic in _ICONS2 if re.search(rx, low)), None)
        if icon and n_icon < cap_icon and last_kind != "icon":
            ibox = _subject_box(c, pid)
            if ibox and ibox[0] < 0.28:
                notes.append('%s: a "%s" icon fits, but the subject is up in the top of the frame, so I skipped it.' % (tag, icon))
                left_clean += 1
                continue
            put("icon-pop", c, 0.2, icon=icon, x=(0.2 if n_icon % 2 == 0 else 0.8), y=0.14)
            n_icon += 1
            last_end, last_kind = c["end"], "icon"
            notes.append('%s: a "%s" icon pops in the top corner.' % (tag, icon))
            continue
        left_clean += 1
    notes.append("Left %d beat(s) clean on purpose: no random lines, no map lines, nothing over a face." % left_clean)
    if layers:
        tr["layers"] = layers
        t.setdefault("meta", {})["director"] = notes
        _director_say(["Director notes (%d layers on %d beats)" % (len(layers), len(vis))] + ["- " + n for n in notes[:30]])
    return t

_from_props_orig = from_props


def from_props(props, spec=None, pid="job", cv=None):
    t = _from_props_orig(props, spec, pid, cv)
    if spec and spec.get("beats"):
        try:
            director_pass(t, spec)
        except Exception as e:
            print("director_pass failed (ignored):", e)
    try:
        camera_pass(t, spec)      # step2-camera
    except Exception as e:
        print("camera_pass failed (ignored):", e)
    return t


_retime_orig = retime


def retime(t, words, total):
    _retime_orig(t, words, total)
    byid = {v["id"]: v for v in t["tracks"]["visuals"]}
    for l in t["tracks"].get("layers") or []:
        a = byid.get(l.get("anchor"))
        if a:
            l["start"] = round(a["start"] + (l.get("delay") or 0.15), 2)
            l["end"] = round(max(l["start"] + 0.6, a["end"] - 0.05), 2)
# ---- end director (layers) ----

# ---- camera (step2-camera): a move per picture, motivated transitions between pictures ----
_CAM_KEEP_RECIPES = ("stop-motion",)
_CAM_REVEAL = re.compile(r"\b(but|until|then|suddenly|turns out|except|however|instead|yet)\b|\?\s*$", re.I)
_CAM_ENERGY = re.compile(r"\b(suddenly|crash|crashed|exploded|boom|everything changed|snapped|collapsed)\b|!\s*$", re.I)
_CAM_END = re.compile(r"[.!?\u2026][\"'\u201d)]*\s*$")


def camera_pass(t, spec=None):
    """Virtual camera. Every picture gets a motivated move (never the same twice in a row), every change between
    pictures is led by the camera: settle (a quick punch on mid-sentence cuts), push-through or carry on sentence
    ends (continuing the previous move), whip at most twice. Evidence beats hold still. Off with spec.camera = off."""
    spec = spec or {}
    if str(spec.get("camera", "")).lower() in ("off", "none", "false"):
        return t
    st = t.get("style") or {}
    if (st.get("recipe") or "") in _CAM_KEEP_RECIPES:
        return t
    tr = t.get("tracks") or {}
    vis = tr.get("visuals") or []
    if not vis:
        return t
    notes, whips, last_whip = [], 0, -99.0
    laid = {}
    for l in tr.get("layers") or []:
        laid.setdefault(l.get("anchor"), set()).add(l.get("kind"))
    sb = spec.get("beats") or []
    prev_move, carried, dirn = None, 0, 1
    camable = lambda c: c.get("kind") == "image" and c.get("src")
    for i, c in enumerate(vis):
        c.pop("cam", None)
        if not camable(c):
            continue
        text = (c.get("narration") or "").strip()
        dur = c["end"] - c["start"]
        k = laid.get(c.get("id"), set())
        sbi = sb[i] if i < len(sb) and isinstance(sb[i], dict) else {}
        fact = bool(str(sbi.get("callout") or "").strip()) or any(re.search(rx, text) for rx in _FACT_RX)
        has_cut = bool(c.get("cutout"))
        dirn = -dirn
        amp = round(max(0.35, min(0.8, 0.3 + 0.12 * dur)), 2)
        if i == 0:
            move, why = ("hold", "hook: the text is behind the subject, the camera stays out of its way") if "depth-text" in k else ("push-in", "hook: slow push-in")
        elif k & {"kinetic", "icon-pop", "depth-text", "corner-text", "chart", "panel", "chapter-card"} or (fact and k):
            move, why = "hold", "evidence on screen: the camera stops"
        elif _CAM_REVEAL.search(text):
            move, why = "pull-out", "a turn in the story: pull back to reveal"
        elif has_cut and i % 3 == 0:
            move, why = "orbit", "subject cutout: a small orbit with parallax"
        elif i % 4 == 2:
            move, why = "truck", "side move for variety"
        else:
            move, why = "drift", "alive baseline"
        if i == len(vis) - 1 and i > 0:
            move, why = "pull-out", "last picture: slow pull-out"
        if move == prev_move and move not in ("hold",):
            move, why = ("drift", why + " (not the same move twice)") if move != "drift" else ("truck", why + " (not the same move twice)")
        cam = {"move": move, "amp": amp, "dir": dirn}
        if move == "hold":
            cam["wobble"] = 0
        c["cam"] = cam
        notes.append("Beat %d: %s (%s)." % (i + 1, move, why))
        prev_move = move
    # transitions between two camera pictures
    for i in range(1, len(vis)):
        a, b = vis[i - 1], vis[i]
        if not (camable(a) and camable(b)):
            continue
        ends = bool(_CAM_END.search((a.get("narration") or "").strip()))
        pm = (a.get("cam") or {}).get("move")
        pd = (a.get("cam") or {}).get("dir") or 1
        nxt = (b.get("narration") or "")
        if ends and whips < 2 and b["start"] - last_whip > 8.0 and _CAM_ENERGY.search(nxt):
            ty, du = ("whip-left" if pd > 0 else "whip-right"), 0.27
            whips += 1
            last_whip = b["start"]
        elif ends:
            carried += 1
            if pm == "push-in" or (carried % 2 == 0 and pm in ("hold", "orbit", "pull-out", None)):
                ty, du = "push-through", 0.45
            elif pm in ("drift", "truck") and carried % 2 == 1:
                ty, du = ("carry-left" if pd > 0 else "carry-right"), 0.4
            else:
                ty, du = "settle", 0.5
        else:
            ty, du = "settle", 0.22      # mid-sentence slice: a quick camera punch, not a slide
        b["transition"] = {"type": ty, "duration": du}
    if notes:
        t.setdefault("meta", {})["camera"] = notes
        kinds = {}
        for c in vis:
            ty = (c.get("transition") or {}).get("type")
            if ty:
                kinds[ty] = kinds.get(ty, 0) + 1
        _director_say(["Camera (%d moves; changes: %s)" % (len(notes), ", ".join("%s x%d" % kv for kv in sorted(kinds.items())))] + ["- " + n for n in notes[:24]])
    return t
# ---- end camera ----

