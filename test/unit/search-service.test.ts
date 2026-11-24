import { describe, expect, it } from "vitest";
import { SearchService } from "../../src/search/search-service.js";
import type { RoomAvailability, RoomSource } from "../../src/domain/types.js";

const NOW = new Date("2026-11-23T13:00:00Z"); // 06:00 Edmonton

// Synthetic rooms. Times in minutes: 13:00=780, 14:00=840, 15:00=900, 16:00=960,
// 17:00=1020, 20:00=1200, 24:00=1440.
const fixtures: RoomAvailability[] = [
  {
    room: { id: 1, name: "A group room", grouping: "Group Rooms - 1st Floor", capacity: 4 },
    free: [
      { start: 900, end: 960 }, // 15:00-16:00
      { start: 1200, end: 1440 }, // 20:00-24:00
    ],
  },
  {
    room: { id: 2, name: "B group room", grouping: "Group Rooms - 2nd & 3rd Floor", capacity: 6 },
    free: [{ start: 840, end: 1020 }], // 14:00-17:00
  },
  {
    room: { id: 3, name: "C hybrid room", grouping: "Hybrid Group Rooms", capacity: 10 },
    free: [{ start: 900, end: 1020 }], // 15:00-17:00
  },
  {
    room: { id: 4, name: "Pod 1", grouping: "Individual Study Pods", capacity: 1 },
    free: [{ start: 840, end: 1440 }],
  },
];

function serviceWith(rooms: RoomAvailability[]): SearchService {
  const source: RoomSource = { getAvailability: async () => rooms };
  return new SearchService(source, undefined, () => NOW);
}

describe("SearchService.findRooms", () => {
  it("returns rooms free for the whole window, smallest suitable capacity first", async () => {
    const result = await serviceWith(fixtures).findRooms({
      date: "2026-11-23",
      start: "15:00",
      end: "16:00",
      partySize: 3,
    });
    expect(result.matches.map((m) => m.room.id)).toEqual([1, 2, 3]);
    expect(result.matches[0]).toEqual({ room: fixtures[0]!.room, start: "15:00", end: "16:00" });
    expect(result.nextAvailable).toEqual([]);
  });

  it("filters out rooms that cannot seat the party", async () => {
    const result = await serviceWith(fixtures).findRooms({
      date: "2026-11-23",
      start: "15:00",
      end: "16:00",
      partySize: 5,
    });
    expect(result.matches.map((m) => m.room.id)).toEqual([2, 3]);
  });

  it("never returns individual study pods", async () => {
    const result = await serviceWith(fixtures).findRooms({
      date: "2026-11-23",
      start: "15:00",
      end: "16:00",
      partySize: 1,
    });
    expect(result.matches.map((m) => m.room.id)).not.toContain(4);
  });

  it("requires the room to be free for the whole requested window", async () => {
    // Room 1 is free 15:00-16:00 only, so a 15:00-17:00 request must not match it.
    const result = await serviceWith(fixtures).findRooms({
      date: "2026-11-23",
      start: "15:00",
      end: "17:00",
      partySize: 3,
    });
    expect(result.matches.map((m) => m.room.id)).toEqual([2, 3]);
  });

  it("suggests the earliest fitting times when nothing matches", async () => {
    // Nothing is free 13:00-14:00 (room B opens at 14:00).
    const result = await serviceWith(fixtures).findRooms({
      date: "2026-11-23",
      start: "13:00",
      end: "14:00",
      partySize: 3,
    });
    expect(result.matches).toEqual([]);
    expect(result.nextAvailable.map((o) => [o.start, o.end, o.room.id])).toEqual([
      ["14:00", "15:00", 2],
      ["15:00", "16:00", 1], // room 3 also fits at 15:00 but is dropped: one offer per start time
      ["20:00", "21:00", 1],
    ]);
  });

  it("returns empty results for a date with no rooms", async () => {
    const result = await serviceWith([]).findRooms({
      date: "2026-11-23",
      start: "15:00",
      end: "16:00",
      partySize: 2,
    });
    expect(result).toEqual({ date: "2026-11-23", partySize: 2, matches: [], nextAvailable: [] });
  });

  it("does not call the room source when the request fails validation", async () => {
    let called = false;
    const source: RoomSource = {
      getAvailability: async () => {
        called = true;
        return [];
      },
    };
    const service = new SearchService(source, undefined, () => NOW);
    await expect(
      service.findRooms({ date: "2026-11-23", start: "15:10", end: "16:00", partySize: 2 }),
    ).rejects.toThrow(/30-minute boundary/);
    expect(called).toBe(false);
  });
});
