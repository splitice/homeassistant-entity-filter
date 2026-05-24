import test from "node:test";
import assert from "node:assert/strict";
import { selectBootstrapTokenSource } from "../src/wsSession.js";

test("selectBootstrapTokenSource prefers config access token", () => {
  assert.deepEqual(
    selectBootstrapTokenSource({
      configAccessToken: "config-token",
      bootstrapAccessToken: "supervisor-token",
      capturedAccessToken: "captured-token",
    }),
    { token: "config-token", source: "configured" },
  );
});

test("selectBootstrapTokenSource falls back to supervisor token before captured token", () => {
  assert.deepEqual(
    selectBootstrapTokenSource({
      configAccessToken: "",
      bootstrapAccessToken: "supervisor-token",
      capturedAccessToken: "captured-token",
    }),
    { token: "supervisor-token", source: "supervisor" },
  );
});

test("selectBootstrapTokenSource falls back to captured token when no overrides exist", () => {
  assert.deepEqual(
    selectBootstrapTokenSource({
      configAccessToken: "",
      bootstrapAccessToken: null,
      capturedAccessToken: "captured-token",
    }),
    { token: "captured-token", source: "captured" },
  );
});
