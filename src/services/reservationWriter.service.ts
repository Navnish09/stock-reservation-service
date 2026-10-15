import os from "node:os";
import { randomUUID } from "node:crypto";
import {
  RESERVATION_DEAD_STREAM,
  RESERVATION_STREAM,
  WRITER_BATCH_SIZE,
  WRITER_BLOCK_MS,
  WRITER_CLAIM_IDLE_MS,
  WRITER_CLAIM_INTERVAL_MS,
  WRITER_ERROR_BACKOFF_MS,
  WRITER_GROUP,
} from "../config/constants";
import { prisma } from "../db/prisma";
import { redis } from "../db/redis";
import { pgErrorCode } from "../lib/errors";
import type { StreamEntry } from "../types";

// Move the Redis stream data into Postgres in batches.
//
// ONE SQL statement inserts every reservation and decrements each item once, so the
// row lock on `items` is taken once per batch instead of once per request.
//   - The he insert is ON CONFLICT DO NOTHING and the decrement only counts rows
//     that were really inserted, so a batch that was committed but not acked is not applied twice.
//   - An entry rejected by the Postgres goes to the dead-letter stream and is acked,
//     so it can't block the queue. Other errors, like DB down, leave entries pending to be retried.
export interface ReservationWriter {
  stop(): Promise<void>;
}

type RawEntries = [string, string[]][];

const consumer = `${os.hostname()}-${process.pid}-${randomUUID().slice(0, 8)}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function parseEntries(raw: RawEntries): StreamEntry[] {
  return raw.map(([streamId, fields]) => {
    const f: Record<string, string> = {};
    for (let i = 0; i < fields.length; i += 2) f[fields[i]] = fields[i + 1];
    return {
      streamId,
      id: f.id,
      sku: f.sku,
      userId: f.userId,
      requested: Number(f.requested),
      granted: Number(f.granted),
      idem: f.idem || null,
    };
  });
}

async function writeBatch(entries: StreamEntry[]): Promise<void> {
  const ids = entries.map((e) => e.id);
  const skus = entries.map((e) => e.sku);
  const users = entries.map((e) => e.userId);
  const granted = entries.map((e) => e.granted);
  const requested = entries.map((e) => e.requested);
  const idems = entries.map((e) => e.idem ?? "");
  await prisma.$queryRaw`
    WITH ins AS (
      INSERT INTO reservations (id, item_id, user_id, quantity, requested_quantity, idempotency_key)
      SELECT t.id, i.id, t.user_id, t.granted, t.requested, NULLIF(t.idem, '')
        FROM unnest(${ids}::uuid[], ${skus}::text[], ${users}::text[], ${granted}::int[], ${requested}::int[], ${idems}::text[])
             AS t(id, sku, user_id, granted, requested, idem)
        JOIN items i ON i.sku = t.sku
      ON CONFLICT DO NOTHING
      RETURNING item_id, quantity
    )
    UPDATE items i
       SET available = i.available - a.q, updated_at = NOW()
      FROM (SELECT item_id, SUM(quantity)::int AS q FROM ins GROUP BY item_id) a
     WHERE i.id = a.item_id`;
}

export function startReservationWriter(): ReservationWriter {
  // Dedicated connection: XREADGROUP BLOCK would otherwise block the API's Redis commands.
  const conn = redis.duplicate();
  let stopping = false;
  let groupReady = false;

  async function ack(entries: StreamEntry[]): Promise<void> {
    const ids = entries.map((e) => e.streamId);
    await conn.pipeline().xack(RESERVATION_STREAM, WRITER_GROUP, ...ids).xdel(RESERVATION_STREAM, ...ids).exec();
  }

  async function deadLetter(entry: StreamEntry, err: unknown): Promise<void> {
    console.error("[writer] dead-lettering", entry.id, (err as Error).message);
    await conn.xadd(
      RESERVATION_DEAD_STREAM, "*",
      "id", entry.id, "sku", entry.sku, "userId", entry.userId,
      "requested", entry.requested, "granted", entry.granted,
      "error", String((err as Error).message).slice(0, 500),
    );
    await ack([entry]);
  }

  async function processEntries(entries: StreamEntry[]): Promise<void> {
    try {
      await writeBatch(entries);
      await ack(entries);
    } catch (err) {
      if (pgErrorCode(err) === undefined) throw err;
      if (entries.length === 1) return deadLetter(entries[0], err);
      for (const entry of entries) await processEntries([entry]);
    }
  }

  async function claimStale(): Promise<void> {
    const res = (await conn.xautoclaim(
      RESERVATION_STREAM, WRITER_GROUP, consumer, WRITER_CLAIM_IDLE_MS, "0-0", "COUNT", WRITER_BATCH_SIZE,
    )) as unknown as [string, RawEntries];
    const entries = parseEntries(res[1] ?? []);
    if (entries.length) await processEntries(entries);
  }

  async function run(): Promise<void> {
    let lastClaim = 0;
    while (!stopping) {
      try {
        if (!groupReady) {
          // "0" = also deliver entries queued before the group existed.
          await conn.xgroup("CREATE", RESERVATION_STREAM, WRITER_GROUP, "0", "MKSTREAM").catch((err: Error) => {
            if (!err.message.includes("BUSYGROUP")) throw err;
          });
          groupReady = true;
        }
        const res = (await conn.xreadgroup(
          "GROUP", WRITER_GROUP, consumer, "COUNT", WRITER_BATCH_SIZE, "BLOCK", WRITER_BLOCK_MS,
          "STREAMS", RESERVATION_STREAM, ">",
        )) as unknown as [string, RawEntries][] | null;
        if (res) await processEntries(parseEntries(res[0][1]));
        if (Date.now() - lastClaim > WRITER_CLAIM_INTERVAL_MS) {
          lastClaim = Date.now();
          await claimStale();
        }
      } catch (err) {
        if (String((err as Error).message).includes("NOGROUP")) groupReady = false; // stream was wiped
        if (!stopping) console.error("[writer]", (err as Error).message);
        await sleep(WRITER_ERROR_BACKOFF_MS);
      }
    }
  }

  const loop = run();
  console.log(`reservation writer started (consumer=${consumer}, batch=${WRITER_BATCH_SIZE})`);
  return {
    async stop() {
      stopping = true;
      await loop;
      conn.disconnect();
    },
  };
}
