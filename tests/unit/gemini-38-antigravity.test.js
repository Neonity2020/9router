import { afterEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { getModelUpstreamId, getDefaultModel } from "../../open-sse/config/providerModels.js";
import { AntigravityExecutor } from "../../open-sse/executors/antigravity.js";
import { applyThinking, stripThinkingSuffix } from "../../open-sse/translator/concerns/thinkingUnified.js";
import ag from "../../open-sse/providers/registry/antigravity.js";
import { MODEL_PRICING } from "../../open-sse/providers/pricing.js";
import { MITM_TOOLS } from "../../src/shared/constants/cliTools.js";

const require = createRequire(import.meta.url);
const mitmConfig = require("../../src/mitm/config.js");
const here = dirname(fileURLToPath(import.meta.url));

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Gemini 3.8 Antigravity tiers", () => {
  it.each(["high", "medium", "low"])(
    "maps the %s tier to the shared upstream model with matching thinking level",
    (tier) => {
      const publicModel = `gemini-3.8-flash-${tier}`;
      const upstreamModel = getModelUpstreamId("ag", publicModel);
      const body = {
        model: stripThinkingSuffix(upstreamModel),
        request: {
          contents: [{ role: "user", parts: [{ text: "hello" }] }],
          generationConfig: {},
        },
      };

      applyThinking("antigravity", upstreamModel, body, "antigravity");
      const finalBody = new AntigravityExecutor().transformRequest(
        publicModel,
        body,
        true,
        { projectId: "project", connectionId: "connection" }
      );

      expect(upstreamModel).toBe(`gemini-3.8-flash-tiered(${tier})`);
      expect(finalBody.model).toBe("gemini-3.8-flash-tiered");
      expect(finalBody.request.generationConfig.thinkingConfig).toEqual({
        thinkingLevel: tier,
        includeThoughts: true,
      });
    }
  );

  it("registers the 3.8 tiers ahead of 3.7 in the antigravity registry (newest first)", () => {
    expect(ag.models[0].id).toBe("gemini-3.8-flash-high");
    expect(getDefaultModel("ag")).toBe("gemini-3.8-flash-high");
  });
});

describe("Gemini 3.8 MITM model extraction", () => {
  it.each(["high", "medium", "low"])("extracts the %s thinking tier for gemini-3.8-flash-tiered", (tier) => {
    const body = Buffer.from(JSON.stringify({
      request: { generationConfig: { thinkingConfig: { thinkingLevel: tier } } },
    }));

    expect(mitmConfig.extractModel(
      "/v1internal/models/gemini-3.8-flash-tiered:streamGenerateContent",
      body
    )).toBe(`gemini-3.8-flash-${tier}`);
  });

  it("defaults invalid or missing thinking levels to medium", () => {
    const body = Buffer.from(JSON.stringify({
      request: { generationConfig: { thinkingConfig: { thinkingLevel: "unknown" } } },
    }));

    expect(mitmConfig.extractModel(
      "/v1internal/models/gemini-3.8-flash-tiered:streamGenerateContent",
      body
    )).toBe("gemini-3.8-flash-medium");
  });

  it("resolves the extracted tier through the synonym map", () => {
    expect(mitmConfig.MODEL_SYNONYMS.antigravity["gemini-3.8-flash-high"]).toBe("gemini-3.8-flash-high");
    expect(mitmConfig.MODEL_SYNONYMS.antigravity["gemini-3.8-flash-low"]).toBe("gemini-3.8-flash-low");
  });
});

describe("Gemini 3.8 MITM tools and catalog", () => {
  it("includes gemini-3.8-flash tiers in MITM_TOOLS defaultModels", () => {
    const defaultModelIds = MITM_TOOLS.antigravity.defaultModels.map((m) => m.id);
    expect(defaultModelIds).toContain("gemini-3.8-flash-high");
    expect(defaultModelIds).toContain("gemini-3.8-flash-medium");
    expect(defaultModelIds).toContain("gemini-3.8-flash-low");
  });

  it("exposes pricing for the 3.8 tiers", () => {
    expect(MODEL_PRICING["gemini-3.8-flash"]).toMatchObject({ input: 1.5, output: 7.5 });
    expect(MODEL_PRICING["gemini-3.8-flash-high"]).toBeDefined();
    expect(MODEL_PRICING["gemini-3.8-flash-medium"]).toBeDefined();
    expect(MODEL_PRICING["gemini-3.8-flash-low"]).toBeDefined();
  });

  it("keeps the standalone CLI Antigravity catalog synchronized", () => {
    const source = readFileSync(join(here, "../../cli/src/cli/menus/providers.js"), "utf8");
    const agCatalog = source.match(/\n  ag: \[([\s\S]*?)\n  \],/)?.[1] || "";

    expect(agCatalog).toContain("gemini-3.8-flash-high");
    expect(agCatalog).toContain("gemini-3.8-flash-medium");
    expect(agCatalog).toContain("gemini-3.8-flash-low");
  });
});
