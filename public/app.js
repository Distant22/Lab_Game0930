import { WORLD, hoopX, position, resolveShot, trajectory, clamp } from './physics.js';

const $ = selector => document.querySelector(selector);
const app = $('#app');
const esc = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const storage = { get(key) { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } }, set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} } };
const path = location.pathname.split('/');
const role = path[1], roomCode = path[2];
let socket, room, identity, renderer, offset = 0, reconnectTimer, reconnectAttempt = 0, intentional = false, page = '', awaitingShot = false;
let sound = storage.get('hoop-sound') ?? true;
const now = () => Date.now() + offset;
let audio;
function tone(hit) {
  if (!sound) return;
  try { audio ||= new (window.AudioContext || window.webkitAudioContext)(); audio.resume(); const osc = audio.createOscillator(), gain = audio.createGain(); osc.connect(gain); gain.connect(audio.destination); osc.frequency.setValueAtTime(hit ? 660 : 180, audio.currentTime); osc.frequency.exponentialRampToValueAtTime(hit ? 1100 : 90, audio.currentTime + .15); gain.gain.setValueAtTime(.07, audio.currentTime); gain.gain.exponentialRampToValueAtTime(.001, audio.currentTime + .2); osc.start(); osc.stop(audio.currentTime + .2); } catch {}
}
function toast(message) { $('#toast').textContent = message; $('#toast').classList.add('show'); clearTimeout(toast.timer); toast.timer = setTimeout(() => $('#toast').classList.remove('show'), 4200); }
function send(data) { if (socket?.readyState === WebSocket.OPEN) { socket.send(JSON.stringify(data)); return true; } toast('連線恢復後就能繼續'); return false; }
function brand() { return '<a class="brand" href="/" aria-label="首頁"><span class="brand-ball">◉</span> HOOP<span>PARTY</span><i>手滑籃球派對</i></a>'; }
function header(extra = '') { return `<header>${brand()}<div class="header-right">${extra}<span class="connection" id="connection">連線中</span></div></header>`; }
function soundButton() { return `<button class="icon-button" id="sound" aria-label="切換音效">${sound ? '音效 ON' : '音效 OFF'}</button>`; }
function bindSound() { $('#sound')?.addEventListener('click', () => { sound = !sound; storage.set('hoop-sound', sound); $('#sound').textContent = sound ? '音效 ON' : '音效 OFF'; if (sound) tone(true); }); }
function updateConnection() { const e = $('#connection'); if (!e) return; const ok = socket?.readyState === WebSocket.OPEN; e.textContent = ok ? '已連線' : intentional ? '已中斷' : '重新連線中'; e.classList.toggle('online', ok); }
function connect(credentials) {
  clearTimeout(reconnectTimer);
  socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`);
  socket.onopen = () => { updateConnection(); send({ type: 'ping', clientNow: Date.now() }); send({ type: 'hello', code: roomCode, ...credentials }); };
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.type === 'pong') offset = message.serverNow - (Date.now() + message.clientNow) / 2;
    if (message.type === 'identity') { identity = message; storage.set(`hoop-player-${roomCode}`, message); credentials.token = message.token; }
    if (message.type === 'state') { reconnectAttempt = 0; room = message.room; renderRoom(); }
    if (message.type === 'shot') { awaitingShot = false; if (renderer) renderer.shot = message.shot; }
    if (message.type === 'result') { if (renderer) renderer.feedback(message.hit); }
    if (message.type === 'error') { awaitingShot = false; toast(message.message); if (!room) { intentional = true; socket.close(); $('#join-submit')?.removeAttribute('disabled'); } else if (role === 'host') renderRoom(); }
    if (message.type === 'replaced') { intentional = true; toast('此身份已在另一個分頁開啟'); }
  };
  socket.onclose = () => { awaitingShot = false; updateConnection(); if (!intentional) reconnectTimer = setTimeout(() => connect(credentials), Math.min(1500 * 2 ** reconnectAttempt++, 15000) + Math.random() * 500); };
  socket.onerror = () => {};
}
setInterval(() => { if (socket?.readyState === WebSocket.OPEN) send({ type: 'ping', clientNow: Date.now() }); }, 10000);

function home() {
  app.innerHTML = `<div class="shell">${header('<span class="eyebrow desktop">THE EVERYONE-CAN-PLAY GAME</span>')}<main class="hero"><section class="hero-copy"><div class="pill"><span class="live-dot"></span> 掃一下，全場開打</div><h1>手滑一下。<br>全場<span class="orange">沸騰。</span><span class="title-star">✳</span></h1><p class="hero-description">把手機變成你的主場。<br>瞄準移動籃框，向上滑動，搶下今晚的 MVP。</p><div class="hero-actions"><button class="primary" id="create">建立派對 <span>↗</span></button><a class="secondary" href="/practice">先練幾球 ↗</a></div><form id="code-form" class="code-entry"><label for="code">有房間代碼？</label><div><input id="code" placeholder="輸入 6 碼" maxlength="6" minlength="6" pattern="[A-Za-z0-9]{6}" autocomplete="off" autocapitalize="characters" required><button type="submit" aria-label="加入房間">→</button></div></form><div class="hero-meta"><span>免下載</span><span>手機就能玩</span><span>即時排行榜</span></div></section><section class="hero-visual"><div class="court-caption"><span>YOUR PHONE. YOUR COURT.</span><span>01 / PLAY</span></div><canvas id="hero-canvas" aria-label="移動籃框遊戲預覽"></canvas><span class="floating-label">SWIPE. SHOOT. REPEAT.</span><span class="score-sticker">+2<small>漂亮！</small></span></section></main><section class="steps"><article><span>01</span><div><h3>開一場派對</h3><p>主持人設定時間，把 QR Code 放上大螢幕。</p></div></article><article><span>02</span><div><h3>掃碼，準備出手</h3><p>輸入暱稱，用手指向上滑動籃球。</p></div></article><article><span>03</span><div><h3>誰是今晚 MVP？</h3><p>每球 2 分，時間到一起揭曉排行榜。</p></div></article></section><footer><span>小小的球場，大大的勝負欲。</span><span>MADE FOR GOOD TIMES ↗</span></footer></div>`;
  $('#connection').remove();
  renderer = new Court($('#hero-canvas'), { demo: true });
  $('#create').onclick = async () => {
    $('#create').disabled = true; $('#create').textContent = '正在準備球場…';
    try { const response = await fetch('/api/rooms', { method: 'POST' }); const data = await response.json(); if (!response.ok) throw new Error(data.error); storage.set(`hoop-host-${data.code}`, data.hostToken); location.href = `/host/${data.code}`; } catch (e) { toast(e.message); $('#create').disabled = false; $('#create').textContent = '建立派對 ↗'; }
  };
  $('#code-form').onsubmit = e => { e.preventDefault(); location.href = `/join/${$('#code').value.trim().toUpperCase()}`; };
}
function join() {
  app.innerHTML = `<div class="shell">${header()}<main class="join-layout"><div class="join-art"><div class="big-ball">✳</div><p>LET’S PLAY<br><strong>SOME BALL.</strong></p></div><section class="panel join-panel"><div class="eyebrow">YOU’RE INVITED</div><h1>準備好<br>大顯身手？</h1><p class="muted">房間 <b>${esc(roomCode)}</b> · 每球 2 分，手感決定勝負。</p><form id="join-form"><label for="name">你的球場暱稱</label><input id="name" maxlength="16" required placeholder="例如：三分球小王子" autocomplete="nickname"><button id="join-submit" class="primary" type="submit">加入球場 <span>↗</span></button></form><p class="fine">向上滑動投球 · 左右方向控制瞄準<br>籃框一直移動，抓準出手時機！</p></section></main></div>`;
  $('#connection').textContent = '等待加入';
  $('#join-form').onsubmit = e => { e.preventDefault(); intentional = false; $('#join-submit').disabled = true; connect({ role: 'player', name: $('#name').value.trim() }); };
  const saved = storage.get(`hoop-player-${roomCode}`);
  if (saved) { identity = saved; $('#name').value = saved.name; connect({ role: 'player', token: saved.token, name: saved.name }); }
}
function leaderboard(players, full = false) {
  if (!players.length) return '<div class="empty"><span>↗</span><h3>球員集合中</h3><p>第一位 MVP，也許就是你。</p></div>';
  return players.slice(0, full ? 100 : 8).map(p => `<div class="ranking-row ${p.id === identity?.id ? 'is-me' : ''}"><span class="rank ${p.rank === 1 ? 'first' : ''}">${String(p.rank).padStart(2, '0')}</span><span class="avatar">${esc(Array.from(p.name)[0])}</span><span class="player-name">${esc(p.name)}${p.id === identity?.id ? '<small>你</small>' : ''}<i class="presence ${p.online ? 'on' : ''}" title="${p.online ? '在線' : '離線'}"></i></span><strong>${p.score}<small>分</small></strong></div>`).join('');
}
function hostPage() {
  page = 'host';
  app.innerHTML = `<div class="shell host-shell">${header('<button class="icon-button" id="fullscreen">全螢幕 ⛶</button>')}<div class="page-title"><div><div class="eyebrow">THE PARTY STARTS HERE</div><h1 id="host-title">今晚的主場。</h1></div><span class="pill">HOST CONTROL</span></div><main class="host-grid"><section class="panel invite-panel"><div class="section-label">01 / INVITE YOUR CREW</div><h2>掃碼，加入球場</h2><div class="qr-wrap"><img id="qr" width="224" height="224" alt="掃描 QR Code 加入遊戲"></div><div class="room-code"><span>房間代碼</span><strong>${esc(roomCode)}</strong></div><button class="secondary full" id="copy">複製邀請連結 ↗</button><p id="local-warning" class="fine"></p><label class="fine" for="invite-url">手機可連線的網址</label><div class="url-entry"><input id="invite-url" aria-label="邀請網址"><button id="update-qr" class="icon-button">更新 QR</button></div></section><section class="panel control-panel"><div class="section-label">02 / SET THE CLOCK</div><div class="clock-label" id="clock-label">每回合時間</div><div class="host-clock"><strong id="host-clock">60</strong><span>SEC</span></div><div id="settings"><div class="presets">${[30, 60, 90, 120].map(n => `<button data-duration="${n}" class="preset ${n === 60 ? 'selected' : ''}">${n}s</button>`).join('')}</div><label class="custom-duration" for="duration">自訂秒數 <input id="duration" type="number" min="15" max="300" value="60"> <span>15–300 秒</span></label></div><div class="rules"><span>↗ 向上滑動投球</span><span>◎ 移動籃框 · 每球 2 分</span><span>◷ 統一倒數 · 同步結算</span></div><button id="start" class="primary full">全員就位，開始！ ↗</button><button id="reset" class="primary full hidden">再來一場 ↗</button><p class="fine" id="host-hint">至少一位玩家加入後，就能開始。</p></section><section class="panel leaderboard-panel"><div class="leader-heading"><div><div class="section-label">03 / THE LEADERBOARD</div><h2 id="leader-title">球員集合</h2></div><span class="count" id="count">0 人</span></div><div id="winner" class="winner hidden"></div><div id="leaderboard"></div><button id="export" class="secondary full hidden">下載本回合成績 ↓</button></section></main><footer><span>大螢幕開著，手機準備好。</span><span>GOOD LUCK. HAVE FUN.</span></footer></div>`;
  const invite = `${location.origin}/join/${roomCode}`;
  $('#invite-url').value = invite;
  const updateQr = () => { try { const target = new URL($('#invite-url').value); if (!['http:', 'https:'].includes(target.protocol)) throw Error(); target.pathname = `/join/${roomCode}`; target.search = ''; target.hash = ''; $('#invite-url').value = target.href; $('#qr').src = `/api/qr?url=${encodeURIComponent(target.href)}`; } catch { toast('請填入完整的 http 或 https 網址'); } };
  updateQr(); $('#update-qr').onclick = updateQr;
  if (['localhost', '127.0.0.1'].includes(location.hostname)) $('#local-warning').textContent = '本機測試：請改填電腦的區網 IP 網址，手機與電腦需連同一個 Wi-Fi。';
  $('#copy').onclick = async () => { try { await navigator.clipboard.writeText($('#invite-url').value); toast('邀請連結已複製'); } catch { $('#invite-url').select(); toast('請複製上方邀請網址'); } };
  $('#fullscreen').onclick = () => { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen?.().catch(() => toast('此瀏覽器不支援全螢幕')); };
  document.querySelectorAll('[data-duration]').forEach(button => button.onclick = () => send({ type: 'settings', duration: Number(button.dataset.duration) }));
  $('#duration').onchange = () => { const value = Number($('#duration').value); if (!Number.isInteger(value) || value < 15 || value > 300) { toast('請輸入 15～300 的整數秒數'); $('#duration').value = room.duration; return; } send({ type: 'settings', duration: value }); };
  $('#start').onclick = () => { $('#start').disabled = true; send({ type: 'start' }); };
  $('#reset').onclick = () => send({ type: 'reset' });
  $('#export').onclick = () => {
    const safe = value => `"${String(value).replace(/^[=+@\-\t\r]/, "'$&").replaceAll('"', '""')}"`;
    const csv = '\ufeff名次,暱稱,分數,出手次數\r\n' + room.players.map(p => [p.rank, p.name, p.score, p.shots].map(safe).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })); const a = document.createElement('a'); a.href = url; a.download = `hoop-${room.code}-round${room.round}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  updateConnection();
}
function renderRoom() {
  if (role === 'host') {
    if (page !== 'host') hostPage();
    const lobby = room.phase === 'lobby', ended = room.phase === 'ended';
    $('#host-title').textContent = ended ? '今晚，誰最準？' : lobby ? '今晚的主場。' : '全場，火力全開。';
    $('#settings').classList.toggle('hidden', !lobby);
    $('#start').classList.toggle('hidden', !lobby); $('#start').disabled = !room.players.some(p => p.online);
    $('#reset').classList.toggle('hidden', !ended); $('#export').classList.toggle('hidden', !ended);
    $('#host-hint').textContent = ended ? '準備好就再來一場，玩家會留在房間。' : lobby ? '所有玩家加入後再開始；開局後暫停新玩家加入。' : '比賽進行中，分數即時同步。';
    if (document.activeElement !== $('#duration')) $('#duration').value = room.duration;
    document.querySelectorAll('[data-duration]').forEach(b => b.classList.toggle('selected', Number(b.dataset.duration) === room.duration));
    $('#clock-label').textContent = ended ? '本回合結束' : lobby ? '每回合時間' : room.phase === 'countdown' ? '準備開打' : '剩餘時間';
    $('#count').textContent = `${room.players.filter(p => p.online).length} / ${room.players.length} 人在線`;
    $('#leader-title').textContent = ended ? '最終排行榜' : lobby ? '球員集合' : '即時排行榜';
    $('#leaderboard').innerHTML = leaderboard(room.players, true);
    $('#winner').classList.toggle('hidden', !ended || !room.players.length);
    if (ended && room.players.length) $('#winner').textContent = `★ ${room.players.filter(p => p.rank === 1).map(p => p.name).join(' & ')} · MVP`;
    updateHostClock();
  } else {
    if (room.phase === 'ended') { if (page !== 'results') resultsPage(); $('#results-list').innerHTML = leaderboard(room.players, true); return; }
    if (page !== 'game') gamePage();
    renderer.round = room;
    const me = room.players.find(p => p.id === identity?.id);
    $('#score').textContent = me?.score || 0;
    $('#my-rank').textContent = me ? `#${me.rank}` : '—';
    $('#waiting-count').textContent = `${room.players.filter(p => p.online).length} 位球員已就位`;
    $('#game-overlay').classList.toggle('hidden', room.phase === 'playing');
    $('#overlay-title').textContent = room.phase === 'lobby' ? '你已就位！' : '準備出手';
    $('#overlay-subtitle').textContent = room.phase === 'lobby' ? '等主持人開始，大家一起開打。' : '看準籃框，向上滑動';
  }
  updateConnection();
}
function updateHostClock() { if (!room || !$('#host-clock')) return; $('#host-clock').textContent = room.phase === 'lobby' ? room.duration : Math.max(0, Math.ceil(((now() < room.startAt ? room.startAt : room.endsAt) - now()) / 1000)); }
setInterval(updateHostClock, 100);
function gamePage(practice = false) {
  renderer?.destroy(); page = 'game';
  app.innerHTML = `<div class="player-shell">${header(soundButton())}<main class="player-main"><div class="player-top"><div><span class="eyebrow">${practice ? 'PRACTICE COURT' : `ROOM ${esc(roomCode)}`}</span><h2>${practice ? '找到你的手感。' : `${esc(identity?.name || '球員')}，上場！`}</h2></div>${practice ? '<a class="text-link" href="/">回首頁 ↗</a>' : '<span class="pill" id="my-rank">#1</span>'}</div><div class="game-stats"><div><span>本場得分</span><strong id="score">0</strong></div><div><span>剩餘秒數</span><strong id="timer">60</strong></div></div><div class="court-container"><canvas id="game-canvas" aria-label="籃球場，從籃球往上滑動來投球"></canvas><div id="game-overlay" class="game-overlay ${practice ? 'hidden' : ''}"><span class="eyebrow">LET’S MAKE SOME NOISE</span><h2 id="overlay-title">你已就位！</h2><p id="overlay-subtitle">等主持人開始，大家一起開打。</p><strong id="countdown"></strong><span id="waiting-count"></span></div></div><div class="game-tip"><span>↑</span><p>從籃球向上滑動放開<br><small>左右滑動控制方向，滑得越遠投得越高</small></p></div>${practice ? '<button id="practice-reset" class="secondary full">重新練習 ↻</button>' : ''}</main></div>`;
  if (practice) $('#connection').remove();
  bindSound();
  renderer = new Court($('#game-canvas'), { practice, onShoot: (dx, dy) => {
    if (awaitingShot) return;
    if (send({ type: 'shoot', dx, dy })) { awaitingShot = true; renderer.shot = resolveShot(dx, dy, now(), room.startAt, room.endsAt); }
  } });
  if (practice) { renderer.round = { phase: 'playing', startAt: now(), endsAt: now() + 60000 }; $('#practice-reset').onclick = () => gamePage(true); }
}
function resultsPage() {
  renderer?.destroy(); page = 'results';
  const me = room.players.find(p => p.id === identity?.id);
  app.innerHTML = `<div class="shell results-shell">${header()}<main><section class="result-hero"><span class="eyebrow">THAT’S A WRAP · ROUND ${room.round}</span><div class="trophy">✳</div><h1>${me?.rank === 1 ? '這場，你最耀眼。' : '好球，下場再戰！'}</h1><p>你拿下 <strong>${me?.score || 0} 分</strong> · 排名 <strong>#${me?.rank || '—'}</strong></p><span class="pill">等待主持人開啟下一回合</span></section><section class="panel result-board"><div class="leader-heading"><h2>最終排行榜</h2><span class="eyebrow">${room.players.length} PLAYERS</span></div><div id="results-list"></div></section></main></div>`;
  updateConnection();
}

