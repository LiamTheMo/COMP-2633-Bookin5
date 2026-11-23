import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LibCalClient, type LibCalClientOptions } from "../../src/adapter/libcal/client.js";
import { LibCalRoomSource } from "../../src/adapter/libcal/libcal-room-source.js";
import { LibraryUnavailableError } from "../../src/domain/errors.js";

const gridJson = readFileSync(new URL("../fixtures/grid-2026-11-23.json", import.meta.url), "utf8");
const spacePageHtml = readFileSync(new URL("../fixtures/space-7561.html", import.meta.url), "utf8");

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

/** Fake fetch that records calls and answers from a router. */
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
  it("posts the grid query with the Referer and Origin LibCal expects", async () => {
    const f = fakeFetch(() => new Response(gridJson, { status: 200 }));
    const client = new LibCalClient(options, f.fetch, noSleep, () => 0);
    await client.fetchGrid("2026-11-23");

    const [call] = f.calls;
    expect(call!.url).toBe("https://librarycal.example/spaces/availability/grid");
    expect(call!.init.method).toBe("POST");
    const headers = call!.init.headers as Record<string, string>;
    expect(headers.Referer).toContain("/spaces");
    expect(headers.Origin).toBe("https://librarycal.example");
    expect(headers["User-Agent"]).toBe("test-agent");

    const body = new URLSearchParams(call!.init.body as string);
    expect(body.get("lid")).toBe("1140");
    expect(body.get("start")).toBe("2026-11-23");
    expect(body.get("end")).toBe("2026-11-24");
  });

  it("maps an HTTP error status to LibraryUnavailableError", async () => {
    const f = fakeFetch(() => new Response("oops", { status: 500 }));
    const client = new LibCalClient(options, f.fetch, noSleep, () => 0);
    await expect(client.fetchGrid("2026-11-23")).rejects.toBeInstanceOf(LibraryUnavailableError);
  });

  it("maps a network failure to LibraryUnavailableError", async () => {
    const f = fakeFetch(() => {
      throw new TypeError("fetch failed");
    });
    const client = new LibCalClient(options, f.fetch, noSleep, () => 0);
    await expect(client.fetchGrid("2026-11-23")).rejects.toMatchObject({ code: "LIBRARY_UNAVAILABLE" });
  });

  it("aborts a request that exceeds the timeout", async () => {
    const f = fakeFetch(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        }),
    );
    const client = new LibCalClient({ ...options, timeoutMs: 20 }, f.fetch, noSleep, () => 0);
    await expect(client.fetchGrid("2026-11-23")).rejects.toThrow(/timed out/);
  });

  it("rejects non-JSON grid responses", async () => {
    const f = fakeFetch(() => new Response("<html>Maintenance</html>", { status: 200 }));
    const client = new LibCalClient(options, f.fetch, noSleep, () => 0);
    await expect(client.fetchGrid("2026-11-23")).rejects.toBeInstanceOf(LibraryUnavailableError);
  });

  it("spaces consecutive requests by minIntervalMs", async () => {
    let clock = 0;
    const sleeps: number[] = [];
    const sleep = async (ms: number): Promise<void> => {
      sleeps.push(ms);
      clock += ms;
    };
    const f = fakeFetch(() => new Response(gridJson, { status: 200 }));
    const client = new LibCalClient({ ...options, minIntervalMs: 500 }, f.fetch, sleep, () => clock);
    await client.fetchGrid("2026-11-23");
    await client.fetchRoomPage(7561, "2026-11-23");
    expect(f.calls).toHaveLength(2);
    expect(sleeps).toEqual([500]);
  });
});

describe("LibCalRoomSource", () => {
  /** Serves the captured grid, and a room page for any requested room id. */
  function libraryFake(): ReturnType<typeof fakeFetch> {
    return fakeFetch((url) => {
      if (url.includes("/spaces/availability/grid")) return new Response(gridJson, { status: 200 });
      const m = /\/space\/(\d+)/.exec(url);
      if (m) {
        // The captured page is for room 7561; rewrite its id for other rooms.
        return new Response(spacePageHtml.replaceAll("eid_7561", `eid_${m[1]}`), { status: 200 });
      }
      return new Response("not found", { status: 404 });
    });
  }

  it("leaves out rooms the library has switched off", async () => {
    const off = readFileSync(new URL("../fixtures/space-7587-unavailable.html", import.meta.url), "utf8");
    const f = fakeFetch((url) => {
      if (url.includes("/spaces/availability/grid")) return new Response(gridJson, { status: 200 });
      if (url.endsWith("/space/7587?date=2026-11-23")) return new Response(off, { status: 200 });
      const m = /\/space\/(\d+)/.exec(url)!;
      return new Response(spacePageHtml.replaceAll("eid_7561", `eid_${m[1]}`), { status: 200 });
    });
    const source = new LibCalRoomSource(new LibCalClient(options, f.fetch, noSleep, () => 0));
    const rooms = await source.getAvailability("2026-11-23");
    expect(rooms).toHaveLength(44);
    expect(rooms.some((r) => r.room.id === 7587)).toBe(false);
  });

  it("returns every room in the grid with its free windows and details", async () => {
    const f = libraryFake();
    const source = new LibCalRoomSource(new LibCalClient(options, f.fetch, noSleep, () => 0));
    const rooms = await source.getAvailability("2026-11-23");

    expect(rooms).toHaveLength(45);
    const oneB = rooms.find((r) => r.room.id === 7561)!;
    expect(oneB.room).toEqual({
      id: 7561,
      name: "1-B group room (1st floor, EL1136)",
      grouping: "Group Rooms - 1st Floor",
      capacity: 5,
    });
    expect(oneB.free).toEqual([
      { start: 900, end: 960 },
      { start: 1200, end: 1440 },
    ]);
  });

  it("reuses cached room details instead of re-reading room pages", async () => {
    const f = libraryFake();
    const source = new LibCalRoomSource(new LibCalClient(options, f.fetch, noSleep, () => 0), {
      roomCacheMs: 60_000,
    }, () => 0);
    await source.getAvailability("2026-11-23");
    const firstPageCalls = f.calls.filter((c) => c.url.includes("/space/")).length;
    await source.getAvailability("2026-11-23");
    const secondPageCalls = f.calls.filter((c) => c.url.includes("/space/")).length;

    expect(firstPageCalls).toBe(45);
    expect(secondPageCalls).toBe(45);
  });

  it("re-reads room details once the cache is stale", async () => {
    let clock = 0;
    const f = libraryFake();
    const source = new LibCalRoomSource(
      new LibCalClient(options, f.fetch, noSleep, () => 0),
      { roomCacheMs: 1000 },
      () => clock,
    );
    await source.getAvailability("2026-11-23");
    clock = 5000;
    await source.getAvailability("2026-11-23");
    expect(f.calls.filter((c) => c.url.includes("/space/")).length).toBe(90);
  });
});
