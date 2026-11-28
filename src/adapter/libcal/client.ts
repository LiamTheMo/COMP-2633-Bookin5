import { LibraryUnavailableError } from "../../domain/errors.js";

export interface LibCalClientOptions {
  /** Site origin, e.g. https://librarycal.mtroyal.ca */
  baseUrl: string;
  locationId: number;
  userAgent: string;
  timeoutMs: number;
  minIntervalMs: number;
}

export const DEFAULT_LIBCAL_OPTIONS: LibCalClientOptions = {
  baseUrl: "https://librarycal.mtroyal.ca",
  locationId: 1140,
  userAgent: "mru-room-booking-mcp/0.1 (read-only availability client)",
  timeoutMs: 10_000,
  minIntervalMs: 1000,
};

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Read-only HTTP access to LibCal. Requests are serialised, spaced by minIntervalMs, and time out. */
export class LibCalClient {
  private chain: Promise<unknown> = Promise.resolve();
  private lastRequestAt: number | undefined;

  constructor(
    private readonly options: LibCalClientOptions = DEFAULT_LIBCAL_OPTIONS,
    private readonly fetchImpl: FetchLike = (input, init) => fetch(input, init),
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** Availability grid JSON for every space from `startDate` up to (not including) `endDate`. */
  async fetchGrid(startDate: string, endDate: string): Promise<string> {
    const body = new URLSearchParams({
      lid: String(this.options.locationId),
      gid: "0",
      eid: "-1",
      seat: "0",
      seatId: "0",
      zone: "0",
      start: startDate,
      end: endDate,
      pageIndex: "0",
      pageSize: "500",
    });
    return this.request(`${this.options.baseUrl}/spaces/availability/grid`, {
      method: "POST",
      body,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
        // LibCal answers "Invalid Referrer." without these.
        Referer: `${this.options.baseUrl}/spaces?lid=${this.options.locationId}`,
        Origin: this.options.baseUrl,
      },
    });
  }

  async fetchSpacePage(eid: number): Promise<string> {
    return this.request(this.bookingUrl(eid), { method: "GET", headers: { Accept: "text/html" } });
  }

  bookingUrl(eid: number, date?: string): string {
    return `${this.options.baseUrl}/space/${eid}${date ? `?date=${date}` : ""}`;
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

