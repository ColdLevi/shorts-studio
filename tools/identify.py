#!/usr/bin/env python3
"""Identify step (stage 7): look at every generated picture, say what is in it, keep the good ones, remake the bad ones.
  python3 tools/identify.py <project-id>      runs after the build, before cutouts/sound/render (make-short.yml)
For each AI-painted still it asks Gemini (vision, free key already in the workflow) for: what the picture shows, tags,
how well it matches the beat's line (1-5), faces (none / drawn / realistic), readable text or logos, defects, unsuitable content.
The decision is made HERE in code, not by the model. A picture is remade when it does not show the line (<=2), has text or a
logo, a realistic face, a distorted/artifact defect, or unsuitable content. Rules:
  - remade at most once per picture, and at most max(1, pictures/3) per video (worst first)
  - the remake uses a stricter prompt and the bot's normal repaint (project.py build); if it is still flagged, it is kept
  - never touches uploads, locked pictures, scenes, graphics, stock clips or video; only the AI stills
  - runs only on a fresh build; a re-render of an edited project skips pictures it already checked (same file hash)
  - spec {"identify": "off"} or env IDENTIFY=off switches it off; no GEMINI_API_KEY = skipped
Results are saved in timeline meta.identify (what each picture shows) and a short note goes to Telegram. Never fails the build."""
import base64, json, os, re, subprocess, sys, tempfile, urllib.error, urllib.request
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import timeline as TL

MODEL = os.getenv("IDENTIFY_MODEL", "gemini-2.5-flash")
SKIP_TOOLS = {"upload", "scene", "graphic", "library", "stock", "url"}
ASK = """You check ONE picture for a short vertical video. Be strict and literal.
The beat's spoken line: "{line}"
The picture was asked for as: "{prompt}"
Answer with JSON only, no prose, exactly these keys:
{{"subject": "what the picture shows, max 6 words",
 "tags": ["up to 6 lowercase words"],
 "match": 1-5 (5 = shows exactly what the line talks about, 3 = loosely related, 1 = unrelated or wrong subject),
 "faces": "none" | "drawn" (cartoon/illustrated face) | "realistic" (photo-like human face),
 "text": true if any readable words, letters, numbers, logo or watermark are visible else false,
 "defect": "none" | "blurry" | "distorted" (warped objects, extra limbs, melted shapes) | "artifact",
 "unsafe": true if graphic violence, nudity or other unsuitable content else false}}"""


def short(s, n=14):
    return " ".join(str(s or "").split()[:n])


def thumb(path):
    out = tempfile.mktemp(suffix=".jpg")
    try:
        r = subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", path, "-vf", "scale='min(640,iw)':-2", "-frames:v", "1", "-q:v", "4", out],
                           capture_output=True, timeout=60)
        if r.returncode != 0 or not os.path.exists(out):
            return None
        return open(out, "rb").read()
    except Exception:
        return None
    finally:
        try:
            os.remove(out)
        except OSError:
            pass


def norm(d):
    """Coerce a model answer into safe values. Anything missing counts as fine, never as a fault."""
    if not isinstance(d, dict):
        return None
    try:
        match = int(float(d.get("match", 3)))
    except (TypeError, ValueError):
        match = 3
    faces = str(d.get("faces", "none")).lower()
    defect = str(d.get("defect", "none")).lower()
    tags = d.get("tags") if isinstance(d.get("tags"), list) else []
    return {"subject": short(d.get("subject"), 6), "tags": [str(x).lower()[:20] for x in tags[:6]],
            "match": max(1, min(5, match)), "faces": faces if faces in ("none", "drawn", "realistic") else "none",
            "text": d.get("text") is True, "defect": defect if defect in ("none", "blurry", "distorted", "artifact") else "none",
            "unsafe": d.get("unsafe") is True}


def ask(path, line, prompt):
    key = (os.getenv("GEMINI_API_KEY") or "").strip()
    img = thumb(path)
    if not key or not img:
        return None
    body = {"contents": [{"parts": [{"text": ASK.format(line=short(line, 40), prompt=short(prompt, 40))},
                                    {"inline_data": {"mime_type": "image/jpeg", "data": base64.b64encode(img).decode()}}]}],
            "generationConfig": {"responseMimeType": "application/json", "temperature": 0}}
    req = urllib.request.Request("https://generativelanguage.googleapis.com/v1beta/models/%s:generateContent" % MODEL,
                                 data=json.dumps(body).encode(), headers={"x-goog-api-key": key, "Content-Type": "application/json"})
    try:
        r = json.load(urllib.request.urlopen(req, timeout=40))
        txt = r["candidates"][0]["content"]["parts"][0]["text"]
        txt = re.sub(r"^```(?:json)?|```$", "", txt.strip(), flags=re.M).strip()
        return norm(json.loads(txt))
    except Exception as e:
        print("identify: look failed (%s)" % str(e)[:100])
        return None


def faults(d):
    why = []
    if d["match"] <= 2:
        why.append("does not show the line")
    if d["text"]:
        why.append("has text or a logo")
    if d["faces"] == "realistic":
        why.append("realistic face")
    if d["defect"] in ("distorted", "artifact"):
        why.append(d["defect"])
    if d["unsafe"]:
        why.append("unsuitable")
    return why


