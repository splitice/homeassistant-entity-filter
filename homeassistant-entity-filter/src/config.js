import fs from "node:fs/promises";
import YAML from "yaml";
import { DEFAULT_DASHBOARD_EXTRACTION_RULES } from "./dashboardEntities.js";

export const DEFAULT_CONFIG = Object.freeze({
  access_token: "",
  listen_addr: "0.0.0.0:10111",
  transparent: true,
  bootstrap_timeout_ms: 5000,
  bootstrap_cache_ttl_ms: 300000,
  warn_entity_updates_over_per_minute: 2,
  default_action: "allow",
  required_entities: [],
  dashboards: [],
  dashboard_extraction_rules: cloneDashboardExtractionRules(DEFAULT_DASHBOARD_EXTRACTION_RULES),
  rules: [],
});

/**
 * @typedef {Object} FilterRuleConfig
 * @property {string} [name]
 * @property {'exact'|'regex'} match_type
 * @property {string} match
 * @property {'allow'|'deny'} action
 * @property {number} [rate_limit_ms]
 */

/**
 * @typedef {Object} DashboardExtractionRuleConfig
 * @property {string} card_type
 * @property {'template_entities'} mode
 * @property {string[]} fields
 */

/**
 * @typedef {Object} AppConfig
 * @property {string} homeassistant_url
 * @property {string} access_token
 * @property {string} listen_addr
 * @property {boolean} transparent
 * @property {number} bootstrap_timeout_ms
 * @property {number} bootstrap_cache_ttl_ms
 * @property {number} warn_entity_updates_over_per_minute
 * @property {'allow'|'deny'} default_action
 * @property {string[]} required_entities
 * @property {string[]} dashboards
 * @property {DashboardExtractionRuleConfig[]} dashboard_extraction_rules
 * @property {FilterRuleConfig[]} rules
 */

export async function loadConfig(path) {
  const rawText = await fs.readFile(path, "utf8");
  return parseConfig(rawText, path);
}

export function parseConfig(rawText, source = "config") {
  const parsed = YAML.parse(rawText) ?? {};
  return normalizeConfig(parsed, source);
}

export function normalizeConfig(rawConfig, source = "config") {
  if (!rawConfig || typeof rawConfig !== "object" || Array.isArray(rawConfig)) {
    throw new Error(`${source}: config root must be a YAML object`);
  }

  const config = {
    ...DEFAULT_CONFIG,
    ...rawConfig,
  };

  if (typeof config.homeassistant_url !== "string" || !config.homeassistant_url.trim()) {
    throw new Error(`${source}: homeassistant_url is required`);
  }
  try {
    new URL(config.homeassistant_url);
  } catch (error) {
    throw new Error(`${source}: homeassistant_url must be a valid URL`);
  }

  if (typeof config.access_token !== "string") {
    throw new Error(`${source}: access_token must be a string`);
  }
  if (typeof config.listen_addr !== "string" || !config.listen_addr.trim()) {
    throw new Error(`${source}: listen_addr must be a non-empty string`);
  }
  if (typeof config.transparent !== "boolean") {
    throw new Error(`${source}: transparent must be a boolean`);
  }
  if (config.default_action !== "allow" && config.default_action !== "deny") {
    throw new Error(`${source}: default_action must be "allow" or "deny"`);
  }

  const bootstrapTimeout = normalizeNonNegativeInteger(
    config.bootstrap_timeout_ms,
    `${source}: bootstrap_timeout_ms`,
  );
  const bootstrapCacheTtl = normalizeNonNegativeInteger(
    config.bootstrap_cache_ttl_ms,
    `${source}: bootstrap_cache_ttl_ms`,
  );
  const warnEntityUpdatesOverPerMinute = normalizeNonNegativeNumber(
    config.warn_entity_updates_over_per_minute,
    `${source}: warn_entity_updates_over_per_minute`,
  );
  const requiredEntities = normalizeStringArray(
    config.required_entities,
    `${source}: required_entities`,
  );
  const dashboards = normalizeStringArray(config.dashboards, `${source}: dashboards`);
  const dashboardExtractionRules = normalizeDashboardExtractionRules(
    rawConfig.dashboard_extraction_rules ?? [],
    source,
  );
  const rules = normalizeRules(config.rules, source);

  return Object.freeze({
    homeassistant_url: config.homeassistant_url,
    access_token: config.access_token,
    listen_addr: config.listen_addr,
    transparent: config.transparent,
    bootstrap_timeout_ms: bootstrapTimeout,
    bootstrap_cache_ttl_ms: bootstrapCacheTtl,
    warn_entity_updates_over_per_minute: warnEntityUpdatesOverPerMinute,
    default_action: config.default_action,
    required_entities: requiredEntities,
    dashboards,
    dashboard_extraction_rules: dashboardExtractionRules,
    rules,
  });
}

