import { describe, expect, it } from "vitest";
import { LibCalClient, DEFAULT_LIBCAL_OPTIONS } from "../../src/adapter/libcal/client.js";
import { LibCalRoomSource } from "../../src/adapter/libcal/libcal-room-source.js";
import { SearchService } from "../../src/search/search-service.js";
import { addDays, localNow, LOCAL_TIMEZONE } from "../../src/domain/time.js";

/*
 * Read-only checks against the real MRU LibCal site. Skipped unless LIVE=1.
 * Reads the public availability grid; never books or cancels.
 */
const live = process.env.LIVE === "1";

describe.skipIf(!live)("live: MRU LibCal read-only", () => {
  const client = new LibCalClient(DEFAULT_LIBCAL_OPTIONS);
  const source = new LibCalRoomSource(client);
  const tomorrow = addDays(localNow(new Date(), LOCAL_TIMEZONE).date, 1);

  it("reads every room's hours and free windows from the grid", async () => {
    const rooms = await source.getAvailability(tomorrow);
    expect(rooms.length).toBeGreaterThan(20);
    // 23:00-24:00 is the quietest hour, so some 24-hour room should be free.
    expect(rooms.some(({ free }) => free.some((w) => w.start <= 1380 && w.end === 1440))).toBe(true);
    for (const { room, free, open } of rooms) {
      expect(open!.length).toBeGreaterThan(0);
      expect(room.name.length).toBeGreaterThan(0);
      expect(room.capacity).toBeGreaterThan(0);
      expect(room.grouping.length).toBeGreaterThan(0);
      for (const w of free) expect(w.end).toBeGreaterThan(w.start);
    }
  }, 30_000);

  it("finds group rooms through the search service", async () => {
    const search = new SearchService(source);
    const result = await search.findRooms({ date: tomorrow, start: "18:00", end: "19:00", partySize: 2 });
    // Either rooms match or alternatives are offered; a full library at 18:00 would be unusual.
    expect(result.date).toBe(tomorrow);
    expect(result.matches.length + result.nextAvailable.length).toBeGreaterThan(0);
    for (const m of [...result.matches, ...result.nextAvailable]) expect(m.room.capacity).toBeGreaterThanOrEqual(2);
  }, 30_000);
});
