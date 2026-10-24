"""Pick working Gemini models automatically and call them with retries.

Google retires model names often (e.g. gemini-2.5-flash -> "no longer available to new users").
Instead of hard-coding names we ask the API which models this key can use, prefer the newest
non-lite Flash, retry briefly on 503/429 (high demand), and follow the "use models/X" hint in 404s.
Override with GEMINI_MODEL (or a tool-specific env passed as `prefer`).
"""
import json, os, re, time, urllib.error, urllib.request

API = "https://generativelanguage.googleapis.com/v1beta"
FALLBACK = ["gemini-3.8-flash", "gemini-flash-latest", "gemini-3.5-flash", "gemini-3.5-flash-lite"]
SKIP = ("image", "tts", "embed", "live", "audio", "native", "robotics", "computer-use", "gemma", "aqa", "veo", "imagen", "learnlm", "thinking-exp")
_cache = {}


def _ver(name):
    m = re.search(r"gemini-(\d+(?:\.\d+)?)", name)
    return float(m.group(1)) if m else 0.0


def rank(names):
    def key(n):
        return ("lite" in n, "preview" in n or "exp" in n, "flash" not in n, -_ver(n), len(n))
    return sorted(dict.fromkeys(names), key=key)


def available(key):
    if key in _cache:
        return _cache[key]
    names = []
    try:
        url, tok = f"{API}/models?pageSize=200", None
        for _ in range(5):
            req = urllib.request.Request(url + (f"&pageToken={tok}" if tok else ""), headers={"x-goog-api-key": key})
            d = json.loads(urllib.request.urlopen(req, timeout=20).read().decode())
            for m in d.get("models", []):
                n = (m.get("name") or "").split("/")[-1]
                if "generateContent" in (m.get("supportedGenerationMethods") or []) and n.startswith("gemini") and not any(s in n for s in SKIP):
                    names.append(n)
            tok = d.get("nextPageToken")
            if not tok:
                break
    except Exception as e:
        print("gemini model list failed:", str(e)[:120])
    _cache[key] = rank(names)[:5] if names else list(FALLBACK)
    return _cache[key]


def _reason(e):
    try:
        body = e.read().decode("utf-8", "ignore")
        err = (json.loads(body).get("error") or {})
        return f"{err.get('code') or e.code} {err.get('status') or ''}: {(err.get('message') or body)[:300]}".strip()
    except Exception:
        return str(e)[:160]


def generate(key, parts, config=None, timeout=120, prefer=None):
    """Returns (response_text, None) or (None, error_summary)."""
    if not key:
        return None, "GEMINI_API_KEY is empty"
    queue = [m for m in [prefer, os.environ.get("GEMINI_MODEL")] if m] + available(key)
    queue = list(dict.fromkeys(queue))
    body = json.dumps({"contents": [{"parts": parts}], "generationConfig": config or {}}).encode()
    errs, tried = [], set()
    while queue and len(tried) < 6:
        model = queue.pop(0)
        if model in tried:
            continue
        tried.add(model)
        for attempt in range(3):
            try:
                req = urllib.request.Request(f"{API}/models/{model}:generateContent", data=body,
                                             headers={"Content-Type": "application/json", "x-goog-api-key": key})
                d = json.loads(urllib.request.urlopen(req, timeout=timeout).read().decode())
                t = "".join(p.get("text", "") for p in d["candidates"][0]["content"]["parts"])
                print("gemini ok:", model)
                return t, None
            except urllib.error.HTTPError as e:
                why = _reason(e)
                if e.code in (429, 500, 503) and attempt < 2:
                    time.sleep(6 * (attempt + 1))   # high demand: wait and retry the same model
                    continue
                errs.append(f"{model}: {why}")
                hint = re.search(r"use models/([a-z0-9.\-]+)", why)
                if hint and hint.group(1) not in tried:
                    queue.insert(0, hint.group(1))  # Google told us the replacement name
                if e.code in (400, 401, 403) and ("API key" in why or "API_KEY" in why or "unregistered" in why or "leaked" in why):
                    return None, "; ".join(errs)    # key problem: same on every model
                break
            except Exception as e:
                errs.append(f"{model}: {str(e)[:120]}")
                break
    return None, "; ".join(errs) or "no Gemini model available"
