import { LibraryUnavailableError } from "../../domain/errors.js";

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

  /**
   * HTML of the space search page for one window: every bookable space free
   * for [start, end), plus LibCal's nearest alternatives. `start`/`end` are
   * HH:mm; an end of "24:00" means midnight. All groupings and sizes are
   * requested (gid=0, capacity=0); filtering happens in the search service.
   */
  async fetchSearchPage(date: string, start: string, end: string): Promise<string> {
    const query = new URLSearchParams({
      m: "t",
      lid: String(this.options.locationId),
      gid: "0",
      capacity: "0",
      date,
      "date-end": date,
      start,
      end,
    });
    return this.request(`${this.options.baseUrl}/spaces?${query}`, {
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
      if (wait > 0) await this.sleep(Math.min(wait, this.options.minIntervalMs));
    }
    this.lastRequestAt = this.now();
  }
}

