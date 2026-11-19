#!/usr/bin/env python3
"""Publish a style pack to the bot, using the same route learn_style.py uses.
  python3 tools/publish_pack.py <pack-id>          dry run: shows what would be sent
  APP=<bot url>/api/studio TG=<bot token> python3 tools/publish_pack.py <pack-id> --send
"""
import hashlib, json, os, sys, urllib.request
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import style_pack as sp
import timeline as TL


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if not args:
        sys.exit(__doc__)
    pid, send = args[0], "--send" in sys.argv
    if pid not in sp.list_packs():
        sys.exit("no pack folder styles/%s/pack.json (packs: %s)" % (pid, ", ".join(sp.list_packs()) or "none"))
    _id, st = TL.find_learned(pid)
    if not st or not st.get("pack") or not st.get("style_tokens"):
        sys.exit("the loader did not return this pack as a style; nothing sent")
    st = dict(st)
    st["name"] = pid
    for k in ("summary", "pacing", "writer_notes"):
        st.setdefault(k, "")
    body = json.dumps({"style": st}).encode()
    print("pack:", pid, "| style_tokens:", sorted(st["style_tokens"])[:12])
    print("pack_sounds:", st.get("pack_sounds"), "| payload bytes:", len(body))
    if not send:
        print("dry run: nothing sent. Add --send (with APP and TG set) to publish.")
        return
    app, tg = os.environ.get("APP", ""), os.environ.get("TG", "")
    if not app or not tg:
        sys.exit("set APP (the bot's /api/studio URL) and TG (the bot token) in your shell first")
    key = hashlib.sha256(tg.encode()).hexdigest()[:32]
    req = urllib.request.Request(app.split("?")[0] + "?event=style", data=body,
                                 headers={"Content-Type": "application/json", "x-studio-key": key})
    print(urllib.request.urlopen(req, timeout=60).read()[:300])


main()
