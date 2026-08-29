import type { Device } from "../services/devices.js";
import {
  getResolvedDevice,
  resolveDevices,
  touchDevice,
} from "../services/devices.js";
import type { Message } from "../services/render.js";
import { applyDeviceSound } from "../services/deviceNotify.js";
import {
  getAwtrixStatus,
  sendToAwtrix,
  setAwtrixBrightness,
  testAwtrix,
} from "./awtrix.js";
import {
  getLametricStatus,
  sendToLametric,
  setLametricBrightness,
  testLametric,
} from "./lametric.js";

export async function dispatchNotification(
  message: Message,
): Promise<{ ok: boolean; detail: string }> {
  const targets = await resolveDevices(message.deviceId);
  if (!targets.length) {
    return {
      ok: false,
      detail: message.deviceId
        ? `Unknown device: ${message.deviceId}`
        : "No clocks configured",
    };
  }

  const results = await Promise.all(
    targets.map((device) => sendToDevice(device, message)),
  );
  const failed = results.filter((r) => !r.ok);
  if (!failed.length) {
    return {
      ok: true,
      detail: results.map((r) => r.detail).join("; "),
    };
  }
  if (failed.length === results.length) {
    return { ok: false, detail: failed.map((r) => r.detail).join("; ") };
  }
  return {
    ok: true,
    detail: `Partial: ${results.map((r) => r.detail).join("; ")}`,
  };
}

export async function sendToDevice(
  device: Device,
  message: Message,
  opts?: { bypassNotifyPrefs?: boolean },
): Promise<{ ok: boolean; detail: string }> {
  const outbound =
    opts?.bypassNotifyPrefs || message.source === "identify"
      ? message
      : { ...message, sound: applyDeviceSound(device, message.sound) };
  if (device.kind === "awtrix") {
    return sendToAwtrix(device, outbound);
  }
  return sendToLametric(device, outbound);
}

export async function testDevice(
  idOrSlug: string,
): Promise<{ ok: boolean; detail: string }> {
  const device = await getResolvedDevice(idOrSlug);
  if (!device) return { ok: false, detail: "Device not found" };
  return device.kind === "awtrix" ? testAwtrix(device) : testLametric(device);
}

export async function identifyDevice(
  idOrSlug: string,
): Promise<{ ok: boolean; detail: string }> {
  const device = await getResolvedDevice(idOrSlug);
  if (!device) return { ok: false, detail: "Device not found" };
  return sendToDevice(device, {
    text: `Soy ${device.name}`,
    priority: "critical",
    sound: true,
    lifetime: 8000,
    cycles: 2,
    source: "identify",
    deviceId: device.id,
  }, { bypassNotifyPrefs: true });
}

export async function getDeviceStatus(idOrSlug: string): Promise<{
  ok: boolean;
  brightness?: number;
  autoBrightness?: boolean;
  power?: boolean;
  detail: string;
}> {
  const device = await getResolvedDevice(idOrSlug);
  if (!device) return { ok: false, detail: "Device not found" };
  return device.kind === "awtrix"
    ? getAwtrixStatus(device)
    : getLametricStatus(device);
}

export async function setDeviceBrightness(
  idOrSlug: string,
  percent: number,
  autoBrightness?: boolean,
): Promise<{ ok: boolean; detail: string }> {
  const device = await getResolvedDevice(idOrSlug);
  if (!device) return { ok: false, detail: "Device not found" };
  const clamped = Math.max(0, Math.min(100, Math.round(percent)));
  return device.kind === "awtrix"
    ? setAwtrixBrightness(device, clamped, autoBrightness)
    : setLametricBrightness(device, clamped, autoBrightness);
}
