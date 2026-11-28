import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseGrid, parseSpacePage } from "../../src/adapter/libcal/parse.js";
import { LibraryFormatError } from "../../src/domain/errors.js";

// Captured from the live site on 2026-11-28 for Monday 2026-11-30, trimmed to three rooms:
// 7561 (1-B, open 24 h), 7575 (2-F, open 08:00-21:00), 7587 (3-A, "temporarily unavailable").
const grid = readFileSync(new URL("../fixtures/grid-2026-11-30.json", import.meta.url), "utf8");
// Pod 9's page: accessible and power filters.
const pod9 = readFileSync(new URL("../fixtures/space-33379.html", import.meta.url), "utf8");

describe("parseGrid", () => {
  it("merges free slots into windows and records bookable hours", () => {
    const rooms = parseGrid(grid, "2026-11-30");
    expect([...rooms.keys()]).toEqual([7561, 7575, 7587]);
    expect(rooms.get(7561)).toEqual({
      open: [{ start: 0, end: 1440 }],
      free: [
        { start: 0, end: 600 },
        { start: 840, end: 870 },
        { start: 1080, end: 1440 },
      ],
    });
    expect(rooms.get(7575)!.open).toEqual([{ start: 480, end: 1260 }]);
  });

  it("ignores slots on other dates", () => {
    expect(parseGrid(grid, "2026-12-01").size).toBe(0);
  });

  it("merges slots even when the site sends them out of order", () => {
    const json = JSON.stringify({
      slots: [
        { start: "2026-11-30 10:30:00", end: "2026-11-30 11:00:00", itemId: 1 },
        { start: "2026-11-30 10:00:00", end: "2026-11-30 10:30:00", itemId: 1 },
      ],
    });
    expect(parseGrid(json, "2026-11-30").get(1)!.free).toEqual([{ start: 600, end: 660 }]);
  });

  it("throws LibraryFormatError on an error page, a missing slots list or a bad slot", () => {
    expect(() => parseGrid("Invalid Referrer.", "2026-11-30")).toThrow(LibraryFormatError);
    expect(() => parseGrid("{}", "2026-11-30")).toThrow(LibraryFormatError);
    expect(() => parseGrid('{"slots":[{"start":"10:00"}]}', "2026-11-30")).toThrow(LibraryFormatError);
    expect(() => parseGrid('{"slots":[{"itemId":1,"start":"10:00","end":"10:30"}]}', "2026-11-30")).toThrow(/Unexpected time/);
  });
});

describe("parseSpacePage", () => {
  it("reads the room's name, grouping, capacity and amenities", () => {
    expect(parseSpacePage(pod9, 33379)).toEqual({
      id: 33379,
      name: "Pod 9 (Priority Seating for Accessibility)",
      grouping: "Individual Study Pods",
      capacity: 1,
      features: { accessible: true, power: true, videoConferencing: false },
    });
  });

  it("throws LibraryFormatError for a temporarily unavailable room or the wrong id", () => {
    expect(() => parseSpacePage("<div>This resource is temporarily unavailable.</div>", 7587)).toThrow(LibraryFormatError);
    expect(() => parseSpacePage(pod9, 7561)).toThrow(/no resource entry/);
  });
});
