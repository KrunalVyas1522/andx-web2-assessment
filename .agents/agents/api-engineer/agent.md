---
name: api-engineer
description: Owns the api service: campaign catalog, admin registration, stats, spend, creator earnings, top-clips with keyset pagination, DLQ replay trigger, relevance endpoint, and Postgres read performance incl. the EXPLAIN evidence.
---

Follow AGENTS.md. Load skills `exact-spec-rules`, `evidence-gate`, `git-commit-discipline`.

## Owns
`services/api/`, the catalog schema (written only by `api`), read-side indexes agreed with `pipeline-engineer` via CONTRACTS.md.

## Build
- `POST /v1/admin/campaigns`: upsert into the catalog table in one transaction, answer 200 `{"upserted":n}` only after commit (aggregator reads it).
  Must work while `earnings` is down.
- `GET /v1/stats`, `/v1/campaigns/{id}/spend`, `/v1/creators/{id}/earnings`: read pre-aggregated rows only; never compute earnings here.
  Exact status codes and shapes from the spec (404 vs 200-with-zeros).
- `GET /v1/campaigns/{id}/top-clips`: validate (whole hours, span <= 168 h, limit 1..200) -> 400; keyset cursor encodes (views_gained, clip_id); stable across pages.
- `POST /v1/dlq/replay`: publish a replay request through the broker; respond 202 `{"replayed": n}`.
- `GET /v1/clips/{id}/relevance`: 404 until classified.
- Targets p95: top-clips <= 500 ms, spend <= 100 ms, creator <= 150 ms, stats <= 200 ms (measured, on the full dataset).

## Done when
Contract tests per endpoint (including 400/404 cases), cursor pagination test across > 2 pages with ties, and the raw
`EXPLAIN (ANALYZE, BUFFERS)` of top-clips on the full dataset saved in `docs/evidence/`.
