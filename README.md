# ANDX Web2 Clip View Pipeline

> **Hours Spent:** ~10 focused hours  
> **Status / Unfinished:** **Gate A Verified (Production Baseline)**. The small preset flow passes with **0 failures** across Seed 7 and two oracle-generated seeds (Seed 2 and Seed 3). Unit tests for all 5 services pass cleanly inside Docker with no stack running (`make test`). Full-preset (22.8M rows) performance optimizations and automated chaos kill/restart matrix remain as documented future milestones in `DESIGN.md`.

---

## 1. Quick Start

### Prerequisites
- Docker & Docker Compose (v2+)
- Node.js 20+ (for generator/checker scripts)
- Python 3 (for test oracle)

### Start the Stack
```bash
docker compose up -d --build
```
This spins up all 7 containers:
- `gateway` (:8080)
- `api` (:8081)
- `aggregator`
- `earnings`
- `classifier`
- `broker` (Redis 7, :6379)
- `postgres` (PostgreSQL 16, :5432)

### Run Unit Tests Inside Docker
```bash
make test
```
*Executes isolated Vitest test suites for `gateway`, `aggregator`, `earnings`, `api`, and `classifier` inside container environments with no running stack required.*

### Run Small Flow Verification
```bash
# 1. Generate small preset data
node web2-kit/generator/andx-gen.js gen --preset small --seed 7 --out ./data-small

# 2. Register initial campaigns
curl -XPOST http://localhost:8081/v1/admin/campaigns -H "content-type: application/json" --data-binary @data-small/campaigns.json

# 3. Stream dataset
node web2-kit/generator/andx-gen.js send --data ./data-small --url http://localhost:8080

# 4. Check initial stats (after queues drain)
node web2-kit/generator/andx-gen.js check --api http://localhost:8081 --expected web2-kit/expected/small-seed7.json --phase before_replay

# 5. Register late campaigns
curl -XPOST http://localhost:8081/v1/admin/campaigns -H "content-type: application/json" --data-binary @data-small/campaigns-late.json

# 6. Replay DLQ
curl -XPOST http://localhost:8081/v1/dlq/replay -H "content-type: application/json" -d '{"reason":"unknown_campaign"}'

# 7. Final validation
node web2-kit/generator/andx-gen.js check --api http://localhost:8081 --expected web2-kit/expected/small-seed7.json --phase final --perf
```

---

## 2. Architecture & Service Ownership

```
                       [ Load Generator / External Clients ]
                                       |
                                       v
                              [ gateway : 8080 ] (Fastify)
                                       |
                    +------------------+------------------+
                    | (snapshots)      | (invalid)        | (clip_text)
                    v                  v                  v
             [ Redis Broker ]   [ Redis Broker ]   [ Redis Broker ]
                    |                  |                  |
                    +--------+---------+                  |
                             |                            v
                             v                     [ classifier ]
                      [ aggregator ]                      |
                             |                            v
            +----------------+----------------+   [ clip_relevance ]
            | (Postgres write)                | (Outbox)
            v                                 v
     [ clip_view_snapshots ]           [ views_updated ]
     [ processed_events ]                     |
     [ late_events / dlq ]                    v
                                         [ earnings ]
                                              |
                                              v
                                       [ campaign_spend ]
                                       [ creator_earnings ]
                                              ^
                                              |
                                       [ api : 8081 ] (NestJS)
                                              ^
                                              |
                                       [ Query Clients ]
```

### Microservice Breakdown
1. **`gateway` (Fastify, Port 8080)**: High-throughput ingestion. Validates schema v1/v2, normalizes to internal v2, checks Redis memory limits for 429/503 backpressure, and routes into split BullMQ queues (`snapshots`, `clip_text`, `invalid`).
2. **`aggregator` (NestJS)**: Deduplicates events via PostgreSQL `processed_events`. Inserts view snapshots into `clip_view_snapshots`, drops events late by > 6 hours into `late_events`, and pushes unknown campaigns into `aggregator.dlq`. Emits transaction-bound events to `aggregator.outbox`.
3. **`earnings` (NestJS)**: Consumes `views_updated` updates, marks campaigns dirty with optimistic versioning, and runs debounced compute cycles. Implements exact `BigInt` budget allocation and remainder rule down to the single cent with string code point tie-breaking.
4. **`api` (NestJS, Port 8081)**: Serves public read endpoints (`/v1/stats`, `/v1/campaigns/:id/spend`, `/v1/creators/:id/earnings`, `/v1/campaigns/:id/top-clips`, `/v1/clips/:clip_id/relevance`), manages campaign catalog, and dispatches DLQ replay requests to `aggregator`.
5. **`classifier` (NestJS)**: Consumes `clip_text` events, calls OpenRouter / OpenAI compatible LLMs using structured prompts, and persists classification scores to `classifier.clip_relevance`.

---

## 3. Broker Choice & Backpressure

### Broker: BullMQ on Redis 7 (AOF enabled)
- **Why**: Handles 20,000+ events/second bursts directly in memory. Provides robust queue management, atomic job reservation, stalled job recovery, and dead-letter queue handling.
- **Backpressure Mechanism**:
  - The `gateway` checks Redis `used_memory` and queue pending counts.
  - If Redis memory approaches 1 GB (out of the 1.5 GB limit) or queue lag builds beyond threshold, the gateway returns `503 Service Unavailable` or `429 Too Many Requests` with a `Retry-After: 1` header, causing the generator to throttle.

