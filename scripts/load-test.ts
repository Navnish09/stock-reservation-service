// Fires concurrent reservation requests at the API, then checks the result against the
// server's own view of the stock.
//
// Usage:
//   npm run loadtest                                  # 200 users, stock 100, random quantity 1-3
//   npm run loadtest -- --users=500 --qty=1
//   npm run loadtest -- --strategy=naive              # watch it oversell
//   npm run loadtest -- --endpoint=fast --users=10000 --stock=1000 --qty=1 --concurrency=500
//                                                     # Redis gate path; waits for the queue to drain
//
// Flags (all optional):
//   --base=URL         API address                                   (default http://localhost:3000)
//   --users=N          number of reservation requests                (default 200)
//   --stock=N          units of stock to start with                  (default 100)
//   --qty=N|random     units each user asks for, or random 1-3       (default random)
//   --sku=NAME         item to reserve                               (default WIDGET-1)
//   --strategy=NAME    atomic | pessimistic | naive, per-request override (default: the server's)
//   --endpoint=fast    use POST .../reservations/fast (Redis gate) instead of the standard endpoint
//   --concurrency=N    max requests in flight at once                (default: same as --users)
//   --quiet=true       print nothing, only set the exit code
//
// Exits with code 1 if any check fails, so it can run in CI.

import type { LoadTestOptions, LoadTestSummary, RequestResult, StockSnapshot } from "../src/types";

const DRAIN_TIMEOUT_MS = 60_000; // fast endpoint: how long to wait for the queue to reach Postgres
const DRAIN_POLL_MS = 50;

function parseOptions(): LoadTestOptions {
  const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=")));
  const users = Number(args.users ?? 200);
  return {
    base: args.base ?? "http://localhost:3000",
    users,
    stock: Number(args.stock ?? 100),
    qty: args.qty ?? "random",
    sku: args.sku ?? "WIDGET-1",
    strategy: args.strategy,
    endpoint: args.endpoint === "fast" ? "fast" : "standard",
    concurrency: Number(args.concurrency ?? users),
    quiet: args.quiet === "true",
  };
}

const defaults = parseOptions();

// --- helpers ----------------------------------------------------------------------------

async function api<T>(base: string, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(`${base}/api/v1${path}`, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: (await res.json()) as T };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const sum = (numbers: number[]) => numbers.reduce((total, n) => total + n, 0);
const percentile = (sorted: number[], p: number) =>
  sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];

async function getStock(o: LoadTestOptions): Promise<StockSnapshot> {
  return (await api<{ data: StockSnapshot }>(o.base, "GET", `/items/${o.sku}`)).body.data;
}

// --- steps ------------------------------------------------------------------------------

// Send ONE reservation request for user number `index` and record what came back.
async function sendReservation(o: LoadTestOptions, index: number): Promise<RequestResult> {
  const userId = `user-${String(index + 1).padStart(3, "0")}`;
  const requested = o.qty === "random" ? 1 + Math.floor(Math.random() * 3) : Number(o.qty);
  const path = o.endpoint === "fast" ? `/items/${o.sku}/reservations/fast` : `/items/${o.sku}/reservations`;
  const headers: Record<string, string> = o.strategy ? { "x-reservation-strategy": o.strategy } : {};

  const startedAt = performance.now();
  const { status, body } = await api<{ data?: { quantity: number }; error?: { code: string } }>(
    o.base, "POST", path, { userId, quantity: requested }, headers,
  );
  return { requested, granted: body.data?.quantity ?? 0, status, code: body.error?.code, ms: performance.now() - startedAt };
}

// Send all `users` requests with at most `concurrency` in flight. Each worker keeps taking the
// next unsent request from a shared counter, so the first wave of requests goes out together.
async function fireRequests(o: LoadTestOptions) {
  const results: RequestResult[] = new Array(o.users);
  let next = 0;
  const worker = async () => {
    for (let i = next++; i < o.users; i = next++) results[i] = await sendReservation(o, i);
  };

  const startedAt = performance.now();
  await Promise.all(Array.from({ length: Math.min(o.concurrency, o.users) }, worker));
  return { results, wallMs: performance.now() - startedAt };
}

// The fast endpoint answers before Postgres is written: wait until the queue is empty.
async function waitForQueueDrain(o: LoadTestOptions): Promise<number> {
  const startedAt = performance.now();
  while (performance.now() - startedAt < DRAIN_TIMEOUT_MS) {
    if ((await getStock(o)).gate?.pendingWrites === 0) break;
    await sleep(DRAIN_POLL_MS);
  }
  return performance.now() - startedAt;
}

