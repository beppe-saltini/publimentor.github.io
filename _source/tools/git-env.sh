#!/bin/bash
# Shared by deploy.sh and rollback.sh — sourced, not run. Expects REPO, KEY and KNOWN to be set and the
# shell to be inside $REPO.
#
# Every git call goes through g() so the same scripts work from Terminal on the Mac and from Claude's
# sandbox on the Mac. In the sandbox the connected folder is writable but nothing in it can be deleted,
# which git needs in two places:
#   - its lock and temporary files (.git/HEAD.lock, tmp_obj_*, …): they are moved to ../_to_delete/
#     after each command instead (tidy), and the index lives outside the folder while a script runs;
#   - replacing files in the working tree (checkout, merge, revert delete a file and recreate it):
#     sync_to overwrites files in place instead, so it is used everywhere in place of those commands.

G=(git -c safe.directory=*)
git config --get user.name  >/dev/null 2>&1 || G+=(-c "user.name=Giuseppe Saltini")
git config --get user.email >/dev/null 2>&1 || G+=(-c "user.email=beppe@Giuseppes-MacBook-Pro-4.local")
# Keep the sandbox's own GIT_SSH_COMMAND (its proxy) when there is one; add the deploy key and GitHub's pinned host keys.
export GIT_SSH_COMMAND="${GIT_SSH_COMMAND:-ssh} -i '$KEY' -o IdentitiesOnly=yes -o 'UserKnownHostsFile=\"$KNOWN\"' -o StrictHostKeyChecking=yes"

# Pages that build.py generates: rollback and fast-forward may overwrite these freely.
GENERATED=(index.html newsletter.html newsletter/building-the-home-for-a-field.html newsletter/open-access-invoice-arrived.html)

SANDBOX=0
case "$REPO" in "$HOME"/mnt/*) SANDBOX=1 ;; esac
JUNK="$REPO/../_to_delete/git-leftovers"
MOVED=0

# Sandbox only: move the lock/temp files git could not delete out of the repository.
tidy() {
  [ "$SANDBOX" = 1 ] || return 0
  local f dest
  for f in .git/HEAD.lock .git/index.lock .git/refs/heads/main.lock .git/objects/maintenance.lock .git/objects/??/tmp_obj_*; do
    [ -e "$f" ] || continue
    mkdir -p "$JUNK"
    dest="$JUNK/$(date +%Y%m%d-%H%M%S)-$MOVED-$(printf '%s' "${f#.git/}" | tr / -)"
    mv -n "$f" "$dest" 2>/dev/null
    if [ -e "$f" ]; then echo "warning: could not move $f aside; the next git command may fail" >&2; else MOVED=$((MOVED+1)); fi
  done
  return 0
}

# Run git. In the sandbox, hide its warnings about the lock/temp files it could not delete (tidy moves them).
g() {
  local rc=0 err="$HOME/.publimentor-git-stderr"
  if [ "$SANDBOX" = 1 ]; then
    "${G[@]}" "$@" 2>"$err" || rc=$?
    grep -Ev "^warning: unable to unlink .*(\.lock|/tmp_obj_)" "$err" >&2 || true
    tidy
  else
    "${G[@]}" "$@" || rc=$?
  fi
  return $rc
}

if [ "$SANDBOX" = 1 ]; then
  export GIT_INDEX_FILE="$HOME/.publimentor-git-index"
  cp .git/index "$GIT_INDEX_FILE"
  finish() {
    cp "$GIT_INDEX_FILE" .git/index
    tidy
    [ "$MOVED" = 0 ] || echo "  (sandbox: $MOVED lock/temp files git could not delete were moved to ../_to_delete/git-leftovers — safe to trash)"
  }
  trap finish EXIT
  tidy
fi

# Files that differ between two commits, one per line.
changed_between() { g diff --name-only "$1" "$2"; }

# Refuse to continue if a file that changes between commits $1 and $2 also has local edits (generated pages excepted).
check_local_edits() {
  local from="$1" to="$2" f keep=() dirty
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    case " ${GENERATED[*]} " in *" $f "*) continue ;; esac
    keep+=("$f")
  done <<EOF
$(changed_between "$from" "$to")
EOF
  [ "${#keep[@]}" -gt 0 ] || return 0
  dirty="$(g diff --name-only "$from" -- "${keep[@]}")"
  [ -z "$dirty" ] || { echo "These files have local edits that would be lost:"; echo "$dirty" | sed 's/^/  /'; echo "Deploy them first, or move the edits aside, then retry."; exit 1; }
}

# Move main, the index and the working tree from commit $1 to commit $2 by overwriting files in place
# (never deleting and recreating them). Run check_local_edits first.
sync_to() {
  local from="$1" to="$2" f mode
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    if g cat-file -e "$to:$f" 2>/dev/null; then
      mkdir -p "$(dirname "$f")"
      g cat-file blob "$to:$f" > "$f"
      mode="$(g ls-tree "$to" -- "$f" | cut -c1-6)"
      if [ "$mode" = 100755 ]; then chmod +x "$f" 2>/dev/null || true; fi
    else
      rm -f "$f" 2>/dev/null || echo "  note: $f no longer exists in $(g rev-parse --short "$to") but cannot be deleted here; it stays as an untracked file"
    fi
  done <<EOF
$(changed_between "$from" "$to")
EOF
  g read-tree "$to"
  g update-index --refresh -q >/dev/null 2>&1 || true
  g update-ref -m "sync to $(g rev-parse --short "$to")" HEAD "$to" "$from"
}

# The published pages in a tree: every *.html at the root and under newsletter/.
pages_in() { g ls-tree -r --name-only "$1" | grep -E '^(newsletter/)?[^/]+\.html$' || true; }

# Print the id of a tree that is commit $1's tree with the published pages replaced by commit $2's.
# Everything else (_source, CLAUDE.md, the app scaffolding) stays as in $1.
site_tree_from() {
  local base="$1" target="$2" tmp="$HOME/.publimentor-rollback-index" p
  rm -f "$tmp"
  GIT_INDEX_FILE="$tmp" "${G[@]}" read-tree "$base"
  for p in $(pages_in "$base"); do GIT_INDEX_FILE="$tmp" "${G[@]}" update-index --force-remove -- "$p"; done
  "${G[@]}" ls-tree -r "$target" | grep -E $'\t(newsletter/)?[^/\t]+\.html$' | GIT_INDEX_FILE="$tmp" "${G[@]}" update-index --index-info
  GIT_INDEX_FILE="$tmp" "${G[@]}" write-tree
  rm -f "$tmp"
  tidy
}

# Bring local main level with GitHub's main (fast-forward only). Sets LOCAL and REMOTE_SHA.
sync_with_github() {
  echo "→ Fetching main from GitHub…"
  g fetch --quiet "$REMOTE" main
  LOCAL="$(g rev-parse main)"; REMOTE_SHA="$(g rev-parse FETCH_HEAD)"
  if [ "$LOCAL" != "$REMOTE_SHA" ]; then
    if g merge-base --is-ancestor "$LOCAL" "$REMOTE_SHA"; then
      check_local_edits "$LOCAL" "$REMOTE_SHA"
      sync_to "$LOCAL" "$REMOTE_SHA"
      echo "  fast-forwarded main to GitHub ($(g rev-parse --short "$REMOTE_SHA"))"
    elif g merge-base --is-ancestor "$REMOTE_SHA" "$LOCAL"; then
      echo "  note: local main has commits not yet on GitHub; they will be pushed too"
    else
      echo "Local main and GitHub have diverged — resolve that first."; exit 1
    fi
  fi
}
