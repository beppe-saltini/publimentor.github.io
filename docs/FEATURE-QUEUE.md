# PubliMentor — Feature Queue

The running list of app work, in priority order. Update it when an item ships (move it to **Done** with the commit) or when a new request comes in.

_Last updated: 2026-10-09_

---

## 1. Reference existence check (new feature)

**Request (owner, 2026-10-09):** for every reference in the paper, run a web search to confirm that the cited source (article, review, book, chapter, preprint, dataset, report, website…) is real and actually published as cited. The goal is to catch fabricated or "hallucinated" references, not just malformed ones.

**What exists today:** `src/lib/reference-validator.ts` (`parseReferences`, `validateReferences`) checks DOIs and metadata against Crossref/PubMed and reports `valid / not_found / retracted / suspicious / unchecked`. A reference without a DOI, or one that isn't indexed in Crossref or PubMed (books, reports, conference papers, web pages), usually comes back `not_found` or `unchecked`, which says nothing about whether it actually exists. The integrity review (item 2) found more gaps: Vancouver references never validate, and 404 DOIs are ignored.

**Proposed approach:**
- Escalate one layer at a time and stop as soon as a layer settles the reference:
  1. DOI resolves and its metadata matches the citation (Crossref/DataCite).
  2. Title/author/year search in Crossref, PubMed and OpenAlex (free).
  3. Web search for anything still unresolved. Reuse the Claude Haiku + `web_search` tool pattern from `src/lib/reviewers/deceased-check.ts`, which needs no search-engine keys.
- Verdict for each reference: **Verified** (found, details match) / **Mismatch** (a real work, but the authors, year, journal or title differ from the citation) / **Not found** (no trace anywhere, so possibly fabricated) / **Unchecked** (an outage or the budget ran out; never show this as "Not found").
- Show the evidence (the matching URL or record) next to each verdict so the editor can judge it.
- Limit the web-search layer per run (an env var like `REFERENCE_WEB_SEARCH_MAX`) and give it its own rate limit and `maxDuration` (the integrity review found these missing on the references route).
- Make it available both in the integrity check and in the Journal-Ready Formatter's reference repair.

**Depends on:** the reference-parsing fixes from item 2 (Vancouver initials and titles, DOI pattern cutting off at ")"). Without them the search queries start from badly parsed fields.

---

## 2. Integrity-check fixes (paused partway, not merged)

36 confirmed findings from the 2026-10-09 review (full list in the earlier session's scratchpad `integrity-findings.md`; copy it into `docs/` before that scratchpad goes away). Headlines: the tortured-phrase list flags ordinary English and has no word boundaries; the retraction check reads `update-to` instead of `updated-by`; the DOI pattern cuts off at ")"; Vancouver references never validate; ORCID affiliation matching never actually compares; the top ROR hit is accepted blindly; outages are shown as "Not found"; manuscript-loaded checks see only the abstract.

Unfinished, uncommitted work in `publimentor/.claude/worktrees/`:
- `wf_b88c857e-e70-1` — tortured-phrase detector
- `wf_b88c857e-e70-2` (branch `identity-fixes`) — ORCID / ROR identity
- `wf_b88c857e-e70-3` — references (Crossref, PubPeer, text/field parsers)
- `wf_b88c857e-e70-4` — integrity UI (new panels; full-report route removed)

Next step: check each worktree's changes against the findings list, finish and test them, then merge to `app` and deploy.

---

## 3. Journal-Ready Formatter, next steps

Shipped in `43372e9` and `138bd7e`.
- A DOCX without Word heading styles gives an empty outline, so the deposition checks become not-applicable. Infer headings from formatting/text.
- Add journal profiles beyond iScience (profile + target structure, never special-cased in code).
- Test file downloads in production.

---

## 4. Small app backlog

- Nothing schedules `runRetentionPolicies` (add a Vercel cron).
- 73 eslint warnings (unused variables, hook dependencies).
- `src/lib/storage/index.ts` doesn't trim `STORAGE_PROVIDER`.

---

## 5. Longer-term ideas

See [TODO.md](TODO.md): breached-password check (HIBP), MFA, session binding, Postgres row-level security, OpenTelemetry tracing. (Its Redis and audit-log entries are partly out of date.)

---

## Owner actions (outside the code)

- Add an Upstash Redis store from the Vercel Storage tab (free tier). Until then, rate limits only apply per server instance.
- Optional: add `HF_API_TOKEN` to turn on manuscript embeddings.

---

## Done

_(move items here with their commit hash)_
