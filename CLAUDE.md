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
2. Run, in the sandbox shell on the Mac:
   `cd "$HOME/mnt/project publimentor/publimentor" && _source/tools/deploy.sh "message"`
   The script fetches, fast-forwards, builds, checks, commits and pushes over SSH with the deploy key.
   It keeps the sandbox's own `GIT_SSH_COMMAND` (the proxy) and only adds the key and known_hosts.
3. Verify: `https://www.publimentor.com/` should serve the new `index.html` within a couple of minutes.

The owner can do the same by double-clicking `Deploy website.command` (next to the repository), and can
preview the current `_source` at http://localhost:8765 with `Preview website in localhost.command`.
Rollback: `_source/tools/rollback.sh` (or `Roll back website.command`) reverts the latest commit on main and pushes; the pages return exactly to the previous version. Re-deploy later with deploy.sh.

To revoke Claude's push access: GitHub → repository → Settings → Deploy keys → delete "claude-deploy-key".

## History

- 2026-09-22 — Redesign: new visual identity (Newsreader + Figtree, brand teal/green palette, illustration
  set drawn in `_source/art.py`), always-visible EN/中文 switch, pictures throughout, newsletter covers,
  fifth testimonial. Wording unchanged from the previous site apart from a few interface labels.
