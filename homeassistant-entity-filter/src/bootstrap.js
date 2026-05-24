import { createHash } from "node:crypto";
import WebSocket from "ws";
import { extractDashboardEntities } from "./dashboardEntities.js";
import { parseJsonMessageGroup } from "./frame.js";
import { buildHomeAssistantWebSocketUrl } from "./urlHelpers.js";

export class BootstrapManager {
  constructor({
    homeAssistantUrl,
    webSocketUrl = null,
    requiredEntities = [],
    dashboards = [],
    dashboardExtractionRules = [],
    cacheTtlMs = 300000,
    logger = console,
    openConnection = openAuthenticatedConnection,
  }) {
    this.homeAssistantUrl = homeAssistantUrl;
    this.webSocketUrl = webSocketUrl;
    this.baseRequiredEntities = [...requiredEntities];
    this.dashboards = [...dashboards];
    this.dashboardExtractionRules = [...dashboardExtractionRules];
    this.cacheTtlMs = cacheTtlMs;
    this.logger = logger;
    this.openConnection = openConnection;
    this.cache = new Map();
  }

  hasBootstrapTargets() {
    return this.dashboards.length > 0;
  }

  async load(accessToken, timeoutMs = 5000) {
    if (!accessToken) {
      return {
        requiredEntities: new Set(this.baseRequiredEntities),
        entityCatalog: null,
      };
    }

    const cacheKey = `${hashToken(accessToken)}::${this.dashboards.join(",")}`;
    const cachedEntry = this.cache.get(cacheKey);
    const now = Date.now();
    if (cachedEntry && cachedEntry.expiresAt > now) {
      return cloneBootstrapData(cachedEntry.data);
    }

    const freshData = await withTimeout(
      this._fetch(accessToken, timeoutMs),
      timeoutMs,
      `bootstrap timed out after ${timeoutMs}ms`,
    );

    const cacheValue = {
      requiredEntities: [...freshData.requiredEntities],
      entityCatalog: freshData.entityCatalog ? [...freshData.entityCatalog] : null,
    };
    this.cache.set(cacheKey, {
      expiresAt: now + this.cacheTtlMs,
      data: cacheValue,
    });

    return cloneBootstrapData(cacheValue);
  }

  async _fetch(accessToken, timeoutMs) {
    const connection = await this.openConnection({
      homeAssistantUrl: this.homeAssistantUrl,
      webSocketUrl: this.webSocketUrl,
      accessToken,
      timeoutMs,
    });

    try {
      const states = await connection.call({ type: "get_states" });
      const entityCatalog = new Set();
      if (Array.isArray(states)) {
        for (const state of states) {
          if (state && typeof state.entity_id === "string") {
            entityCatalog.add(state.entity_id);
          }
        }
      }

      const requiredEntities = new Set(this.baseRequiredEntities);
      for (const dashboard of this.dashboards) {
        const urlPath = dashboard === "default" ? null : dashboard;
        try {
          const config = await connection.call({
            type: "lovelace/config",
            url_path: urlPath,
            force: false,
          });

          if (config && typeof config === "object" && config.strategy) {
            this.logger.warn(
              `bootstrap: skipping strategy dashboard ${dashboard} because it cannot be statically analyzed`,
            );
            continue;
          }

          for (const entityId of extractDashboardEntities(config, this.dashboardExtractionRules)) {
            requiredEntities.add(entityId);
          }
        } catch (error) {
          this.logger.warn(`bootstrap: failed to load dashboard ${dashboard}: ${error.message}`);
        }
      }

      return {
        requiredEntities,
        entityCatalog,
      };
    } finally {
      await connection.close();
    }
  }
}

export function hashToken(token) {
  return createHash("sha256").update(token).digest("hex").slice(0, 12);
}

export function resolveBootstrapWebSocketUrl({ homeAssistantUrl, webSocketUrl }) {
  if (webSocketUrl) {
    return webSocketUrl;
  }
  return buildHomeAssistantWebSocketUrl(homeAssistantUrl, "/api/websocket");
}

