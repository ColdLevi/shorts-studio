import asyncio, sys, os
import edge_tts

TEXT = "Fourteen days across oceans. Here's what nobody tells you."
WANT = ["en-NG-AbeoNeural", "en-NG-EzinneNeural", "en-US-AndrewMultilingualNeural",
        "en-US-AvaMultilingualNeural", "en-US-BrianMultilingualNeural",
        "en-US-EmmaMultilingualNeural", "en-US-GuyNeural", "en-US-ChristopherNeural",
        "en-GB-RyanNeural", "en-GB-SoniaNeural"]

async def main():
    vs = await edge_tts.list_voices()
    en = {v["ShortName"]: v for v in vs if v["Locale"].startswith("en-")}
    print("Nigerian voices:", [n for n in en if n.startswith("en-NG")])
    print("English voices available:", len(en))
    for name in WANT:
        if name not in en:
            print("missing:", name)
            continue
        out = "voices/previews/%s.mp3" % name
        for attempt in range(3):
            try:
                await edge_tts.Communicate(TEXT, name).save(out)
                print("ok:", name, en[name]["Gender"])
                break
            except Exception as e:
                print("retry", name, str(e)[:80])
                await asyncio.sleep(3)

asyncio.run(main())
