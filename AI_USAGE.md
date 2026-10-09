# AI Usage Report

In compliance with the ANDX Engineering Assessment instructions, this document provides an honest, comprehensive account of how AI assistance was utilized throughout the build.

## Tools Used
- **Agentic IDE & CLI Assistant:** Antigravity (powered by Gemini 2.5 / 3.1 Pro models).

## Areas of AI Assistance

### 1. Architecture Design & Scaffolding
- **Accepted:** Modular service decomposition into 5 microservices (`gateway`, `aggregator`, `earnings`, `api`, `classifier`) with explicit contract separation and isolated Postgres schemas.
- **Accepted:** BullMQ with Redis 7 as the broker backbone and TypeORM for PostgreSQL persistence.

### 2. Implementation & Hot-Path Ingestion
- **Accepted:** Fastify implementation in `gateway` for high-throughput NDJSON ingestion and streaming.
- **Rejected & Changed:** The initial aggregator implementation performed individual row queries and commits per event in the loop, which saturated disk I/O at ~60 events/s. This was discarded and rewritten to execute **set-based chunked SQL transactions (1 transaction per batch)**, elevating throughput to over 22,000 events/second.

### 3. Edge-Case Validation & Deduplication
- **Accepted:** In-memory catalog caching with database fallback for campaign lookups before DLQ routing.
- **Changed:** Safe date parsing in `gateway/src/validator.ts` — raw `new Date().toISOString()` crashed on intentional test anomalies (`2026-13-45T...`). Replaced with rigorous NaN timestamp guard checks to prevent HTTP 500 crashes during burst traffic.
- **Changed:** In `earnings/src/earnings.cron.ts`, replaced JavaScript floating-point arithmetic with native `BigInt` math to guarantee exact budget allocation and remainder rule distribution down to the single cent, using string code point comparison (`<` / `>`) for tie-breaking rather than `localeCompare`.

### 4. Verification & Testing
- AI assistance was used to automate end-to-end execution of the test harness on Seed 7 and oracle-generated seeds (Seed 2 and Seed 3), confirming zero failures across all checks.
- All numbers and latencies reported in `README.md` and `EVAL.md` are taken directly from executed command outputs saved under `docs/evidence/`.

Every line of code in this repository has been vetted and run against the assessment verification suite.
