/** LaMetric local API sound IDs (notifications + alarms). */

export type LametricSound = {
  id: string;
  label: string;
  category: "notifications" | "alarms";
};

export const LAMETRIC_SOUNDS: LametricSound[] = [
  { id: "notification", label: "Notification", category: "notifications" },
  { id: "notification2", label: "Notification 2", category: "notifications" },
  { id: "notification3", label: "Notification 3", category: "notifications" },
  { id: "notification4", label: "Notification 4", category: "notifications" },
  { id: "open_door", label: "Door unlocked", category: "notifications" },
  { id: "knock-knock", label: "Knock knock", category: "notifications" },
  { id: "letter_email", label: "Mail", category: "notifications" },
  { id: "bicycle", label: "Bicycle", category: "notifications" },
  { id: "car", label: "Car", category: "notifications" },
  { id: "cash", label: "Cash", category: "notifications" },
  { id: "cat", label: "Cat", category: "notifications" },
  { id: "dog", label: "Dog", category: "notifications" },
  { id: "dog2", label: "Dog 2", category: "notifications" },
  { id: "energy", label: "Energy", category: "notifications" },
  { id: "positive1", label: "Positive 1", category: "notifications" },
  { id: "positive2", label: "Positive 2", category: "notifications" },
  { id: "positive3", label: "Positive 3", category: "notifications" },
  { id: "positive4", label: "Positive 4", category: "notifications" },
  { id: "positive5", label: "Positive 5", category: "notifications" },
  { id: "positive6", label: "Positive 6", category: "notifications" },
  { id: "negative1", label: "Negative 1", category: "notifications" },
  { id: "negative2", label: "Negative 2", category: "notifications" },
  { id: "negative3", label: "Negative 3", category: "notifications" },
  { id: "negative4", label: "Negative 4", category: "notifications" },
  { id: "negative5", label: "Negative 5", category: "notifications" },
  { id: "lose1", label: "Lose 1", category: "notifications" },
  { id: "lose2", label: "Lose 2", category: "notifications" },
  { id: "win", label: "Win", category: "notifications" },
  { id: "win2", label: "Win 2", category: "notifications" },
  { id: "statistic", label: "Page turn", category: "notifications" },
  { id: "thunder", label: "Thunder", category: "notifications" },
  { id: "water1", label: "Water 1", category: "notifications" },
  { id: "water2", label: "Water 2", category: "notifications" },
  { id: "wind", label: "Wind", category: "notifications" },
  { id: "wind_short", label: "Wind short", category: "notifications" },
  { id: "alarm1", label: "Alarm 1", category: "alarms" },
  { id: "alarm2", label: "Alarm 2", category: "alarms" },
  { id: "alarm3", label: "Alarm 3", category: "alarms" },
  { id: "alarm4", label: "Alarm 4", category: "alarms" },
  { id: "alarm5", label: "Alarm 5", category: "alarms" },
  { id: "alarm6", label: "Alarm 6", category: "alarms" },
  { id: "alarm7", label: "Alarm 7", category: "alarms" },
  { id: "alarm8", label: "Alarm 8", category: "alarms" },
  { id: "alarm9", label: "Alarm 9", category: "alarms" },
  { id: "alarm10", label: "Alarm 10", category: "alarms" },
  { id: "alarm11", label: "Alarm 11", category: "alarms" },
  { id: "alarm12", label: "Alarm 12", category: "alarms" },
  { id: "alarm13", label: "Alarm 13", category: "alarms" },
];

const SOUND_IDS = new Set(LAMETRIC_SOUNDS.map((s) => s.id));

export function isLametricSoundId(id: string): boolean {
  return SOUND_IDS.has(id);
}

export function lametricSoundCategory(
  id: string,
): "notifications" | "alarms" {
  const found = LAMETRIC_SOUNDS.find((s) => s.id === id);
  if (found) return found.category;
  return /^alarm\d+$/i.test(id) ? "alarms" : "notifications";
}

/** Normalize optional sound id; empty → null. */
export function normalizeSoundId(
  value: string | null | undefined,
): string | null {
  const id = (value ?? "").trim();
  if (!id) return null;
  if (!isLametricSoundId(id)) {
    throw new Error(`Unknown sound id: ${id}`);
  }
  return id;
}
