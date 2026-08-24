export type AwtrixColor = string | number | [number, number, number];

export type NotifyInput = {
  text?: string | Array<{ text: string; color?: AwtrixColor }>;
  icon?: string;
  textColor?: AwtrixColor | "palette";
  durationMs?: number;
  repeat?: number;
  name?: string;
  hold?: boolean;
  stack?: boolean;
  wakeup?: boolean;
  sound?: string | number;
  soundRtttl?: string;
  soundLoop?: boolean;
  effect?: string;
  overlay?: string;
  progress?: number;
  progressColor?: AwtrixColor;
};

export type AwtrixErrorBody = {
  error?: {
    code?: string;
    message?: string;
    field?: string;
  };
};

export type DeviceInfo = {
  version: string;
  hostname: string;
  ipAddress: string;
  currentApp?: string;
  matrixPower: boolean;
  brightness: number;
  batteryPercent?: number;
};
