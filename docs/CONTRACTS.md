# System Contracts & Architecture

## 1. Services & Ports
| Service      | Port | Framework | Responsibility |
|--------------|------|-----------|----------------|
| `gateway`    | 8080 | Fastify   | Ingest events, validate, push to BullMQ, backpressure. |
| `aggregator` | none | NestJS    | Deduplicate, calculate V(clip, t), DLQ late/unknown. |
| `earnings`   | none | NestJS    | Compute exact spend/earnings, remainder rule. |
| `api`        | 8081 | NestJS    | Serve stats/queries, manage campaign catalog. |
| `classifier` | none | NestJS    | AI classification of clip text via OpenRouter. |
| `broker`     | 6379 | Redis     | Backs BullMQ. Configured with AOF (Append Only File) to prevent data loss on restarts. |
| `postgres`   | 5432 | Postgres  | 1 instance, separate schemas per service. |

## 2. Broker Choice
**BullMQ on Redis**
- **Why**: Handles massive bursts (200k/s) via memory, built-in retry logic, and DLQ handling.
- **What it can lose**: With AOF enabled (`appendonly yes`), it can theoretically lose up to 1 second of writes if a hard OS crash happens, but for normal restarts or SIGKILLs on services, it loses nothing. Memory is bounded by aggressively removing completed jobs (`removeOnComplete`).

## 3. BullMQ Queues (Stream Names)
- `raw_events`: Populated by `gateway`, consumed by `aggregator` and `classifier`.
- `views_updated`: Populated by `aggregator` (Outbox pattern), consumed by `earnings`.

## 4. Internal Event Schemas (Versioned)
**`raw_events` Job Payload**
```json
{
  "version": 1,
  "type": "view_snapshot_batch",
  "events": [ /* array of valid raw events v1/v2 */ ]
}
```
**`views_updated` Job Payload**
```json
{
  "version": 1,
  "campaign_id": "k_00001",
  "clip_id": "c_0012093",
  "creator_id": "u_003303",
  "views": 15000,
  "observed_at_ms": 1767572203558,
  "aggregator_tx_id": "uuid-for-idempotency"
}
```

## 5. Database Schemas & Idempotency
- **`api.campaigns`**: `id` (PK), `budget_cents`, `cpm_cents`, `per_clip_cap_cents`, `end_at`.
- **`aggregator.processed_events`**: `event_id` (PK). Deduplication (exactly-once).
- **`aggregator.clip_views`**: `clip_id` (PK), `campaign_id`, `creator_id`, `latest_views`, `latest_observed_at_ms`.
- **`aggregator.dlq`**: `event_id` (PK), `reason` (invalid_schema/unknown_campaign), `payload`.
- **`earnings.processed_updates`**: `aggregator_tx_id` (PK). Idempotency for outbox events.
- **`earnings.campaign_spend`**: `campaign_id` (PK), `spend_cents`, `raw_earnings_cents`, `paid_clips`.
- **`earnings.creator_earnings`**: `creator_id` (PK), `campaign_id` (PK), `earned_cents`.
- **`classifier.clip_relevance`**: `clip_id` (PK), `on_brief`, `score`.

## 6. Replay Protocol
When `POST /v1/dlq/replay` is called:
1. `api` queries `aggregator.dlq` for the given reason.
2. It pushes them back onto the `raw_events` BullMQ queue in batches.
3. It deletes or marks them as processing in the DLQ table.
4. If they fail again, they return to the DLQ natively via BullMQ failure logic.

## 7. Environment Variables
- `REDIS_URL`: `redis://broker:6379`
- `DATABASE_URL`: `postgres://user:pass@postgres:5432/andx`
- `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`: Standard OpenAI-compatible args mapped to OpenRouter.
