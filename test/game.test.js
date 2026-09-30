import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { createGameServer } from '../server.js';
import { trajectory, position, resolveShot, hoopX, WORLD } from '../public/physics.js';

test('shots cross the rim descending, obey aim and reject baskets after the buzzer', () => {
  for (const dy of [-30, -140, -300]) {
    const t = trajectory(0, dy);
    assert.ok(t.vy + WORLD.gravity * t.crossing > 0);
    assert.ok(Math.abs(position(t, t.crossing).y - WORLD.rimY) < .0001);
    const start = 1000;
    const dx = (hoopX(t.crossing) - WORLD.x) / t.crossing / 2.3;
    assert.equal(resolveShot(dx, dy, start, start, 60000).hit, true);
    assert.equal(resolveShot(dx, dy, start, start, start + t.crossing * 1000 - 1).hit, false);
    assert.equal(resolveShot(-170, dy, start, start, 60000).hit, false);
  }
});

async function client(url) {
  const ws = new WebSocket(url); const messages = [];
  ws.on('message', raw => messages.push(JSON.parse(raw)));
  await once(ws, 'open');
  return { ws, send: data => ws.send(JSON.stringify(data)), async next(type, predicate = () => true, timeout = 3500) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      const i = messages.findIndex(m => m.type === type && predicate(m));
      if (i !== -1) return messages.splice(i, 1)[0];
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error(`Timed out waiting for ${type}: ${JSON.stringify(messages)}`);
  } };
}

test('multiplayer round: access control, settings, score, reconnect, results and replay', async t => {
  const game = createGameServer({ countdownMs: 80 });
  game.server.listen(0, '127.0.0.1'); await once(game.server, 'listening');
  t.after(() => game.close());
  const base = `http://127.0.0.1:${game.server.address().port}`;
  const wsUrl = base.replace('http', 'ws') + '/ws';
  assert.equal((await fetch(`${base}/health`)).status, 200);
  assert.equal((await fetch(`${base}/server.js`)).status, 404);
  assert.equal((await fetch(`${base}/api/rooms`, { method: 'POST', headers: { Origin: 'http://evil.example' } })).status, 403);
  const created = await (await fetch(`${base}/api/rooms`, { method: 'POST' })).json();
  const qr = await fetch(`${base}/api/qr?url=${encodeURIComponent(base + '/join/' + created.code)}`);
  assert.match(await qr.text(), /<svg/);
  const [host, alice, bob, attacker] = await Promise.all(Array.from({ length: 4 }, () => client(wsUrl)));
  host.send({ type: 'hello', code: created.code, role: 'host', token: created.hostToken });
  await host.next('state');
  attacker.send({ type: 'hello', code: created.code, role: 'host', token: 'wrong' });
  assert.match((await attacker.next('error')).message, /權限/);
  alice.send({ type: 'hello', code: created.code, name: 'Alice' });
  const saved = await alice.next('identity');
  bob.send({ type: 'hello', code: created.code, name: 'Bob' });
  await bob.next('identity');
  await host.next('state', m => m.room.players.length === 2);
  alice.send({ type: 'settings', duration: 20 });
  assert.match((await alice.next('error')).message, /主持人/);
  host.send({ type: 'settings', duration: 3 });
  assert.match((await host.next('error')).message, /15/);
  host.send({ type: 'settings', duration: 15 });
  assert.equal((await host.next('state', m => m.room.duration === 15)).room.duration, 15);
  host.send({ type: 'start' });
  const started = (await host.next('state', m => m.room.phase === 'countdown')).room;
  await new Promise(resolve => setTimeout(resolve, 110));
  attacker.send({ type: 'hello', code: created.code, name: 'Late' });
  assert.match((await attacker.next('error')).message, /已開始/);
  const motion = trajectory(0, -160);
  const target = hoopX((Date.now() - started.startAt) / 1000 + motion.crossing);
  alice.send({ type: 'shoot', dx: (target - WORLD.x) / motion.crossing / 2.3, dy: -160, score: 999 });
  const shot = await alice.next('shot'); assert.equal(shot.shot.hit, true);
  alice.send({ type: 'shoot', dx: 0, dy: -160 });
  assert.match((await alice.next('error')).message, /等球/);
  const result = await alice.next('result'); assert.equal(result.score, 2);
  const scored = (await host.next('state', m => m.room.players[0]?.score === 2)).room;
  assert.equal(scored.players[0].name, 'Alice'); assert.equal(scored.players[0].rank, 1);
  alice.ws.close(); await once(alice.ws, 'close');
  const resumed = await client(wsUrl);
  resumed.send({ type: 'hello', code: created.code, token: saved.token });
  assert.equal((await resumed.next('identity')).id, saved.id);
  assert.equal((await resumed.next('state')).room.players.find(p => p.id === saved.id).score, 2);
  // Advance the round deadline while preserving the production clock and tick.
  game.rooms.get(created.code).endsAt = Date.now() - 1;
  const ended = (await host.next('state', m => m.room.phase === 'ended')).room;
  assert.equal(ended.players[0].score, 2);
  resumed.send({ type: 'shoot', dx: 0, dy: -160 });
  assert.match((await resumed.next('error')).message, /目前無法/);
  host.send({ type: 'reset' });
  const reset = (await host.next('state', m => m.room.phase === 'lobby' && m.room.round === 1)).room;
  assert.ok(reset.players.every(p => p.score === 0 && p.shots === 0));
  assert.equal(reset.players.length, 2);
});
