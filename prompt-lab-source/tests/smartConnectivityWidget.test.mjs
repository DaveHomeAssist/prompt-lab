import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { buildLeadPayload, initialWidgetState, resolveRecommendation } from "../public/widgets/smart-connectivity-finder/widget.js";

const matrix = JSON.parse(
  await readFile(new URL("../public/widgets/smart-connectivity-finder/logicMatrix.json", import.meta.url), "utf8")
);

test("resolves the heavy duty modular recommendation from the matrix", () => {
  const recommendation = resolveRecommendation(
    {
      industry: "automation",
      bottleneck: "downtime",
      environment: "vibration_harsh",
      media: "hybrid"
    },
    matrix
  );

  assert.equal(recommendation.id, "REC_HEAVY_DUTY_MODULAR");
  assert.equal(recommendation.isFallback, false);
  assert.deepEqual(recommendation.output.sku_bundle, ["09400060311", "09140033001", "09140044501"]);
});

test("resolves the compact PCB recommendation from the matrix", () => {
  const recommendation = resolveRecommendation(
    {
      industry: "datacenters",
      bottleneck: "spatial",
      environment: "controlled",
      media: "data_signal"
    },
    matrix
  );

  assert.equal(recommendation.id, "REC_COMPACT_PCB");
  assert.equal(recommendation.isFallback, false);
  assert.deepEqual(recommendation.output.sku_bundle, ["15110162601", "15210162601"]);
});

test("falls back to engineering review when no rule matches", () => {
  const recommendation = resolveRecommendation(
    {
      industry: "transportation",
      bottleneck: "contamination",
      environment: "outdoor_liquids",
      media: "power"
    },
    matrix
  );

  assert.equal(recommendation.id, "universal-contact-eng");
  assert.equal(recommendation.isFallback, true);
  assert.deepEqual(recommendation.output.sku_bundle, ["ENG-REVIEW", "APP-CONSULT", "BOM-CHECK"]);
});

test("builds CRM hidden field payload from widget state", () => {
  const state = {
    ...structuredClone(initialWidgetState),
    selections: {
      industry: "automation",
      bottleneck: "downtime",
      environment: "vibration_harsh",
      media: "hybrid"
    }
  };
  state.resolvedRecommendation = resolveRecommendation(state.selections, matrix);

  assert.deepEqual(buildLeadPayload(state), {
    industry: "automation",
    bottleneck: "downtime",
    environment: "vibration_harsh",
    media: "hybrid",
    recommendation_id: "REC_HEAVY_DUTY_MODULAR",
    recommendation_type: "matched_bundle",
    recommendation_headline: "Modular Han-Eco® IP65 System Layout",
    sku_bundle: "09400060311,09140033001,09140044501"
  });
});
