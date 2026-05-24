import test from "node:test";
import assert from "node:assert/strict";
import { parseArgs } from "../src/cli.js";

test("parseArgs defaults to proxy-config.yaml", () => {
  assert.deepEqual(parseArgs([]), { configPath: "proxy-config.yaml" });
});

test("parseArgs accepts --config", () => {
  assert.deepEqual(parseArgs(["--config", "custom.yaml"]), { configPath: "custom.yaml" });
});
