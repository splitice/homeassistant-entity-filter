import WebSocket from "ws";
import { stripTransparentHeaders } from "./httpProxy.js";
import { LegacyStateChangedManager } from "./legacyStateChanged.js";
import { ModernEntitiesManager } from "./modernEntities.js";
import { parseJsonMessageGroup, serializeJsonMessageGroup } from "./frame.js";
import { buildHomeAssistantWebSocketUrl } from "./urlHelpers.js";

let nextSessionId = 1;

export class WsSession {
  constructor({
    request,
    clientSocket,
    config,
    ruleEngine,
    bootstrapManager,
    bootstrapAccessToken = null,
    entityUpdateRateMonitor = null,
    eventSummaryReporter = null,
    logger = console,
  }) {
    this.id = nextSessionId;
    nextSessionId += 1;

    this.request = request;
    this.clientSocket = clientSocket;
    this.config = config;
    this.ruleEngine = ruleEngine;
    this.bootstrapManager = bootstrapManager;
    this.bootstrapAccessToken = bootstrapAccessToken;
    this.logger = logger;

    this.capturedAccessToken = null;
    this.bootstrapAttempted = false;
    this.bootstrapPromise = null;
    this.bootstrapData = null;
    this.subscribeEntitiesLogState = {
      injected: false,
      intersected: false,
      unchanged: false,
    };
    this.bootstrapSourceLogged = false;
    this.closed = false;
    this.clientFrameQueue = Promise.resolve();
    this.serverFrameQueue = Promise.resolve();
    this.clientSendQueue = Promise.resolve();
    this.upstreamSendQueue = Promise.resolve();

    this.modernManager = new ModernEntitiesManager({
      resolvePolicy: (entityId) => this.resolvePolicy(entityId),
      emitMessages: (messages) => this.sendGeneratedMessages(messages),
      entityUpdateRateMonitor,
      eventSummaryReporter,
      logger,
    });
    this.legacyManager = new LegacyStateChangedManager({
      resolvePolicy: (entityId) => this.resolvePolicy(entityId),
      emitMessages: (messages) => this.sendGeneratedMessages(messages),
      entityUpdateRateMonitor,
      eventSummaryReporter,
      logger,
    });
  }

  attach() {
    const upstreamUrl = buildHomeAssistantWebSocketUrl(
      this.config.homeassistant_url,
      this.request.url ?? "/api/websocket",
    );
    const protocols = parseSubprotocols(this.request.headers["sec-websocket-protocol"]);
    const headers = buildUpstreamHeaders(this.request.headers, this.config.transparent);

    this.upstreamSocket = new WebSocket(
      upstreamUrl,
      protocols.length > 0 ? protocols : undefined,
      { headers },
    );

    this.upstreamOpenPromise = new Promise((resolve, reject) => {
      const handleOpen = () => {
        cleanup();
        resolve();
      };
      const handleError = (error) => {
        cleanup();
        reject(error);
      };
      const handleClose = () => {
        cleanup();
        reject(new Error("upstream websocket closed before opening"));
      };
      const cleanup = () => {
        this.upstreamSocket.off("open", handleOpen);
        this.upstreamSocket.off("error", handleError);
        this.upstreamSocket.off("close", handleClose);
      };
      this.upstreamSocket.on("open", handleOpen);
      this.upstreamSocket.on("error", handleError);
      this.upstreamSocket.on("close", handleClose);
    });

    this.clientSocket.on("message", (data, isBinary) => {
      if (isBinary) {
        this.sendToUpstream(data, true).catch((error) => this.fail(error));
        return;
      }
      this.clientFrameQueue = this.clientFrameQueue
        .then(() => this.handleClientTextFrame(String(data)))
        .catch((error) => this.fail(error));
    });
    this.clientSocket.on("close", () => this.close());
    this.clientSocket.on("error", (error) => this.fail(error));

    this.upstreamSocket.on("message", (data, isBinary) => {
      if (isBinary) {
        this.sendToClient(data, true).catch((error) => this.fail(error));
        return;
      }
      this.serverFrameQueue = this.serverFrameQueue
        .then(() => this.handleServerTextFrame(String(data)))
        .catch((error) => this.fail(error));
    });
    this.upstreamSocket.on("close", () => this.close());
    this.upstreamSocket.on("error", (error) => this.fail(error));
  }

  resolvePolicy(entityId) {
    return this.ruleEngine.resolve(entityId, this.getRequiredEntities());
  }

