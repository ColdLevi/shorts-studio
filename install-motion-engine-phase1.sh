#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail
ROOT="$HOME/shorts-studio"
ZIP="$HOME/motion-engine-phase1-patch.zip"
[ -d "$ROOT/.git" ] || { echo "ERROR: $ROOT is not a git repository"; exit 1; }
[ -f "$ZIP" ] || { echo "ERROR: missing $ZIP"; exit 1; }
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="$HOME/motion-engine-backup-$STAMP"
mkdir -p "$BACKUP"
cd "$ROOT"
python - "$ZIP" "$ROOT" "$BACKUP" <<'PY'
import sys, zipfile, pathlib, shutil
archive, root, backup = map(pathlib.Path, sys.argv[1:])
with zipfile.ZipFile(archive) as z:
    for name in z.namelist():
        if name.startswith('/') or '..' in pathlib.PurePosixPath(name).parts:
            raise SystemExit("Unsafe archive path: "+name)
        dst=root/name
        if dst.exists():
            b=backup/name
            b.parent.mkdir(parents=True,exist_ok=True)
            shutil.copy2(dst,b)
        dst.parent.mkdir(parents=True,exist_ok=True)
        dst.write_bytes(z.read(name))
print("Patch files installed. Existing edited files backed up to:",backup)
PY
echo
echo "Changed files:"
git status --short
echo
echo "Review the diff before committing:"
git diff -- remotion/src/studio/Layers.tsx remotion/src/studio/types.ts timeline/timeline.schema.json
