import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/** The student's saved preferences. Never holds credentials. */
export interface Settings {
  defaultPartySize?: number;
  favouriteRoomIds: number[];
}

/** ~/.bookin5/settings.json, or BOOKIN5_SETTINGS to put it elsewhere. */
export const SETTINGS_PATH = process.env.BOOKIN5_SETTINGS ?? join(homedir(), ".bookin5", "settings.json");

export async function loadSettings(path = SETTINGS_PATH): Promise<Settings> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return { favouriteRoomIds: [] };
  }
  try {
    const data = JSON.parse(raw) as Partial<Settings>;
    return {
      ...(Number.isInteger(data.defaultPartySize) && data.defaultPartySize! > 0 && { defaultPartySize: data.defaultPartySize }),
      favouriteRoomIds: Array.isArray(data.favouriteRoomIds) ? data.favouriteRoomIds.filter(Number.isInteger) : [],
    };
  } catch {
    throw new Error(`Settings file ${path} is not valid JSON; fix or delete it.`);
  }
}

/** Merges `changes` into the saved settings and writes them back. */
export async function saveSettings(changes: Partial<Settings>, path = SETTINGS_PATH): Promise<Settings> {
  const next = { ...(await loadSettings(path)), ...changes };
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(next, null, 2) + "\n");
  return next;
}