  getRequiredEntities() {
    if (this.bootstrapData?.requiredEntities) {
      return this.bootstrapData.requiredEntities;
    }
    return new Set(this.config.required_entities);
  }

  getExplicitAllowedSet() {
    return this.ruleEngine.resolveExplicitAllowedSet({
      requiredEntities: this.getRequiredEntities(),
      entityCatalog: this.bootstrapData?.entityCatalog ?? null,
    });
  }

  async handleClientTextFrame(rawText) {
    let group;
    try {
      group = parseJsonMessageGroup(rawText);
    } catch {
      await this.sendToUpstream(rawText, false);
      return;
    }

    const outgoingMessages = [];
    for (const message of group.messages) {
      const handledMessage = await this.handleClientMessage(message);
      if (handledMessage != null) {
        outgoingMessages.push(handledMessage);
      }
    }

    const payload = serializeJsonMessageGroup(outgoingMessages, group.wasArray || outgoingMessages.length > 1);
    if (payload != null) {
      await this.sendToUpstream(payload, false);
    }
  }

  async handleClientMessage(message) {
    if (!message || typeof message !== "object") {
      return message;
    }

    if (message.type === "auth" && typeof message.access_token === "string") {
      this.capturedAccessToken = message.access_token;
      return message;
    }

    if (message.type === "subscribe_events" && message.event_type === "state_changed") {
      this.legacyManager.trackSubscription(message.id);
      return message;
    }

    if (message.type === "unsubscribe_events") {
      this.modernManager.clearSubscription(message.subscription);
      this.legacyManager.clearSubscription(message.subscription);
      return message;
    }

    if (message.type === "subscribe_entities") {
      return this.handleSubscribeEntities(message);
    }

    return message;
  }

  async handleSubscribeEntities(message) {
    this.modernManager.trackSubscription(message.id);

    let explicitAllowedSet = this.getExplicitAllowedSet();
    const bootstrapRequired =
      (!this.bootstrapData && this.bootstrapManager.hasBootstrapTargets()) ||
      (!explicitAllowedSet && this.ruleEngine.requiresEntityCatalogForExplicitSet());

    if (!explicitAllowedSet && bootstrapRequired && !this.bootstrapAttempted) {
      await this.ensureBootstrap();
      explicitAllowedSet = this.getExplicitAllowedSet();
    }

    if (explicitAllowedSet && this.bootstrapManager.hasBootstrapTargets() && !this.bootstrapData && !this.bootstrapAttempted) {
      await this.ensureBootstrap();
      explicitAllowedSet = this.getExplicitAllowedSet();
    }

    if (explicitAllowedSet) {
      const sortedAllowedIds = [...explicitAllowedSet].sort();
      if (Array.isArray(message.entity_ids)) {
        const clientEntityIds = new Set(
          message.entity_ids.filter((value) => typeof value === "string"),
        );
        message.entity_ids = sortedAllowedIds.filter((entityId) => clientEntityIds.has(entityId));
        this.logSubscribeEntitiesMode("intersected", message.entity_ids.length);
      } else {
        message.entity_ids = sortedAllowedIds;
        this.logSubscribeEntitiesMode("injected", message.entity_ids.length);
      }
      return message;
    }

    if (bootstrapRequired) {
      this.logSubscribeEntitiesMode("unchanged", null);
    }
    return message;
  }

  async ensureBootstrap() {
    if (this.bootstrapPromise) {
      return this.bootstrapPromise;
    }

    const { token, source } = selectBootstrapTokenSource({
      configAccessToken: this.config.access_token,
      bootstrapAccessToken: this.bootstrapAccessToken,
      capturedAccessToken: this.capturedAccessToken,
    });

    if (!this.bootstrapSourceLogged) {
      this.logger.info(`session ${this.id}: bootstrap source=${source}`);
      this.bootstrapSourceLogged = true;
    }

    if (!token) {
      this.bootstrapPromise = Promise.resolve(null);
      return this.bootstrapPromise;
    }

    this.bootstrapAttempted = true;

    this.bootstrapPromise = this.bootstrapManager
      .load(token, this.config.bootstrap_timeout_ms)
      .then((data) => {
        this.bootstrapData = data;
        return data;
      })
      .catch((error) => {
        if (error.code === "BOOTSTRAP_TIMEOUT") {
          this.logger.warn(`session ${this.id}: bootstrap timeout: ${error.message}`);
        } else {
          this.logger.warn(`session ${this.id}: bootstrap failed: ${error.message}`);
        }
        return null;
      });

    return this.bootstrapPromise;
  }

