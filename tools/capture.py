#!/usr/bin/env python3
"""Promo capture: real screenshots of the product link, added to spec.user_assets.
  python3 tools/capture.py --check job/spec.json   exit 0 if a safe promo link exists, else 1
  python3 tools/capture.py job/spec.json           capture and update the spec
Never fails the build."""
import sys, os, re, json, socket, ipaddress, urllib.parse
URL = re.compile(r"https?://[^\s<>\")]+", re.I)
OUT = "/tmp/capture"


def pick_url(spec):
    u = str(spec.get("brand_url") or "").strip()
    if not u and str(spec.get("category") or "").lower() == "promo":
        m = URL.search(str(spec.get("topic") or ""))
        u = m.group(0).rstrip(".,;)") if m else ""
    return u


def safe(u):
    try:
        p = urllib.parse.urlparse(u)
        if p.scheme not in ("http", "https") or not p.hostname:
            return False
        for info in socket.getaddrinfo(p.hostname, None):
            ip = ipaddress.ip_address(info[4][0])
            if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast:
                return False
        return True
    except Exception:
        return False


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    check = "--check" in sys.argv
    sp = args[0]
    spec = json.load(open(sp))
    url = pick_url(spec)
    if not url or not safe(url):
        print("capture: no safe product link, skipped")
        sys.exit(1 if check else 0)
    if check:
        sys.exit(0)
    from playwright.sync_api import sync_playwright
    os.makedirs(OUT, exist_ok=True)
    land = str(spec.get("format") or "").lower() == "landscape"
    cfg = ("desktop", 1280, 800, 1, False, (0, 900, 1800)) if land else ("mobile", 390, 844, 2, True, (0, 800, 1600, 2400))
    name, vw, vh, scale, mobile, ys = cfg
    shots, meta = [], {}
    with sync_playwright() as pw:
        b = pw.chromium.launch()
        try:
            ctx = b.new_context(viewport={"width": vw, "height": vh}, device_scale_factor=scale, is_mobile=mobile, has_touch=mobile)
            page = ctx.new_page()
            try:
                page.goto(url, wait_until="domcontentloaded", timeout=25000)
                page.wait_for_timeout(2500)
                if not safe(page.url):
                    print("capture: redirected to an unsafe address, stopped")
                else:
                    meta = {"url": page.url, "name": (page.title() or "")[:80],
                            "color": page.evaluate("() => { const m = document.querySelector('meta[name=theme-color]'); return m ? m.content : ''; }"),
                            "og_image": page.evaluate("() => { const m = document.querySelector('meta[property=\"og:image\"]'); return m ? m.content : ''; }")}
                    for i, y in enumerate(ys):
                        page.evaluate("window.scrollTo(0, %d)" % y)
                        page.wait_for_timeout(600)
                        p = os.path.join(OUT, "%s_%d.png" % (name, i))
                        page.screenshot(path=p)
                        shots.append((i, p))
            except Exception as e:
                print("capture: page failed (%s)" % str(e)[:120])
            ctx.close()
        finally:
            b.close()
    if not shots:
        print("capture: nothing captured")
        return
    items = spec.setdefault("user_assets", [])
    for i, p in shots:
        items.append({"kind": "image", "path": p, "caption": "product screen %d" % (i + 1), "source": "capture"})
    spec["brand"] = meta
    json.dump(spec, open(sp, "w"), ensure_ascii=False)
    print("capture: %d screenshots of %s" % (len(shots), meta.get("url")))


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception as e:
        print("capture: skipped (%s)" % str(e)[:150])
