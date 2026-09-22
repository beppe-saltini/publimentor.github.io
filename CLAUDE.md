# PubliMentor — project notes for Claude

Repository: `beppe-saltini/publimentor.github.io`. Owner: Giuseppe Saltini (beppe). Business: PubliMentor,
Simona Fiorani's publishing consultancy (www.publimentor.com). Claude maintains this repository; the
owner previously used Cursor.

## What is where

- `main` — the public website, served by GitHub Pages from the repository root (custom domain in `CNAME`,
  no build step on GitHub). Four pages: `index.html`, `newsletter.html`, `newsletter/*.html`.
- `_source/` — the website's source. Build with `python3 _source/build.py`; read `_source/README.md` first.
- `app` branch — the Next.js app at app.publimentor.com, deployed by Vercel. Separate from the website;
  the Next.js scaffolding still present on `main` (package.json, src/app, public/) is not used by the site.
- `.github/workflows/` — a Supabase keep-alive and an Anthropic model check for the app. Not part of the site.
- `../.deploy/` (next to the repository, outside git) — Claude's SSH deploy key, GitHub's pinned host keys.
  The public half is registered as a write deploy key on the repository ("claude-deploy-key").

## Working rules

- Copy is the owner's: never change wording unless asked. New interface strings get a key in both
  `content/en.json` and `content/zh.json`; keep English and Chinese in step.
- Keep each page a single self-contained file; keep the four URLs and the `assets/training/` slide files.
- Always run `python3 _source/check.py` before deploying. After deploying, fetch the live page and
  confirm it matches the built file.
- Commit only the website files (the four pages, `_source/`, `CLAUDE.md`, `_config.yml`). Local scratch
  files in the working tree (`preview.html`, `proposed-layout.html`, `preview-assets.txt`,
  `assets/logo*.jpg`, `assets/simona.jpg`, `uploads/`, `src/generated/`, `.claude*`, `.vscode/`) stay
  untracked; don't commit or delete them without asking.
- Commits: author is the owner's usual identity; add `Co-Authored-By: Claude <noreply@anthropic.com>`.

## Deploying from a Claude session

1. Connect the folder `~/Projects/project publimentor` (it contains the repository and `.deploy/`).
2. Edit `_source` on the Mac (send changed files with device_commit_files, then compare sha256 on both
   sides: the tool has served a stale copy of a previously sent path — use a fresh staged path if so).
3. Run, in the sandbox shell on the Mac:
   `cd "$HOME/mnt/project publimentor/publimentor" && _source/tools/deploy.sh "message"`
   The script fetches, fast-forwards, builds, checks, commits and pushes over SSH with the deploy key.
   It keeps the sandbox's own `GIT_SSH_COMMAND` (the proxy) and only adds the key and known_hosts.
4. Verify: `https://www.publimentor.com/` should serve the new `index.html` within a couple of minutes
   (WebFetch works; the cloud shell cannot reach the domain, and the built-in browser on the Mac can).

Rollback: `_source/tools/rollback.sh [commit]` publishes the pages as they were before the latest commit
(or at the given commit) as a new commit; `_source` stays as it is. Re-deploy later with deploy.sh.
The owner can do both by double-clicking `Deploy website.command` / `Roll back website.command` (next to
the repository) and can preview the current `_source` at http://localhost:8765 with
`Preview website in localhost.command`.

Sandbox quirks (handled by `_source/tools/git-env.sh`, so use the scripts rather than raw git for anything
that writes): nothing inside the connected folder can be deleted, so git leaves `.git/HEAD.lock`,
`index.lock`, `objects/maintenance.lock` and `tmp_obj_*` files behind — a stale `HEAD.lock` blocks the
next commit — and `checkout`/`merge`/`revert` fail because they delete files before recreating them. The
scripts keep the index outside the folder, replace files by overwriting, and move the leftovers to
`../_to_delete/git-leftovers/`. For read-only git commands in the sandbox, set
`GIT_INDEX_FILE` to a copy of `.git/index` outside the folder (e.g. `cp .git/index "$HOME/i"`) to avoid
leaving an `index.lock` behind. Never print the environment (the proxy variables carry credentials).

To revoke Claude's push access: GitHub → repository → Settings → Deploy keys → delete "claude-deploy-key".

## History

- 2026-09-22 — Redesign: new visual identity (Newsreader + Figtree, brand teal/green palette, illustration
  set drawn in `_source/art.py`), always-visible EN/中文 switch, pictures throughout, newsletter covers,
  fifth testimonial, Simona's three editorial roles in the hero and About section. Wording unchanged from
  the previous site apart from a few interface labels. Deployed as b4417a4 (previous site: 0f762c1).
- 2026-09-22 — deploy.sh / rollback.sh rewritten around `git-env.sh` so they also work from the sandbox;
  rollback now restores only the published pages.
