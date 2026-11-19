"""After a fresh render: tell the owner which script directions could not be followed."""
import json, os, urllib.request

pid, tok, chat = os.getenv("PROJECT_ID"), os.getenv("TELEGRAM_TOKEN"), os.getenv("CHAT_ID")
if not (pid and tok and chat) or not os.path.exists("job/spec.json"):
    raise SystemExit(0)  # chat edits do not re-parse directions
tl = json.load(open(f"media/projects/{pid}/timeline.json"))
rep = (tl.get("meta") or {}).get("directions") or []
lines = []
for r in rep:
    for u in r.get("unsupported") or []:
        lines.append(f"Scene {r.get('scene')}: couldn't do \"{u}\"")
if not lines:
    raise SystemExit(0)
msg = ("📝 Some of your directions weren't followed:\n" + "\n".join(lines))[:3800]
urllib.request.urlopen(urllib.request.Request(
    f"https://api.telegram.org/bot{tok}/sendMessage",
    data=json.dumps({"chat_id": chat, "text": msg, "disable_notification": True}).encode(),
    headers={"Content-Type": "application/json"}), timeout=15)
