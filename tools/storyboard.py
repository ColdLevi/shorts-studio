#!/usr/bin/env python3
"""Storyboard for scene (What If) videos: one picture per shot, checked before the real render.

  storyboard.py build  job/spec.json job/timeline.json      spec -> a voiceless timeline (timings estimated from word count)
  storyboard.py sheet  job/timeline.json job/frames job/out  frames/s00.png.. -> out/sheet.png, out/caption.txt, out/markup.json

Nothing here generates images or voice: scene clips are drawn in code, so this costs no quota."""
import json, os, sys, textwrap

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import timeline as tl  # noqa: E402

WORDS_PER_SEC = 2.5
PLACEHOLDER = {"pack": "whatif", "scene": "stage", "shot": "medium", "room": "study", "pose": "stand"}


def build(spec_path, out_path):
    spec = json.load(open(spec_path))
    beats = spec.get("beats") or []
    if not beats:
        sys.exit("No beats in the spec.")
    t, rows = 0.0, []
    for b in beats:
        words = len(str(b.get("narration") or "").split())
        dur = round(max(1.6, words / WORDS_PER_SEC + 0.2), 2)
        scene = b.get("scene") if isinstance(b.get("scene"), dict) else dict(PLACEHOLDER)
        rows.append({"start": round(t, 2), "end": round(t + dur, 2), "text": b.get("narration", ""), "scene": scene})
        t += dur
    props = {"beats": rows, "duration": round(t + 0.5, 2), "title": spec.get("title", ""), "accent": spec.get("accent")}
    rest = {k: v for k, v in spec.items() if k != "beats"}
    out = tl.from_props(props, rest, pid="storyboard")
    # same look as the verified whatif-test timeline: hard cuts, no captions, no title card, no progress bar
    out["style"].update({"caption": {"preset": "none"}, "vignette": False, "progress_bar": False, "title": {"show": False}, "transition": {"type": "cut"}})
    out["tracks"]["captions"] = {"enabled": False, "words": []}
    out["tracks"]["voice"], out["tracks"]["music"], out["tracks"]["sfx"], out["tracks"]["overlays"] = [], [], [], []
    json.dump(out, open(out_path, "w"))
    print(f"{len(rows)} shots, {out['duration']}s, canvas {out['canvas']['width']}x{out['canvas']['height']}")


def scene_line(s):
    s = s or {}
    if s.get("scene") == "title":
        return "title card"
    if s.get("scene") == "fact":
        return f"fact {s.get('number', '')}".strip()
    bits = [s.get("shot", "medium"), s.get("room", "study")]
    if s.get("prop"):
        bits.append(s["prop"] + (f" {s['fx']}" if s.get("fx") not in (None, "none") else ""))
    return " · ".join(bits)


def sheet(tl_path, frames_dir, out_dir):
    from PIL import Image, ImageDraw, ImageFont
    t = json.load(open(tl_path))
    vis = t["tracks"]["visuals"]
    os.makedirs(out_dir, exist_ok=True)
    cols = 5
    cw, ch, lab = 270, 480, 78
    pad = 8
    rows_n = (len(vis) + cols - 1) // cols
    W, H = cols * (cw + pad) + pad, rows_n * (ch + lab + pad) + pad
    img = Image.new("RGB", (W, H), "#0f0a1c")
    d = ImageDraw.Draw(img)

    def font(size, bold=False):
        for p in ("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",):
            try:
                return ImageFont.truetype(p, size)
            except Exception:
                pass
        return ImageFont.load_default()

    fb, fs = font(17, True), font(13)
    lines = []
    for i, v in enumerate(vis):
        r, c = divmod(i, cols)
        x, y = pad + c * (cw + pad), pad + r * (ch + lab + pad)
        p = os.path.join(frames_dir, "s%02d.png" % i)
        if os.path.exists(p):
            im = Image.open(p).convert("RGB")
            im.thumbnail((cw, ch))
            img.paste(im, (x + (cw - im.width) // 2, y))
        else:
            d.rectangle([x, y, x + cw, y + ch], outline="#553377")
            d.text((x + 10, y + 10), "no frame", fill="#aa88cc", font=fs)
        what = scene_line(v.get("scene"))
        head_txt = f"{i + 1}  {what}"
        while len(head_txt) > 4 and d.textlength(head_txt, font=fb) > cw - 4:
            head_txt = head_txt[:-2].rstrip() + "…" if not head_txt.endswith("…") else head_txt[:-2] + "…"
        d.text((x + 2, y + ch + 4), head_txt, fill="#ffd43b", font=fb)
        for k, ln in enumerate(textwrap.wrap(str(v.get("narration") or ""), 34)[:3]):
            d.text((x + 2, y + ch + 28 + k * 16), ln, fill="#e8e0f5", font=fs)
        lines.append(f"{i + 1}. {what}: {str(v.get('narration') or '').strip()}")
    img.save(os.path.join(out_dir, "sheet.png"))
    head = f"🖼 Storyboard: {t.get('title', '')} ({len(vis)} shots, about {round(t.get('duration', 0))}s)\n"
    tail = "\n\nTap Render to make it with voice, sound and captions. Want a change? Edit the script or type it, e.g. \"make shot 4 a close-up\"."
    body = "\n".join(lines)
    room = 1000 - len(head) - len(tail)
    if len(body) > room:
        body = "\n".join(l[:60] for l in lines)[:room - 1] + "…"
    open(os.path.join(out_dir, "caption.txt"), "w").write(head + body + tail)
    markup = {"inline_keyboard": [[{"text": "🎬 Render it", "callback_data": "approve"}],
                                   [{"text": "✏️ Edit script", "callback_data": "editscript"}, {"text": "🔁 Redo", "callback_data": "redo"}]]}
    json.dump(markup, open(os.path.join(out_dir, "markup.json"), "w"))
    print("sheet", img.size)


if __name__ == "__main__":
    a = sys.argv[1:]
    if len(a) == 3 and a[0] == "build":
        build(a[1], a[2])
    elif len(a) == 4 and a[0] == "sheet":
        sheet(a[1], a[2], a[3])
    else:
        sys.exit(__doc__)
