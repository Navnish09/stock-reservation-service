# Testing the Stock Reservation API (quick guide)

Collection: `postman/stock-reservation.postman_collection.json` ("Stock APIs (simple)").
Every request resets its own item, so you can run any request alone, in any order.
The full edge-case suite is in [TESTING.md](TESTING.md).

## 1. Run it

```bash
docker compose up -d --wait   # Postgres + Redis
npm install
npm run migrate
npm start                     # API on http://localhost:3000
```

Import the collection into the Postman desktop app (`baseUrl` = `http://localhost:3000`), then **Run** folders **1 to 4**.
✅ All green in about 30 seconds (14 requests, 39 assertions).

## 2. What each request proves

URLs are relative to `{{baseUrl}}`. Requests marked **script** fire many calls from a pre-request script; the URL shown is the final stock check.

| # | Requirement | Request in Postman | Endpoint and payload | ✅ Expected |
|---|---|---|---|---|
| 1 | API is up | Health check | `GET /health` | 200, `redis: up` |
| 2 | Set / reset stock | Set stock | `PUT /api/v1/items/CORE-STOCK` `{"quantity":10}` | 200, `available` 10 |
| 2 | Reserve lowers stock | Reserve 2 units | `POST /api/v1/items/CORE-RESERVE/reservations` `{"userId":"alice","quantity":2}` | 201, `quantity` 2, `remaining` 8 |
| 2 | Partial fill | Partial fill: ask 5, only 3 left | `POST /api/v1/items/CORE-PARTIAL/reservations` `{"userId":"alice","quantity":5}` | 201, `quantity` 3, `partial` true |
| 2 | Sold out | Sold out | `POST /api/v1/items/CORE-SOLDOUT/reservations` `{"userId":"bob","quantity":1}` | 409 `OUT_OF_STOCK` |
| 2 | Input validation | Invalid input (quantity 0) | `POST /api/v1/items/CORE-RESERVE/reservations` `{"userId":"alice","quantity":0}` | 400 `VALIDATION_ERROR` |
| 2 | Idempotent retry | Retry with Idempotency-Key | `POST /api/v1/items/CORE-IDEM/reservations` + header `Idempotency-Key`, same body as above (already sent once by the pre-request) | 200, `replayed` true, one reservation |
| 2 | Ledger matches counter | Get stock (ledger check) | `GET /api/v1/items/CORE-RESERVE` | 200, `consistent` true |
| 3 | No overselling (atomic) | 200 users, stock 100 · atomic | **script**: 200 × `POST …/RACE-ATOMIC/reservations` `{"quantity":1}` | 100 × 201, 100 × 409, `available` 0 |
| 3 | No overselling (pessimistic) | 200 users, stock 100 · pessimistic | **script**: same, header `x-reservation-strategy: pessimistic` | same |
| 3 | The race is real | 200 users, stock 100 · naive | **script**: same, header `x-reservation-strategy: naive` | reserved > 100, `consistent` false (green = bug shown) |
| 4 | Fast path partial fill | Fast reserve: ask 5, only 3 left | `POST /api/v1/items/FAST-PARTIAL/reservations/fast` `{"userId":"alice","quantity":5}` | 202, `quantity` 3, `meta.path` `redis-gate` |
| 4 | Fast path, no overselling | 200 users, stock 100 · fast path | **script**: 200 × `POST …/FAST-RACE/reservations/fast` | 100 × 202, 100 × 409, `gate.pendingWrites` 0 |
| 4 | Fast path is faster | Speed: normal vs fast (1,000 users) | **script**: 1,000 calls on each endpoint | both correct, fast has more req/s (see Console) |

## 3. Endpoints

| Method | Path | Body | Success |
|---|---|---|---|
| `GET` | `/health` | none | 200 `{"status":"ok","redis":"up\|down"}` |
| `PUT` | `/api/v1/items/:sku` | `{"quantity": 0..1000000}` | 200 `{data:{sku,totalQuantity,available}}` |
| `GET` | `/api/v1/items/:sku` | none | 200 `{data:{available,reservedQuantity,reservationCount,consistent,gate:{available,pendingWrites}}}` |
| `POST` | `/api/v1/items/:sku/reservations` | `{"userId": string, "quantity": 1..1000}` | 201 new, 200 replay |
| `POST` | `/api/v1/items/:sku/reservations/fast` | same | 202 new, 200 replay |

- Headers on both reserve endpoints: `Idempotency-Key` (optional). The normal endpoint also accepts `x-reservation-strategy: atomic | pessimistic | naive` (demo only, default `atomic`).
- Reserve response: `{data:{id,userId,requestedQuantity,quantity,partial,remaining}, meta:{replayed,…}}`.
- Errors are `{"error":{"code","message","details?"}}`. Codes: `VALIDATION_ERROR` 400, `INVALID_JSON` 400, `NOT_FOUND` 404, `OUT_OF_STOCK` 409, `WRITES_PENDING` 409, `GATE_UNAVAILABLE` 503, `DB_BUSY` 503, `INTERNAL_ERROR` 500.
- Do not use one item on both reserve endpoints (the two counters would drift).

## 4. Redis down (optional, folder 5)

Do not use the Runner for this folder. Send the requests in order:

1. Send **1 · Prepare**, then run `docker compose stop redis`.
2. Send **2 · Fast reserve while Redis is stopped** ✅ 503 `GATE_UNAVAILABLE` (after about 2 s).
3. Send **3 · Normal reserve while Redis is stopped** ✅ 201 (the normal path does not need Redis).
4. Run `docker compose start redis`, wait 5 s, send **4 · Fast reserve after Redis is back** ✅ 202.

## 5. Beyond Postman (optional)

```bash
npm run -s compare -- --base=http://localhost:3000
```
✅ `atomic`, `pessimistic`, `redis gate (fast)` show `passed`; `naive` shows `race`.

```bash
npm run -s loadtest -- --base=http://localhost:3000 --endpoint=fast --users=10000 --stock=1000 --qty=1 --concurrency=500
```
✅ `'202': 1000`, `'409 OUT_OF_STOCK': 9000`, all checks `passed`.

## Clean up

```bash
docker compose down -v
```
