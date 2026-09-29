import { describe, it, expect } from "vitest";
import { isBusinessHours, nextBusinessWindow, saHolidays, holidayName } from "@/lib/hours";

const sast = (s: string) => new Date(`${s}+02:00`);

describe("SA business hours", () => {
  it("knows fixed, Easter-based and Sunday-observed holidays", () => {
    const h2026 = saHolidays(2026);
    expect(h2026.get("2026-04-03")).toBe("Good Friday");
    expect(h2026.get("2026-04-06")).toBe("Family Day");
    expect(h2026.get("2026-04-28")).toBeUndefined();
    const h2027 = saHolidays(2027); // Heritage Day 2028 is a Sunday → check 2028
    expect(saHolidays(2028).get("2028-09-25")).toMatch(/observed/);
    expect(h2027.get("2027-03-26")).toBe("Good Friday");
    expect(holidayName(sast("2026-12-16T10:00:00"))).toBe("Day of Reconciliation");
  });

  it("only allows Mon–Fri 08:00–17:00 SAST outside holidays", () => {
    expect(isBusinessHours(sast("2026-09-29T09:30:00"))).toBe(true); // Tuesday
    expect(isBusinessHours(sast("2026-09-29T07:59:00"))).toBe(false);
    expect(isBusinessHours(sast("2026-09-29T17:00:00"))).toBe(false);
    expect(isBusinessHours(sast("2026-10-03T10:00:00"))).toBe(false); // Saturday
    expect(isBusinessHours(sast("2026-09-24T10:00:00"))).toBe(false); // Heritage Day
  });

  it("finds the next call window", () => {
    // Friday 16:50 → Monday 08:00
    expect(nextBusinessWindow(sast("2026-10-02T16:50:00")).toISOString()).toBe(sast("2026-10-05T08:00:00").toISOString());
    // Wednesday before Heritage Day... Thursday 24 Sep is a holiday → Friday 08:00
    expect(nextBusinessWindow(sast("2026-09-23T18:00:00")).toISOString()).toBe(sast("2026-09-25T08:00:00").toISOString());
    // Inside hours → unchanged
    const t = sast("2026-09-29T10:00:00");
    expect(nextBusinessWindow(t)).toBe(t);
  });
});