---

## 4. Internal Event Contracts & Data Model

### BullMQ Queues
- `snapshots`: Valid view snapshots (normalized v2 shape).
- `clip_text`: Valid clip text metadata for classifier.
- `invalid`: Malformed lines and invalid schemas destined for DLQ.
- `dlq_replay`: Replay requests dispatched from API.
- `views_updated`: Outbox events published by aggregator for earnings.

### Database Schema (Single Postgres, Schema Per Service)
- **`api.campaigns`**: `id` (PK), `budget_cents`, `cpm_cents`, `per_clip_cap_cents`, `end_at`.
- **`aggregator.processed_events`**: `event_id` (PK), `processed_at`.
- **`aggregator.late_events`**: `event_id` (PK), `processed_at`.
- **`aggregator.clip_metadata`**: `clip_id` (PK), `campaign_id`, `creator_id`.
- **`aggregator.clip_view_snapshots`**: `(clip_id, observed_at_ms)` (PK), `campaign_id`, `creator_id`, `views`.
  - Index: `idx_snapshots_camp_obs (campaign_id, observed_at_ms DESC)`.
- **`aggregator.dlq`**: `event_id` (PK), `reason`, `payload`.
  - Index: `idx_dlq_reason (reason)`.
- **`aggregator.outbox`**: `id` (PK UUID), `type`, `payload`, `processed`, `created_at`.
- **`earnings.processed_updates`**: `aggregator_tx_id` (PK UUID).
- **`earnings.dirty_campaigns`**: `campaign_id` (PK), `version`, `updated_at`.
- **`earnings.campaign_spend`**: `campaign_id` (PK), `spend_cents`, `raw_earnings_cents`, `paid_clips`.
- **`earnings.creator_earnings`**: `(creator_id, campaign_id)` (PK), `clips`, `earned_cents`.
  - Index: `idx_creator_earnings_user (creator_id)`.
- **`classifier.clip_relevance`**: `clip_id` (PK), `campaign_id`, `on_brief`, `score`, `model`.

---

## 5. Exactly-Once Guarantees & Failure Handling

### Exactly-Once Processing
1. **Ingestion & Aggregation**: Incoming snapshot batches are processed in set-based atomic PostgreSQL transactions. Deduplication is enforced by `ON CONFLICT (event_id) DO NOTHING` on `aggregator.processed_events`.
2. **Outbox Pattern**: Changes to view snapshots and outbox rows are committed within the same database transaction, ensuring no events are lost or double-counted if a process crashes mid-batch.
3. **Optimistic Locking**: Earnings debouncer verifies the `version` column on `earnings.dirty_campaigns` to avoid race conditions during concurrent recomputations.

### Failure Recovery Scenarios
- **Gateway crash**: In-flight requests terminate abruptly. The load generator catches network drops and retries the batch automatically.
- **Aggregator crash mid-batch**: Uncommitted transactions roll back cleanly. BullMQ detects the stalled worker lock expiration and re-queues the job. Deduplication ensures replay safety.
- **Earnings crash**: Uncommitted recalculations roll back. Dirty campaign flags remain in Postgres, and computation resumes upon restart.
- **Broker restart**: BullMQ uses persistent Redis AOF (Append-Only File). All microservices use ioredis instances with automated exponential backoff reconnection.

---

## 6. Verification & Measured Performance

### Environment
- **Host**: Windows 11 Pro, Docker Desktop (WSL2 Engine), 8 Cores, 16 GB RAM.
- **Resource Constraints**: 1.5 GB memory limit enforced on all service containers in `docker-compose.yml`.

### Measured Numbers (Gate A Small Flow)
| Test Target | Total Lines | Rate Sustained | Checks Passed | Failures | Status |
|-------------|-------------|----------------|---------------|----------|--------|
| **Seed 7** (Baseline) | 455,524 | 22,290 lines/s | 272 / 272 | **0** | **PASS** |
| **Seed 2** (Oracle Generated) | 455,981 | 21,453 lines/s | 254 / 254 | **0** | **PASS** |
| **Seed 3** (Oracle Generated) | 455,513 | 21,327 lines/s | 254 / 254 | **0** | **PASS** |

### API P95 Latency (Seed 7 Benchmark)
- `GET /v1/stats`: **103.9 ms**
- `GET /v1/campaigns/:id/spend`: **14.1 ms**
- `GET /v1/creators/:id/earnings`: **11.3 ms**
- `GET /v1/campaigns/:id/top-clips`: **259.1 ms**

### Unit Tests (`make test`)
- `gateway`: 3/3 passed (timestamp validation, schema discrimination)
- `aggregator`: 2/2 passed (deduplication, transaction boundary)
- `earnings`: 1/1 passed (BigInt budget allocation, remainder rule, code point tie-breaking)
- `api`: 1/1 passed (cursor pagination, queries)
- `classifier`: 2/2 passed (relevance scoring)

Raw verification output files are stored under `docs/evidence/`.
