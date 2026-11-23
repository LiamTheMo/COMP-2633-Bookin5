import { LibraryUnavailableError } from "../../domain/errors.js";
import { addDays } from "../../domain/time.js";

export interface LibCalClientOptions {
  /** Site origin, e.g. https://librarycal.mtroyal.ca */
  baseUrl: string;
  /** LibCal location id for MRU Library group rooms (lid=1140). */
  locationId: number;
  /** Sent on every request so the library can identify this client. Contains no personal data. */
  userAgent: string;
  timeoutMs: number;
  /** Minimum gap between requests, so the adapter never hammers the site. */
  minIntervalMs: number;
}

export const DEFAULT_LIBCAL_OPTIONS: LibCalClientOptions = {
  baseUrl: "https://librarycal.mtroyal.ca",
  locationId: 1140,
  userAgent: "mru-room-booking-mcp/0.1 (read-only availability client)",
  timeoutMs: 10_000,
  minIntervalMs: 500,
};

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * Low-level HTTP access to LibCal. Read-only: this client never books or cancels.
 * Every request is serialised, spaced by minIntervalMs, and times out.
 */
export class LibCalClient {
  private chain: Promise<unknown> = Promise.resolve();
  private lastRequestAt: number | undefined;

  constructor(
    private readonly options: LibCalClientOptions = DEFAULT_LIBCAL_OPTIONS,
    private readonly fetchImpl: FetchLike = (input, init) => fetch(input, init),
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** Raw JSON of the availability grid for one date (all rooms at this location). */
  async fetchGrid(date: string): Promise<unknown> {
    const body = new URLSearchParams({
      lid: String(this.options.locationId),
      gid: "0",
      eid: "-1",
      seat: "0",
      seatId: "0",
      zone: "0",
      start: date,
      end: addDays(date, 1),
      pageIndex: "0",
      pageSize: "18",
    });
    const text = await this.request(`${this.options.baseUrl}/spaces/availability/grid`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        // LibCal rejects grid requests that do not look like they come from its own search page.
        Referer: `${this.options.baseUrl}/spaces?lid=${this.options.locationId}&date=${date}`,
        Origin: this.options.baseUrl,
      },
      body: body.toString(),
    });
    try {
      return JSON.parse(text) as unknown;
    } catch (cause) {
      throw new LibraryUnavailableError("Availability grid returned non-JSON content", { cause });
    }
  }

  /** HTML of one room's detail page. */
  async fetchRoomPage(roomId: number, date: string): Promise<string> {
    return this.request(`${this.options.baseUrl}/space/${roomId}?date=${date}`, {
      method: "GET",
      headers: { Accept: "text/html" },
    });
  }

  private request(url: string, init: RequestInit): Promise<string> {
    const run = async (): Promise<string> => {
      await this.pace();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
      try {
        const response = await this.fetchImpl(url, {
          ...init,
          signal: controller.signal,
          headers: { "User-Agent": this.options.userAgent, ...(init.headers as Record<string, string>) },
        });
        if (!response.ok) {
          throw new LibraryUnavailableError(`LibCal responded ${response.status} for ${new URL(url).pathname}`);
        }
        return await response.text();
      } catch (cause) {
        if (cause instanceof LibraryUnavailableError) throw cause;
        const reason = controller.signal.aborted ? "timed out" : "could not be reached";
        throw new LibraryUnavailableError(`LibCal ${reason}`, { cause });
      } finally {
        clearTimeout(timer);
      }
    };
    // Chain requests so they run one after another.
    const next = this.chain.then(run, run);
    this.chain = next.catch(() => undefined);
    return next;
  }

  private async pace(): Promise<void> {
    if (this.lastRequestAt !== undefined) {
      const wait = this.lastRequestAt + this.options.minIntervalMs - this.now();
      if (wait > 0) await this.sleep(wait);
    }
    this.lastRequestAt = this.now();
  }
}

