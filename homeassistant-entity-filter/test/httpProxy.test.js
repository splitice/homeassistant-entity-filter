import test from "node:test";
import assert from "node:assert/strict";
import { stripTransparentHeaders } from "../src/httpProxy.js";

test("stripTransparentHeaders removes x-forwarded headers and keeps others", () => {
  const headers = stripTransparentHeaders({
    host: "homeassistant.local",
    cookie: "sid=123",
    "x-forwarded-for": "10.0.0.10",
    "X-Forwarded-Proto": "https",
  });

  assert.deepEqual(headers, {
    host: "homeassistant.local",
    cookie: "sid=123",
  });
});
