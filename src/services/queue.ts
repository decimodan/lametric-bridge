import { query, type NotifyLogRow } from "../db/index.js";
import { dispatchNotification } from "../adapters/clocks.js";
import { config } from "../config.js";
import { getDevice, listDevices } from "./devices.js";
import { priorityRank, type Message } from "./render.js";

type QueueItem = {
  message: Message;
  enqueuedAt: number;
  attempts: number;
};

type DeviceQueueState = {
  queue: QueueItem[];
  current: QueueItem | null;
  processing: boolean;
  nextProcessAt: number;
};

const UNASSIGNED_KEY = "__unassigned__";

const deviceQueues = new Map<string, DeviceQueueState>();
let timer: NodeJS.Timeout | null = null;

const rateBuckets = new Map<string, { count: number; windowStart: number }>();

function getOrCreateDeviceQueue(deviceId: string): DeviceQueueState {
  let state = deviceQueues.get(deviceId);
  if (!state) {
    state = {
      queue: [],
      current: null,
      processing: false,
      nextProcessAt: 0,
    };
    deviceQueues.set(deviceId, state);
  }
  return state;
}

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

function sortQueue(items: QueueItem[]): void {
  items.sort((a, b) => {
    const pr =
      priorityRank(a.message.priority) - priorityRank(b.message.priority);
    if (pr !== 0) return pr;
    return a.enqueuedAt - b.enqueuedAt;
  });
}

async function resolveEnqueueTargets(message: Message): Promise<string[]> {
  if (message.deviceIds?.length) {
    const ids: string[] = [];
    for (const ref of message.deviceIds) {
      const dev = await getDevice(ref);
      if (dev && !ids.includes(dev.id)) ids.push(dev.id);
    }
    return ids;
  }
  if (message.deviceId) {
    const dev = await getDevice(message.deviceId);
    return dev ? [dev.id] : [];
  }
  const all = await listDevices();
  return all.map((d) => d.id);
}

export async function enqueue(message: Message): Promise<void> {
  const targetIds = await resolveEnqueueTargets(message);
  const base = { ...message };
  delete base.deviceIds;

  if (!targetIds.length) {
    const state = getOrCreateDeviceQueue(UNASSIGNED_KEY);
    state.queue.push({ message: base, enqueuedAt: Date.now(), attempts: 0 });
    sortQueue(state.queue);
    ensureWorker();
    return;
  }

  for (const deviceId of targetIds) {
    const state = getOrCreateDeviceQueue(deviceId);
    state.queue.push({
      message: { ...base, deviceId },
      enqueuedAt: Date.now(),
      attempts: 0,
    });
    sortQueue(state.queue);
  }
  ensureWorker();
}

function serializeItem(item: QueueItem, position: number) {
  return {
    text: item.message.text,
    icon: item.message.icon,
    priority: item.message.priority ?? "info",
    source: item.message.source,
    deviceId: item.message.deviceId,
    sound: item.message.sound,
    enqueuedAt: item.enqueuedAt,
    position,
    attempts: item.attempts,
  };
}

function queueEntriesForFilter(deviceId?: string): Array<{
  deviceKey: string;
  item: QueueItem;
}> {
  const entries: Array<{ deviceKey: string; item: QueueItem }> = [];
  for (const [deviceKey, state] of deviceQueues) {
    if (deviceId && deviceKey !== deviceId) continue;
    if (state.current) {
      entries.push({ deviceKey, item: state.current });
    }
    for (const item of state.queue) {
      entries.push({ deviceKey, item });
    }
  }
  entries.sort((a, b) => {
    const pr =
      priorityRank(a.item.message.priority) -
      priorityRank(b.item.message.priority);
    if (pr !== 0) return pr;
    return a.item.enqueuedAt - b.item.enqueuedAt;
  });
  return entries;
}

export function listQueue(deviceId?: string): Array<{
  text: string;
  icon?: string;
  priority: string;
  source: string;
  deviceId?: string;
  enqueuedAt: number;
  position: number;
  attempts: number;
}> {
  const pending = queueEntriesForFilter(deviceId).filter(
    ({ deviceKey, item }) => {
      const state = deviceQueues.get(deviceKey);
      return state?.current !== item;
    },
  );
  return pending.map(({ item }, index) => serializeItem(item, index + 1));
}

