import { query, type NotifyLogRow } from "../db/index.js";
import { sendNotification } from "../adapters/lametric.js";
import { config } from "../config.js";
import { priorityRank, type Message } from "./render.js";

type QueueItem = {
  message: Message;
  enqueuedAt: number;
  attempts: number;
};

const MAX_ATTEMPTS = 3;

const queue: QueueItem[] = [];
let timer: NodeJS.Timeout | null = null;
let processing = false;
let nextProcessAt = 0;
let current: QueueItem | null = null;

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
  queue.push({ message, enqueuedAt: Date.now(), attempts: 0 });
  sortQueue();
  ensureWorker();
}

function serializeItem(item: QueueItem, position: number) {
  return {
    text: item.message.text,
    icon: item.message.icon,
    priority: item.message.priority ?? "info",
    source: item.message.source,
    enqueuedAt: item.enqueuedAt,
    position,
    attempts: item.attempts,
  };
}

export function listQueue(): Array<{
  text: string;
  icon?: string;
  priority: string;
  source: string;
  enqueuedAt: number;
  position: number;
  attempts: number;
}> {
  sortQueue();
  return queue.map((item, index) => serializeItem(item, index + 1));
}

export function getCurrentQueueItem(): {
  text: string;
  icon?: string;
  priority: string;
  source: string;
  enqueuedAt: number;
  position: number;
  attempts: number;
} | null {
  if (!current) return null;
  return serializeItem(current, 0);
}

export function clearQueue(): number {
  const n = queue.length;
  queue.length = 0;
  return n;
}

function displayPauseMs(message: Message, ok: boolean): number {
  if (!ok) {
    // Retry sooner on failure, but avoid tight loops.
    return Math.max(config.queueIntervalMs, 1_500);
  }
  const lifetime = message.lifetime ?? 5_000;
  const cycles = Math.max(1, message.cycles ?? 2);
  // Pace so LaMetric can finish showing a notification before the next one.
  return Math.min(Math.max(config.queueIntervalMs, lifetime * cycles), 20_000);
}

async function processOne(): Promise<number> {
  const item = queue.shift();
  if (!item) return config.queueIntervalMs;

  current = item;
  item.attempts += 1;

  try {
    let ok = false;
    try {
      const result = await sendNotification(item.message);
      ok = result.ok;
      await logNotify(
        item.message.source,
        item.message.text,
        item.message.priority ?? "info",
        result.ok ? "ok" : "error",
        result.detail,
        item.message.appId,
      );
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      await logNotify(
        item.message.source,
        item.message.text,
        item.message.priority ?? "info",
        "error",
        detail,
        item.message.appId,
      );
    }

    if (!ok && item.attempts < MAX_ATTEMPTS) {
      queue.push(item);
      sortQueue();
    }

    return displayPauseMs(item.message, ok);
  } finally {
    current = null;
  }
}

function ensureWorker(): void {
  if (timer) return;
  timer = setInterval(() => {
    void (async () => {
      if (processing) return;
      if (queue.length === 0) return;
      if (Date.now() < nextProcessAt) return;
      processing = true;
      try {
        const pause = await processOne();
        nextProcessAt = Date.now() + pause;
      } catch (err) {
        console.error("queue worker error", err);
        nextProcessAt = Date.now() + Math.max(config.queueIntervalMs, 1_500);
      } finally {
        processing = false;
      }
    })();
  }, Math.min(200, config.queueIntervalMs));
}

export function startQueue(): void {
  ensureWorker();
}

export function queueSize(): number {
  return queue.length + (current ? 1 : 0);
}
