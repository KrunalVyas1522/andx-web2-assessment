# ANDX Clip View Pipeline

A high-throughput, event-driven microservices architecture built for the ANDX Web2 Assessment. 

## Architecture
- **Gateway**: Fastify (extreme throughput, stream parsing).
- **Services**: NestJS (`aggregator`, `earnings`, `api`, `classifier`).
- **Database**: PostgreSQL 16 (TypeORM, isolated schemas).
- **Broker**: BullMQ on Redis 7 (AOF enabled).
- **AI**: OpenRouter compatible API.

## Design Highlights
- **Backpressure**: The Gateway constantly monitors BullMQ lag. If pending jobs exceed thresholds, it sheds load via `429 Retry-After`.
- **Exactly-Once**: Achieved via an `event_id` registry in Postgres and the Outbox Pattern for publishing to the earnings queue.
- **Exact Math**: Earnings uses native `BigInt` to ensure budget splits and the remainder rule are precise down to the cent.

## Unfinished / Blocked
**Note**: Due to missing local dependencies on the host machine (Docker Desktop, Python, Make), the codebase was fully implemented and compiled via `tsc`, but the integration test suites, chaos matrices, and P1-P4 latency performance tests were skipped.
