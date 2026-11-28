import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LibCalClient, type LibCalClientOptions } from "../../src/adapter/libcal/client.js";
import { LibCalRoomSource } from "../../src/adapter/libcal/libcal-room-source.js";
import { LibraryUnavailableError } from "../../src/domain/errors.js";
import { SearchService } from "../../src/search/search-service.js";

const grid = readFileSync(new URL("../fixtures/grid-2026-11-30.json", import.meta.url), "utf8");
const pod9 = readFileSync(new URL("../fixtures/space-33379.html", import.meta.url), "utf8");

const options: LibCalClientOptions = {
  baseUrl: "https://librarycal.example",
  locationId: 1140,
  userAgent: "test-agent",
  timeoutMs: 1000,
  minIntervalMs: 0,
};

const noSleep = async (): Promise<void> => undefined;

interface Call {
  url: string;
  init: RequestInit;
}

function fakeFetch(route: (url: string, init: RequestInit) => Response | Promise<Response>): {
  fetch: (input: string, init?: RequestInit) => Promise<Response>;
  calls: Call[];
} {
  const calls: Call[] = [];
  return {
    calls,
    fetch: async (input, init = {}) => {
      calls.push({ url: input, init });
      return route(input, init);
    },
  };
}

const ok = (body: string) => () => new Response(body, { status: 200 });

describe("LibCalClient", () => {
  it("posts the grid request for every space with the referrer the site requires", async () => {
    const f = fakeFetch(ok(grid));
    const client = new LibCalClient(options, f.fetch, noSleep, () => 0);
    await client.fetchGrid("2026-11-30", "2026-12-01");

    const [call] = f.calls;
    expect(call!.url).toBe("https://librarycal.example/spaces/availability/grid");
    expect(call!.init.method).toBe("POST");
    expect(Object.fromEntries(call!.init.body as URLSearchParams)).toMatchObject({
      lid: "1140",
      gid: "0",
      eid: "-1",
      start: "2026-11-30",
      end: "2026-12-01",
    });
    const headers = call!.init.headers as Record<string, string>;
    expect(headers["User-Agent"]).toBe("test-agent");
    expect(headers.Referer).toBe("https://librarycal.example/spaces?lid=1140");
    expect(headers.Origin).toBe("https://librarycal.example");
  });

  it("builds the Book Now link for a room and date", () => {
    const client = new LibCalClient(options);
    expect(client.bookingUrl(7561, "2026-11-30")).toBe("https://librarycal.example/space/7561?date=2026-11-30");
  });

  it("maps an HTTP error status to LibraryUnavailableError", async () => {
    const f = fakeFetch(() => new Response("oops", { status: 500 }));
    const client = new LibCalClient(options, f.fetch, noSleep, () => 0);
    await expect(client.fetchGrid("2026-11-30", "2026-12-01")).rejects.toBeInstanceOf(LibraryUnavailableError);
  });

  it("maps a network failure (site blocked or down) to LibraryUnavailableError", async () => {
    const f = fakeFetch(() => {
      throw new TypeError("fetch failed");
    });
    const client = new LibCalClient(options, f.fetch, noSleep, () => 0);
    await expect(client.fetchGrid("2026-11-30", "2026-12-01")).rejects.toMatchObject({ code: "LIBRARY_UNAVAILABLE" });
  });

  it("aborts a request that exceeds the timeout", async () => {
    const f = fakeFetch(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        }),
    );
    const client = new LibCalClient({ ...options, timeoutMs: 20 }, f.fetch, noSleep, () => 0);
    await expect(client.fetchGrid("2026-11-30", "2026-12-01")).rejects.toThrow(/timed out/);
  });

  it("spaces consecutive requests by minIntervalMs", async () => {
    let clock = 0;
    const sleeps: number[] = [];
    const sleep = async (ms: number): Promise<void> => {
      sleeps.push(ms);
      clock += ms;
    };
    const f = fakeFetch(ok(grid));
    const client = new LibCalClient({ ...options, minIntervalMs: 1000 }, f.fetch, sleep, () => clock);
    await client.fetchGrid("2026-11-30", "2026-12-01");
    await client.fetchSpacePage(7561);
    expect(f.calls).toHaveLength(2);
    expect(sleeps).toEqual([1000]);
  });

  it("never sleeps longer than minIntervalMs, even if the clock steps backwards", async () => {
    let clock = 3_600_000;
    const sleeps: number[] = [];
    const f = fakeFetch(ok(grid));
    const client = new LibCalClient({ ...options, minIntervalMs: 500 }, f.fetch, async (ms) => void sleeps.push(ms), () => clock);
    await client.fetchGrid("2026-11-30", "2026-12-01");
    clock = 0;
    await client.fetchGrid("2026-11-30", "2026-12-01");
    expect(sleeps).toEqual([500]);
  });
});

