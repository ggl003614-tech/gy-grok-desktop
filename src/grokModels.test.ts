import { describe, expect, it } from "vitest";
import {
  agentProcessStartOptions,
  grokModelDisplayName,
  mergeModelCatalog,
  parseGrokModelsList,
  resolvePreferredSessionModel,
} from "./grokModels";

const GROK_MODELS_OUTPUT = `You are logged in with grok.com.

Default model: grok-4.6

Available models:
  * grok-4.6 (default)
  - grok-4.5
`;

describe("grok models catalog", () => {
  it("parses the CLI default and every advertised model", () => {
    expect(parseGrokModelsList(GROK_MODELS_OUTPUT)).toEqual({
      defaultModelId: "grok-4.6",
      modelIds: ["grok-4.6", "grok-4.5"],
    });
  });

  it("never pins --model when starting the ACP process", () => {
    expect(
      agentProcessStartOptions("C:\\repo", {
        alwaysApprove: true,
        permissionMode: "auto",
        debug: true,
      }),
    ).toEqual({
      cwd: "C:\\repo",
      alwaysApprove: true,
      permissionMode: "auto",
      debug: true,
    });
    expect(agentProcessStartOptions("C:\\repo")).not.toHaveProperty("model");
    expect(agentProcessStartOptions("C:\\repo")).not.toHaveProperty("reasoningEffort");
  });

  it("keeps a leftover 4.5 preference only when 4.6 is still in the catalog", () => {
    expect(
      resolvePreferredSessionModel("grok-4.5", ["grok-4.6", "grok-4.5"], "grok-4.6"),
    ).toBe("grok-4.5");
    expect(resolvePreferredSessionModel("grok-4.5", ["grok-4.6"], "grok-4.6")).toBeUndefined();
    expect(resolvePreferredSessionModel("", ["grok-4.6"], "grok-4.6")).toBeUndefined();
  });

  it("fills ACP-only catalogs with the CLI model list", () => {
    const merged = mergeModelCatalog(
      [
        {
          modelId: "grok-4.6",
          name: "Grok 4.6",
          supportsReasoningEffort: true,
          reasoningEfforts: [{ id: "high", value: "high", label: "High", isDefault: true }],
        },
      ],
      ["grok-4.6", "grok-4.5"],
    );
    expect(merged.map((model) => model.modelId)).toEqual(["grok-4.6", "grok-4.5"]);
    expect(merged[0]?.supportsReasoningEffort).toBe(true);
    expect(merged[1]).toMatchObject({
      modelId: "grok-4.5",
      name: grokModelDisplayName("grok-4.5"),
    });
  });
});
