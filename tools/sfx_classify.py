"""Guess which studio role a sound effect fits: from its name first, then by having Gemini listen. Never raises."""
import base64, os, re, subprocess, sys, tempfile
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

KEYWORDS = [
    ("riser", ["riser", "rise", "buildup", "build up", "uplifter"]),
    ("swish", ["swish", "swoosh"]),
    ("whoosh_fast", ["whip", "fast whoosh", "fastwhoosh"]),
    ("whoosh_soft", ["whoosh", "woosh", "sweep"]),
    ("hit_low", ["boom", "impact", "hit", "thud", "slam", "thump", "punch"]),
    ("tick", ["tick", "click"]),
    ("pop", ["pop", "bubble", "blip"]),
]
ANS = {"hit": "hit_low", "impact": "hit_low", "whoosh_fast": "whoosh_fast", "whoosh_soft": "whoosh_soft", "whoosh": "whoosh_soft",
       "swish": "swish", "tick": "tick", "pop": "pop", "riser": "riser", "none": ""}
PROMPT = ("This is a short sound effect (up to 10 seconds) for video editing. Which ONE role fits it best? "
          "hit = a low punchy impact or boom; whoosh_fast = a fast sharp whoosh for a quick cut; whoosh_soft = a softer whoosh for a transition; "
          "swish = a light airy swish; tick = a small click or tick for text; pop = a short bubbly pop for an element appearing; "
          "riser = a sound that builds up in intensity; none = anything else (speech, music, noise, ambience, jingle). "
          "Answer with exactly one word from: hit, whoosh_fast, whoosh_soft, swish, tick, pop, riser, none.")


def from_name(text):
    low = " " + re.sub(r"[^a-z]+", " ", str(text).lower()) + " "
    for role, words in KEYWORDS:
        for w in words:
            if " " + w + " " in low:
                return role
    return ""


def from_audio(path):
    key = os.environ.get("GEMINI_API_KEY", "")
    if not key:
        return ""
    tmp = tempfile.mkdtemp(prefix="sfxc_")
    try:
        mp3 = os.path.join(tmp, "c.mp3")
        r = subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", path, "-t", "6", "-vn", "-ac", "1", "-ar", "16000", "-b:a", "48k", mp3],
                           capture_output=True, text=True, timeout=60)
        if r.returncode != 0 or not os.path.exists(mp3):
            return ""
        data = base64.b64encode(open(mp3, "rb").read()).decode()
        import gemini_models as gm
        txt, err = gm.generate(key, [{"text": PROMPT}, {"inline_data": {"mime_type": "audio/mp3", "data": data}}],
                               config={"temperature": 0}, timeout=90)
        if not txt:
            print("sfx_classify: no answer (%s)" % str(err)[:100])
            return ""
        w = re.sub(r"[^a-z_ ]+", "", txt.lower()).split()
        return ANS.get(w[0], "") if w else ""
    except Exception as e:
        print("sfx_classify: skipped (%s)" % str(e)[:100])
        return ""
    finally:
        import shutil
        shutil.rmtree(tmp, ignore_errors=True)


def classify(path, hint=""):
    """-> (role or '', how)"""
    r = from_name(hint)
    if r:
        return r, "its name"
    r = from_audio(path)
    return (r, "listening to it") if r else ("", "")
