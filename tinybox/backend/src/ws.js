'use strict';
/**
 * WebSocket router shared by all features (market data streams, server
 * consoles, notifications...). Handlers register a path prefix:
 *
 *   ctx.ws.route('/ws/market', (socket, req, info) => { ... });   // info.user is set when ?token= is valid
 *
 * The server attaches it with ctx.attach(httpServer). Uses the `ws` package
 * (https://github.com/websockets/ws) in noServer mode so it can share the
 * Express HTTP server.
 */
const { WebSocketServer } = require('ws');

class WsRouter {
  constructor({ auth, log = console }) {
    this.auth = auth; this.log = log;
    this.routes = [];
    this.wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });
    this.wss.on('connection', (socket) => { socket.isAlive = true; socket.on('pong', () => { socket.isAlive = true; }); });
    this.ping = setInterval(() => {
      for (const s of this.wss.clients) { if (s.isAlive === false) { s.terminate(); continue; } s.isAlive = false; try { s.ping(); } catch {} }
    }, 30000);
    this.ping.unref?.();
  }

  route(prefix, handler) { this.routes.push({ prefix, handler }); return this; }

  attach(server) {
    server.on('upgrade', (req, socket, head) => {
      let url;
      try { url = new URL(req.url, 'http://x'); } catch { return socket.destroy(); }
      const r = this.routes.find((x) => url.pathname === x.prefix || url.pathname.startsWith(x.prefix + '/'));
      if (!r) return socket.destroy();
      const token = url.searchParams.get('token') || (req.headers['sec-websocket-protocol'] || '').split(',').map((s) => s.trim()).find((s) => s.startsWith('bearer.'))?.slice(7);
      const user = token && this.auth ? this.auth.verifyToken(token) : null;
      this.wss.handleUpgrade(req, socket, head, (ws) => {
        this.wss.emit('connection', ws, req);
        try { r.handler(ws, req, { user, url, path: url.pathname.slice(r.prefix.length) }); } catch (e) { this.log.error?.('[ws]', e.message); ws.close(1011, 'internal error'); }
      });
    });
    return this;
  }

  /** Send JSON safely. */
  static send(ws, msg) { if (ws.readyState === 1) { try { ws.send(JSON.stringify(msg)); } catch {} } }
  close() { clearInterval(this.ping); for (const c of this.wss.clients) c.terminate(); }
}

module.exports = { WsRouter };
