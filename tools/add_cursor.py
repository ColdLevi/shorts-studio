#!/usr/bin/env python3
"""Install a custom mouse cursor into a style pack.
  python3 tools/add_cursor.py <pack-id> <image.png|webp|svg> [--size 48] [--tip 0 0]
size = cursor width in type units (1 = 1/1080 of the short side).
tip  = the pointer's hot spot as a fraction of the image (0 0 = top-left corner).
Without --size and --tip it writes the renderer's own defaults (48 and 0 0).
Copies the image to styles/<pack>/cursor/ and writes the "cursor" entry in pack.json."""
import json, os, shutil, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def main():
    a = sys.argv[1:]
    if len(a) < 2:
        sys.exit(__doc__)
    pid, img = a[0], os.path.expanduser(a[1])
    size, tx, ty = 48.0, 0.0, 0.0
    try:
        if "--size" in a:
            size = float(a[a.index("--size") + 1])
        if "--tip" in a:
            i = a.index("--tip")
            tx, ty = float(a[i + 1]), float(a[i + 2])
    except (ValueError, IndexError):
        sys.exit("--size takes one number and --tip takes two, for example --tip 0.1 0.05")
    if size <= 0 or not (0 <= tx <= 1 and 0 <= ty <= 1):
        sys.exit("size must be above 0 and the tip values are fractions between 0 and 1")
    ext = os.path.splitext(img)[1].lower()
    if ext not in (".png", ".webp", ".svg"):
        sys.exit("use a .png, .webp or .svg image")
    if not os.path.isfile(img):
        sys.exit("image not found: " + img)
    if os.path.getsize(img) > 2000000:
        sys.exit("image is over 2 MB, use a smaller one")
    pdir = os.path.join(ROOT, "styles", pid)
    pj = os.path.join(pdir, "pack.json")
    if not os.path.isfile(pj):
        sys.exit("no pack folder styles/%s/pack.json" % pid)
    name = "cursor" + ext
    os.makedirs(os.path.join(pdir, "cursor"), exist_ok=True)
    shutil.copyfile(img, os.path.join(pdir, "cursor", name))
    p = json.load(open(pj))
    p["cursor"] = {"file": name, "size": int(size) if size == int(size) else size, "tipX": tx, "tipY": ty}
    with open(pj, "w") as f:
        json.dump(p, f, indent=2)
    print("cursor installed in %s: %s" % (pid, p["cursor"]))
    print("now commit styles/%s/cursor/ and styles/%s/pack.json" % (pid, pid))


main()
