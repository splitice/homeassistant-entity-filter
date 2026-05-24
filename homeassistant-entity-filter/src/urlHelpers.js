export function toWebSocketUrl(homeAssistantUrl) {
  const url = new URL(homeAssistantUrl);
  if (url.protocol === "http:") {
    url.protocol = "ws:";
  } else if (url.protocol === "https:") {
    url.protocol = "wss:";
  }
  url.hash = "";
  return url;
}

export function buildHomeAssistantWebSocketUrl(homeAssistantUrl, requestPath = "/api/websocket") {
  const base = toWebSocketUrl(homeAssistantUrl);
  const requestUrl = new URL(requestPath, "http://proxy.invalid");
  const basePath = base.pathname === "/" ? "" : base.pathname.replace(/\/$/, "");
  const incomingPath = requestUrl.pathname.startsWith("/")
    ? requestUrl.pathname
    : `/${requestUrl.pathname}`;

  base.pathname = `${basePath}${incomingPath}` || "/";
  base.search = requestUrl.search;
  return base.toString();
}
