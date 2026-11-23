export const LOCAL_TIMEZONE = "America/Edmonton";
export const SLOT_MINUTES = 30;
export const DAY_END = 24 * 60;

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** "14:30" -> 870. Throws on malformed input. */
export function parseHHMM(value: string): number {
  const m = HHMM.exec(value);
  if (!m) throw new RangeError(`Invalid time "${value}", expected HH:mm`);
  return Number(m[1]) * 60 + Number(m[2]);
}

/** 870 -> "14:30". Accepts 1440 and renders it as "24:00". */
export function formatHHMM(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** True when the string is a real calendar date in YYYY-MM-DD form. */
export function isValidIsoDate(value: string): boolean {
  const m = ISO_DATE.exec(value);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

/** Adds days to an ISO date without any timezone drift. */
export function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return date.toISOString().slice(0, 10);
}

/**
 * The current date and minute-of-day in the library's timezone.
 * `now` is injectable so tests do not depend on the real clock.
 */
export function localNow(now: Date, timeZone = LOCAL_TIMEZONE): { date: string; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value);
  return {
    date: `${get("year")}-${String(get("month")).padStart(2, "0")}-${String(get("day")).padStart(2, "0")}`,
    minutes: get("hour") * 60 + get("minute"),
  };
}
