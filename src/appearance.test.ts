import { describe, expect, it } from "vitest";
import {
  colorFgBg,
  grokCliTheme,
  resolvedDeskTheme,
  xtermTheme,
} from "./appearance";

describe("appearance", () => {
  it("treats missing and light data-theme as light", () => {
    expect(resolvedDeskTheme({ dataset: {} })).toBe("light");
    expect(resolvedDeskTheme({ dataset: { theme: "light" } })).toBe("light");
    expect(resolvedDeskTheme({ dataset: { theme: "dark" } })).toBe("dark");
  });

  it("maps desk theme onto Grok CLI day/night themes", () => {
    expect(grokCliTheme("light")).toBe("grokday");
    expect(grokCliTheme("dark")).toBe("groknight");
    expect(colorFgBg("light")).toBe("0;15");
    expect(colorFgBg("dark")).toBe("15;0");
  });

  it("uses a paper background in light xterm and a dark canvas in dark mode", () => {
    expect(xtermTheme("light").background).toBe("#ffffff");
    expect(xtermTheme("light").foreground).toBe("#1c1c1a");
    expect(xtermTheme("dark").background).toBe("#111110");
    expect(xtermTheme("dark").foreground).toBe("#ededeb");
  });
});
