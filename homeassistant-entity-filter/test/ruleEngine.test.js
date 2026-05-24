import test from "node:test";
import assert from "node:assert/strict";
import { RuleEngine } from "../src/ruleEngine.js";

test("RuleEngine resolves first matching rule", () => {
  const engine = new RuleEngine(
    [
      { name: "deny all sensors", match_type: "regex", match: "^sensor\\.", action: "deny" },
      { name: "allow kitchen", match_type: "exact", match: "sensor.kitchen", action: "allow" },
    ],
    "allow",
  );

  const resolution = engine.resolve("sensor.kitchen", new Set());
  assert.equal(resolution.action, "deny");
  assert.equal(resolution.matchedRule, "deny all sensors");
});

test("RuleEngine falls back to required entities", () => {
  const engine = new RuleEngine([], "deny");
  const resolution = engine.resolve("sensor.required", new Set(["sensor.required"]));
  assert.equal(resolution.action, "allow");
  assert.equal(resolution.matchedRule, "required");
});

test("RuleEngine resolves explicit sets without a catalog when closed", () => {
  const engine = new RuleEngine(
    [{ name: "allow office", match_type: "exact", match: "sensor.office", action: "allow" }],
    "deny",
  );

  const explicitSet = engine.resolveExplicitAllowedSet({
    requiredEntities: new Set(["sensor.required"]),
  });

  assert.deepEqual([...explicitSet].sort(), ["sensor.office", "sensor.required"]);
});

test("RuleEngine requires a catalog for regex allow rules", () => {
  const engine = new RuleEngine(
    [{ name: "allow temps", match_type: "regex", match: "^sensor\\.temp", action: "allow" }],
    "deny",
  );

  assert.equal(engine.requiresEntityCatalogForExplicitSet(), true);
  assert.equal(engine.resolveExplicitAllowedSet({ requiredEntities: new Set() }), null);

  const explicitSet = engine.resolveExplicitAllowedSet({
    requiredEntities: new Set(),
    entityCatalog: new Set(["sensor.temp_a", "camera.front"]),
  });
  assert.deepEqual([...explicitSet], ["sensor.temp_a"]);
});
