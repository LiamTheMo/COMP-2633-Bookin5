import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadSettings, saveSettings } from "../../src/settings.js";

const tempFile = () => join(mkdtempSync(join(tmpdir(), "bookin5-")), "nested", "settings.json");

describe("settings", () => {
  it("defaults to no party size and no favourites when there is no file", async () => {
    expect(await loadSettings(tempFile())).toEqual({ favouriteRoomIds: [] });
  });

  it("saves, merges and reloads preferences", async () => {
    const path = tempFile();
    await saveSettings({ defaultPartySize: 4 }, path);
    await saveSettings({ favouriteRoomIds: [7561, 7575] }, path);
    expect(await loadSettings(path)).toEqual({ defaultPartySize: 4, favouriteRoomIds: [7561, 7575] });
  });

  it("drops invalid values and reports a corrupt file", async () => {
    const path = tempFile();
    await saveSettings({}, path);
    writeFileSync(path, JSON.stringify({ defaultPartySize: -1, favouriteRoomIds: [1, "x"], password: "no" }));
    expect(await loadSettings(path)).toEqual({ favouriteRoomIds: [1] });
    writeFileSync(path, "{oops");
    await expect(loadSettings(path)).rejects.toThrow(/not valid JSON/);
  });
});
