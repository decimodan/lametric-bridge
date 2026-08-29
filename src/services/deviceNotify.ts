import type { Device } from "./devices.js";

export type NotifySoundMode = "inherit" | "on" | "off";

/** Apply per-clock sound preferences before sending to hardware adapters. */
export function applyDeviceSound(
  device: Pick<Device, "notifySoundMode" | "notifySoundId">,
  sound: boolean | string | undefined,
): boolean | string | undefined {
  if (device.notifySoundMode === "off") return false;
  if (device.notifySoundMode === "on") {
    return device.notifySoundId?.trim() || true;
  }

  if (sound === false) return false;
  if (typeof sound === "string") return sound;
  return sound;
}

export function describeEffectiveSound(
  device: Pick<Device, "notifySoundMode" | "notifySoundId">,
  sound: boolean | string | undefined,
): string {
  const effective = applyDeviceSound(device, sound);
  if (effective === false) {
    if (device.notifySoundMode === "off") return "silencioso (reloj)";
    return "mudo";
  }
  if (typeof effective === "string") {
    if (device.notifySoundMode === "on") return `${effective} (reloj)`;
    return effective;
  }
  if (effective === true) return "sonido";
  return "sin sonido";
}