export function getCurrentQueueItem(deviceId?: string): {
  text: string;
  icon?: string;
  priority: string;
  source: string;
  deviceId?: string;
  enqueuedAt: number;
  position: number;
  attempts: number;
} | null {
  if (deviceId) {
    const state = deviceQueues.get(deviceId);
    if (!state?.current) return null;
    return serializeItem(state.current, 0);
  }

  const currents = [...deviceQueues.entries()]
    .filter(([, state]) => state.current)
    .map(([key, state]) => ({ key, item: state.current! }))
    .sort(
      (a, b) =>
        priorityRank(a.item.message.priority) -
        priorityRank(b.item.message.priority),
    );

  if (!currents.length) return null;
  return serializeItem(currents[0].item, 0);
}

export function getCurrentQueueItems(): Array<{
  text: string;
  icon?: string;
  priority: string;
  source: string;
  deviceId?: string;
  enqueuedAt: number;
  position: number;
  attempts: number;
}> {
  return [...deviceQueues.entries()]
    .filter(([, state]) => state.current)
    .map(([, state]) => serializeItem(state.current!, 0));
}

export function clearQueue(deviceId?: string): number {
  if (!deviceId) {
    let n = 0;
    for (const state of deviceQueues.values()) {
      n += state.queue.length + (state.current ? 1 : 0);
      state.queue.length = 0;
      state.current = null;
    }
    return n;
  }

  const state = deviceQueues.get(deviceId);
  if (!state) return 0;
  const n = state.queue.length + (state.current ? 1 : 0);
  state.queue.length = 0;
  state.current = null;
  return n;
}

function displayPauseMs(message: Message, ok: boolean): number {
  if (!ok) {
    return Math.max(config.queueIntervalMs, 1_500);
  }
  const lifetime = message.lifetime ?? 5_000;
  const cycles = Math.max(1, message.cycles ?? 2);
  return Math.min(Math.max(config.queueIntervalMs, lifetime * cycles), 20_000);
}

function isPermanentFailure(detail: string): boolean {
  return /only notifications with priority|authorization is required|not configured|modo silencioso|unknown device|no clocks configured/i.test(
    detail,
  );
}

async function processOneForDevice(
  deviceKey: string,
  state: DeviceQueueState,
): Promise<number> {
  const item = state.queue.shift();
  if (!item) return config.queueIntervalMs;

  state.current = item;
  item.attempts += 1;

  try {
    let ok = false;
    let detail = "";
    try {
      const result = await dispatchNotification(item.message);
      ok = result.ok;
      detail = result.detail;
      await logNotify(
        item.message.source,
        item.message.text,
        item.message.priority ?? "info",
        result.ok ? "ok" : "error",
        result.detail,
        item.message.appId,
      );
    } catch (err) {
      detail = err instanceof Error ? err.message : String(err);
      await logNotify(
        item.message.source,
        item.message.text,
        item.message.priority ?? "info",
        "error",
        detail,
        item.message.appId,
      );
    }

    const permanent = !ok && isPermanentFailure(detail);
    if (!ok && !permanent && item.attempts < MAX_ATTEMPTS) {
      state.queue.push(item);
      sortQueue(state.queue);
    }

    if (permanent) return Math.max(config.queueIntervalMs, 400);
    return displayPauseMs(item.message, ok);
  } finally {
    state.current = null;
  }
}

const MAX_ATTEMPTS = 3;

function ensureWorker(): void {
  if (timer) return;
  timer = setInterval(() => {
    void (async () => {
      for (const [deviceKey, state] of deviceQueues) {
        if (state.processing) continue;
        if (state.queue.length === 0) continue;
        if (Date.now() < state.nextProcessAt) continue;
        state.processing = true;
        try {
          const pause = await processOneForDevice(deviceKey, state);
          state.nextProcessAt = Date.now() + pause;
        } catch (err) {
          console.error(`queue worker error (${deviceKey})`, err);
          state.nextProcessAt =
            Date.now() + Math.max(config.queueIntervalMs, 1_500);
        } finally {
          state.processing = false;
        }
      }
    })();
  }, Math.min(200, config.queueIntervalMs));
}

export function startQueue(): void {
  ensureWorker();
}

export function queueSize(deviceId?: string): number {
  if (deviceId) {
    const state = deviceQueues.get(deviceId);
    if (!state) return 0;
    return state.queue.length + (state.current ? 1 : 0);
  }
  let n = 0;
  for (const state of deviceQueues.values()) {
    n += state.queue.length + (state.current ? 1 : 0);
  }
  return n;
}
