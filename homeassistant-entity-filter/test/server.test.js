import test from "node:test";
import assert from "node:assert/strict";
import { formatBoundAddressLog } from "../src/server.js";

test("formatBoundAddressLog formats TCP address information", () => {
  assert.equal(
    formatBoundAddressLog({ address: "0.0.0.0", port: 10111, family: "IPv4" }),
    "BOUND_ADDRESS=0.0.0.0 BOUND_PORT=10111 BOUND_FAMILY=IPv4",
  );
});

test("formatBoundAddressLog formats socket paths", () => {
  assert.equal(
    formatBoundAddressLog("/tmp/homeassistant-entity-filter.sock"),
    "BOUND_PATH=/tmp/homeassistant-entity-filter.sock",
  );
});
