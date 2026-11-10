// South African business hours (SAST = UTC+2, no daylight saving) and public holidays.
import { config } from "./config";

const SAST_OFFSET_MS = 2 * 3600_000;

/** Returns a Date whose UTC fields read as SAST wall-clock time. */
export function toSast(d: Date): Date {
  return new Date(d.getTime() + SAST_OFFSET_MS);
}

export function sastString(d: Date = new Date()): string {
  const s = toSast(d);
  return `${s.toISOString().slice(0, 10)} ${s.toISOString().slice(11, 16)}`;
}

function easterSunday(year: number): Date {
  // Anonymous Gregorian algorithm.
  const a = year % 19, b = Math.floor(year / 100), c = year % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** SA public holidays for a year (Public Holidays Act: a Sunday holiday moves to Monday). */
export function saHolidays(year: number): Map<string, string> {
  const fixed: [number, number, string][] = [
    [1, 1, "New Year's Day"], [3, 21, "Human Rights Day"], [4, 27, "Freedom Day"], [5, 1, "Workers' Day"],
    [6, 16, "Youth Day"], [8, 9, "National Women's Day"], [9, 24, "Heritage Day"], [12, 16, "Day of Reconciliation"],
    [12, 25, "Christmas Day"], [12, 26, "Day of Goodwill"],
  ];
  const out = new Map<string, string>();
  for (const [m, d, name] of fixed) {
    const date = new Date(Date.UTC(year, m - 1, d));
    out.set(iso(date), name);
    if (date.getUTCDay() === 0) out.set(iso(new Date(date.getTime() + 86400_000)), `${name} (observed)`);
  }
  const easter = easterSunday(year);
  out.set(iso(new Date(easter.getTime() - 2 * 86400_000)), "Good Friday");
  out.set(iso(new Date(easter.getTime() + 86400_000)), "Family Day");
  for (const extra of config.extraHolidays) if (extra.startsWith(String(year))) out.set(extra, "Declared holiday");
  return out;
}

export function holidayName(d: Date = new Date()): string | null {
  const s = toSast(d);
  return saHolidays(s.getUTCFullYear()).get(iso(s)) ?? null;
}

/** Mon–Fri 08:00–17:00 SAST, excluding public holidays. `endBufferMin` keeps calls from starting at 16:59. */
export function isBusinessHours(d: Date = new Date(), endBufferMin = 0): boolean {
  const s = toSast(d);
  const day = s.getUTCDay();
  if (day === 0 || day === 6) return false;
  if (holidayName(d)) return false;
  const minutes = s.getUTCHours() * 60 + s.getUTCMinutes();
  return minutes >= 8 * 60 && minutes < 17 * 60 - endBufferMin;
}

/** Next moment (UTC Date) that is inside business hours, starting from `from`. */
export function nextBusinessWindow(from: Date = new Date(), endBufferMin = 15): Date {
  if (isBusinessHours(from, endBufferMin)) return from;
  let s = toSast(from);
  for (let i = 0; i < 20; i++) {
    const minutes = s.getUTCHours() * 60 + s.getUTCMinutes();
    // Jump to 08:00 today if before opening, else 08:00 next day.
    const target = new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), s.getUTCDate(), 8, 0));
    if (minutes >= 8 * 60) target.setUTCDate(target.getUTCDate() + 1);
    const utc = new Date(target.getTime() - SAST_OFFSET_MS);
    if (isBusinessHours(utc, endBufferMin)) return utc;
    s = target;
  }
  return new Date(from.getTime() + 86400_000);
}

/** ISO timestamp of the most recent SAST midnight. */
export function sastDayStartIso(at: Date = new Date()): string {
  const s = toSast(at);
  return new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), s.getUTCDate()) - SAST_OFFSET_MS).toISOString();
}

/** 08:00 SAST on the next calendar day. */
export function tomorrowMorning(at: Date = new Date()): Date {
  return new Date(new Date(sastDayStartIso(at)).getTime() + 32 * 3600_000);
}