class Court {
  constructor(canvas, options = {}) {
    this.canvas = canvas; this.ctx = canvas.getContext('2d'); this.options = options; this.born = now(); this.shot = null; this.drag = null; this.score = 0; this.flash = 0; this.stopped = false;
    this.resize = () => { const r = canvas.getBoundingClientRect(); const dpr = Math.min(devicePixelRatio || 1, 2); canvas.width = r.width * dpr; canvas.height = r.height * dpr; };
    this.observer = new ResizeObserver(this.resize); this.observer.observe(canvas); this.resize();
    const point = e => { const r = canvas.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width * WORLD.width, y: (e.clientY - r.top) / r.height * WORLD.height }; };
    canvas.onpointerdown = e => {
      if (!this.canShoot()) return;
      const p = point(e); if (Math.hypot(p.x - WORLD.x, p.y - WORLD.y) > 90) { toast('從下方籃球開始向上滑'); return; }
      try { audio ||= new (window.AudioContext || window.webkitAudioContext)(); audio.resume(); } catch {}
      canvas.setPointerCapture(e.pointerId); this.pointer = e.pointerId; this.drag = { start: p, end: p };
    };
    canvas.onpointermove = e => { if (this.drag && this.pointer === e.pointerId) this.drag.end = point(e); };
    canvas.onpointerup = e => {
      if (!this.drag || this.pointer !== e.pointerId) return;
      const dx = this.drag.end.x - this.drag.start.x, dy = this.drag.end.y - this.drag.start.y; this.drag = null;
      if (dy > -25 || !this.canShoot()) return;
      if (options.practice) { this.shot = resolveShot(dx, dy, now(), this.round.startAt, this.round.endsAt); this.shot.resolved = false; }
      else options.onShoot?.(dx, dy);
    };
    canvas.onpointercancel = () => { this.drag = null; };
    this.frame = this.frame.bind(this); this.frame();
  }
  canShoot() { return !this.options.demo && this.round?.phase === 'playing' && now() >= this.round.startAt && now() < this.round.endsAt && !this.shot && (this.options.practice || socket?.readyState === WebSocket.OPEN); }
  feedback(hit) { this.flash = now(); this.hit = hit; tone(hit); if (hit && navigator.vibrate) navigator.vibrate(30); }
  destroy() { this.stopped = true; cancelAnimationFrame(this.raf); this.observer.disconnect(); }
  frame() {
    if (this.stopped) return;
    const { ctx: c, canvas } = this; c.setTransform(canvas.width / 400, 0, 0, canvas.height / 640, 0, 0);
    const time = now(), elapsed = (time - (this.round?.startAt || this.born)) / 1000;
    const hx = hoopX(Math.max(0, elapsed));
    c.fillStyle = '#173e34'; c.fillRect(0, 0, 400, 640);
    const gradient = c.createLinearGradient(0, 0, 0, 640); gradient.addColorStop(0, '#102d26'); gradient.addColorStop(1, '#245b46'); c.fillStyle = gradient; c.fillRect(0, 0, 400, 640);
    c.strokeStyle = '#b5d0a922'; c.lineWidth = 1;
    for (let y = 0; y < 640; y += 32) { c.beginPath(); c.moveTo(0, y); c.lineTo(400, y); c.stroke(); }
    for (let x = 0; x < 400; x += 40) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, 640); c.stroke(); }
    c.strokeStyle = '#d7e8c43b'; c.lineWidth = 2; c.strokeRect(26, 354, 348, 290); c.strokeRect(120, 354, 160, 166);
    c.beginPath(); c.ellipse(200, 518, 80, 35, 0, 0, Math.PI * 2); c.stroke(); c.beginPath(); c.ellipse(200, 530, 230, 100, 0, Math.PI, 2 * Math.PI); c.stroke();
    c.fillStyle = '#dce7c330'; c.font = 'bold 13px system-ui'; c.textAlign = 'center'; c.fillText('H O O P   P A R T Y', 200, 60);
    c.fillStyle = '#0c231f66'; c.beginPath(); c.ellipse(hx, 335, 53, 10, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#efecd8'; c.beginPath(); c.roundRect(hx - 66, 142, 132, 99, 9); c.fill();
    c.strokeStyle = '#839786'; c.lineWidth = 3; c.strokeRect(hx - 55, 153, 110, 77); c.strokeStyle = '#f47b44'; c.strokeRect(hx - 25, 193, 50, 37);
    // Net and rear rim; the descending ball is layered behind the front rim.
    c.strokeStyle = '#ecf1d9ad'; c.lineWidth = 1.6;
    for (let n = 0; n <= 8; n++) { const x = hx - 41 + n * 10.25; c.beginPath(); c.moveTo(x, 247); c.lineTo(hx + (x - hx) * .65 + 5, 290); c.stroke(); }
    for (let y = 257; y < 292; y += 11) { const w = 40 - (y - 247) * .31; c.beginPath(); c.ellipse(hx, y, w, 5, 0, 0, Math.PI * 2); c.stroke(); }
    c.strokeStyle = '#ff8755'; c.lineWidth = 6; c.beginPath(); c.ellipse(hx, 246, 41, 9, 0, Math.PI, 2 * Math.PI); c.stroke();
    if (this.options.demo && !this.shot && elapsed > 1) { const m = trajectory(0, -160); const target = hoopX(elapsed + m.crossing); this.shot = resolveShot((target - 200) / m.crossing / 2.3, -160, time, this.born, Infinity); }
    let bx = 200, by = 535, radius = 27, rotation = 0;
    if (this.shot) {
      const t = (time - this.shot.startedAt) / 1000;
      const p = position(this.shot, Math.max(0, t)); bx = p.x; by = p.y; radius = 27 - Math.min(t / this.shot.crossing, 1) * 12; rotation = t * 5;
      if (this.shot.hit && t > this.shot.crossing) { bx = hoopX((this.shot.crossingAt - (this.round?.startAt || this.born)) / 1000); by = WORLD.rimY + (t - this.shot.crossing) * 500; }
      if ((this.options.practice || this.options.demo) && time >= this.shot.crossingAt && !this.shot.resolved) { this.shot.resolved = true; if (this.shot.hit) this.score += 2; if (this.options.practice) { this.feedback(this.shot.hit); $('#score').textContent = this.score; } }
      if (t >= this.shot.lifetime) this.shot = null;
    }
    if (this.drag) {
      const motion = trajectory(this.drag.end.x - this.drag.start.x, this.drag.end.y - this.drag.start.y);
      c.fillStyle = '#f4edc777'; for (let t = .08; t < .7; t += .08) { const p = position(motion, t); c.beginPath(); c.arc(p.x, p.y, 2.5, 0, 7); c.fill(); }
    }
    if (!this.shot) { c.fillStyle = '#081d2255'; c.beginPath(); c.ellipse(200, 572, 35, 9, 0, 0, 7); c.fill(); }
    c.save(); c.translate(bx, by); c.rotate(rotation); c.fillStyle = '#fa8245'; c.strokeStyle = '#6f3420'; c.lineWidth = 1.7; c.beginPath(); c.arc(0, 0, radius, 0, 7); c.fill(); c.stroke(); c.beginPath(); c.moveTo(-radius, 0); c.lineTo(radius, 0); c.moveTo(0, -radius); c.lineTo(0, radius); c.moveTo(-radius * .65, -radius * .75); c.bezierCurveTo(radius * .5, -radius * .2, radius * .5, radius * .2, -radius * .65, radius * .75); c.moveTo(radius * .65, -radius * .75); c.bezierCurveTo(-radius * .5, -radius * .2, -radius * .5, radius * .2, radius * .65, radius * .75); c.stroke(); c.restore();
    c.strokeStyle = '#ff9867'; c.lineWidth = 6; c.beginPath(); c.ellipse(hx, 246, 41, 9, 0, 0, Math.PI); c.stroke();
    if (!this.shot && !this.options.demo) { c.fillStyle = '#ecedcd99'; c.font = '12px system-ui'; c.fillText('↑  往上滑，投出你的好球', 200, 608); }
    if (time - this.flash < 900) { c.globalAlpha = 1 - (time - this.flash) / 900; c.fillStyle = this.hit ? '#e7f3b0' : '#ffb184'; c.font = '900 38px system-ui'; c.fillText(this.hit ? '+2  NICE!' : '差一點！', 200, 360 - (time - this.flash) / 30); c.globalAlpha = 1; }
    if ($('#timer') && this.round) { const left = Math.max(0, Math.ceil((this.round.endsAt - time) / 1000)); $('#timer').textContent = this.round.phase === 'lobby' ? room.duration : this.round.phase === 'countdown' ? room.duration : left; $('#timer').classList.toggle('urgent', left <= 10 && this.round.phase === 'playing');
      if ($('#countdown')) $('#countdown').textContent = this.round.phase === 'countdown' ? Math.max(1, Math.ceil((this.round.startAt - time) / 1000)) : '';
      if (this.options.practice && left === 0) { this.round.phase = 'ended'; $('#game-overlay').classList.remove('hidden'); $('#overlay-title').textContent = `練習完成 · ${this.score} 分`; $('#overlay-subtitle').textContent = '再練一場，或回首頁邀朋友一起玩。'; }
    }
    this.raf = requestAnimationFrame(this.frame);
  }
}

if (role === 'host' && roomCode) {
  hostPage(); const credential = storage.get(`hoop-host-${roomCode}`);
  if (credential) connect({ role: 'host', token: credential }); else { intentional = true; updateConnection(); toast('請使用建立此房間的瀏覽器開啟主持人頁面'); }
} else if (role === 'join' && roomCode) join();
else if (role === 'practice') gamePage(true);
else home();
