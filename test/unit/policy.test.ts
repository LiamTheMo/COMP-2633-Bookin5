import { describe, expect, it } from "vitest";
import { DEFAULT_SEARCH_POLICY, validateSearch } from "../../src/search/policy.js";
import { PolicyViolationError } from "../../src/domain/errors.js";

// 2026-11-23, early morning in Edmonton (06:00 or 07:00: Alberta's offset depends on the installed tz data).
const NOW = new Date("2026-11-23T13:00:00Z");

const base = { date: "2026-11-23", start: "14:00", end: "15:00", partySize: 3 };

function rejects(overrides: Partial<typeof base>, pattern: RegExp): void {
  expect(() => validateSearch({ ...base, ...overrides }, DEFAULT_SEARCH_POLICY, NOW)).toThrow(PolicyViolationError);
  expect(() => validateSearch({ ...base, ...overrides }, DEFAULT_SEARCH_POLICY, NOW)).toThrow(pattern);
}

describe("validateSearch", () => {
  it("accepts a valid request and returns minutes", () => {
    expect(validateSearch(base, DEFAULT_SEARCH_POLICY, NOW)).toEqual({
      date: "2026-11-23",
      startMin: 840,
      endMin: 900,
      durationMin: 60,
      partySize: 3,
      category: undefined,
      needs: [],
    });
  });

  it("normalises a category and collects required features", () => {
    const v = validateSearch(
      { ...base, category: " group rooms - 1st floor ", accessible: true, power: false, videoConferencing: true },
      DEFAULT_SEARCH_POLICY,
      NOW,
    );
    expect(v.category).toBe("Group Rooms - 1st Floor");
    expect(v.needs).toEqual(["accessible", "videoConferencing"]);
  });

  it("rejects an unknown category and lists the valid ones", () => {
    expect(() => validateSearch({ ...base, category: "Pods" }, DEFAULT_SEARCH_POLICY, NOW)).toThrow(
      /Unknown category "Pods"\. Choose one of: Group Rooms - 1st Floor, Group Rooms - 2nd & 3rd Floor, Hybrid Group Rooms/,
    );
  });

  it("rejects a feature filter that is not true or false", () => {
    expect(() =>
      validateSearch({ ...base, power: "yes" as unknown as boolean }, DEFAULT_SEARCH_POLICY, NOW),
    ).toThrow(/power must be true or false/);
  });

  it("rejects an impossible date", () => {
    rejects({ date: "2026-02-30" }, /not a valid/);
  });

  it("rejects a time that is not HH:mm", () => {
    rejects({ start: "2pm" }, /HH:mm/);
  });

  it("rejects times that are not on a 30-minute boundary", () => {
    rejects({ start: "14:15" }, /30-minute boundary/);
  });

  it("rejects an end before the start", () => {
    rejects({ start: "15:00", end: "14:00" }, /after the start/);
  });

  it("rejects a booking shorter than the minimum", () => {
    const policy = { ...DEFAULT_SEARCH_POLICY, minDurationMinutes: 60 };
    expect(() => validateSearch({ ...base, start: "14:00", end: "14:30" }, policy, NOW)).toThrow(/at least 60 minutes/);
  });

  it("accepts a window ending at midnight written as 24:00", () => {
    expect(validateSearch({ ...base, start: "23:00", end: "24:00" }, DEFAULT_SEARCH_POLICY, NOW).endMin).toBe(1440);
  });

  it("rejects a booking longer than the maximum", () => {
    rejects({ start: "10:00", end: "13:00" }, /at most 120 minutes/);
  });

  it("rejects a party size below one or not a whole number", () => {
    rejects({ partySize: 0 }, /at least 1/);
    rejects({ partySize: 2.5 }, /whole number/);
  });

  it("rejects a past date", () => {
    rejects({ date: "2026-11-22" }, /in the past/);
  });

  it("rejects a date beyond the booking horizon", () => {
    rejects({ date: "2026-12-01" }, /up to 7 days ahead/);
  });

  it("treats start-end as a window when a duration is given (FR3)", () => {
    const v = validateSearch({ ...base, start: "13:00", end: "17:00", durationMinutes: 120 }, DEFAULT_SEARCH_POLICY, NOW);
    expect(v).toMatchObject({ startMin: 780, endMin: 1020, durationMin: 120 });
  });

  it("caps the duration, not the window, when a duration is given (FR7)", () => {
    const req = { ...base, start: "13:00", end: "18:00" };
    expect(() => validateSearch({ ...req, durationMinutes: 300 }, DEFAULT_SEARCH_POLICY, NOW)).toThrow(/at most 120 minutes/);
  });

  it("rejects a duration that does not fit the window or the slot grid", () => {
    expect(() => validateSearch({ ...base, durationMinutes: 90 }, DEFAULT_SEARCH_POLICY, NOW)).toThrow(/does not fit/);
    expect(() => validateSearch({ ...base, end: "17:00", durationMinutes: 45 }, DEFAULT_SEARCH_POLICY, NOW)).toThrow(
      /30-minute slots/,
    );
  });

  it("accepts the last day of the 7-day horizon (NFR6)", () => {
    expect(validateSearch({ ...base, date: "2026-11-30" }, DEFAULT_SEARCH_POLICY, NOW).date).toBe("2026-11-30");
  });

  it("rejects a start time that has already passed today", () => {
    // NOW is 06:00 or 07:00 locally, so 05:30 has passed either way.
    rejects({ date: "2026-11-23", start: "05:30", end: "06:30" }, /already passed/);
  });

  it("accepts a start later today", () => {
    expect(() => validateSearch({ ...base, start: "08:00", end: "09:00" }, DEFAULT_SEARCH_POLICY, NOW)).not.toThrow();
  });
});
