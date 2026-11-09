import asyncio, os, edge_tts
TEXT = "Fourteen days across oceans. Here's what nobody tells you."
async def main():
    vs = await edge_tts.list_voices()
    for n in sorted(v["ShortName"] for v in vs if v["Locale"].startswith("en-")):
        out = "voices/previews/%s.mp3" % n
        if os.path.exists(out):
            continue
        for a in range(3):
            try:
                await edge_tts.Communicate(TEXT, n).save(out)
                print("ok", n)
                break
            except Exception as e:
                print("retry", n, str(e)[:60])
                await asyncio.sleep(3)
asyncio.run(main())