describe("LibCalRoomSource", () => {
  it("answers a day from one grid read, reused for a minute, with snapshot room details", async () => {
    let now = 0;
    const f = fakeFetch(ok(grid));
    const source = new LibCalRoomSource(new LibCalClient(options, f.fetch, noSleep, () => 0), () => now);
    const rooms = await source.getAvailability("2026-11-30");
    await source.getAvailability("2026-11-30");
    expect(f.calls).toHaveLength(1);

    // 7587 is temporarily unavailable on the site, so it is skipped without a page read.
    expect(rooms.map((r) => r.room.id)).toEqual([7561, 7575]);
    expect(rooms[0]!.room.name).toBe("1-B group room (1st floor, EL1136)");
    expect(rooms[1]!.open).toEqual([{ start: 480, end: 1260 }]);

    now = 60_000;
    await source.getAvailability("2026-11-30");
    expect(f.calls).toHaveLength(2);
  });

  it("reads an unknown room's page once and skips rooms whose page is unreadable", async () => {
    const json = JSON.stringify({
      slots: [
        { start: "2026-11-30 10:00:00", end: "2026-11-30 10:30:00", itemId: 33379 },
        { start: "2026-11-30 10:00:00", end: "2026-11-30 10:30:00", itemId: 99999 },
      ],
    });
    const f = fakeFetch((url) => {
      if (url.endsWith("/grid")) return new Response(json);
      return new Response(url.endsWith("/space/99999") ? "temporarily unavailable" : pod9);
    });
    const source = new LibCalRoomSource(new LibCalClient(options, f.fetch, noSleep, () => 0));
    // Pod 9 is in the snapshot, so only 99999's page is read.
    const rooms = await source.getAvailability("2026-11-30");
    expect(rooms.map((r) => r.room.id)).toEqual([33379]);
    expect(f.calls.map((c) => new URL(c.url).pathname)).toEqual(["/spaces/availability/grid", "/space/99999"]);
  });

  it("does not cache a failed read", async () => {
    let fail = true;
    const f = fakeFetch(() => (fail ? new Response("down", { status: 503 }) : new Response(grid)));
    const source = new LibCalRoomSource(new LibCalClient(options, f.fetch, noSleep, () => 0));
    await expect(source.getAvailability("2026-11-30")).rejects.toBeInstanceOf(LibraryUnavailableError);
    fail = false;
    expect(await source.getAvailability("2026-11-30")).toHaveLength(2);
  });

  it("drives the search service end to end with one request", async () => {
    const f = fakeFetch(ok(grid));
    const source = new LibCalRoomSource(new LibCalClient(options, f.fetch, noSleep, () => 0));
    const search = new SearchService(source, undefined, () => new Date("2026-11-30T15:00:00Z")); // 08:00 in Calgary
    // 1-B is free only 14:00-14:30 and 2-F only 14:30-15:00, so nothing fits 14:00-15:00;
    // the closest hour is 1-B from 18:00 (the morning gaps end at 10:00, further away).
    const result = await search.findRooms({ date: "2026-11-30", start: "14:00", end: "15:00", partySize: 3 });

    expect(f.calls).toHaveLength(1);
    expect(result.matches).toEqual([]);
    expect(result.nextAvailable[0]).toMatchObject({ room: { id: 7561 }, start: "18:00", end: "19:00" });
  });

  it("refuses a window outside the rooms' bookable hours", async () => {
    const f = fakeFetch(ok(grid));
    const source = new LibCalRoomSource(new LibCalClient(options, f.fetch, noSleep, () => 0));
    const search = new SearchService(source, undefined, () => new Date("2026-11-30T15:00:00Z"));
    await expect(
      search.findRooms({ date: "2026-11-30", start: "22:00", end: "23:00", partySize: 2, category: "Group Rooms - 2nd & 3rd Floor" }),
    ).rejects.toThrow(/bookable hours that day: 08:00-21:00/);
  });
});
