import httpProxy from "http-proxy";

const TRANSPARENT_HEADERS = [
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-proto",
  "x-forwarded-server",
];

export function stripTransparentHeaders(headers = {}) {
  const nextHeaders = {};
  for (const [name, value] of Object.entries(headers)) {
    if (!TRANSPARENT_HEADERS.includes(name.toLowerCase())) {
      nextHeaders[name] = value;
    }
  }
  return nextHeaders;
}

export function createReverseProxy({ targetUrl, transparent = true, logger = console }) {
  const proxy = httpProxy.createProxyServer({
    target: targetUrl.toString(),
    changeOrigin: true,
    ws: true,
    xfwd: !transparent,
    secure: false,
  });

  if (transparent) {
    proxy.on("proxyReq", (proxyReq) => stripProxyRequestHeaders(proxyReq));
    proxy.on("proxyReqWs", (proxyReq) => stripProxyRequestHeaders(proxyReq));
  }

  proxy.on("error", (error, req, res) => {
    logger.error(`reverse proxy error for ${req?.method ?? "WS"} ${req?.url ?? "unknown"}: ${error.message}`);
    if (res && typeof res.writeHead === "function" && !res.headersSent) {
      res.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
      res.end("Bad Gateway");
    } else if (res && typeof res.end === "function" && !res.writableEnded) {
      res.end();
    }
  });

  return proxy;
}

function stripProxyRequestHeaders(proxyReq) {
  for (const headerName of TRANSPARENT_HEADERS) {
    proxyReq.removeHeader(headerName);
  }
}