def stricter(c, line, why):
    base = ((c.get("gen") or {}).get("prompt") or "").strip().rstrip(".")
    add = []
    if "does not show the line" in why:
        add.append("Show clearly and literally: %s" % short(line, 16))
    add.append("One clear subject. No text, no letters, no numbers, no logos, no watermarks. No realistic faces, no close-up people")
    return (base + ". " + ". ".join(add) + ".").strip(". ") + "."


def candidates(t, pid, done):
    out = []
    for c in (t.get("tracks") or {}).get("visuals") or []:
        g = c.get("gen") or {}
        if c.get("kind") != "image" or not c.get("src") or c.get("src_locked") or (g.get("tool") or "").lower() in SKIP_TOOLS:
            continue
        p = TL.asset_path(pid, c["src"])
        if not (p and os.path.exists(p)):
            continue
        h = TL.file_hash(p)
        if done.get(c["id"], {}).get("hash") == h:
            continue
        out.append((c, p, h))
    return out


def look(items):
    with ThreadPoolExecutor(4) as ex:
        return list(ex.map(lambda x: ask(x[1], x[0].get("narration"), (x[0].get("gen") or {}).get("prompt")), items))


def rebuild(pid):
    try:
        subprocess.run([sys.executable, os.path.join(os.path.dirname(os.path.abspath(__file__)), "project.py"), "build", pid],
                       timeout=600, check=False)
    except Exception as e:
        print("identify: rebuild skipped (%s)" % str(e)[:100])


def save(tp, t):
    json.dump(t, open(tp, "w"), indent=1, ensure_ascii=False)


def run(pid):
    if os.getenv("IDENTIFY", "").lower() in ("off", "0", "no"):
        return
    tp = os.path.join(TL.project_dir(pid), "timeline.json")
    t = json.load(open(tp))
    meta = t.setdefault("meta", {})
    if str((meta.get("spec") or {}).get("identify", "")).lower() in ("off", "no", "false"):
        return
    if not (os.getenv("GEMINI_API_KEY") or "").strip():
        print("identify: no GEMINI_API_KEY, skipped")
        return
    idn = meta.setdefault("identify", {"clips": {}, "retried": []})
    items = candidates(t, pid, idn["clips"])
    if not items:
        print("identify: no AI pictures to check")
        return
    items = items[:14]
    results = look(items)
    seen_subjects, notes, flagged = [], [], []
    for (c, p, h), d in zip(items, results):
        if not d:
            continue
        why = faults(d)
        dup = any(d["subject"] and d["subject"] == s for s in seen_subjects)
        if d["subject"]:
            seen_subjects.append(d["subject"])
        idn["clips"][c["id"]] = {"hash": h, "subject": d["subject"], "tags": d["tags"], "match": d["match"], "faces": d["faces"],
                                 "text": d["text"], "defect": d["defect"], "repeat": dup, "faults": why}
        if why and c["id"] not in idn["retried"]:
            flagged.append((len(why) + (3 - d["match"]) * 0.5, c, why))
    cap = max(1, len(items) // 3)
    flagged.sort(key=lambda x: -x[0])
    fix = flagged[:cap]
    for _, c, why in fix:
        g = c.setdefault("gen", {})
        g["prompt"] = stricter(c, c.get("narration"), why)
        c["dirty"] = True
        idn["retried"].append(c["id"])
        notes.append("remaking %s: %s" % (c["id"], ", ".join(why)))
    for _, c, why in flagged[cap:]:
        notes.append("kept %s despite: %s (limit reached)" % (c["id"], ", ".join(why)))
    save(tp, t)
    if fix:
        rebuild(pid)
        t = json.load(open(tp))
        meta = t.setdefault("meta", {})
        idn = meta.setdefault("identify", idn)
        again = [(c, TL.asset_path(pid, c["src"]), None) for c in (t["tracks"].get("visuals") or []) if c["id"] in {x[1]["id"] for x in fix}
                 and c.get("src") and not c.get("dirty")]
        for (c, p, _), d in zip(again, look(again) if again else []):
            if d:
                left = faults(d)
                idn["clips"][c["id"]] = {"hash": TL.file_hash(p), "subject": d["subject"], "tags": d["tags"], "match": d["match"],
                                         "faces": d["faces"], "text": d["text"], "defect": d["defect"], "repeat": False, "faults": left}
                notes.append("%s after remake: %s" % (c["id"], "fixed" if not left else "still flagged (%s), kept" % ", ".join(left)))
        save(tp, t)
    ok = sum(1 for v in idn["clips"].values() if not v["faults"])
    meta["identify"]["summary"] = "%d of %d pictures clean" % (ok, len(idn["clips"]))
    save(tp, t)
    lines = ["Picture check: %s" % meta["identify"]["summary"]] + ["- " + n for n in notes[:10]]
    print("\n".join(lines))
    if notes:
        TL._director_say(lines)


if __name__ == "__main__":
    try:
        run(sys.argv[1])
    except SystemExit:
        raise
    except Exception as e:
        print("identify: skipped (", e, ")")
