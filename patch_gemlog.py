import sys, shutil
P = "tools/build_short.py"
dry = "--dry-run" in sys.argv
s = open(P, encoding="utf-8").read()
edits = [
 ('print("gemini image", g)', 'print("gemini image", g); _FB_ERR.append("gemini: " + str(g)[:100])'),
 ('(("together", together_image), ("pollinations", pollinations_image))', '(("together", together_image),)'),
]
for a, b in edits:
    n = s.count(a)
    if n != 1:
        sys.exit("ANCHOR MISMATCH (%d matches): %s" % (n, a[:60]))
    s = s.replace(a, b)
compile(s, P, "exec")
print("ok: 2 edits, syntax fine")
if not dry:
    shutil.copy(P, P + ".bak-gemlog")
    open(P, "w", encoding="utf-8").write(s)
    print("written")
