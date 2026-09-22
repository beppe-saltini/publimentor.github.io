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

main() {
  cd "$REPO"
  [ -f "$KEY" ] || { echo "Deploy key not found at $KEY"; exit 1; }
  . "$REPO/_source/tools/git-env.sh"

  [ "$(g rev-parse --abbrev-ref HEAD)" = "main" ] || { echo "Not on main — refusing to deploy."; exit 1; }
  if ! g diff --cached --quiet; then echo "There are staged changes already — commit or unstage them first."; exit 1; fi

  sync_with_github

  echo "→ Building…";  python3 _source/build.py
  echo "→ Checking…"; python3 _source/check.py
  g add -- "${FILES[@]}"
  if g diff --cached --quiet; then echo "Nothing to deploy: GitHub already has these pages."; exit 0; fi
  g diff --cached --stat -- "${FILES[@]}"
  g commit --quiet -m "$MSG"
  echo "→ Committed $(g rev-parse --short HEAD). Pushing…"
  g push "$REMOTE" HEAD:main
  echo "✓ Pushed. GitHub Pages publishes within a minute or two: https://www.publimentor.com/"
}
main "$@"; exit
