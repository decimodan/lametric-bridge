import { query, type NotifyLogRow } from "../db/index.js";
import { sendNotification } from "../adapters/lametric.js";
import { config } from "../config.js";
import { priorityRank, type Message } from "./render.js";

type QueueItem = {
  message: Message;
  enqueuedAt: number;
};

const queue: QueueItem[] = [];
let timer: NodeJS.Timeout | null = null;
let processing = false;

const rateBuckets = new Map<string, { count: number; windowStart: number }>();

export function checkRateLimit(key: string): boolean {
  const now = Date.now();
  const bucket = rateBuckets.get(key);
  if (!bucket || now - bucket.windowStart >= 60_000) {
    rateBuckets.set(key, { count: 1, windowStart: now });
    return true;
  }
  if (bucket.count >= config.rateLimitPerMinute) {
    return false;
  }
  bucket.count += 1;
  return true;
}

export async function logNotify(
  source: string,
  text: string,
  priority: string,
  status: string,
  detail?: string,
  appId?: string,
): Promise<void> {
  await query(
    `INSERT INTO notify_log (source, app_id, text, priority, status, detail)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [source, appId ?? null, text, priority, status, detail ?? null],
  );

  await query(
    `DELETE FROM notify_log
     WHERE id NOT IN (
       SELECT id FROM notify_log ORDER BY id DESC LIMIT 200
     )`,
  );
}

export async function listNotifyLog(limit = 50): Promise<NotifyLogRow[]> {
  const res = await query<NotifyLogRow>(
    "SELECT * FROM notify_log ORDER BY id DESC LIMIT $1",
    [limit],
  );
  return res.rows;
}

function sortQueue(): void {
  queue.sort((a, b) => {
    const pr =
      priorityRank(a.message.priority) - priorityRank(b.message.priority);
    if (pr !== 0) return pr;
    return a.enqueuedAt - b.enqueuedAt;
  });
}

export function enqueue(message: Message): void {
  queue.push({ message, enqueuedAt: Date.now() });
  sortQueue();
  ensureWorker();
}

async function processOne(): Promise<void> {
  const item = queue.shift();
  if (!item) return;

  const result = await sendNotification(item.message);
  await logNotify(
    item.message.source,
    item.message.text,
    item.message.priority ?? "info",
    result.ok ? "ok" : "error",
    result.detail,
    item.message.appId,
  );
}

function ensureWorker(): void {
  if (timer) return;
  timer = setInterval(() => {
    void (async () => {
      if (processing) return;
      if (queue.length === 0) return;
      processing = true;
      try {
        await processOne();
      } catch (err) {
        console.error("queue worker error", err);
      } finally {
        processing = false;
      }
    })();
  }, config.queueIntervalMs);
}

export function startQueue(): void {
  ensureWorker();
}

export function queueSize(): number {
  return queue.length;
}
