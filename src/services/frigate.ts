/**
 * Parse Frigate detection payloads into bridge events + template vars.
 * Accepts native MQTT `frigate/events` JSON or a flat simplified body.
 */

export type FrigateParsed = {
  /** Frigate event type: new | update | end */
  type: string;
  label: string;
  camera: string;
  zones: string[];
  score: number | null;
  subLabel: string;
  /** Connection events to match (detection + label). */
  events: string[];
  /** Stable id for last_value / dedupe logging. */
  objectId: string;
};

function asString(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return String(v).trim();
}

function asZones(v: unknown): string[] {
  if (!Array.isArray(v)) {
    const s = asString(v);
    return s ? [s] : [];
  }
  return v.map(asString).filter(Boolean);
}

function asScore(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim()) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** sub_label may be a string or [name, score]. */
function asSubLabel(v: unknown): string {
  if (Array.isArray(v) && v.length) return asString(v[0]);
  return asString(v);
}

type AfterLike = {
  id?: unknown;
  camera?: unknown;
  label?: unknown;
  sub_label?: unknown;
  top_score?: unknown;
  score?: unknown;
  current_zones?: unknown;
  entered_zones?: unknown;
};

/**
 * Normalize request body to a Frigate detection.
 * Returns null when the payload should be ignored (e.g. update/end with default filter).
 */
export function parseFrigateBody(
  body: unknown,
  opts?: { includeUpdates?: boolean },
): FrigateParsed | { error: string } | null {
  if (!body || typeof body !== "object") {
    return { error: "Expected JSON object" };
  }

  const raw = body as Record<string, unknown>;
  const includeUpdates = Boolean(opts?.includeUpdates ?? raw.include_updates);

  // Native Frigate MQTT event: { type, before, after }
  const after =
    raw.after && typeof raw.after === "object"
      ? (raw.after as AfterLike)
      : null;

  if (after || typeof raw.type === "string") {
    const type = asString(raw.type).toLowerCase() || "new";
    if (type !== "new" && !includeUpdates) {
      return null;
    }
    if (!after) {
      return { error: "Frigate event missing `after` object" };
    }

    const label = asString(after.label).toLowerCase() || "object";
    const camera = asString(after.camera);
    const zones = [
      ...asZones(after.current_zones),
      ...asZones(after.entered_zones),
    ].filter((z, i, arr) => arr.indexOf(z) === i);
    const score = asScore(after.top_score) ?? asScore(after.score);
    const subLabel = asSubLabel(after.sub_label);
    const objectId = asString(after.id) || `${camera}:${label}:${Date.now()}`;

    const events = ["detection"];
    if (label && label !== "object") events.push(label);

    return {
      type,
      label,
      camera,
      zones,
      score,
      subLabel,
      events,
      objectId,
    };
  }

  // Flat / simplified payload from scripts or HA
  const label =
    asString(raw.label || raw.event).toLowerCase() || "object";
  const camera = asString(raw.camera);
  const zones = asZones(raw.zones ?? raw.zone);
  const score = asScore(raw.score ?? raw.top_score);
  const subLabel = asSubLabel(raw.sub_label ?? raw.name);
  const type = asString(raw.type).toLowerCase() || "new";

  if (type !== "new" && !includeUpdates) {
    return null;
  }

  if (!camera && !label) {
    return { error: "Provide Frigate event (`type`+`after`) or label/camera" };
  }

  const explicitEvent = asString(raw.event).toLowerCase();
  const events = ["detection"];
  if (label && label !== "object" && label !== "detection") {
    events.push(label);
  }
  if (explicitEvent && !events.includes(explicitEvent)) {
    events.push(explicitEvent);
  }

  return {
    type,
    label,
    camera,
    zones,
    score,
    subLabel,
    events,
    objectId: asString(raw.id) || `${camera}:${label}:${Date.now()}`,
  };
}
