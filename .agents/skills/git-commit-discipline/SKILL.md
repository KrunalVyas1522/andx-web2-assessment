---
name: git-commit-discipline
description: Use whenever you stage, commit, branch, merge, tag or prepare a submission in this repo. Defines commit format, atomic commit rules, the concurrency-safe commit command for parallel agents, and what must never be committed.
---

# Git commit discipline

The commit history is read by the reviewer. It should show a real, incremental, test-backed build.

## Format (Conventional Commits)
`<type>(<scope>): <imperative summary, <= 72 chars>`
- types: `feat fix test refactor perf docs build chore`
- scopes: `gateway aggregator earnings api classifier compose oracle docs`
- body (when the why is not obvious): what changed, why, how it was verified. Wrap at ~80 cols.
- trailer on AI-assisted commits: `Assisted-by: Antigravity (Gemini 3.1 Pro)`

Examples
- `feat(aggregator): batch-upsert snapshots with event_id dedup in one txn`
- `test(earnings): cover remainder rule tie-break by clip_id`
- `fix(gateway): return 503 when consumer lag exceeds high-water mark`

## Rules
1. One logical change per commit. Tests for it are in the SAME commit. No "wip", "fix stuff", "update".
2. Stage explicit paths only: `git add -- <paths>`. Never `git add -A` or `git add .`.
3. Before every commit: `git status --short` and `git diff --cached --stat`; confirm only your owned paths are staged.
4. Run the fast checks for your service first (unit tests + typecheck). Do not commit a red `main`.
5. Never commit: `data-*/`, `*.ndjson*`, `.env*`, `node_modules/`, `docs/ASSESSMENT.md`, secrets, API keys, build output.
6. Never: `git push`, `--force`, `--amend` on anything already merged, `rebase` of shared history, `git config`, `--author`, `GIT_*_DATE`.
7. Hours, timestamps and author identity are real. Do not fake them.

## Parallel agents in one working tree (concurrency-safe commit)
Use a lock so two agents never race on the index:
```bash
flock /tmp/andx-git.lock sh -c 'git add -- services/aggregator && git commit -m "feat(aggregator): ..."'
```
If you work in your own worktree (`git worktree add ../wt-<role> -b agent/<role>/<topic>`), commit there normally;
the orchestrator merges with `git merge --no-ff agent/<role>/<topic>` after the service's tests pass.

## Milestone tags (orchestrator only, after evidence exists)
`m0-contracts`, `m1-small-flow-green`, `m2-crash-tests-green`, `m3-full-run-recorded`, `v1.0-submission`.

## Final pack (the human does the push)
Orchestrator prepares: clean `git status`, `git log --oneline` review, tag `v1.0-submission`, and a fallback
`git archive --format=zip -o ../andx-submission.zip v1.0-submission`.
