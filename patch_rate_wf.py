import sys, shutil
P = ".github/workflows/make-short.yml"
dry = "--dry-run" in sys.argv
s = open(P, encoding="utf-8").read()
A = "MARKUP=$(python3 tools/library_add.py --button)"
if s.count(A) != 1:
    sys.exit("ANCHOR MISMATCH (%d matches)" % s.count(A))
line = [l for l in s.split("\n") if A in l][0]
ind = line[: len(line) - len(line.lstrip())]
code = [
 'MARKUP=$(PROJECT_ID="$PROJECT_ID" MK="$MARKUP" python3 -c "import json,os;pid=os.environ[\'PROJECT_ID\'][:54]',
 'try:',
 ' m=json.loads(os.environ[\'MK\'] or \'{\\"inline_keyboard\\":[]}\');m[\'inline_keyboard\'].append([{\'text\':\'👍 Nailed it\',\'callback_data\':\'r:u:\'+pid},{\'text\':\'👎 Meh\',\'callback_data\':\'r:d:\'+pid}]);print(json.dumps(m))',
 'except Exception:',
 ' print(os.environ[\'MK\'])")',
]
new = "\n".join(ind + c if i == 0 else ind + c for i, c in enumerate(code))
s2 = s.replace(ind + A, ind + A + "\n" + new)
try:
    import yaml
    yaml.safe_load(s2)
    print("yaml ok")
except ImportError:
    print("yaml check skipped")
print("ok: 1 edit")
if not dry:
    shutil.copy(P, P + ".bak-rate")
    open(P, "w", encoding="utf-8").write(s2)
    print("written")
