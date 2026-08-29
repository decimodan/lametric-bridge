export type Priority = "info" | "warning" | "critical";

export type Message = {
  text: string;
  icon?: string;
  priority?: Priority;
  sound?: boolean | string;
  lifetime?: number;
  cycles?: number;
  source: string;
  appId?: string;
  channelId?: string;
  /** Device id or slug. Omit (with no deviceIds) to send to every configured clock. */
  deviceId?: string;
  /** Multiple device ids or slugs. Takes precedence over deviceId when set. */
  deviceIds?: string[];
};

export type LametricFrame = {
  text: string;
  icon: string;
};

export function priorityRank(priority: Priority = "info"): number {
  switch (priority) {
    case "critical":
      return 0;
    case "warning":
      return 1;
    default:
      return 2;
  }
}

/**
 * Simple templates with optional filters:
 *   {{ name }}: {{ state | round:2 }}{{ unit }}
 *   {{ state | fixed:2 }}  — always N decimals
 *   {{ state | int }}      — truncate to integer
 */
export function renderTemplate(
  template: string,
  vars: Record<string, string>,
): string {
  return template.replace(
    /\{\{\s*(\w+)(?:\s*\|\s*(\w+)(?::(\d+))?)?\s*\}\}/g,
    (_match, key: string, filter?: string, arg?: string) => {
      const raw = vars[key] ?? "";
      if (!filter) return raw;

      const num = Number(String(raw).trim().replace(",", "."));
      if (!Number.isFinite(num)) return raw;

      if (filter === "int") {
        return String(Math.trunc(num));
      }

      if (filter === "round" || filter === "fixed") {
        const digits = arg !== undefined ? Number(arg) : 2;
        const places = Number.isFinite(digits) ? Math.max(0, Math.min(8, digits)) : 2;
        if (filter === "fixed") {
          return num.toFixed(places);
        }
        const factor = 10 ** places;
        return String(Math.round(num * factor) / factor);
      }

      return raw;
    },
  );
}
