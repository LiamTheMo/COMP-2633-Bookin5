import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseGrid, parseSpacePage } from "../../src/adapter/libcal/parse.js";
import { LibraryFormatError } from "../../src/domain/errors.js";

const grid = JSON.parse(readFileSync(new URL("../fixtures/grid-2026-11-23.json", import.meta.url), "utf8"));
const spacePage = readFileSync(new URL("../fixtures/space-7561.html", import.meta.url), "utf8");

describe("parseGrid", () => {
  it("turns taken and free 30-minute slots into merged free windows", () => {
    // Captured 2026-11-23 for room 7561 (1-B). Live search showed it free 15:00-16:00
    // and from 20:00 on, which matches these windows.
    const windows = parseGrid(grid, "2026-11-23");
    expect(windows.get(7561)).toEqual([
      { start: 900, end: 960 },
      { start: 1200, end: 1440 },
    ]);
  });

  it("returns only windows that are sorted, non-overlapping and inside the day", () => {
    const windows = parseGrid(grid, "2026-11-23");
    expect(windows.size).toBe(45);
    for (const list of windows.values()) {
      for (let i = 0; i < list.length; i++) {
        const w = list[i]!;
        expect(w.start).toBeGreaterThanOrEqual(0);
        expect(w.end).toBeLessThanOrEqual(1440);
        expect(w.end).toBeGreaterThan(w.start);
        if (i > 0) expect(w.start).toBeGreaterThan(list[i - 1]!.end);
      }
    }
  });

  it("ignores slots that belong to a different date", () => {
    const windows = parseGrid(grid, "2026-11-24");
    expect(windows.size).toBe(0);
  });

  it("rejects a response without a slots list", () => {
    expect(() => parseGrid({ nope: true }, "2026-11-23")).toThrow(LibraryFormatError);
  });

  it("rejects an unexpected timestamp format", () => {
    const bad = { slots: [{ start: "23/11/2026 14:00", end: "2026-11-23 14:30:00", itemId: 1 }] };
    expect(() => parseGrid(bad, "2026-11-23")).toThrow(LibraryFormatError);
  });
});

describe("parseSpacePage", () => {
  it("reads name, grouping and capacity from a room page", () => {
    expect(parseSpacePage(spacePage, 7561)).toEqual({
      id: 7561,
      name: "1-B group room (1st floor, EL1136)",
      grouping: "Group Rooms - 1st Floor",
      capacity: 5,
    });
  });

  it("rejects a page that describes a different room", () => {
    expect(() => parseSpacePage(spacePage, 9999)).toThrow(LibraryFormatError);
  });

  it("returns null for a room the library has switched off", () => {
    const off = readFileSync(new URL("../fixtures/space-7587-unavailable.html", import.meta.url), "utf8");
    expect(parseSpacePage(off, 7587)).toBeNull();
  });

  it("returns null for a listed id whose page is LibCal's not-found page", () => {
    const notFound = '<html><h1 id="errorcode"><i></i> 404</h1></html>';
    expect(parseSpacePage(notFound, 35502)).toBeNull();
  });

  it("rejects a page with no room object", () => {
    expect(() => parseSpacePage("<html><body>Maintenance</body></html>", 7561)).toThrow(LibraryFormatError);
  });
});
