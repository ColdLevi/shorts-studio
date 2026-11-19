"""direction_parse.py: turns the owner's script directions into locked director fields.
Gemini reads the words; code validates every value against the engine's real vocabulary. Nothing is dropped silently."""
import json, os, re

MOVES = ("push-in", "pull-out", "drift", "truck", "orbit", "hold", "handheld")
TRANS = ("cut", "fade", "dissolve", "flash", "slide-left", "slide-up", "zoom-in", "zoom-out", "wipe", "page-turn", "blur",
         "settle", "push-through", "carry-left", "carry-right", "whip-left", "whip-right")
KITCAM = ("follow-out", "focus-pull", "push-reply", "static")
PFROM = ("left", "right", "top", "bottom", "center")
PPATH = ("straight", "arc-up", "arc-down", "wobble")
PEASE = ("in-out", "out", "out-cubic", "out-quint", "soft", "snap", "back-soft")
STEPS = ("move", "click", "type", "enter", "spinner", "bubble")
HEX = re.compile(r"^#[0-9a-fA-F]{6}$")

PROMPT = """You are a video editor's assistant. Translate the editor's DIRECTION for ONE scene into JSON, using ONLY this vocabulary.
Follow the direction exactly. Add nothing it did not ask for. Leave out every key the direction does not mention.
Anything the direction asks for that is NOT in the vocabulary goes into "unsupported" as short plain phrases.
Answer with the JSON object only.

VOCABULARY
"cam": {"move": one of <<MOVES>>, "amp": 0.2 to 0.9 (optional, strength), "dir": 1 or -1 (optional)}   camera move on the scene's picture
"transition": {"type": one of <<TRANS>>, "duration": 0.1 to 1.0 seconds}   the change INTO this scene
"clean": true   no overlays at all on this scene
"callout": short text, at most 14 characters, shown big on screen
"asset": a prop to show, at most 5 words
"kit": "none" (no screen scene), "screen" (a fake browser or search screen scene) or "glass-ui" (a liquid glass app interface: now-playing pill, tab bar, round search button)
"screen": list of steps, each {"type": one of <<STEPS>>, "text": "...", "side": "left" or "right", "to": "bar" or "button"}
"glass": list of steps for a glass-ui scene, each {"type": "pill" or "tab" or "search" or "hold", "text": "...", "sub": "...", "to": 0 to 3}
"chat": list of up to 2 {"side": "left" or "right", "text": "..."}
"kitcam": one of <<KITCAM>>   camera inside a screen scene
"ptr": {"from": one of <<PFROM>>, "path": one of <<PPATH>>, "ease": one of <<PEASE>>}   mouse pointer in a screen scene
"theme": {"accent": "#rrggbb", "accent2": "#rrggbb", "surface": "#rrggbb", "text": "#rrggbb", "mode": "dark" or "light"}   colour theme for the WHOLE video (only the colours mentioned; turn colour names into hex)
"unsupported": list of short phrases

SCENE TEXT: <<TEXT>>
DIRECTION: <<DIR>>"""

def _s(x, n):
    return str(x).strip()[:n]

