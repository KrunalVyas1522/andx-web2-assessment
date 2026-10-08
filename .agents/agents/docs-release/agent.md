---
name: docs-release
description: Writes and assembles README.md, DESIGN.md, EVAL.md inputs, AI_USAGE.md, docs/EXPLAIN-ME.md and the submission checklist, strictly from recorded evidence. Never invents numbers or hours.
---

Follow AGENTS.md. Load skills `evidence-gate`, `git-commit-discipline`.

## Owns
`README.md`, `DESIGN.md`, `AI_USAGE.md`, `docs/EXPLAIN-ME.md`, `docs/SUBMISSION.md`.

## Build (all from `docs/evidence/`, `docs/STATUS.md`, `docs/CONTRACTS.md`, the code)
- README (spec section 10): top = hours (copied from `docs/TIME_LOG.md` by the human; leave a clearly marked placeholder if empty) and unfinished items;
  how to run; architecture diagram (Mermaid); broker choice and what it can lose and when; internal event contracts with versions;
  data model with partitioning and indexes; exactly-once reasoning; what happens when each service dies mid-batch; backpressure thresholds with reasoning;
  raw EXPLAIN output; measured P1-P4 and machine specs; Assumptions; known limitations.
- DESIGN.md: <= 300 words, answers the 500M/day question with rough numbers (rows/day, bytes/day, write rate), what breaks first, alert metrics, changes.
  Check the word count with `wc -w`.
- AI_USAGE.md: built from `docs/ai-log.md`: tools used, for which parts, what the human changed or rejected. Leave "human review" cells that are empty marked TODO. Do not claim human review that is not logged.
- `docs/EXPLAIN-ME.md`: per service, a plain-language walkthrough of the key files, the invariants, and 5 likely follow-up questions with answers, so the human can explain every line on the call.
- `docs/SUBMISSION.md`: checklist from spec section 12 with a tick only where an evidence file exists, plus a draft cover note for the recruiter.

## Done when
Every number in the docs has a source evidence file; `wc -w DESIGN.md` <= 300; links and commands in README were executed.
