import { describe, expect, it } from "vitest";
import { DEFAULT_SEARCH_POLICY, validateSearch } from "../../src/search/policy.js";
import { PolicyViolationError } from "../../src/domain/errors.js";

// 2026-11-23 06:00 in Edmonton (MST, UTC-7).
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
      partySize: 3,
    });
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
    rejects({ start: "14:00", end: "14:00" }, /after the start/);
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
    rejects({ date: "2026-12-10" }, /up to 14 days ahead/);
  });

  it("rejects a start time that has already passed today", () => {
    // NOW is 06:00 locally, so 05:30 has passed.
    rejects({ date: "2026-11-23", start: "05:30", end: "06:30" }, /already passed/);
  });

  it("accepts a start later today", () => {
    expect(() => validateSearch({ ...base, start: "07:00", end: "08:00" }, DEFAULT_SEARCH_POLICY, NOW)).not.toThrow();
  });
});
