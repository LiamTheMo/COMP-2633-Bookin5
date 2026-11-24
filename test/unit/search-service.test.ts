import { describe, expect, it } from "vitest";
import { SearchService } from "../../src/search/search-service.js";
import type { RoomAvailability, RoomSource } from "../../src/domain/types.js";

const NOW = new Date("2026-11-23T13:00:00Z"); // early morning in Edmonton (06:00 or 07:00: Alberta's offset depends on the installed tz data)

const POWER = { accessible: false, power: true, videoConferencing: false };
const ALL = { accessible: true, power: true, videoConferencing: true };
const NONE = { accessible: false, power: false, videoConferencing: false };

// Synthetic rooms. Times in minutes: 13:00=780, 14:00=840, 15:00=900, 16:00=960,
// 17:00=1020, 20:00=1200, 24:00=1440.
const fixtures: RoomAvailability[] = [
  {
    room: { id: 1, name: "A group room", grouping: "Group Rooms - 1st Floor", capacity: 4, features: POWER },
    free: [
      { start: 900, end: 960 }, // 15:00-16:00
      { start: 1200, end: 1440 }, // 20:00-24:00
    ],
  },
  {
    room: { id: 2, name: "B group room", grouping: "Group Rooms - 2nd & 3rd Floor", capacity: 6, features: POWER },
    free: [{ start: 840, end: 1020 }], // 14:00-17:00
  },
  {
    room: { id: 3, name: "C hybrid room", grouping: "Hybrid Group Rooms", capacity: 10, features: ALL },
    free: [{ start: 900, end: 1020 }], // 15:00-17:00
  },
  {
    room: { id: 4, name: "Pod 1", grouping: "Individual Study Pods", capacity: 1, features: POWER },
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
    // Room 1 is also free 20:00-24:00, but a matched room is never repeated as an alternative.
    expect(result.nextAvailable).toEqual([]);
  });

  it("offers other rooms as alternatives alongside matches", async () => {
    const extra: RoomAvailability = {
      room: { id: 5, name: "E group room", grouping: "Group Rooms", capacity: 4, features: NONE },
      free: [{ start: 960, end: 1080 }], // 16:00-18:00
    };
    const result = await serviceWith([...fixtures, extra]).findRooms({
      date: "2026-11-23",
      start: "15:00",
      end: "16:00",
      partySize: 3,
    });
    expect(result.matches.map((m) => m.room.id)).toEqual([1, 2, 3]);
    expect(result.nextAvailable.map((o) => [o.start, o.room.id])).toEqual([["16:00", 5]]);
  });

  it("finds a free gap of the duration inside a wider window, earliest start first (FR3, FR5)", async () => {
    // Week 1 example: "4 people, 1-5 pm, 2 h" (party of 3 here so room 1 qualifies by size).
    const result = await serviceWith(fixtures).findRooms({
      date: "2026-11-23",
      start: "13:00",
      end: "17:00",
      durationMinutes: 120,
      partySize: 3,
    });
    // Room 1 only has a 1 h gap in the window; room 2 fits from 14:00, room 3 from 15:00.
    expect(result.matches.map((m) => [m.room.id, m.start, m.end])).toEqual([
      [2, "14:00", "16:00"],
      [3, "15:00", "17:00"],
    ]);
    // Room 1's 20:00 gap is outside the window, so it is an alternative.
    expect(result.nextAvailable.map((o) => [o.room.id, o.start, o.end])).toEqual([[1, "20:00", "22:00"]]);
  });

  it("queries a booking-length window at every start in the window, then two hours past it", async () => {
    const calls: [number, number][] = [];
    const source: RoomSource = {
      getAvailability: async (_date, start, end) => {
        calls.push([start, end]);
        return [];
      },
    };
    const service = new SearchService(source, undefined, () => NOW);
    await service.findRooms({ date: "2026-11-23", start: "13:00", end: "17:00", durationMinutes: 120, partySize: 2 });
    // Starts 13:00..15:00 fit the window; 15:30..17:00 are the look-ahead.
    expect(calls.map(([s]) => s)).toEqual([780, 810, 840, 870, 900, 930, 960, 990, 1020]);
    expect(calls.every(([s, e]) => e - s === 120)).toBe(true);
  });

  it("also queries the same-length window at every slot in the next two hours", async () => {
    const calls: [number, number][] = [];
    const source: RoomSource = {
      getAvailability: async (_date, start, end) => {
        calls.push([start, end]);
        return [];
      },
    };
    const service = new SearchService(source, undefined, () => NOW);
    await service.findRooms({ date: "2026-11-23", start: "14:00", end: "15:00", partySize: 2 });
    expect(calls).toEqual([
      [840, 900],
      [870, 930],
      [900, 960],
      [930, 990],
      [960, 1020],
    ]);

    calls.length = 0;
    await service.findRooms({ date: "2026-11-23", start: "22:30", end: "23:30", partySize: 2 });
    expect(calls).toEqual([
      [1350, 1410],
      [1380, 1440],
    ]); // never past midnight
  });

  it("offers rooms that only show up in a later window", async () => {
    const later: RoomAvailability = {
      room: { id: 9, name: "Z group room", grouping: "Group Rooms", capacity: 5, features: NONE },
      free: [{ start: 960, end: 1020 }],
    };
    const source: RoomSource = { getAvailability: async (_d, start) => (start === 960 ? [later] : []) };
    const result = await new SearchService(source, undefined, () => NOW).findRooms({
      date: "2026-11-23",
      start: "14:00",
      end: "15:00",
      partySize: 3,
    });
    expect(result.matches).toEqual([]);
    expect(result.nextAvailable).toEqual([{ room: later.room, start: "16:00", end: "17:00" }]);
  });

  it("filters by category, case-insensitively", async () => {
    const result = await serviceWith(fixtures).findRooms({
      date: "2026-11-23",
      start: "15:00",
      end: "16:00",
      partySize: 3,
      category: "hybrid group rooms",
    });
    expect(result.matches.map((m) => m.room.id)).toEqual([3]);
  });

  it("returns only rooms with every requested feature; false means either", async () => {
    const find = (f: { accessible?: boolean; power?: boolean; videoConferencing?: boolean }) =>
      serviceWith(fixtures).findRooms({ date: "2026-11-23", start: "15:00", end: "16:00", partySize: 3, ...f });
    expect((await find({ videoConferencing: true })).matches.map((m) => m.room.id)).toEqual([3]);
    expect((await find({ power: true, accessible: true })).matches.map((m) => m.room.id)).toEqual([3]);
    expect((await find({ power: true, accessible: false })).matches.map((m) => m.room.id)).toEqual([1, 2, 3]);
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

  it("suggests the times closest to the requested start, not the earliest of the day", async () => {
    // Nothing fits 18:00-19:00. B can do 16:00 (2h away), A 20:00 (2h) or 15:00 (3h).
    const result = await serviceWith(fixtures).findRooms({
      date: "2026-11-23",
      start: "18:00",
      end: "19:00",
      partySize: 3,
    });
    expect(result.nextAvailable.map((o) => [o.start, o.end, o.room.id])).toEqual([
      ["16:00", "17:00", 2],
      ["20:00", "21:00", 1],
      ["15:00", "16:00", 1],
    ]);
  });

  it("never suggests a time that has already passed today", async () => {
    const rooms: RoomAvailability[] = [
      {
        room: { id: 1, name: "A group room", grouping: "Group Rooms", capacity: 4, features: NONE },
        free: [
          { start: 840, end: 900 }, // 14:00-15:00, already past
          { start: 1200, end: 1260 }, // 20:00-21:00
        ],
      },
    ];
    const afternoon = new Date("2026-11-23T21:40:00Z"); // mid-afternoon in Edmonton (14:40 or 15:40)
    const service = new SearchService({ getAvailability: async () => rooms }, undefined, () => afternoon);
    const result = await service.findRooms({ date: "2026-11-23", start: "16:00", end: "17:00", partySize: 2 });
    expect(result.nextAvailable.map((o) => o.start)).toEqual(["20:00"]);
  });

  it("suggests the nearest fitting times when nothing matches", async () => {
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
