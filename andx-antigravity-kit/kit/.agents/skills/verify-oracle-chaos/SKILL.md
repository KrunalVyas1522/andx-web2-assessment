---
name: verify-oracle-chaos
description: Use when verifying the system end to end: running the checker, generating expected answers for new seeds with the oracle, and testing crash recovery, broker restart, earnings outage, replay, hostile input, backpressure and the spend-never-exceeds-budget invariant.
---

# Verify with the oracle, then break things on purpose

The oracle (`tools/oracle/oracle.py`) is an independent single-process implementation of the spec. It was validated against
`web2-kit/expected/small-seed7.json` and matches it fully. Never share code between it and the services.

## 1. Expected answers for any seed
```bash
node web2-kit/generator/andx-gen.js gen --preset small --seed 3 --out ./data-small-3
python3 tools/oracle/oracle.py --data ./data-small-3 --out ./expected-small-3.json
python3 tools/oracle/oracle.py --data ./data-small --compare web2-kit/expected/small-seed7.json   # sanity: ALL MATCH
```
Use the oracle on small and medium. For `full` there is no oracle: compare against invariants and the stats the checker can verify.

## 2. The small flow (from web2-kit/README.md), per seed
register `campaigns.json` -> send -> wait for drain -> `check --phase before_replay` -> register `campaigns-late.json`
-> `POST /v1/dlq/replay {"reason":"unknown_campaign"}` -> wait -> `check --perf`. Must end `... checks passed, 0 failures`.
Wait by polling `/v1/stats` until stable AND consumer lag is 0, not by sleeping.

## 3. Chaos matrix (scripts in `tools/chaos/`, one per row, each prints PASS/FAIL against the oracle)
| Test | How | Pass when |
|---|---|---|
| Crash each of gateway/aggregator/earnings/api | medium preset, during the burst: `docker compose kill -s SIGKILL <svc>`, keep down 2 min, `docker compose up -d <svc>` (fresh stack per service) | final check: 0 failures |
| Earnings outage | stop `earnings` mid-flow | spend/earnings freeze while stats keep moving; after restart exact catch-up |
| Broker restart | graceful `docker compose restart broker` while idle | services reconnect, nothing lost, numbers unchanged |
| Replay storm | re-send the same file (or `--slice`) several times | every number unchanged |
| Hostile input | inject lines of kinds NOT in the generator (see exact-spec-rules traps) | all in DLQ as invalid_schema, rest unaffected |
| Late campaigns | register late file, replay DLQ | `unknown_campaign` pending drops to expected, no duplicates |
| Budget invariant | sampler polls every campaign's spend each 200 ms during a run | `spend_cents <= budget_cents` always; `spend == budget` when exhausted |
| Backpressure | full or medium burst | every request answered < 10 s with 202/429/503; no restarts/OOM; `docker stats` < 1.5 GB per service |

## 4. Record
Each run goes to `docs/evidence/` via the evidence-gate skill, with seed, preset, commit hash and raw checker output.
