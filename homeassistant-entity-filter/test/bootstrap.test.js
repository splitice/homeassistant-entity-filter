import test from "node:test";
import assert from "node:assert/strict";
import { resolveBootstrapWebSocketUrl } from "../src/bootstrap.js";

test("resolveBootstrapWebSocketUrl uses override when provided", () => {
  assert.equal(
    resolveBootstrapWebSocketUrl({
      homeAssistantUrl: "http://example.com",
      webSocketUrl: "ws://supervisor/core/websocket",
    }),
    "ws://supervisor/core/websocket",
  );
});

test("resolveBootstrapWebSocketUrl falls back to the Home Assistant websocket path", () => {
  assert.equal(
    resolveBootstrapWebSocketUrl({
      homeAssistantUrl: "http://example.com/base",
      webSocketUrl: null,
    }),
    "ws://example.com/base/api/websocket",
  );
});
