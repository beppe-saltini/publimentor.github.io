#!/bin/bash
# Put the live website back as it was at an earlier commit, by publishing those pages as a new commit.
#
#   _source/tools/rollback.sh              # the pages as they were before the latest commit on main (undo the last deploy)
#   _source/tools/rollback.sh <commit>     # the pages as they were at that commit (see `git log --oneline`)
#
# Only the published pages change (index.html, newsletter.html, newsletter/*.html); _source and the tools stay
# as they are, so the problem can be fixed there and deployed again with deploy.sh. Nothing is rewritten or
# force-pushed: history stays intact and a rollback can itself be rolled back. Uses the deploy key of deploy.sh.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
KEY="$REPO/../.deploy/id_ed25519"
KNOWN="$REPO/../.deploy/known_hosts"
REMOTE="${PUBLIMENTOR_REMOTE:-git@github.com:beppe-saltini/publimentor.github.io.git}"
TARGET="${1:-HEAD~1}"

main() {
  cd "$REPO"
  [ -f "$KEY" ] || { echo "Deploy key not found at $KEY"; exit 1; }
  . "$REPO/_source/tools/git-env.sh"

  [ "$(g rev-parse --abbrev-ref HEAD)" = "main" ] || { echo "Not on main — refusing."; exit 1; }
  if ! g diff --cached --quiet; then echo "There are staged changes — commit or unstage them first."; exit 1; fi

  sync_with_github

  local NOW TO SHORT TREE NEW
  NOW="$(g rev-parse HEAD)"
  TO="$(g rev-parse --verify --quiet "$TARGET^{commit}")" || { echo "Unknown commit: $TARGET"; exit 1; }
  SHORT="$(g rev-parse --short "$TO")"
  TREE="$(site_tree_from "$NOW" "$TO")"
  if [ "$TREE" = "$(g rev-parse "$NOW^{tree}")" ]; then echo "The website pages are already as they were at $SHORT."; exit 0; fi

  echo "→ Rolling the pages back to $SHORT: $(g log -1 --format=%s "$TO")"
  NEW="$(g commit-tree "$TREE" -p "$NOW" -m "Roll back the website pages to $SHORT ($(g log -1 --format=%s "$TO"))")"
  g diff --stat "$NOW" "$NEW" | tail -1
  check_local_edits "$NOW" "$NEW"
  echo "→ Pushing…"
  g push "$REMOTE" "$NEW:refs/heads/main"
  sync_to "$NOW" "$NEW"
  echo "✓ Rolled back ($(g rev-parse --short "$NEW")). GitHub Pages publishes within a minute or two: https://www.publimentor.com/"
  echo "  Visitors may see the cached version for up to 10 minutes; a hard refresh (Cmd+Shift+R) shows the current one."
}
main "$@"; exit
