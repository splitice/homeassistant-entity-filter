import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import WebSocket from "ws";
import { parseConfig } from "../src/config.js";
import { formatBoundAddressLog, startServer } from "../src/server.js";

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

test("upstream websocket connection refusal closes the session without an unhandled rejection", async (t) => {
  const unhandledRejections = [];
  const handleUnhandledRejection = (reason) => {
    unhandledRejections.push(reason);
  };
  process.on("unhandledRejection", handleUnhandledRejection);
  t.after(() => {
    process.off("unhandledRejection", handleUnhandledRejection);
  });

  const upstreamPort = await reserveClosedLocalPort();
  const logger = createMemoryLogger();
  const app = await startServer(
    parseConfig(`
homeassistant_url: "http://127.0.0.1:${upstreamPort}"
listen_addr: "127.0.0.1:0"
`),
    { logger },
  );
  t.after(async () => {
    await app.close();
  });

  const listenPort = app.server.address().port;
  const client = new WebSocket(`ws://127.0.0.1:${listenPort}/api/websocket`);
  await waitForSocketClose(client);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(unhandledRejections.length, 0);
  assert.ok(
    logger.entries.error.some((message) => message.includes("connect ECONNREFUSED")),
    "expected the session refusal to be logged",
  );
});

async function reserveClosedLocalPort() {
  const server = http.createServer();
  await new Promise((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address();
  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
  return port;
}

function waitForSocketClose(socket) {
  return new Promise((resolve, reject) => {
    socket.once("close", resolve);
    socket.once("error", reject);
  });
}

function createMemoryLogger() {
  const entries = {
    info: [],
    warn: [],
    error: [],
  };
  return {
    entries,
    info(message) {
      entries.info.push(String(message));
    },
    warn(message) {
      entries.warn.push(String(message));
    },
    error(message) {
      entries.error.push(String(message));
    },
  };
}
