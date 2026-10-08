# STATUS (shared memory for all agents; keep it short and current)

## Phase
Phase 0: Done (m0-contracts)
Phase 1: In Progress (Parallel Build)

## Decisions (frozen after Phase 0 checkpoint)
- Broker: BullMQ (Redis with AOF)
- Frameworks: Fastify (gateway), NestJS (others)
- DB: Postgres + TypeORM
- AI: OpenRouter (free tier)

## Done (with evidence file)
- Scaffolding & Monorepo setup
- `docs/CONTRACTS.md` created
- `AGENTS.md` updated with custom stack
- `gateway` implementation completed and compiled (tsc)

## In progress / owner
- `aggregator` & `earnings` / pipeline-engineer
- `api` / api-engineer
- `classifier` / ml-engineer

## Blocked / needs human
- Testing is blocked (Missing local tools: Docker, Make, Python)

## Known risks / unverified
- Missing local tools: Docker, Make, Python.
- Testing is currently blocked due to missing tools.
