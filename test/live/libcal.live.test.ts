import { describe, expect, it } from "vitest";
import { LibCalClient, DEFAULT_LIBCAL_OPTIONS } from "../../src/adapter/libcal/client.js";
import { LibCalRoomSource } from "../../src/adapter/libcal/libcal-room-source.js";
import { SearchService } from "../../src/search/search-service.js";
import { addDays, localNow, LOCAL_TIMEZONE } from "../../src/domain/time.js";

/*
 * Read-only checks against the real MRU LibCal site. Skipped unless LIVE=1.
 * Makes only GET and availability POSTs; never books or cancels.
 */
const live = process.env.LIVE === "1";

describe.skipIf(!live)("live: MRU LibCal read-only", () => {
  const client = new LibCalClient(DEFAULT_LIBCAL_OPTIONS);
  const source = new LibCalRoomSource(client);
  const tomorrow = addDays(localNow(new Date(), LOCAL_TIMEZONE).date, 1);

  it("reads availability for a day with group rooms and details", async () => {
    const rooms = await source.getAvailability(tomorrow);
    expect(rooms.length).toBeGreaterThan(0);
    for (const { room, free } of rooms) {
      expect(room.name.length).toBeGreaterThan(0);
      expect(room.capacity).toBeGreaterThan(0);
      expect(room.grouping.length).toBeGreaterThan(0);
      for (const w of free) expect(w.end).toBeGreaterThan(w.start);
    }
  }, 120_000);

  it("finds group rooms through the search service", async () => {
    const search = new SearchService(source);
    const result = await search.findRooms({ date: tomorrow, start: "18:00", end: "19:00", partySize: 2 });
    // The result may be empty if the library is full; just check the shape.
    expect(result.date).toBe(tomorrow);
    for (const m of result.matches) expect(m.room.capacity).toBeGreaterThanOrEqual(2);
  }, 120_000);
});