export function parseListenAddress(listenAddr) {
  if (listenAddr.startsWith("/")) {
    return listenAddr;
  }
  if (/^\d+$/.test(listenAddr)) {
    return { port: Number(listenAddr) };
  }
  if (/^:\d+$/.test(listenAddr)) {
    return { port: Number(listenAddr.slice(1)) };
  }

  const bracketedMatch = listenAddr.match(/^\[([^\]]+)\]:(\d+)$/);
  if (bracketedMatch) {
    return { host: bracketedMatch[1], port: Number(bracketedMatch[2]) };
  }

  const hostPortMatch = listenAddr.match(/^([^:]+):(\d+)$/);
  if (hostPortMatch) {
    return { host: hostPortMatch[1], port: Number(hostPortMatch[2]) };
  }

  throw new Error(`listen_addr must look like ":10111", "127.0.0.1:10111", "10111", or a socket path`);
}

function normalizeStringArray(value, fieldName) {
  if (value == null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error(`${fieldName} must be an array of strings`);
  }
  return value.map((entry, index) => {
    if (typeof entry !== "string" || !entry.trim()) {
      throw new Error(`${fieldName}[${index}] must be a non-empty string`);
    }
    return entry;
  });
}

function normalizeRules(value, source) {
  if (value == null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error(`${source}: rules must be an array`);
  }

  return value.map((rule, index) => {
    const fieldPrefix = `${source}: rules[${index}]`;
    if (!rule || typeof rule !== "object" || Array.isArray(rule)) {
      throw new Error(`${fieldPrefix} must be an object`);
    }
    if (typeof rule.match !== "string" || !rule.match) {
      throw new Error(`${fieldPrefix}.match must be a non-empty string`);
    }
    if (rule.match_type !== "exact" && rule.match_type !== "regex") {
      throw new Error(`${fieldPrefix}.match_type must be "exact" or "regex"`);
    }
    if (rule.action !== "allow" && rule.action !== "deny") {
      throw new Error(`${fieldPrefix}.action must be "allow" or "deny"`);
    }

    const normalizedRule = {
      name: typeof rule.name === "string" && rule.name ? rule.name : `rule-${index + 1}`,
      match_type: rule.match_type,
      match: rule.match,
      action: rule.action,
    };

    if (rule.rate_limit_ms != null) {
      const rateLimit = normalizeNonNegativeInteger(
        rule.rate_limit_ms,
        `${fieldPrefix}.rate_limit_ms`,
      );
      if (rule.action === "deny") {
        throw new Error(`${fieldPrefix}: deny rules must not define rate_limit_ms`);
      }
      normalizedRule.rate_limit_ms = rateLimit;
    }

    return Object.freeze(normalizedRule);
  });
}

function normalizeDashboardExtractionRules(value, source) {
  if (value == null) {
    value = [];
  }
  if (!Array.isArray(value)) {
    throw new Error(`${source}: dashboard_extraction_rules must be an array`);
  }

  const normalizedRules = cloneDashboardExtractionRules(DEFAULT_DASHBOARD_EXTRACTION_RULES);
  for (const [index, rule] of value.entries()) {
    const fieldPrefix = `${source}: dashboard_extraction_rules[${index}]`;
    if (!rule || typeof rule !== "object" || Array.isArray(rule)) {
      throw new Error(`${fieldPrefix} must be an object`);
    }
    if (typeof rule.card_type !== "string" || !rule.card_type.trim()) {
      throw new Error(`${fieldPrefix}.card_type must be a non-empty string`);
    }
    if (rule.mode !== "template_entities") {
      throw new Error(`${fieldPrefix}.mode must be "template_entities"`);
    }
    if (!Array.isArray(rule.fields) || rule.fields.length === 0) {
      throw new Error(`${fieldPrefix}.fields must be a non-empty array of strings`);
    }

    const fields = rule.fields.map((field, fieldIndex) => {
      if (typeof field !== "string" || !field.trim()) {
        throw new Error(`${fieldPrefix}.fields[${fieldIndex}] must be a non-empty string`);
      }
      return field;
    });

    normalizedRules.push(
      Object.freeze({
        card_type: rule.card_type,
        mode: "template_entities",
        fields: Object.freeze(fields),
      }),
    );
  }

  return Object.freeze(normalizedRules);
}

function normalizeNonNegativeInteger(value, fieldName) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${fieldName} must be a non-negative integer`);
  }
  return value;
}

function normalizeNonNegativeNumber(value, fieldName) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`${fieldName} must be a non-negative number`);
  }
  return value;
}

function cloneDashboardExtractionRules(rules) {
  return rules.map((rule) =>
    Object.freeze({
      card_type: rule.card_type,
      mode: rule.mode,
      fields: Object.freeze([...rule.fields]),
    }),
  );
}
