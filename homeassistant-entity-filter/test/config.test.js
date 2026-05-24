import test from "node:test";
import assert from "node:assert/strict";
import { parseConfig } from "../src/config.js";
import { RuleEngine } from "../src/ruleEngine.js";

test("parseConfig applies defaults", () => {
  const config = parseConfig('homeassistant_url: "http://example.com"\n');
  assert.equal(config.listen_addr, "0.0.0.0:10111");
  assert.equal(config.transparent, true);
  assert.equal(config.warn_entity_updates_over_per_minute, 2);
  assert.equal(config.default_action, "allow");
  assert.deepEqual(config.required_entities, []);
});

test("parseConfig accepts decimal warn thresholds", () => {
  const config = parseConfig(`
homeassistant_url: "http://example.com"
warn_entity_updates_over_per_minute: 1.5
`);

  assert.equal(config.warn_entity_updates_over_per_minute, 1.5);
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
