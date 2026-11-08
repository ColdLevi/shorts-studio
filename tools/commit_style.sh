#!/usr/bin/env bash
# Commit learned styles (styles/) back to the repo, race-safe like commit_back.sh. (style-fix)
#   bash tools/commit_style.sh "<style name>"
set -u
NAME="${1:-style}"
MSG="style: ${NAME} [skip ci]"
KEEP=$(mktemp -d)
cp -r styles "$KEEP/styles" 2>/dev/null || true
git config user.name "shorts-studio-bot"
git config user.email "actions@users.noreply.github.com"
add() { [ -d styles ] && git add styles; git commit -qm "$MSG" || true; }
add
for i in 1 2 3 4 5; do
  if git pull --rebase -q && git push -q; then echo "styles pushed"; exit 0; fi
  echo "push raced another job; retrying ($i)"
  git rebase --abort 2>/dev/null || true
  git fetch -q origin
  git reset -q --hard "origin/$(git rev-parse --abbrev-ref HEAD)"
  mkdir -p styles
  cp -r "$KEEP/styles/." "styles/" 2>/dev/null || true
  add
  sleep $((i * 3))
done
echo "::warning::could not push the learned style"
exit 1
