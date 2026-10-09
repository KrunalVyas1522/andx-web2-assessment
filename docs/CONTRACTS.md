# System Contracts & Architecture

## 1. Services & Ports
| Service      | Port | Framework | Responsibility |
|--------------|------|-----------|----------------|
| `gateway`    | 8080 | Fastify   | Ingest events, validate, normalize to v2, split into queues, memory backpressure. |
| `aggregator` | none | NestJS    | Deduplicate exactly-once, save V(clip, t) snapshots, DLQ late/unknown. |
| `earnings`   | none | NestJS    | Compute exact spend/earnings with remainder rule & optimistic locking. |
| `api`        | 8081 | NestJS    | Serve stats/queries, manage campaign catalog, dispatch replay commands. |
| `classifier` | none | NestJS    | AI classification of clip text via OpenRouter. |
| `broker`     | 6379 | Redis     | Backs BullMQ. Configured with AOF (Append Only File). |
| `postgres`   | 5432 | Postgres  | 1 instance, separate schemas per service (initdb setup). |

## 2. Broker Choice & Backpressure
**BullMQ on Redis**
- **Why**: Handles massive bursts via memory, built-in retry logic.
- **Backpressure**: The `gateway` checks Redis `used_memory` (max 1.5GB allowed). If > 1GB, it returns 429 Too Many Requests to prevent OOM, ensuring pending events across all queues apply backpressure.

## 3. BullMQ Queues (Stream Names)
- `snapshots`: Valid view snapshots (normalized v2), consumed by `aggregator`.
- `clip_text`: Valid clip text events, consumed by `classifier`.
- `invalid`: Invalid schemas, consumed by `aggregator` for DLQ.
- `dlq_replay`: Commands to replay DLQ events, sent by `api`, consumed by `aggregator`.
- `views_updated`: Populated by `aggregator` (Outbox pattern), consumed by `earnings`.

## 4. Internal Event Schemas (Versioned)
**Normalized View Snapshot (`snapshots` Queue)**
```json
{
  "version": 1,
  "type": "view_snapshot_batch",
  "events": [
    {
      "v": 2,
      "type": "view_snapshot",
      "event_id": "...",
      "clip_id": "...",
      "campaign_id": "...",
      "creator_id": "...",
      "observed_at_ms": 1767572203558,
      "emitted_at_ms": 1767572204558,
      "view_count": 15000
    }
  ]
}
```

## 5. Database Schemas & Idempotency
- **`api.campaigns`**: `id` (PK), `budget_cents`, `cpm_cents`, `per_clip_cap_cents`, `end_at`.
- **`aggregator.processed_events`**: `event_id` (PK). Deduplication (exactly-once).
- **`aggregator.late_events`**: `event_id` (PK), `processed_at`. Tracks dropped late events.
- **`aggregator.clip_view_snapshots`**: `clip_id`, `observed_at_ms` (Composite PK), `campaign_id`, `creator_id`, `views`. Full history for V(clip,t).
- **`aggregator.dlq`**: `event_id` (PK), `reason` (invalid_schema/unknown_campaign), `payload`.
- **`earnings.processed_updates`**: `aggregator_tx_id` (PK). Idempotency for outbox events.
- **`earnings.dirty_campaigns`**: `campaign_id` (PK), `version`. Optimistic locking for debounced compute.
- **`earnings.campaign_spend`**: `campaign_id` (PK), `spend_cents`, `raw_earnings_cents`, `paid_clips`.
- **`earnings.creator_earnings`**: `creator_id`, `campaign_id` (Composite PK), `clips`, `earned_cents`.
- **`classifier.clip_relevance`**: `clip_id` (PK), `on_brief`, `score`.

## 6. Replay Protocol
When `POST /v1/dlq/replay` is called:
1. `api` dispatches a broker request to `dlq_replay` with the `{ reason }` and immediately returns 202.
2. `aggregator` consumes the request, pulls rows from `aggregator.dlq`.
3. It directly processes them atomically within a database transaction, deleting them from the DLQ and emitting outbox events if valid.

## 7. Environment Variables
- `REDIS_URL`: `redis://broker:6379`
- `DATABASE_URL`: `postgres://user:pass@postgres:5432/andx`