async function openAuthenticatedConnection({ homeAssistantUrl, webSocketUrl, accessToken, timeoutMs }) {
  const socket = new WebSocket(resolveBootstrapWebSocketUrl({ homeAssistantUrl, webSocketUrl }));
  const pending = new Map();
  let nextCommandId = 1;
  let authenticated = false;
  let closed = false;
  let authResolve;
  let authReject;
  const authPromise = new Promise((resolve, reject) => {
    authResolve = resolve;
    authReject = reject;
  });

  const shutdown = (error) => {
    if (closed) {
      return;
    }
    closed = true;
    if (!authenticated) {
      authReject(error);
    }
    for (const entry of pending.values()) {
      entry.reject(error);
    }
    pending.clear();
    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
      socket.terminate();
    }
  };

  socket.on("message", (data) => {
    let messages;
    try {
      ({ messages } = parseJsonMessageGroup(String(data)));
    } catch (error) {
      shutdown(error);
      return;
    }

    for (const message of messages) {
      if (!message || typeof message !== "object") {
        continue;
      }

      if (message.type === "auth_required") {
        sendJson(socket, { type: "auth", access_token: accessToken }).catch(shutdown);
        continue;
      }

      if (message.type === "auth_ok") {
        authenticated = true;
        authResolve();
        continue;
      }

      if (message.type === "auth_invalid") {
        shutdown(new Error(message.message || "authentication failed"));
        return;
      }

      if (message.type === "result" && pending.has(message.id)) {
        const { resolve, reject } = pending.get(message.id);
        pending.delete(message.id);
        if (message.success) {
          resolve(message.result);
        } else {
          reject(new Error(message.error?.message || `command ${message.id} failed`));
        }
      }
    }
  });

  socket.on("error", (error) => {
    shutdown(error);
  });
  socket.on("close", () => {
    if (!closed) {
      shutdown(new Error("Home Assistant websocket closed during bootstrap"));
    }
  });

  await withTimeout(authPromise, timeoutMs, `bootstrap auth timed out after ${timeoutMs}ms`);

  return {
    async call(message) {
      if (closed) {
        throw new Error("bootstrap connection is closed");
      }

      const commandId = nextCommandId;
      nextCommandId += 1;

      const responsePromise = new Promise((resolve, reject) => {
        pending.set(commandId, { resolve, reject });
      });

      try {
        await sendJson(socket, { ...message, id: commandId });
      } catch (error) {
        pending.delete(commandId);
        throw error;
      }

      return withTimeout(
        responsePromise,
        timeoutMs,
        `bootstrap command ${message.type} timed out after ${timeoutMs}ms`,
      );
    },

    async close() {
      if (closed) {
        return;
      }
      closed = true;
      for (const entry of pending.values()) {
        entry.reject(new Error("bootstrap connection closed"));
      }
      pending.clear();
      await closeSocket(socket);
    },
  };
}

function cloneBootstrapData(data) {
  return {
    requiredEntities: new Set(data.requiredEntities || []),
    entityCatalog: data.entityCatalog ? new Set(data.entityCatalog) : null,
  };
}

function closeSocket(socket) {
  return new Promise((resolve) => {
    if (socket.readyState === WebSocket.CLOSED) {
      resolve();
      return;
    }
    socket.once("close", () => resolve());
    socket.close();
    setTimeout(() => {
      if (socket.readyState !== WebSocket.CLOSED) {
        socket.terminate();
      }
    }, 200).unref?.();
  });
}

function sendJson(socket, payload) {
  return new Promise((resolve, reject) => {
    socket.send(JSON.stringify(payload), (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function withTimeout(promise, timeoutMs, message) {
  if (timeoutMs <= 0) {
    return promise;
  }

  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      const error = new Error(message);
      error.code = "BOOTSTRAP_TIMEOUT";
      reject(error);
    }, timeoutMs);
    timeoutId.unref?.();
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    clearTimeout(timeoutId);
  });
}
