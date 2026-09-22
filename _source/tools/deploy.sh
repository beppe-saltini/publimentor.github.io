#!/bin/bash
# Build, check, commit and push the PubliMentor website (GitHub Pages → www.publimentor.com).
#
#   _source/tools/deploy.sh "What changed"            # from the repository, or from Claude's sandbox on the Mac
#
# Pushes over SSH with the deploy key in ../.deploy (next to the repository, outside git). Works from
# Terminal on the Mac too. Only the website files are committed: the four pages, _source, CLAUDE.md, _config.yml.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
KEY="$REPO/../.deploy/id_ed25519"
KNOWN="$REPO/../.deploy/known_hosts"
REMOTE="${PUBLIMENTOR_REMOTE:-git@github.com:beppe-saltini/publimentor.github.io.git}"
FILES=(index.html newsletter.html newsletter/building-the-home-for-a-field.html newsletter/open-access-invoice-arrived.html _source CLAUDE.md _config.yml)
MSG="${1:-Update website}"

cd "$REPO"
[ -f "$KEY" ] || { echo "Deploy key not found at $KEY"; exit 1; }
G=(git -c safe.directory=*)
git config --get user.name  >/dev/null 2>&1 || G+=(-c "user.name=Giuseppe Saltini")
git config --get user.email >/dev/null 2>&1 || G+=(-c "user.email=beppe@Giuseppes-MacBook-Pro-4.local")
# Keep the sandbox's proxy settings when they exist; add the deploy key and GitHub's pinned host key.
export GIT_SSH_COMMAND="${GIT_SSH_COMMAND:-ssh} -i '$KEY' -o IdentitiesOnly=yes -o 'UserKnownHostsFile=\"$KNOWN\"' -o StrictHostKeyChecking=yes"

[ "$("${G[@]}" rev-parse --abbrev-ref HEAD)" = "main" ] || { echo "Not on main — refusing to deploy."; exit 1; }
if ! "${G[@]}" diff --cached --quiet; then echo "There are staged changes already — commit or unstage them first."; exit 1; fi

echo "→ Fetching main from GitHub…"
"${G[@]}" fetch --quiet "$REMOTE" main
LOCAL="$("${G[@]}" rev-parse main)"; REMOTE_SHA="$("${G[@]}" rev-parse FETCH_HEAD)"
if [ "$LOCAL" != "$REMOTE_SHA" ]; then
  if "${G[@]}" merge-base --is-ancestor "$LOCAL" "$REMOTE_SHA"; then
    "${G[@]}" merge --ff-only --quiet FETCH_HEAD && echo "  fast-forwarded main to GitHub"
  elif "${G[@]}" merge-base --is-ancestor "$REMOTE_SHA" "$LOCAL"; then
    echo "  note: local main has commits not yet on GitHub; they will be pushed with this deploy"
  else
    echo "Local main and GitHub have diverged — resolve that first."; exit 1
  fi
fi

echo "→ Building…";  python3 _source/build.py
echo "→ Checking…"; python3 _source/check.py
"${G[@]}" add -- "${FILES[@]}"
if "${G[@]}" diff --cached --quiet; then echo "Nothing to deploy: GitHub already has these pages."; exit 0; fi
"${G[@]}" diff --cached --stat -- "${FILES[@]}"
"${G[@]}" commit --quiet -m "$MSG"
echo "→ Committed $("${G[@]}" rev-parse --short HEAD). Pushing…"
"${G[@]}" push "$REMOTE" HEAD:main
echo "✓ Pushed. GitHub Pages publishes within a minute or two: https://www.publimentor.com/"
