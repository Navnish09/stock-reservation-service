// Runs the same 200-user test against every strategy and prints a comparison.
// Requires the server to be running. Each strategy gets its own SKU.
import { runLoadTest } from "./load-test";

async function main() {
  const rows = [];
  for (const strategy of ["atomic", "pessimistic", "naive"]) {
    const s = await runLoadTest({
      strategy,
      sku: `CMP-${strategy}`,
      qty: "1",
      // For random qty, uncomment the line below. It will generate a random number between 1 and 10, but will default to 1 if the random number is 0. s
      // qty: (Math.random() * 10 || 1).toPrecision(1)
      quiet: true,
    });
    rows.push({
      strategy,
      "201s": s.succeeded,
      partial: s.partials,
      reserved: s.unitsReserved,
      available: s.available,
      "p50 ms": s.p50ms,
      "p95 ms": s.p95ms,
      "wall ms": s.wallMs,
      correct: s.passed ? "passed" : "race",
    });
  }
  const fast = await runLoadTest({ endpoint: "fast", sku: "CMP-redis-gate", qty: "1", quiet: true });
  rows.push({
    strategy: "redis gate (fast)",
    "201s": fast.succeeded,
    partial: fast.partials,
    reserved: fast.unitsReserved,
    available: fast.available,
    "p50 ms": fast.p50ms,
    "p95 ms": fast.p95ms,
    "wall ms": fast.wallMs,
    correct: fast.passed ? "passed" : "race",
  });
  console.log("\n200 concurrent users, stock 100, 1 unit each:");
  console.table(rows);
}

main();
