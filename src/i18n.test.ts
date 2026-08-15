import { describe, expect, it } from "vitest";
import { I18N_KEYS, setLocale, t } from "./i18n";

describe("locale tables", () => {
  it("keeps matching keys in Chinese and English", () => {
    expect(Object.keys(I18N_KEYS.en).sort()).toEqual(Object.keys(I18N_KEYS.zh).sort());
  });

  it("switches effort world names without the swallow-tokens line", () => {
    setLocale("zh");
    expect(t("world.xhigh")).toBe("黑洞");
    expect(t("world.xhigh")).not.toMatch(/token/i);
    setLocale("en");
    expect(t("world.xhigh")).toBe("Black hole");
    expect(t("world.low")).toBe("Asteroid");
    setLocale("zh");
  });
});
