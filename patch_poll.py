import sys, shutil
P = "tools/build_short.py"
dry = "--dry-run" in sys.argv
s = open(P, encoding="utf-8").read()
HELPER = '''_POLL_LOCK = __import__("threading").Semaphore(1)


def _poll_fetch(req):
    last = None
    with _POLL_LOCK:
        for attempt in range(4):
            try:
                return urllib.request.urlopen(req, timeout=150).read()
            except urllib.error.HTTPError as e:
                body = e.read().decode("utf-8", "ignore")[:120]
                last = "HTTP %s %s" % (e.code, body)
                if e.code in (400, 401, 402, 403, 404):
                    break
                time.sleep(6 + attempt * 10)
            except Exception as e:
                last = str(e)[:120]
                time.sleep(4)
    raise RuntimeError("pollinations: %s" % last)


def pollinations_image(prompt, path, seed=0):'''
edits = [
 ("def pollinations_image(prompt, path, seed=0):", HELPER),
 ("data = urllib.request.urlopen(req, timeout=150).read()", "data = _poll_fetch(req)"),
 ("PAID_NOTES = []", "PAID_NOTES = []\n_FB_ERR = []"),
 ('print("image fallback", _name, g)', 'print("image fallback", _name, g); _FB_ERR.append("%s: %s" % (_name, str(g)[:100]))'),
 ('tg("⏸️ Cloudflare said: " + quota[0][:200])', 'tg("⏸️ Cloudflare said: " + quota[0][:200] + "\\nFallbacks: " + (" | ".join(_FB_ERR[-4:]) or "none ran"))'),
]
for a, b in edits:
    n = s.count(a)
    if n != 1:
        sys.exit("ANCHOR MISMATCH (%d matches): %s" % (n, a[:50]))
    s = s.replace(a, b)
compile(s, P, "exec")
print("ok: 5 edits, syntax fine")
if not dry:
    shutil.copy(P, P + ".bak-poll")
    open(P, "w", encoding="utf-8").write(s)
    print("written")
