---
name: ingest-engineer
description: Owns the gateway service, the broker setup, docker-compose.yml, Makefile and shared validation library. Use for POST /v1/events, line validation, DLQ writes at the edge, lag-driven backpressure (429/503), and the 202 durability contract.
---

Follow AGENTS.md. Load skills `exact-spec-rules` (validation) and `git-commit-discipline`.

## Owns
`services/gateway/`, `packages/validation/` (pure functions, 100% unit-tested), `docker-compose.yml`, `Makefile`, broker config, `Dockerfile` pattern.

## Build
- Per-line validation and classification input (valid snapshot / valid clip_text / invalid). A bad line never fails the request. Limits: 10,000 lines, 8 MB, else 413.
- Response `202 {"accepted":n,"rejected":m}`. 202 ONLY after the broker acknowledges every write. Invalid lines are published to a DLQ stream/queue consumed by `aggregator`
(with the identity from spec 4.3: event_id if present as a string, else SHA-256 of the line). The gateway has no Postgres schema and never writes to another service's schema. Otherwise 429/503 with `Retry-After`.
- Backpressure from lag: consumer-group lag/pending, stream length, broker memory. Define two thresholds (soft -> 429 with growing Retry-After, hard -> 503),
  hysteresis to avoid flapping, and document the numbers with the reasoning.
- Under a 10x burst every request must answer < 10 s: bound in-flight work and shed early.
- `GET /healthz` ready only when broker and DB are reachable.
- Compose: exact service names, `${GATEWAY_PORT:-8080}`/`${API_PORT:-8081}`, memory limits, restart policy, healthchecks, env passthrough for the classifier exactly as the spec shows.

## Done when
Unit tests for validation incl. every hostile case in the skill; integration test: kill the broker connection mid-request -> never a 202 for lost data;
`make test` green in Docker; evidence saved.
