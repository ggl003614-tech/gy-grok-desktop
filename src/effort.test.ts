import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  displayEffortLabel,
  effortStage,
  effortWorldKey,
  isExtraHighEffort,
  sortEfforts,
} from "./effort";
import { t } from "./i18n";

const root = dirname(fileURLToPath(import.meta.url));

describe("effort slider order and labels", () => {
  it("sorts extra high to the far end and keeps the official Extra high label", () => {
    const ordered = sortEfforts([
      { value: "xhigh", label: "Extra high" },
      { value: "low", label: "Low" },
      { value: "high", label: "High" },
    ]);
    expect(ordered.map((item) => item.value)).toEqual(["low", "high", "xhigh"]);
    expect(isExtraHighEffort(ordered[2])).toBe(true);
    expect(displayEffortLabel(ordered[2])).toBe("Extra high");
    expect(effortStage(ordered[2])).toBe("xhigh");
  });

  it("maps official stages to asteroid / earth / star / black hole", () => {
    expect(effortWorldKey("low")).toBe("world.low");
    expect(effortWorldKey("xhigh")).toBe("world.xhigh");
    expect(t("world.xhigh")).toBe("黑洞");
    expect(t("world.xhigh")).not.toMatch(/吞噬|token/i);
  });

  it("paints a following world knob that becomes earth, sun, then a black hole", () => {
    const source = readFileSync(join(root, "EffortSlider.tsx"), "utf8");
    expect(source).toMatch(/displayEffortLabel/);
    expect(source).toMatch(/effort-world/);
    expect(source).toMatch(/effort-hole/);
    expect(source).toMatch(/effort-hole-rim/);
    expect(source).toMatch(/effort-orbit-dust/);
    expect(source).toMatch(/effort-field-dust/);
    expect(source).toMatch(/grok-mark\.png/);
    expect(source).toMatch(/effort-particles/);
    expect(source).toMatch(/effort-track-warp/);
    expect(source).not.toMatch(/effort-grok-spin/);
    expect(source).not.toMatch(/effort-hole-suck/);
    expect(source).not.toMatch(/black-hole\.jpg/);
    expect(source).not.toMatch(/effort-singularity/);
    expect(source).toMatch(/springTo/);
    expect(source).toMatch(/clientWidth/);
    expect(source).not.toMatch(/Rocket/);
    expect(source).not.toMatch(/X\. High effort/);
  });
});
