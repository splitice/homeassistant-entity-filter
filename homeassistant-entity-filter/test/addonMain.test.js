import test from "node:test";
import assert from "node:assert/strict";
import {
  buildAddonRuntimeConfig,
  DEFAULT_ADDON_OPTIONS,
  resolveInternalHomeAssistantUrl,
  resolveInternalHomeAssistantUrlFromConfig,
} from "../src/addonMain.js";

test("buildAddonRuntimeConfig maps default add-on options to internal runtime settings", () => {
  const config = buildAddonRuntimeConfig(DEFAULT_ADDON_OPTIONS);

  assert.equal(config.homeassistant_url, "http://homeassistant:8123");
  assert.equal(config.access_token, "");
  assert.equal(config.listen_addr, "0.0.0.0:10111");
  assert.equal(config.transparent, true);
  assert.deepEqual(config.rules, []);
  assert.deepEqual(config.dashboards, []);
});

test("buildAddonRuntimeConfig accepts a discovered Home Assistant URL override", () => {
  const config = buildAddonRuntimeConfig(DEFAULT_ADDON_OPTIONS, {
    homeAssistantUrl: "https://homeassistant:443",
  });

  assert.equal(config.homeassistant_url, "https://homeassistant:443");
});

test("buildAddonRuntimeConfig preserves dashboards and rules", () => {
  const config = buildAddonRuntimeConfig(
    {
      dashboards: ["dashboard-kiosk"],
      rules: [
        {
          name: "deny cameras",
          match_type: "regex",
          match: "^camera\\.",
          action: "deny",
        },
      ],
    },
    { source: "test-options.json" },
  );

  assert.deepEqual(config.dashboards, ["dashboard-kiosk"]);
  assert.equal(config.rules.length, 1);
  assert.equal(config.rules[0].name, "deny cameras");
});

test("buildAddonRuntimeConfig validates add-on options through normalizeConfig", () => {
  assert.throws(
    () => buildAddonRuntimeConfig({ default_action: "maybe" }, { source: "test-options.json" }),
    /default_action must be "allow" or "deny"/,
  );
});

test("resolveInternalHomeAssistantUrl uses supervisor core info", async () => {
  const url = await resolveInternalHomeAssistantUrl("supervisor-token", {
    fetchImpl: async (requestUrl, options) => {
      assert.equal(requestUrl, "http://supervisor/core/info");
      assert.equal(options.headers.Authorization, "Bearer supervisor-token");
      return {
        ok: true,
        async json() {
          return {
            data: {
              port: 8124,
              ssl: false,
            },
          };
        },
      };
    },
  });

  assert.equal(url, "http://homeassistant:8124");
});

test("resolveInternalHomeAssistantUrl switches to https when core ssl is enabled", async () => {
  const url = await resolveInternalHomeAssistantUrl("supervisor-token", {
    fetchImpl: async () => ({
      ok: true,
      async json() {
        return {
          data: {
            port: 443,
            ssl: true,
          },
        };
      },
    }),
  });

  assert.equal(url, "https://homeassistant:443");
});

test("resolveInternalHomeAssistantUrl rejects missing supervisor token", async () => {
  const logger = { warn() {} };
  const url = await resolveInternalHomeAssistantUrl("", {
    logger,
    readFile: async () => "http:\n  server_port: 9443\n  ssl_certificate: /ssl/fullchain.pem\n",
  });

  assert.equal(url, "https://homeassistant:9443");
});

test("resolveInternalHomeAssistantUrl falls back to the default url when config parsing fails", async () => {
  const warnings = [];
  const url = await resolveInternalHomeAssistantUrl("", {
    logger: {
      warn(message) {
        warnings.push(message);
      },
    },
    readFile: async () => {
      throw new Error("missing file");
    },
  });

  assert.equal(url, "http://homeassistant:8123");
  assert.equal(warnings.length, 2);
});

test("resolveInternalHomeAssistantUrlFromConfig uses default http settings when http is omitted", async () => {
  const url = await resolveInternalHomeAssistantUrlFromConfig({
    readFile: async () => "default_config:\n",
  });

  assert.equal(url, "http://homeassistant:8123");
});

test("resolveInternalHomeAssistantUrlFromConfig reads configured port and ssl", async () => {
  const url = await resolveInternalHomeAssistantUrlFromConfig({
    readFile: async () => "http:\n  server_port: 9443\n  ssl_certificate: /ssl/fullchain.pem\n",
  });

  assert.equal(url, "https://homeassistant:9443");
});

test("resolveInternalHomeAssistantUrlFromConfig rejects invalid yaml roots", async () => {
  await assert.rejects(
    () =>
      resolveInternalHomeAssistantUrlFromConfig({
        readFile: async () => "- not-an-object\n",
      }),
    /configuration root must be a YAML object/,
  );
});
