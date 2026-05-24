import test from "node:test";
import assert from "node:assert/strict";
import { parseConfig } from "../src/config.js";
import { DEFAULT_DASHBOARD_EXTRACTION_RULES } from "../src/dashboardEntities.js";
import { RuleEngine } from "../src/ruleEngine.js";

test("parseConfig applies defaults", () => {
  const config = parseConfig('homeassistant_url: "http://example.com"\n');
  assert.equal(config.listen_addr, "0.0.0.0:10111");
  assert.equal(config.transparent, true);
  assert.equal(config.warn_entity_updates_over_per_minute, 2);
  assert.equal(config.default_action, "allow");
  assert.deepEqual(config.required_entities, []);
  assert.deepEqual(config.dashboard_extraction_rules, DEFAULT_DASHBOARD_EXTRACTION_RULES);
});

test("parseConfig accepts decimal warn thresholds", () => {
  const config = parseConfig(`
homeassistant_url: "http://example.com"
warn_entity_updates_over_per_minute: 1.5
`);

  assert.equal(config.warn_entity_updates_over_per_minute, 1.5);
});

test("parseConfig appends user dashboard extraction rules after the built-in defaults", () => {
  const config = parseConfig(`
homeassistant_url: "http://example.com"
dashboard_extraction_rules:
  - card_type: custom:test-card
    mode: template_entities
    fields:
      - markdown
`);

  assert.deepEqual(config.dashboard_extraction_rules, [
    ...DEFAULT_DASHBOARD_EXTRACTION_RULES,
    {
      card_type: "custom:test-card",
      mode: "template_entities",
      fields: ["markdown"],
    },
  ]);
});

test("parseConfig rejects deny rules with rate limits", () => {
  assert.throws(
    () =>
      parseConfig(`
homeassistant_url: "http://example.com"
rules:
  - match_type: exact
    match: sensor.demo
    action: deny
    rate_limit_ms: 1000
`),
    /deny rules must not define rate_limit_ms/,
  );
});

test("parseConfig rejects invalid default_action", () => {
  assert.throws(
    () => parseConfig('homeassistant_url: "http://example.com"\ndefault_action: maybe\n'),
    /default_action must be "allow" or "deny"/,
  );
});

test("parseConfig rejects negative warn thresholds", () => {
  assert.throws(
    () =>
      parseConfig('homeassistant_url: "http://example.com"\nwarn_entity_updates_over_per_minute: -1\n'),
    /warn_entity_updates_over_per_minute must be a non-negative number/,
  );
});

test("parseConfig rejects non-number warn thresholds", () => {
  assert.throws(
    () =>
      parseConfig('homeassistant_url: "http://example.com"\nwarn_entity_updates_over_per_minute: nope\n'),
    /warn_entity_updates_over_per_minute must be a non-negative number/,
  );
});

test("parseConfig rejects invalid dashboard extraction card types", () => {
  assert.throws(
    () =>
      parseConfig(`
homeassistant_url: "http://example.com"
dashboard_extraction_rules:
  - card_type: ""
    mode: template_entities
    fields:
      - content
`),
    /dashboard_extraction_rules\[0\]\.card_type must be a non-empty string/,
  );
});

test("parseConfig rejects invalid dashboard extraction modes", () => {
  assert.throws(
    () =>
      parseConfig(`
homeassistant_url: "http://example.com"
dashboard_extraction_rules:
  - card_type: custom:test-card
    mode: markdown_entities
    fields:
      - content
`),
    /dashboard_extraction_rules\[0\]\.mode must be "template_entities"/,
  );
});

test("parseConfig rejects empty or invalid dashboard extraction fields", () => {
  assert.throws(
    () =>
      parseConfig(`
homeassistant_url: "http://example.com"
dashboard_extraction_rules:
  - card_type: custom:test-card
    mode: template_entities
    fields: []
`),
    /dashboard_extraction_rules\[0\]\.fields must be a non-empty array of strings/,
  );

  assert.throws(
    () =>
      parseConfig(`
homeassistant_url: "http://example.com"
dashboard_extraction_rules:
  - card_type: custom:test-card
    mode: template_entities
    fields:
      - content
      - 42
`),
    /dashboard_extraction_rules\[0\]\.fields\[1\] must be a non-empty string/,
  );
});

test("RuleEngine rejects invalid regex patterns", () => {
  const config = parseConfig(`
homeassistant_url: "http://example.com"
rules:
  - match_type: regex
    match: "(unterminated"
    action: allow
`);

  assert.throws(() => new RuleEngine(config.rules, config.default_action), /invalid regex/i);
});