  async handleServerTextFrame(rawText) {
    let group;
    try {
      group = parseJsonMessageGroup(rawText);
    } catch {
      await this.sendToClient(rawText, false);
      return;
    }

    const outgoingMessages = [];
    for (const message of group.messages) {
      const modernResult = this.modernManager.handleServerMessage(message);
      if (modernResult !== null) {
        outgoingMessages.push(...modernResult);
        continue;
      }

      const legacyResult = this.legacyManager.handleServerMessage(message);
      if (legacyResult !== null) {
        outgoingMessages.push(...legacyResult);
        continue;
      }

      outgoingMessages.push(message);
    }

    const payload = serializeJsonMessageGroup(
      outgoingMessages,
      group.wasArray || outgoingMessages.length > 1,
    );
    if (payload != null) {
      await this.sendToClient(payload, false);
    }
  }

  async sendGeneratedMessages(messages) {
    const payload = serializeJsonMessageGroup(messages, messages.length > 1);
    if (payload == null) {
      return;
    }
    await this.sendToClient(payload, false);
  }

  sendToClient(data, isBinary) {
    this.clientSendQueue = this.clientSendQueue.then(() => sendSocket(this.clientSocket, data, isBinary));
    return this.clientSendQueue;
  }

  sendToUpstream(data, isBinary) {
    this.upstreamSendQueue = this.upstreamSendQueue.then(async () => {
      await this.upstreamOpenPromise;
      await sendSocket(this.upstreamSocket, data, isBinary);
    });
    return this.upstreamSendQueue;
  }

  logSubscribeEntitiesMode(mode, entityCount) {
    if (this.subscribeEntitiesLogState[mode]) {
      return;
    }
    this.subscribeEntitiesLogState[mode] = true;

    if (mode === "injected") {
      this.logger.info(`session ${this.id}: injected entity_ids (${entityCount}) into subscribe_entities`);
      return;
    }
    if (mode === "intersected") {
      this.logger.info(`session ${this.id}: intersected client entity_ids down to ${entityCount}`);
      return;
    }
    this.logger.info(`session ${this.id}: forwarded subscribe_entities unchanged because no explicit entity set was available`);
  }

  fail(error) {
    if (this.closed) {
      return;
    }
    this.logger.error(`session ${this.id}: ${error.message}`);
    this.close();
  }

  close() {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.modernManager.close();
    this.legacyManager.close();

    if (this.clientSocket.readyState === WebSocket.OPEN || this.clientSocket.readyState === WebSocket.CONNECTING) {
      this.clientSocket.close();
    }
    if (this.upstreamSocket?.readyState === WebSocket.OPEN || this.upstreamSocket?.readyState === WebSocket.CONNECTING) {
      this.upstreamSocket.close();
    }
  }
}

export function selectBootstrapTokenSource({
  configAccessToken,
  bootstrapAccessToken,
  capturedAccessToken,
}) {
  if (configAccessToken) {
    return { token: configAccessToken, source: "configured" };
  }
  if (bootstrapAccessToken) {
    return { token: bootstrapAccessToken, source: "supervisor" };
  }
  if (capturedAccessToken) {
    return { token: capturedAccessToken, source: "captured" };
  }
  return { token: null, source: "unresolved" };
}

function buildUpstreamHeaders(headers, transparent) {
  const stripped = transparent ? stripTransparentHeaders(headers) : { ...headers };
  const nextHeaders = {};
  for (const [name, value] of Object.entries(stripped)) {
    const lowerName = name.toLowerCase();
    if (
      lowerName === "host" ||
      lowerName === "connection" ||
      lowerName === "upgrade" ||
      lowerName === "sec-websocket-key" ||
      lowerName === "sec-websocket-version" ||
      lowerName === "sec-websocket-extensions" ||
      lowerName === "sec-websocket-protocol"
    ) {
      continue;
    }
    nextHeaders[name] = Array.isArray(value) ? value.join(", ") : value;
  }
  return nextHeaders;
}

function parseSubprotocols(headerValue) {
  if (!headerValue) {
    return [];
  }
  if (Array.isArray(headerValue)) {
    return headerValue.flatMap((entry) => parseSubprotocols(entry));
  }
  return String(headerValue)
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function sendSocket(socket, data, isBinary) {
  return new Promise((resolve, reject) => {
    if (socket.readyState !== WebSocket.OPEN) {
      reject(new Error("websocket is not open"));
      return;
    }
    socket.send(data, { binary: isBinary }, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}
