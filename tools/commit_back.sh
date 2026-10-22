#!/usr/bin/env bash
# Commit a finished render back to the repo: library.json + the project's timeline, history and renders.
# Renders of different projects run in parallel, so a push can race another one. On a conflict this
# starts again from the fresh remote copy, puts our project files back and re-adds our library entry.
#   bash tools/commit_back.sh <release-tag> <project-id> "<commit message>"
set -u
TAG="$1"; PID="$2"; MSG="$3"
P="media/projects/$PID"
KEEP=$(mktemp -d)
git config user.name "shorts-studio-bot"
git config user.email "actions@users.noreply.github.com"
mkdir -p "$KEEP/p"
cp "$P/timeline.json" "$KEEP/p/" 2>/dev/null || true
cp "$P/renders.json" "$KEEP/p/" 2>/dev/null || true
cp -r "$P/history" "$KEEP/p/" 2>/dev/null || true
add() {
  for f in library.json "$P/timeline.json" "$P/history" "$P/renders.json"; do [ -e "$f" ] && git add "$f"; done
  git commit -qm "$MSG" || true
}
add
for i in 1 2 3 4 5; do
  if git pull --rebase -q && git push -q; then echo "pushed"; exit 0; fi
  echo "push raced another render; retrying ($i)"
  git rebase --abort 2>/dev/null || true
  git fetch -q origin
  git reset -q --hard "origin/$(git rev-parse --abbrev-ref HEAD)"
  mkdir -p "$P"; cp -r "$KEEP/p/." "$P/"
  python3 tools/library_add.py "$TAG" >/dev/null
  add
  sleep $((i * 3))
done
echo "::warning::could not push the library/timeline update"
exit 1
