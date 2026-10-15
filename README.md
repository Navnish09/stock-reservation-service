# Stock Reservation API — Node.js + TypeScript + Prisma + PostgreSQL

A concurrency-safe API that initialises a stock of 100 items and lets many users reserve
units at the same time **without ever overselling**, plus a script that fires 200
concurrent users at it and proves the result is correct.

**Want to verify it yourself?** `TESTING.md` is a step-by-step guide that uses the Postman collection in `postman/` (import it into Postman) for every scenario.

## Quick start

```bash
docker compose up -d --wait
npm install
npm run migrate                 # prisma migrate deploy: Ready the database
npm start                       # API on :3000

npm run loadtest                # 200 concurrent users vs stock of 100
npm run compare                 # same test across all 3 strategies, side by side
npm run loadtest -- --users=2000 --stock=1000 --qty=1   # custom run

# High-throughput endpoint (Redis approach), 10,000 requests, 500 in flight:
npm run loadtest -- --endpoint=fast --users=10000 --stock=1000 --qty=1 --concurrency=500

# Optional: run the Redis -> Postgres writer as its own process, start multiple for more throughput
#   RUN_WRITER=false npm start      # API without the built-in writer
#   npm run worker                  # the writer; REDIS_URL defaults to redis://localhost:6380
```

## API

| Method | Path | Body | Purpose |
|---|---|---|---|
| `PUT` | `/api/v1/items/:sku` | `{ "quantity": 100 }` | Create item or reset stock (idempotent) |
| `GET` | `/api/v1/items/:sku` | – | Stock + ledger totals + `consistent` flag |
| `POST` | `/api/v1/items/:sku/reservations` | `{ "userId": "u1", "quantity": 2 }` | Reserve units |
| `POST` | `/api/v1/items/:sku/reservations/fast` | `{ "userId": "u1", "quantity": 2 }` | Reserve via the Redis gate (for high-throughput) |
| `GET` | `/health` | – | Liveness + DB check (also reports `redis: up/down`) |

Reservation responses: `201` created (full **or partial**), `200` idempotent replay
(header `Idempotency-Key`), `400` invalid input, `404` unknown SKU, `409 OUT_OF_STOCK`
(only when nothing is left).

The `/fast` variant answers `202 Accepted` (the grant is final, the ledger row is written to
Postgres a moment later) and `200` for an idempotent replay; the other codes are the same.

Example: 3 left, user asks for 5:
```json
{ "data": { "requestedQuantity": 5, "quantity": 3, "partial": true, "remaining": 0, "...": "..." } }
```

`PUT` is used for initialisation because "set stock to 100" is naturally idempotent.
Reservations are a sub-resource of the item they reserve, hence `POST /items/:sku/reservations`.

---

## Requirements & decisions

| Question | Decision | Consequence |
|---|---|---|
| Do reservations expire and return to stock? Is there a cancel step? | **No. Reservations are permanent.** | No TTL, no expiry job, no cancel/confirm endpoints, no `status` column. The ledger is append-only, which keeps the invariant simple: `available + SUM(quantity) == total`. |
| User asks for 5 but only 3 are left: fail or partially fulfil? | **Partially fulfil (give 3).** | `granted = LEAST(available, requested)`. The reservation stores both `requested_quantity` and `quantity` (granted), and the response carries `partial: true`. `409 OUT_OF_STOCK` only when 0 are left. |

---

## 1. Architecture

```
HTTP request
   │
   ▼
routes/          validate input (zod), map HTTP ⇄ service, choose status codes
   │
   ▼
services/        business rules + transaction boundary ("what is one unit of work?")
   │   ├── strategies/   pluggable concurrency control (atomic | pessimistic | naive)
   │   └── fast path: Redis gate + a writer that batches accepted reservations into Postgres
   ▼
repositories/    data access only (Prisma raw SQL, plus the Redis gate), no business logic
   │
   ▼
db/              Prisma client (= connection pool), Redis client, transaction helper
db/schema.prisma + db/migrations/    schema and SQL migrations
```

Shared **types** live in `src/types/index.ts`; all **constants** (error codes, Postgres/Prisma codes,
retry and timeout limits, defaults) live in `src/config/constants.ts`.

Each layer only talks to the one below it. The service never sees `req`/`res`, and the
repository never decides whether "not enough stock" is an error. That separation makes it
testable and made it trivial to plug in three concurrency strategies behind one interface
(the **Strategy pattern**: `decrementStock(tx, itemId, qty) → { granted, remaining } | null`).

`app.ts` builds the Express app and `server.ts` starts it, so tests can import the app
without opening a port. `server.ts` also handles `SIGTERM` gracefully (finish in-flight
requests, disconnect Prisma), which matters on every container deploy.

### Data model

`items` holds the counter (`total_quantity`, `available`). `reservations` is an append-only
ledger of who got what (`quantity` = granted, `requested_quantity` = asked for). Keeping both lets us verify correctness: **`available + SUM(reserved) == total`**
must always hold. `GET /items/:sku` reports this as `consistent`.

The database enforces the invariant itself through
`CHECK (available >= 0 AND available <= total_quantity)` (and `requested_quantity >= quantity`). Prisma's schema language can't
express CHECK constraints, so they are appended by hand to the generated migration
(`db/migrations/*_init/migration.sql`). Application code can have bugs; the constraint is
the last line of defence.

---

## 2. The strategies in `src/services/strategies/`

All three are implemented and selectable with `RESERVATION_STRATEGY` (or, for testing,
per request via the `x-reservation-strategy` header).

| Strategy | How | Strengths | Weaknesses
|---|---|---|---|
| **atomic** | One `UPDATE ... LEAST(available, n) ... RETURNING old/new` | 1 round trip, shortest lock hold, simplest | Rule must fit in SQL
| **pessimistic** | `SELECT ... FOR UPDATE`, decide in app, then update | Arbitrary app logic under the lock | 2+ round trips while locked → lower throughput
| **naive** | Read, compute in memory, write | – | Loses updates → oversells

Measure it locally (200 users, 100 units, qty 1), from `npm run compare`:

| strategy | 201s | reserved | available | p50 ms | wall ms | correct |
|---|---|---|---|---|---|---|
| atomic | 100 | 100 | 0 | 187 | 219 | PASSED |
| pessimistic | 100 | 100 | 0 | 205 | 259 | PASSED |
| naive | 200 | 200 | 92 | 168 | 355 | RACE |

Partial fulfilment under concurrency (`--qty=3`, 200 users, 100 units): every correct strategy
gives **33 full fills + exactly 1 partial fill (1 unit)** and ends at `available = 0`.

**Prisma notes.** Prisma is used for the schema, migrations, generated types, the connection
pool and `$transaction`. **Every query is a `$queryRaw` tagged template**, so the exact SQL is
visible and each strategy's locking behaviour is clear. Values are sent as
parameters (`$1, $2`), so there is no chance of SQL injection.
