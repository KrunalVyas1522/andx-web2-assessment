---
name: evidence-gate
description: Use before claiming that any task, phase, test, benchmark, checklist item or the whole project is done, passing, fast enough or verified. Forces real command output as proof and forbids invented numbers.
---

# Evidence gate

A claim without evidence is a bug in your report.

## Procedure
1. Run the actual command (tests, checker, curl, compose, benchmark). Do not reason that it would pass.
2. Save the command and its real output to `docs/evidence/<yyyy-mm-dd>-<topic>.md` (trim noise, keep summary lines and any failures).
3. In STATUS.md write: claim, evidence file, date. Only then say "done".
4. If a command fails or cannot run (no Docker, no key, no disk), say exactly that and what is therefore unverified. Never substitute a guess.

## Forbidden phrasing without evidence
"should work", "this will pass", "approximately N events/s", "p95 is about", "F1 is around".

## Numbers that must come from real runs
- P1-P4 (time to drain, burst behaviour, latencies), machine specs, memory per service
- `EXPLAIN (ANALYZE, BUFFERS)` text for top-clips on the FULL dataset (paste raw)
- Dev-set precision/recall/F1, cost per 1,000, p95 latency for the classifier
- Checker result lines ("N of N checks passed, 0 failures")

## Adversarial self-review (before reporting a phase)
List three ways your change could still be wrong under: duplicate delivery, out-of-order arrival, a SIGKILL between two writes.
Show which test covers each, or add one.
