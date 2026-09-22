#!/bin/bash
# Roll the live website back by reverting a deploy commit (default: the latest commit on main) and pushing.
#
#   _source/tools/rollback.sh              # undo the most recent commit on main
#   _source/tools/rollback.sh <commit>     # undo a specific commit
#
# Nothing is rewritten or force-pushed: the revert is a new commit, so history stays intact and the
# reverted version can be deployed again later with deploy.sh. Uses the same deploy key as deploy.sh.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
KEY="$REPO/../.deploy/id_ed25519"
KNOWN="$REPO/../.deploy/known_hosts"
REMOTE="${PUBLIMENTOR_REMOTE:-git@github.com:beppe-saltini/publimentor.github.io.git}"
TARGET="${1:-HEAD}"

cd "$REPO"
[ -f "$KEY" ] || { echo "Deploy key not found at $KEY"; exit 1; }
G=(git -c safe.directory=*)
git config --get user.name  >/dev/null 2>&1 || G+=(-c "user.name=Giuseppe Saltini")
git config --get user.email >/dev/null 2>&1 || G+=(-c "user.email=beppe@Giuseppes-MacBook-Pro-4.local")
export GIT_SSH_COMMAND="${GIT_SSH_COMMAND:-ssh} -i '$KEY' -o IdentitiesOnly=yes -o 'UserKnownHostsFile=\"$KNOWN\"' -o StrictHostKeyChecking=yes"

[ "$("${G[@]}" rev-parse --abbrev-ref HEAD)" = "main" ] || { echo "Not on main — refusing."; exit 1; }
if ! "${G[@]}" diff --cached --quiet; then echo "There are staged changes — commit or unstage them first."; exit 1; fi

echo "→ Fetching main from GitHub…"
"${G[@]}" fetch --quiet "$REMOTE" main
if [ "$("${G[@]}" rev-parse main)" != "$("${G[@]}" rev-parse FETCH_HEAD)" ]; then
  "${G[@]}" merge --ff-only --quiet FETCH_HEAD || { echo "Local main and GitHub have diverged — resolve that first."; exit 1; }
fi

SHA="$("${G[@]}" rev-parse --short "$TARGET")"
echo "→ Reverting $SHA: $("${G[@]}" log -1 --format=%s "$TARGET")"
"${G[@]}" revert --no-edit "$TARGET" >/dev/null
"${G[@]}" diff --stat HEAD~1 HEAD | tail -1
echo "→ Pushing…"
"${G[@]}" push "$REMOTE" HEAD:main
echo "✓ Rolled back. GitHub Pages publishes within a minute or two: https://www.publimentor.com/"
echo "  Visitors may see the cached version for up to 10 minutes; a hard refresh (Cmd+Shift+R) shows the current one."
