import test from "node:test";
import assert from "node:assert/strict";
import { buildAddonRuntimeConfig, DEFAULT_ADDON_OPTIONS } from "../src/addonMain.js";

test("buildAddonRuntimeConfig maps default add-on options to internal runtime settings", () => {
  const config = buildAddonRuntimeConfig(DEFAULT_ADDON_OPTIONS, "test-options.json");

  assert.equal(config.homeassistant_url, "http://homeassistant:8123");
  assert.equal(config.access_token, "");
  assert.equal(config.listen_addr, "0.0.0.0:10111");
  assert.equal(config.transparent, true);
  assert.deepEqual(config.rules, []);
  assert.deepEqual(config.dashboards, []);
});

test("buildAddonRuntimeConfig preserves dashboards and rules", () => {
  const config = buildAddonRuntimeConfig({
    dashboards: ["dashboard-kiosk"],
    rules: [
      {
        name: "deny cameras",
        match_type: "regex",
        match: "^camera\\.",
        action: "deny",
      },
    ],
  }, "test-options.json");

  assert.deepEqual(config.dashboards, ["dashboard-kiosk"]);
  assert.equal(config.rules.length, 1);
  assert.equal(config.rules[0].name, "deny cameras");
});

test("buildAddonRuntimeConfig validates add-on options through normalizeConfig", () => {
  assert.throws(
    () => buildAddonRuntimeConfig({ default_action: "maybe" }, "test-options.json"),
    /default_action must be "allow" or "deny"/,
  );
});
