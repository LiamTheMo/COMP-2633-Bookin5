import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LibCalClient, type LibCalClientOptions } from "../../src/adapter/libcal/client.js";
import { LibCalRoomSource } from "../../src/adapter/libcal/libcal-room-source.js";
import { LibraryUnavailableError } from "../../src/domain/errors.js";
import { SearchService } from "../../src/search/search-service.js";

const searchHtml = readFileSync(new URL("../fixtures/search-2026-11-24-1400.html", import.meta.url), "utf8");

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

describe("LibCalClient", () => {
  it("requests the search page for the window with every grouping and size", async () => {
    const f = fakeFetch(() => new Response(searchHtml, { status: 200 }));
    const client = new LibCalClient(options, f.fetch, noSleep, () => 0);
    await client.fetchSearchPage("2026-11-24", "14:00", "24:00");

    const [call] = f.calls;
    const url = new URL(call!.url);
    expect(url.origin + url.pathname).toBe("https://librarycal.example/spaces");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      m: "t",
      lid: "1140",
      gid: "0",
      capacity: "0",
      date: "2026-11-24",
      "date-end": "2026-11-24",
      start: "14:00",
      end: "24:00",
    });
    expect(call!.init.method).toBe("GET");
    expect((call!.init.headers as Record<string, string>)["User-Agent"]).toBe("test-agent");
  });

  it("maps an HTTP error status to LibraryUnavailableError", async () => {
    const f = fakeFetch(() => new Response("oops", { status: 500 }));
    const client = new LibCalClient(options, f.fetch, noSleep, () => 0);
    await expect(client.fetchSearchPage("2026-11-24", "14:00", "15:00")).rejects.toBeInstanceOf(LibraryUnavailableError);
  });

  it("maps a network failure to LibraryUnavailableError", async () => {
    const f = fakeFetch(() => {
      throw new TypeError("fetch failed");
    });
    const client = new LibCalClient(options, f.fetch, noSleep, () => 0);
    await expect(client.fetchSearchPage("2026-11-24", "14:00", "15:00")).rejects.toMatchObject({
      code: "LIBRARY_UNAVAILABLE",
    });
  });

  it("aborts a request that exceeds the timeout", async () => {
    const f = fakeFetch(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        }),
    );
    const client = new LibCalClient({ ...options, timeoutMs: 20 }, f.fetch, noSleep, () => 0);
    await expect(client.fetchSearchPage("2026-11-24", "14:00", "15:00")).rejects.toThrow(/timed out/);
  });

  it("spaces consecutive requests by minIntervalMs", async () => {
    let clock = 0;
    const sleeps: number[] = [];
    const sleep = async (ms: number): Promise<void> => {
      sleeps.push(ms);
      clock += ms;
    };
    const f = fakeFetch(() => new Response(searchHtml, { status: 200 }));
    const client = new LibCalClient({ ...options, minIntervalMs: 500 }, f.fetch, sleep, () => clock);
    await client.fetchSearchPage("2026-11-24", "14:00", "15:00");
    await client.fetchSearchPage("2026-11-24", "15:00", "16:00");
    expect(f.calls).toHaveLength(2);
    expect(sleeps).toEqual([500]);
  });

  it("never sleeps longer than minIntervalMs, even if the clock steps backwards", async () => {
    let clock = 3_600_000;
    const sleeps: number[] = [];
    const f = fakeFetch(() => new Response(searchHtml, { status: 200 }));
    const client = new LibCalClient(
      { ...options, minIntervalMs: 500 },
      f.fetch,
      async (ms) => void sleeps.push(ms),
      () => clock,
    );
    await client.fetchSearchPage("2026-11-24", "14:00", "15:00");
    clock = 0;
    await client.fetchSearchPage("2026-11-24", "15:00", "16:00");
    expect(sleeps).toEqual([500]);
  });
});

describe("LibCalRoomSource", () => {
  it("answers a search with one live request and no caching", async () => {
    const f = fakeFetch(() => new Response(searchHtml, { status: 200 }));
    const source = new LibCalRoomSource(new LibCalClient(options, f.fetch, noSleep, () => 0));
    const rooms = await source.getAvailability("2026-11-24", 840, 900);
    await source.getAvailability("2026-11-24", 840, 900);

    expect(f.calls).toHaveLength(2);
    expect(new URL(f.calls[0]!.url).searchParams.get("start")).toBe("14:00");
    expect(new URL(f.calls[0]!.url).searchParams.get("end")).toBe("15:00");
    expect(rooms.find((r) => r.room.id === 7572)?.free).toEqual([{ start: 870, end: 930 }]);
  });

  it("drives the search service end to end: only pods free at 14:00, so it suggests 2-C at 14:30", async () => {
    const f = fakeFetch(() => new Response(searchHtml, { status: 200 }));
    const source = new LibCalRoomSource(new LibCalClient(options, f.fetch, noSleep, () => 0));
    const search = new SearchService(source, undefined, () => new Date("2026-11-24T15:00:00Z")); // morning in Edmonton
    const result = await search.findRooms({ date: "2026-11-24", start: "14:00", end: "15:00", partySize: 3 });

    expect(result.matches).toEqual([]);
    expect(result.nextAvailable[0]).toMatchObject({ room: { id: 7572 }, start: "14:30", end: "15:30" });
  });
});
