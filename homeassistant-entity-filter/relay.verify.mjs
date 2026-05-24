import http from 'node:http';
import fs from 'node:fs';
import httpProxy from 'http-proxy';
import { WebSocketServer, WebSocket } from 'ws';

const upstreamHttp = 'http://192.168.1.101';
const upstreamWsBase = 'ws://192.168.1.101';
const listenPort = 18123;
const logPath = '/tmp/ha-ws-capture.jsonl';
fs.writeFileSync(logPath, '');
let nextConnId = 1;

const proxy = httpProxy.createProxyServer({
  target: upstreamHttp,
  changeOrigin: true,
  ws: true,
  secure: false,
});
proxy.on('error', (error, req, res) => {
  console.error('relay proxy error', error.message);
  if (res && !res.headersSent) {
    res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Bad Gateway');
  }
});

const wss = new WebSocketServer({ noServer: true });
const server = http.createServer((req, res) => proxy.web(req, res));

server.on('upgrade', (req, socket, head) => {
  const pathname = new URL(req.url ?? '/', 'http://relay.local').pathname;
  if (pathname !== '/api/websocket') {
    proxy.ws(req, socket, head);
    return;
  }

  wss.handleUpgrade(req, socket, head, (clientSocket) => {
    const connId = nextConnId++;
    const upstreamUrl = new URL(req.url ?? '/api/websocket', upstreamWsBase);
    const protocols = req.headers['sec-websocket-protocol']
      ? String(req.headers['sec-websocket-protocol']).split(',').map((entry) => entry.trim()).filter(Boolean)
      : undefined;
    const upstreamSocket = new WebSocket(upstreamUrl, protocols, {
      headers: Object.fromEntries(
        Object.entries(req.headers).filter(([name]) => {
          const lower = name.toLowerCase();
          return !['host','connection','upgrade','sec-websocket-key','sec-websocket-version','sec-websocket-extensions','sec-websocket-protocol'].includes(lower);
        }),
      ),
    });
    const queuedClientFrames = [];

    const closeBoth = () => {
      if (clientSocket.readyState === WebSocket.OPEN || clientSocket.readyState === WebSocket.CONNECTING) clientSocket.close();
      if (upstreamSocket.readyState === WebSocket.OPEN || upstreamSocket.readyState === WebSocket.CONNECTING) upstreamSocket.close();
    };

    clientSocket.on('message', (data, isBinary) => {
      if (!isBinary) logFrame(connId, 'client_to_ha', String(data));
      if (upstreamSocket.readyState === WebSocket.OPEN) {
        upstreamSocket.send(data, { binary: isBinary });
        return;
      }
      queuedClientFrames.push({ data, isBinary });
    });
    upstreamSocket.on('open', () => {
      while (queuedClientFrames.length > 0 && upstreamSocket.readyState === WebSocket.OPEN) {
        const frame = queuedClientFrames.shift();
        upstreamSocket.send(frame.data, { binary: frame.isBinary });
      }
    });
    upstreamSocket.on('message', (data, isBinary) => {
      if (!isBinary) logFrame(connId, 'ha_to_client', String(data));
      if (clientSocket.readyState === WebSocket.OPEN) clientSocket.send(data, { binary: isBinary });
    });
    clientSocket.on('close', closeBoth);
    upstreamSocket.on('close', closeBoth);
    clientSocket.on('error', closeBoth);
    upstreamSocket.on('error', closeBoth);
  });
});

server.listen(listenPort, '127.0.0.1', () => {
  console.log(`relay listening on http://127.0.0.1:${listenPort}`);
  console.log(`capture log ${logPath}`);
});

function logFrame(connectionId, direction, payload) {
  const entry = {
    ts: new Date().toISOString(),
    connectionId,
    direction,
    payload,
  };
  fs.appendFileSync(logPath, JSON.stringify(entry) + '\n');
}