def validate(d):
    if not isinstance(d, dict):
        return {}, ["could not read the direction"]
    out, bad = {}, [_s(x, 80) for x in (d.get("unsupported") or []) if x][:6]
    c = d.get("cam")
    if isinstance(c, dict):
        if c.get("move") in MOVES:
            cam = {"move": c["move"]}
            try:
                if c.get("amp") is not None:
                    cam["amp"] = round(min(0.9, max(0.2, float(c["amp"]))), 2)
            except (TypeError, ValueError):
                pass
            if c.get("dir") in (1, -1):
                cam["dir"] = c["dir"]
            if cam["move"] == "hold":
                cam["wobble"] = 0
            out["cam"] = cam
        else:
            bad.append("camera move: " + _s(c.get("move"), 30))
    tr = d.get("transition")
    if isinstance(tr, dict):
        if tr.get("type") in TRANS:
            try:
                du = round(min(1.0, max(0.1, float(tr.get("duration", 0.4)))), 2)
            except (TypeError, ValueError):
                du = 0.4
            out["transition"] = {"type": tr["type"], "duration": du}
        else:
            bad.append("transition: " + _s(tr.get("type"), 30))
    if d.get("clean") is True:
        out["clean"] = True
    if d.get("callout"):
        out["callout"] = _s(d["callout"], 14)
    if d.get("asset"):
        out["asset"] = _s(d["asset"], 40)
    if d.get("kit") in ("none", "screen", "glass-ui"):
        out["kit"] = d["kit"]
    st = d.get("screen")
    if isinstance(st, list):
        steps = []
        for x in st[:14]:
            if isinstance(x, dict) and x.get("type") in STEPS:
                y = {"type": x["type"]}
                if x.get("text"):
                    y["text"] = _s(x["text"], 80)
                if x.get("side") in ("left", "right"):
                    y["side"] = x["side"]
                if x.get("to") in ("bar", "button"):
                    y["to"] = x["to"]
                steps.append(y)
        if steps:
            out["screen"] = steps
    gl = d.get("glass")
    if isinstance(gl, list):
        gsteps = []
        for x in gl[:10]:
            if isinstance(x, dict) and x.get("type") in ("pill", "tab", "search", "hold"):
                y = {"type": x["type"]}
                if x.get("text"):
                    y["text"] = _s(x["text"], 40)
                if x.get("sub"):
                    y["sub"] = _s(x["sub"], 40)
                if isinstance(x.get("to"), int):
                    y["to"] = max(0, min(3, x["to"]))
                gsteps.append(y)
        if gsteps:
            out["glass"] = gsteps
    ch = d.get("chat")
    if isinstance(ch, list):
        bub = [{"side": "left" if x.get("side") == "left" else "right", "text": _s(x["text"], 80)} for x in ch[:2] if isinstance(x, dict) and x.get("text")]
        if bub:
            out["chat"] = bub
    if d.get("kitcam") in KITCAM:
        out["kitcam"] = d["kitcam"]
    p = d.get("ptr")
    if isinstance(p, dict):
        q = {k: p[k] for k, menu in (("from", PFROM), ("path", PPATH), ("ease", PEASE)) if p.get(k) in menu}
        if q:
            out["ptr"] = q
    th = d.get("theme")
    if isinstance(th, dict):
        q = {k: th[k] for k in ("accent", "accent2", "surface", "text") if isinstance(th.get(k), str) and HEX.match(th[k])}
        if th.get("mode") in ("dark", "light"):
            q["mode"] = th["mode"]
        if q:
            out["theme"] = q
        else:
            bad.append("theme: no usable colours")
    return out, bad

def parse_answer(txt):
    try:
        s = re.sub(r"^```(?:json)?|```$", "", str(txt).strip(), flags=re.M).strip()
        a, b = s.find("{"), s.rfind("}")
        return validate(json.loads(s[a:b + 1]))
    except Exception:
        return {}, ["could not read the direction"]

def compile_one(raw, beat, key):
    if not key:
        return {}, ["could not read the direction (no Gemini key)"]
    prompt = (PROMPT.replace("<<MOVES>>", str(list(MOVES))).replace("<<TRANS>>", str(list(TRANS))).replace("<<STEPS>>", str(list(STEPS)))
              .replace("<<KITCAM>>", str(list(KITCAM))).replace("<<PFROM>>", str(list(PFROM))).replace("<<PPATH>>", str(list(PPATH)))
              .replace("<<PEASE>>", str(list(PEASE))).replace("<<TEXT>>", _s(beat.get("script_text") or beat.get("narration") or "", 400))
              .replace("<<DIR>>", _s(raw, 600)))
    try:
        try:
            import gemini_models as gm
        except ImportError:
            from tools import gemini_models as gm
        err = None
        for _ in range(2):
            txt, err = gm.generate(key, [{"text": prompt}], config={"temperature": 0}, timeout=60)
            if txt:
                return parse_answer(txt)
        return {}, ["could not read the direction (%s)" % _s(err, 300)]
    except Exception as e:
        return {}, ["could not read the direction (%s)" % _s(e, 60)]

def apply(spec):
    """Reads every beat's raw "direction", locks the translated fields onto the beat, and returns a report."""
    beats = spec.get("beats") or []
    key = os.environ.get("GEMINI_API_KEY", "")
    report = []
    for i, b in enumerate(beats):
        raw = str(b.get("direction") or "").strip() if isinstance(b, dict) else ""
        if not raw:
            continue
        d, bad = compile_one(raw, b, key)
        for k, v in d.items():
            if k == "theme":
                spec["theme"] = dict(spec.get("theme") or {}, **v)
            else:
                b[k] = v
        b["locked"] = sorted(d.keys())
        report.append({"scene": i + 1, "direction": raw[:120], "followed": sorted(d.keys()), "unsupported": bad})
        print("DIRECTION scene %d: locked %s%s" % (i + 1, sorted(d.keys()), ("; could not do: " + "; ".join(bad)) if bad else ""))
    if report:
        spec["_direction_report"] = report
    return report