// What the clients were told, added up.
function tally(o: LoadTestOptions, results: RequestResult[]) {
  const acceptedStatus = o.endpoint === "fast" ? 202 : 201;
  const accepted = results.filter((r) => r.status === acceptedStatus);
  const statuses: Record<string, number> = {};
  for (const r of results) {
    const key = r.code ? `${r.status} ${r.code}` : String(r.status);
    statuses[key] = (statuses[key] ?? 0) + 1;
  }
  return {
    statuses,
    accepted: accepted.length,
    unitsConfirmed: sum(accepted.map((r) => r.granted)),
    partials: accepted.filter((r) => r.granted < r.requested).length,
    totalDemand: sum(results.map((r) => r.requested)),
    hadServerError: results.some((r) => r.status >= 500),
  };
}

// The real test: what the clients were told must match what the server recorded.
function checkInvariants(o: LoadTestOptions, t: ReturnType<typeof tally>, stock: StockSnapshot): [string, boolean][] {
  return [
    ["No oversell: reserved <= total", stock.reservedQuantity <= stock.totalQuantity],
    ["Counter matches ledger: available + reserved == total", stock.consistent],
    ["Available never negative", stock.available >= 0],
    ["Every accepted reservation is in the ledger", t.unitsConfirmed === stock.reservedQuantity],
    ["No 5xx errors", !t.hadServerError],
    ["Backlog fully written to Postgres", o.endpoint !== "fast" || stock.gate?.pendingWrites === 0],
    // Partial fulfilment: a partial fill drains the stock to 0, so there can be at most one,
    // and if demand >= stock nothing may be left over.
    ["At most one partial fill", t.partials <= 1],
    ["Sold out when demand >= stock", t.totalDemand < o.stock || stock.available === 0],
  ];
}

function printReport(o: LoadTestOptions, s: LoadTestSummary, stock: StockSnapshot) {
  const line = "─".repeat(64);
  const drained = o.endpoint === "fast" ? `, queue drained to Postgres ${s.drainMs}ms after the last response` : "";
  console.log(`\n${o.users} users (max ${Math.min(o.concurrency, o.users)} in flight) -> stock of ${o.stock} (${o.sku}), qty=${o.qty}, strategy=${s.strategy}`);
  console.log(line);
  console.log("Responses        ", s.statuses);
  console.log(`Succeeded         ${s.succeeded} reservations (${s.partials} partial), ${s.unitsConfirmed} units confirmed to clients`);
  console.log(`Server state      available=${stock.available}, reserved=${stock.reservedQuantity}, total=${stock.totalQuantity}`);
  console.log(`Latency           p50=${s.p50ms}ms p95=${s.p95ms}ms p99=${s.p99ms}ms, wall=${s.wallMs}ms`);
  console.log(`Throughput        ${s.rps} requests/s${drained}`);
  console.log(line);
  for (const [name, pass] of s.checks) console.log(`${pass ? "passed" : "failed"} ${name}`);
  console.log();
}

// --- the whole run ------------------------------------------------------------------------

export async function runLoadTest(options: Partial<LoadTestOptions> = {}): Promise<LoadTestSummary> {
  const o = { ...defaults, ...options };

  await api(o.base, "PUT", `/items/${o.sku}`, { quantity: o.stock }); // start from a known stock
  const { results, wallMs } = await fireRequests(o); // everyone reserves at (almost) the same time
  const drainMs = o.endpoint === "fast" ? await waitForQueueDrain(o) : 0;
  const stock = await getStock(o); // what the SERVER says actually happened

  const t = tally(o, results);
  const checks = checkInvariants(o, t, stock);
  const latencies = results.map((r) => r.ms).sort((a, b) => a - b);

  const summary: LoadTestSummary = {
    strategy: o.endpoint === "fast" ? "redis-gate (fast endpoint)" : (o.strategy ?? "(server default)"),
    users: o.users,
    stock: o.stock,
    succeeded: t.accepted,
    partials: t.partials,
    unitsConfirmed: t.unitsConfirmed,
    unitsReserved: stock.reservedQuantity,
    available: stock.available,
    statuses: t.statuses,
    wallMs: Math.round(wallMs),
    rps: Math.round(o.users / (wallMs / 1000)),
    drainMs: Math.round(drainMs),
    p50ms: Math.round(percentile(latencies, 50)),
    p95ms: Math.round(percentile(latencies, 95)),
    p99ms: Math.round(percentile(latencies, 99)),
    passed: checks.every(([, pass]) => pass),
    checks,
  };

  if (!o.quiet) printReport(o, summary, stock);
  return summary;
}

// Run directly (not when imported by compare-strategies.ts)
if (require.main === module) {
  runLoadTest().then((s) => process.exit(s.passed ? 0 : 1));
}
