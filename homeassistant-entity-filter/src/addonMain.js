#!/usr/bin/env node
import fs from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { normalizeConfig } from "./config.js";
import { startServer } from "./server.js";

const ADDON_OPTIONS_PATH = "/data/options.json";
const SUPERVISOR_CORE_INFO_URL = "http://supervisor/core/info";
const DEFAULT_INTERNAL_HOME_ASSISTANT_URL = "http://homeassistant:8123";
const INTERNAL_HOME_ASSISTANT_HOST = "homeassistant";
const INTERNAL_LISTEN_ADDR = "0.0.0.0:10111";
const SUPERVISOR_WEBSOCKET_URL = "ws://supervisor/core/websocket";

export const DEFAULT_ADDON_OPTIONS = Object.freeze({
  transparent: true,
  bootstrap_timeout_ms: 5000,
  bootstrap_cache_ttl_ms: 300000,
  warn_entity_updates_over_per_minute: 2,
  default_action: "allow",
  required_entities: [],
  dashboards: [],
  rules: [],
});

export async function loadAddonOptions(path = ADDON_OPTIONS_PATH) {
  const rawText = await fs.readFile(path, "utf8");
  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch (error) {
    throw new Error(`${path}: invalid JSON: ${error.message}`);
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${path}: options root must be an object`);
  }

  return parsed;
}

export async function resolveInternalHomeAssistantUrl(
  supervisorToken,
  {
    fetchImpl = fetch,
    supervisorCoreInfoUrl = SUPERVISOR_CORE_INFO_URL,
  } = {},
) {
  if (!supervisorToken) {
    throw new Error(
      "SUPERVISOR_TOKEN is not available; add-on startup must run through /usr/bin/with-contenv so Supervisor API credentials are preserved",
    );
  }

  const response = await fetchImpl(supervisorCoreInfoUrl, {
    headers: {
      Authorization: `Bearer ${supervisorToken}`,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(
      `failed to query Home Assistant Core info from Supervisor: HTTP ${response.status}`,
    );
  }

  const payload = await response.json();
  const coreInfo = payload?.data;
  const port = coreInfo?.port;
  const ssl = coreInfo?.ssl;

  if (!Number.isInteger(port) || port <= 0 || typeof ssl !== "boolean") {
    throw new Error("Supervisor returned invalid Home Assistant Core connection details");
  }

  const protocol = ssl ? "https" : "http";
  return `${protocol}://${INTERNAL_HOME_ASSISTANT_HOST}:${port}`;
}

export function buildAddonRuntimeConfig(
  options = {},
  {
    homeAssistantUrl = DEFAULT_INTERNAL_HOME_ASSISTANT_URL,
    source = ADDON_OPTIONS_PATH,
  } = {},
) {
  return normalizeConfig(
    {
      ...DEFAULT_ADDON_OPTIONS,
      ...options,
      homeassistant_url: homeAssistantUrl,
      access_token: "",
      listen_addr: INTERNAL_LISTEN_ADDR,
    },
    source,
  );
}

export async function main() {
  const options = await loadAddonOptions();
  const supervisorToken = process.env.SUPERVISOR_TOKEN || null;
  const homeAssistantUrl = await resolveInternalHomeAssistantUrl(supervisorToken);
  const config = buildAddonRuntimeConfig(options, { homeAssistantUrl });
  await startServer(config, {
    logger: console,
    bootstrapAccessToken: supervisorToken,
    bootstrapWebSocketUrl: SUPERVISOR_WEBSOCKET_URL,
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
