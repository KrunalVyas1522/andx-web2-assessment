# STATUS (shared memory for all agents; keep it short and current)

## Phase
Phase 0: Done (m0-contracts)
Phase 1: Done (Parallel Build)
Phase 2: Gate A Passed (Small flow verified on Seed 7, 2, and 3 with 0 failures; Docker unit tests green)

## Decisions (frozen after Phase 0 checkpoint)
- Broker: BullMQ (Redis with AOF)
- Frameworks: Fastify (gateway), NestJS (others)
- DB: Postgres + TypeORM (batched set-based transactions)
- AI: OpenRouter (free tier)

## Done (with evidence file)
- Scaffolding & Monorepo setup
- `docs/CONTRACTS.md` created and updated with split queues & backpressure
- `gateway`: Fastify ingestion with safe timestamp validation & split queues
- `aggregator`: Batched set-based SQL consumer, late_events table, and DLQ replay
- `earnings`: Remainder rule, optimistic versioning, BigInt precision, creator earnings
- `api`: Replay dispatch, campaigns upsert, UTC parsing, stats & query endpoints
- `classifier`: Relevance scoring worker with Vitest tests
- Gate A Small Flow Seed 7: `docs/evidence/small-flow-seed7.txt` (272/272 passed, 0 failures)
- Gate A Small Flow Seed 2: `docs/evidence/small-flow-seed2.txt` (254/254 passed, 0 failures)
- Gate A Small Flow Seed 3: `docs/evidence/small-flow-seed3.txt` (254/254 passed, 0 failures)
- Docker unit tests: `docs/evidence/make-test-docker.txt` (All 5 services green with no stack running)

## In progress / owner
- Orchestrator: Gate A Complete -> Proceeding to Gate B upon user confirmation.

## Blocked / needs human
- None

## Known risks / unverified
- Medium preset throughput & memory headroom under full burst load.
