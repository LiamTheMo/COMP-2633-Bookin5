import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseSearchPage } from "../../src/adapter/libcal/parse.js";
import { LibraryFormatError } from "../../src/domain/errors.js";

// Captured from the live search page for Tuesday 2026-11-24.
// 14:00-15:00: one pod (Pod 8) free for the whole window, plus "next available" alternatives.
const afternoon = readFileSync(new URL("../fixtures/search-2026-11-24-1400.html", import.meta.url), "utf8");
// 20:00-21:00: "best matches" only, no alternatives section.
const evening = readFileSync(new URL("../fixtures/search-2026-11-24-2000.html", import.meta.url), "utf8");

const DATE = "2026-11-24";

describe("parseSearchPage", () => {
  it("reads room details and the offered window from each result", () => {
    const rooms = parseSearchPage(afternoon, DATE);
    expect(rooms.find((r) => r.room.id === 7586)).toEqual({
      room: {
        id: 7586,
        name: "2-Q group room (2nd floor, EL2407)",
        grouping: "Group Rooms - 2nd & 3rd Floor",
        capacity: 5,
        features: { accessible: false, power: true, videoConferencing: false },
      },
      free: [{ start: 960, end: 1020 }], // next available 16:00-17:00
    });
  });

  it("reads amenities from the result icons", () => {
    const rooms = parseSearchPage(afternoon, DATE);
    expect(rooms.find((r) => r.room.id === 33379)!.room.features).toEqual({ accessible: true, power: true, videoConferencing: false });
    expect(rooms.find((r) => r.room.id === 35064)!.room.features).toEqual({ accessible: false, power: false, videoConferencing: false });
    // No video-conferencing room was free in the capture, so swap one icon title in.
    const vc = afternoon.replaceAll('title="Accessible Seat/Space"', 'title="Video Conferencing"');
    expect(parseSearchPage(vc, DATE).find((r) => r.room.id === 33379)!.room.features).toEqual({
      accessible: false,
      power: true,
      videoConferencing: true,
    });
  });

  it("includes both full matches and alternatives", () => {
    const rooms = parseSearchPage(afternoon, DATE);
    const pod8 = rooms.find((r) => r.room.id === 33317)!;
    expect(pod8.room).toMatchObject({ name: "Pod 8", grouping: "Individual Study Pods", capacity: 1 });
    expect(pod8.free).toEqual([{ start: 840, end: 900 }]);
    expect(rooms.length).toBeGreaterThan(3);
  });

  it("returns well-formed windows for every room", () => {
    for (const html of [afternoon, evening]) {
      for (const { room, free } of parseSearchPage(html, DATE)) {
        expect(room.name.length).toBeGreaterThan(0);
        expect(room.grouping).not.toMatch(/&amp;|<|\s$/);
        expect(room.capacity).toBeGreaterThan(0);
        for (const w of free) expect(w.end).toBeGreaterThan(w.start);
      }
    }
  });

  it("parses a page with no alternatives section", () => {
    const rooms = parseSearchPage(evening, DATE);
    expect(rooms.length).toBeGreaterThan(0);
    for (const { free } of rooms) expect(free).toContainEqual({ start: 1200, end: 1260 });
  });

  it("treats an end on the next day as midnight (1440)", () => {
    const html = afternoon
      .replaceAll('value="2026-11-24 14:00:00"', 'value="2026-11-24 23:00:00"')
      .replaceAll('value="2026-11-24 15:00:00"', 'value="2026-11-25 00:00:00"');
    expect(parseSearchPage(html, DATE).find((r) => r.room.id === 33317)!.free).toEqual([{ start: 1380, end: 1440 }]);
  });

  it("returns no rooms when the results section is empty", () => {
    expect(parseSearchPage('<div id="s-lc-eq-search-results"><h2>No matches</h2></div>', DATE)).toEqual([]);
  });

  it("throws LibraryFormatError when the page has no results section", () => {
    expect(() => parseSearchPage("<html>Maintenance</html>", DATE)).toThrow(LibraryFormatError);
  });

  it("throws LibraryFormatError when a result is missing a field", () => {
    const broken = afternoon.replaceAll('title="The capacity of this space"', 'title="x"');
    expect(() => parseSearchPage(broken, DATE)).toThrow(/missing its capacity/);
  });
});
