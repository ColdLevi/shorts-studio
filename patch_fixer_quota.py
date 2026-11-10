import sys, shutil, re, json
dry = "--dry-run" in sys.argv
F, R = "tools/fixer.py", "tools/fixer_rules.json"
f = open(F, encoding="utf-8").read()
r = open(R, encoding="utf-8").read()
A = 'return {"action": "ignore-transient", "class": cls}'
if f.count(A) != 1:
    sys.exit("ANCHOR MISMATCH fixer.py (%d)" % f.count(A))
GUARD = A + '\n        if cls.get("rule") == "cf-neurons":\n            print("fixer: daily image quota is used up, no retry (it resets 00:00 UTC)")\n            return {"action": "quota-wait", "class": cls}'
f2 = f.replace(A, GUARD)
m = re.search(r'"transient"\s*:\s*\[', r)
if not m or len(re.findall(r'"transient"\s*:\s*\[', r)) != 1:
    sys.exit("ANCHOR MISMATCH fixer_rules.json")
RULE = '\n  {\n   "id": "cf-neurons",\n   "pattern": "daily free allocation|used up your daily|PAUSED: image quota",\n   "backoff": 0,\n   "label": "the Cloudflare free image quota is used up for today (resets 00:00 UTC)"\n  },'
r2 = r[:m.end()] + RULE + r[m.end():]
json.loads(r2)
compile(f2, F, "exec")
print("ok: 2 edits, json + python valid")
if not dry:
    shutil.copy(F, F + ".bak-quota"); shutil.copy(R, R + ".bak-quota")
    open(F, "w", encoding="utf-8").write(f2)
    open(R, "w", encoding="utf-8").write(r2)
    print("written")
