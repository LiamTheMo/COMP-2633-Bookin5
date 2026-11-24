import type { RoomAvailability, RoomSource } from "../../domain/types.js";
import { formatHHMM } from "../../domain/time.js";
import { LibCalClient } from "./client.js";
import { parseSearchPage } from "./parse.js";

/**
 * The library site adapter: implements RoomSource with one live read of the
 * LibCal search page per search. Read-only, and nothing is cached, so results
 * always reflect current bookings and rooms the library has switched off.
 */
export class LibCalRoomSource implements RoomSource {
  constructor(private readonly client: LibCalClient) {}

  async getAvailability(date: string, startMin: number, endMin: number): Promise<RoomAvailability[]> {
    const html = await this.client.fetchSearchPage(date, formatHHMM(startMin), formatHHMM(endMin));
    return parseSearchPage(html, date);
  }
}
