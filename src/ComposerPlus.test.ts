import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { COMPOSER_PLUS_ITEMS } from "./ComposerPlus";
import { PERMISSION_MODES } from "./permissionModes";
import { CATALOG_CONNECTORS, OFFICIAL_CONNECTORS_URL } from "./connectors";

const root = dirname(fileURLToPath(import.meta.url));

describe("composer plus menu", () => {
  it("ships the Claude-style plus actions", () => {
    expect(COMPOSER_PLUS_ITEMS.map((item) => item.id)).toEqual([
      "files",
      "folder",
      "screenshot",
      "check",
      "connectors",
    ]);
  });

  it("ships every CLI permission mode on the visible control list", () => {
    expect(PERMISSION_MODES.map((mode) => mode.id).sort()).toEqual(
      ["acceptEdits", "auto", "bypassPermissions", "default", "dontAsk", "plan"].sort(),
    );
  });

  it("lists official Google connectors and HTTP catalog entries", () => {
    expect(OFFICIAL_CONNECTORS_URL).toBe("https://grok.com/connectors");
    expect(CATALOG_CONNECTORS.map((item) => item.id)).toEqual([
      "gmail",
      "google-drive",
      "github",
      "linear",
      "notion",
      "sentry",
    ]);
  });

  it("opens connectors as a dedicated page instead of a cramped submenu", () => {
    const source = readFileSync(join(root, "ComposerPlus.tsx"), "utf8");
    expect(source).toMatch(/onOpenExtensions/);
    expect(source).not.toMatch(/CATALOG_CONNECTORS/);
    expect(source).not.toMatch(/showConnectors/);
  });
});
