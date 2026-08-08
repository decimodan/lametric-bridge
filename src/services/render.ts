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

export function renderTemplate(
  template: string,
  vars: Record<string, string>,
): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key: string) => {
    return vars[key] ?? "";
  });
}
