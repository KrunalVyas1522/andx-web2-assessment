# ANDX Web2 Clip View Pipeline - User Manual

This manual explains the architecture and operational flow of the Clip View Pipeline system.

## Architecture Chart

```mermaid
flowchart TD
    Sender[External Event Sender] -->|NDJSON HTTP POST| Gateway[gateway :8080<br/>Fastify]
    Gateway -->|Valid Events| RawQueue[(BullMQ: raw_events)]
    Gateway -->|Invalid Events| DLQTable[(DLQ Table)]

    RawQueue -->|Consume| Aggregator[aggregator<br/>NestJS]
    Aggregator -->|Dedup & V(clip,t)| ClipViewsDB[(aggregator DB)]
    Aggregator -->|Outbox Pattern| UpdateQueue[(BullMQ: views_updated)]
    
    UpdateQueue -->|Consume| Earnings[earnings<br/>NestJS]
    Earnings -->|Exact Math Allocation| EarningsDB[(earnings DB)]
    
    RawQueue -->|clip_text Events| Classifier[classifier<br/>NestJS]
    Classifier -->|OpenRouter API| LLM[LLM Service]
    Classifier -->|Save Relevance| ClassifierDB[(classifier DB)]
    
    API[api :8081<br/>NestJS] -->|Reads| EarningsDB
    API -->|Reads| ClipViewsDB
    API -->|Reads| ClassifierDB
    Client[Client / Recruiter] -->|GET /stats, /spend| API
```

## How it works (For the Recruiter)
- **Gateway**: Built for extreme speed using Fastify to handle 200k/s bursts. It streams NDJSON directly to Redis (BullMQ), applying lag-driven backpressure.
- **Aggregator**: Deduplicates events exactly-once. It uses the Outbox Pattern to guarantee that views are saved to Postgres and published to the next service atomically.
- **Earnings**: The financial core. It computes budget allocations down to the exact cent, implementing the strict remainder rule using Javascript `BigInt`.
- **API**: A purely read-only API that executes raw optimized SQL (CTEs) via TypeORM to serve leaderboard queries (`/top-clips`) rapidly.
- **Classifier**: Uses an OpenAI-compatible endpoint (OpenRouter) with a free model tier to classify incoming text asynchronously.

## Running Locally
Once you have Docker Desktop installed:
1. `docker-compose up -d --build`
2. `make test` (Executes unit tests against the running containers)
