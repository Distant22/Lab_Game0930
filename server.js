import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomInt } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import QRCode from 'qrcode';
import { resolveShot } from './public/physics.js';

const token = () => randomBytes(24).toString('hex');
const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const code = () => Array.from({ length: 6 }, () => alphabet[randomInt(alphabet.length)]).join('');
const json = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };

export function createGameServer({ countdownMs = 3000 } = {}) {
  const rooms = new Map();
  const creationLimits = new Map();
  const send = (ws, data) => { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data)); };
  const phase = (room, now = Date.now()) => !room.startAt ? 'lobby' : now < room.startAt ? 'countdown' : now < room.endsAt ? 'playing' : 'ended';
  function state(room) {
    const players = [...room.players.values()].sort((a, b) => b.score - a.score || a.joinedAt - b.joinedAt);
    let previousScore, rank;
    return { code: room.code, duration: room.duration, phase: phase(room), startAt: room.startAt, endsAt: room.endsAt, round: room.round,
      players: players.map((p, i) => { if (p.score !== previousScore) rank = i + 1; previousScore = p.score; return { id: p.id, name: p.name, score: p.score, shots: p.shots, rank, online: p.socket?.readyState === WebSocket.OPEN }; }) };
  }
  function broadcast(room) {
    const payload = { type: 'state', serverNow: Date.now(), room: state(room) };
    send(room.hostSocket, payload);
    for (const p of room.players.values()) send(p.socket, payload);
  }
  function settle(room, now = Date.now()) {
    for (const p of room.players.values()) {
      if (p.pending && now >= p.pending.crossingAt) {
        if (p.pending.hit) p.score += 2;
        send(p.socket, { type: 'result', id: p.pending.id, hit: p.pending.hit, score: p.score });
        p.pending = null;
      }
    }
  }
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
    try {
      const url = new URL(req.url, 'http://localhost');
      if (req.method === 'GET' && url.pathname === '/health') return json(res, 200, { ok: true });
      if (req.method === 'POST' && url.pathname === '/api/rooms') {
        const origin = req.headers.origin;
        if (origin && new URL(origin).host !== req.headers.host) return json(res, 403, { error: '來源不符' });
        const ip = req.socket.remoteAddress;
        const limit = creationLimits.get(ip) || { at: Date.now(), count: 0 };
        if (Date.now() - limit.at > 60000) { limit.at = Date.now(); limit.count = 0; }
        if (++limit.count > 30 || rooms.size >= 1000) return json(res, 429, { error: '建立太頻繁，請稍後再試' });
        creationLimits.set(ip, limit);
        let roomCode = code(); while (rooms.has(roomCode)) roomCode = code();
        const room = { code: roomCode, hostToken: token(), duration: 60, startAt: 0, endsAt: 0, round: 0, players: new Map(), hostSocket: null, touched: Date.now() };
        rooms.set(roomCode, room);
        return json(res, 201, { code: room.code, hostToken: room.hostToken });
      }
      if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' });
      if (url.pathname === '/api/qr') {
        const target = url.searchParams.get('url') || '';
        if (target.length > 600 || !/^https?:\/\//.test(target)) return json(res, 400, { error: 'Invalid URL' });
        res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=3600' });
        return res.end(await QRCode.toString(target, { type: 'svg', margin: 2, color: { dark: '#172923', light: '#ffffff' } }));
      }
      const assets = { '/app.js': 'text/javascript', '/physics.js': 'text/javascript', '/styles.css': 'text/css', '/favicon.svg': 'image/svg+xml' };
      const isPage = url.pathname === '/' || url.pathname === '/practice' || /^\/(host|join)\/[A-Z0-9]{6}$/.test(url.pathname);
      if (!isPage && !assets[url.pathname]) return json(res, 404, { error: 'Not found' });
      const file = isPage ? 'index.html' : url.pathname.slice(1);
      const content = await readFile(fileURLToPath(new URL(`./public/${file}`, import.meta.url)));
      res.writeHead(200, { 'Content-Type': isPage ? 'text/html; charset=utf-8' : assets[url.pathname], 'Cache-Control': 'no-cache' });
      res.end(content);
    } catch { if (!res.headersSent) json(res, 500, { error: '服務暫時無法使用' }); else res.end(); }
  });
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 4096, verifyClient: ({ origin, req }) => {
    try { return !origin || new URL(origin).host === req.headers.host; } catch { return false; }
  } });
  wss.on('connection', ws => {
    let room, player, host = false;
    let count = 0, windowStart = Date.now();
    ws.alive = true;
    ws.on('pong', () => { ws.alive = true; });
    const fail = message => send(ws, { type: 'error', message });
    ws.on('message', raw => {
      try {
        if (Date.now() - windowStart > 1000) { count = 0; windowStart = Date.now(); }
        if (++count > 25) return ws.close(1008, 'Too many messages');
        const msg = JSON.parse(raw.toString());
        if (!msg || typeof msg !== 'object') return fail('訊息格式錯誤');
        if (msg.type === 'ping') return send(ws, { type: 'pong', clientNow: msg.clientNow, serverNow: Date.now() });
        if (msg.type === 'hello') {
          if (room) return fail('已加入房間');
          const found = rooms.get(String(msg.code).toUpperCase());
          if (!found) return fail('找不到房間，請確認代碼；伺服器重啟後需重新開房。');
          if (msg.role === 'host') {
            if (msg.token !== found.hostToken) return fail('這個瀏覽器沒有此房間的主持人權限');
            room = found; host = true;
            if (room.hostSocket) { send(room.hostSocket, { type: 'replaced' }); room.hostSocket.close(); }
            room.hostSocket = ws;
          } else {
            player = [...found.players.values()].find(p => p.token === msg.token);
            if (!player) {
              if (phase(found) !== 'lobby') return fail('這一回合已開始，請等主持人開啟下一回合再加入');
              if (found.players.size >= 100) return fail('房間已滿（最多 100 人）');
              const name = String(msg.name || '').trim().replace(/[\x00-\x1f\x7f]/g, '').slice(0, 16);
              if (!name) return fail('請輸入暱稱');
              player = { id: token().slice(0, 12), token: token(), name, score: 0, shots: 0, joinedAt: Date.now(), pending: null, nextShotAt: 0 };
              found.players.set(player.id, player);
            }
            room = found;
            if (player.socket) { send(player.socket, { type: 'replaced' }); player.socket.close(); }
            player.socket = ws;
            send(ws, { type: 'identity', id: player.id, token: player.token, name: player.name });
          }
          room.touched = Date.now(); broadcast(room); return;
        }
        if (!room) return fail('請先加入房間');
        room.touched = Date.now();
        if (host && room.hostSocket !== ws || player && player.socket !== ws) return;
        if (msg.type === 'settings') {
          if (!host || phase(room) !== 'lobby') return fail('只有主持人可以在等待室調整時間');
          if (!Number.isInteger(msg.duration) || msg.duration < 15 || msg.duration > 300) return fail('時間請設為 15～300 秒');
          room.duration = msg.duration; broadcast(room);
        } else if (msg.type === 'start') {
          if (!host || phase(room) !== 'lobby') return fail('目前無法開局');
          if (![...room.players.values()].some(p => p.socket?.readyState === WebSocket.OPEN)) return fail('至少需要一位在線玩家');
          room.startAt = Date.now() + countdownMs; room.endsAt = room.startAt + room.duration * 1000; room.round++;
          broadcast(room);
        } else if (msg.type === 'reset') {
          if (!host || phase(room) !== 'ended') return fail('遊戲結束後才能開下一回合');
          room.startAt = 0; room.endsAt = 0;
          for (const p of room.players.values()) { p.score = 0; p.shots = 0; p.pending = null; p.nextShotAt = 0; }
          broadcast(room);
        } else if (msg.type === 'shoot') {
          const now = Date.now();
          if (!player || phase(room, now) !== 'playing') return fail('目前無法投籃');
          if (now < player.nextShotAt) return fail('等球回來再投一次');
          if (!Number.isFinite(msg.dx) || !Number.isFinite(msg.dy) || msg.dy > -25 || Math.abs(msg.dx) > 400 || msg.dy < -640) return fail('請向上滑動投籃');
          settle(room, now);
          const shot = { ...resolveShot(msg.dx, msg.dy, now, room.startAt, room.endsAt), id: token().slice(0, 12) };
          player.pending = shot; player.shots++; player.nextShotAt = now + shot.lifetime * 1000;
          send(ws, { type: 'shot', shot });
        }
      } catch { fail('訊息格式錯誤'); }
    });
    ws.on('close', () => {
      if (player?.socket === ws) player.socket = null;
      if (host && room?.hostSocket === ws) room.hostSocket = null;
      if (room) broadcast(room);
    });
    ws.on('error', () => {});
  });
  let lastBroadcast = 0;
  const tick = setInterval(() => {
    const now = Date.now();
    for (const room of rooms.values()) {
      settle(room, now);
      if (now - lastBroadcast >= 500 && room.startAt) broadcast(room);
      const active = room.hostSocket?.readyState === WebSocket.OPEN || [...room.players.values()].some(p => p.socket?.readyState === WebSocket.OPEN);
      if (active) room.touched = now;
      if (!active && now - room.touched > 2 * 60 * 60 * 1000) rooms.delete(room.code);
    }
    if (now - lastBroadcast >= 500) lastBroadcast = now;
    for (const [ip, limit] of creationLimits) if (now - limit.at > 60000) creationLimits.delete(ip);
  }, 50);
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) { if (!ws.alive) ws.terminate(); else { ws.alive = false; ws.ping(); } }
  }, 30000);
  async function close() { clearInterval(tick); clearInterval(heartbeat); for (const ws of wss.clients) ws.terminate(); await new Promise(resolve => wss.close(resolve)); await new Promise(resolve => server.close(resolve)); }
  return { server, rooms, close };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const app = createGameServer();
  const port = Number(process.env.PORT || 3000);
  app.server.listen(port, '0.0.0.0', () => console.log(`HOOP PARTY → http://localhost:${port}`));
  process.on('SIGTERM', async () => { await app.close(); process.exit(0); });
}
