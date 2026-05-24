import http from "node:http";
import { WebSocketServer } from "ws";
import { BootstrapManager } from "./bootstrap.js";
import { parseListenAddress } from "./config.js";
import { EntityUpdateRateMonitor } from "./entityUpdateRateMonitor.js";
import { createReverseProxy } from "./httpProxy.js";
import { RuleEngine } from "./ruleEngine.js";
import { WsSession } from "./wsSession.js";

export async function startServer(
  config,
  {
    logger = console,
    bootstrapAccessToken = null,
    bootstrapWebSocketUrl = null,
  } = {},
) {
  const targetUrl = new URL(config.homeassistant_url);
  const ruleEngine = new RuleEngine(config.rules, config.default_action);
  const bootstrapManager = new BootstrapManager({
    homeAssistantUrl: config.homeassistant_url,
    webSocketUrl: bootstrapWebSocketUrl,
    requiredEntities: config.required_entities,
    dashboards: config.dashboards,
    cacheTtlMs: config.bootstrap_cache_ttl_ms,
    logger,
  });
  const entityUpdateRateMonitor = new EntityUpdateRateMonitor({
    thresholdPerMinute: config.warn_entity_updates_over_per_minute,
    logger,
  });
  const reverseProxy = createReverseProxy({
    targetUrl,
    transparent: config.transparent,
    logger,
  });
  const webSocketServer = new WebSocketServer({ noServer: true });

  const server = http.createServer((req, res) => {
    reverseProxy.web(req, res);
  });

  server.on("upgrade", (req, socket, head) => {
    const requestUrl = new URL(req.url ?? "/", "http://proxy.invalid");
    if (requestUrl.pathname !== "/api/websocket") {
      reverseProxy.ws(req, socket, head);
      return;
    }

    webSocketServer.handleUpgrade(req, socket, head, (clientSocket) => {
      const session = new WsSession({
        request: req,
        clientSocket,
        config,
        ruleEngine,
        bootstrapManager,
        bootstrapAccessToken,
        entityUpdateRateMonitor,
        logger,
      });
      session.attach();
    });
  });

  const listenAddress = parseListenAddress(config.listen_addr);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(listenAddress, () => {
      server.off("error", reject);
      resolve();
    });
  });

  logger.info(`listening on ${config.listen_addr}`);
  const boundLog = formatBoundAddressLog(server.address());
  if (boundLog) {
    logger.info(boundLog);
  }
  logger.info(`upstream: ${config.homeassistant_url}`);
  logger.info(`transparent mode: ${config.transparent}`);
  logger.info(`dashboards: ${config.dashboards.length ? config.dashboards.join(", ") : "(none)"}`);
  logger.info(`rule count: ${config.rules.length}`);
  if (config.warn_entity_updates_over_per_minute > 0) {
    logger.info(
      `entity update warnings: enabled (> ${config.warn_entity_updates_over_per_minute.toFixed(2)}/min over 3m, process-wide upstream-allowed)`,
    );
  } else {
    logger.info("entity update warnings: disabled");
  }

  return {
    server,
    close() {
      return new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
  };
}

export function formatBoundAddressLog(boundAddress) {
  if (!boundAddress) {
    return null;
  }
  if (typeof boundAddress === "string") {
    return `BOUND_PATH=${boundAddress}`;
  }
  return `BOUND_ADDRESS=${boundAddress.address} BOUND_PORT=${boundAddress.port} BOUND_FAMILY=${boundAddress.family}`;
}
