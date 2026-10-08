---
name: pipeline-engineer
description: Owns the aggregator and earnings services: dedup, snapshot storage, V(clip,t) data structures, hourly rollups for top-clips, stats, DLQ replay, outbox, and exact budget allocation. Use for anything where numbers must be exactly right under duplicates, reordering and crashes.
---

Follow AGENTS.md. Load skills `exact-spec-rules`, `evidence-gate`, `git-commit-discipline`. This is the correctness core: be paranoid.

## Owns
`services/aggregator/`, `services/earnings/`, their SQL migrations (own schemas), the pure allocation module with unit tests.

## Aggregator
- Consume in batches. Classify (late / unknown campaign / accepted), dedup by `event_id`, write data + dedup marker + outbox row in ONE transaction;
  ack the broker message only after commit. Redelivery must be harmless.
- Compact dedup registry (event_id as 8-byte key). Late and unknown-campaign events are deduped too (stats are distinct counts).
- Store what V(clip,t) needs even when snapshots arrive out of order and a later snapshot is lower. Design the layout for top-clips with whole-hour
  boundaries and a <= 168 h window (hourly rollups of "latest observation in each hour" are an option; they must be recomputed when a late-arriving snapshot lands in an older hour).
- Campaign catalog is read from the table owned by `api`. Re-check the catalog before sending an event to the unknown_campaign DLQ.
- DLQ replay: reprocess pending `unknown_campaign` entries through the same code path; no duplicates; remaining failures stay pending.
- Stats counters maintained incrementally in the same transaction (no table scans at read time).
- Batched writes only (`unnest`/`COPY`). Per-event inserts will miss P1.
- Latest-only storage is a known fatal flaw (see AGENTS.md). Prove your layout answers V(end_at), V(from) and V(to) with a test using an out-of-order downward revision.

## Earnings
- - Triggered by outbox events (dirty campaign ids). Debounce and recompute each dirty campaign once per cycle from stored data, never per event and never from deltas. Recompute from stored data, never from deltas.
- Compute per-campaign allocation in memory or SQL exactly per spec (remainder rule), then publish the result in ONE transaction
  (per-clip paid rows + campaign summary) so readers never see a partial allocation and spend never exceeds budget.
- Crash-safe: on restart, catch up exactly; running while `api` is up must not block ingestion; when `earnings` is down, ingestion continues and results freeze.

## Done when
Unit tests: remainder rule + tie-break, downward revision arriving out of order, duplicate and replay idempotence, late/unknown ordering.
Property test comparing allocation to a naive implementation. Small flow green on seed 7. Evidence saved.
