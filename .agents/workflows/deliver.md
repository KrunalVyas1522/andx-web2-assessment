---
description: Run the whole ANDX Web2 take-home from empty repo to submission pack, in phases, with human checkpoints and evidence gates.
---

# /deliver: end-to-end delivery

Always start by reading `docs/STATUS.md`; resume at the first unfinished phase. Never skip a CHECKPOINT.

## Phase 0: Foundation (orchestrator alone)
1. Verify tools: `node -v` (>= 20), `docker compose version`, `make -v`, `python3 -V`, free disk (>= 20 GB), Docker CPU/mem.
2. Confirm `docs/ASSESSMENT.md` and `web2-kit/` exist and are untouched (`git status`). Generate `data-small` seed 7 and run the oracle `--compare` sanity check.
3. Write `docs/CONTRACTS.md`: stream names and event schemas (each with `version`), outbox events, DB schemas per service, idempotency keys,
   catalog table shape, replay protocol, API shapes, env vars, ports, compose service list. Record broker choice with what it can lose.
4. Scaffold the monorepo, shared Dockerfile pattern, Makefile (`test`, `up`, `down`, `small-flow`), a no-op service skeleton per service that passes `/healthz`.
5. Commit in small logical commits; tag `m0-contracts`.
**CHECKPOINT 1: stop. Ask the human to review CONTRACTS.md and the broker/language choices.**

## Phase 1: Parallel build (delegate as subagents; disjoint directories)
- `ingest-engineer`: gateway + validation + compose + backpressure
- `pipeline-engineer`: aggregator + earnings + outbox + allocation
- `api-engineer`: api + catalog + queries
- `ml-engineer`: classifier + eval harness
- `qa-verifier`: extra-seed expected files, chaos scripts, sampler, hostile-input injector (against skeleton services)
Each reports with evidence. Orchestrator re-runs every acceptance test and merges per the git skill.

## Phase 2: Integration
1. `docker compose up -d --build`; both health checks pass.
2. Small flow on seed 7: `before_replay` and final checks end with `0 failures`. Fix by routing bugs to the owning specialist.
3. Small flow on two oracle-generated seeds. Tag `m1-small-flow-green`.
**CHECKPOINT 2: stop. Summarise results with evidence and ask the human before heavy runs.**

## Phase 3: Resilience (qa-verifier leads)
3a. If `implementation_plan.md` or `tasks.md` already exist, diff them against AGENTS.md and list every conflict; the human decides.
3b. Broker spike (time-boxed): push the medium preset through the candidate broker with a no-op batch consumer, then with the real batched Postgres insert.
    Record sustained events/s and Redis memory in `docs/evidence/`. Choose the broker from the numbers, not from preference.
Run the whole chaos matrix on the medium preset vs the oracle (crash each of 4 services, earnings outage, broker restart, replay storm,
hostile input, late campaigns, budget sampler, backpressure). Bugs go to owners; repeat until all rows pass. Tag `m2-crash-tests-green`.

## Phase 4: Full volume
Run the full preset once with the specified burst; record machine specs, P1-P4, memory peaks, restarts, p95 latencies, raw EXPLAIN.
Tune only with evidence. Tag `m3-full-run-recorded`. If any target is missed, document it honestly; do not fudge.
**CHECKPOINT 3: stop. Human reviews numbers and decides whether more tuning time is worth it.**

## Phase 5: Release
Run `/release`.
