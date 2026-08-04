const express = require('express');
const axios = require('axios');

const PORT = process.env.PORT || 3000;
const KEY = process.env.MASTER_KEY || '6aa4d57f015a6dfc2bb6aa76bbaab113';

const BOTS = [
  { name: 'zenquant-claim-bot', region: 'Oregon', url: 'https://zenquant-claim-bot-32ob.onrender.com', tg: '@Fahimzenbot' },
  { name: 'deloyarbot', region: 'Frankfurt', url: 'https://deloyarbot.onrender.com', tg: '@Zenclaimv9bot' },
  { name: 'pervejbot', region: 'Singapore', url: 'https://pervejbot.onrender.com', tg: '?' },
  { name: 'fahimbot-ohio', region: 'Ohio', url: 'https://fahimbot-ohio.onrender.com', tg: '@Zenclaimv13bot' },
  { name: 'faysal-bot', region: 'Virginia', url: 'https://faysal-bot.onrender.com', tg: '@Zenclaimv21bot' },
  { name: 'imran-bot-kngs', region: 'Frankfurt', url: 'https://imran-bot-kngs.onrender.com', tg: '@Zenclaimv26bot' },
  { name: 'tanji-bot', region: 'Singapore', url: 'https://tanji-bot.onrender.com', tg: '@Zenclaimv27bot' },
  { name: 'adrian-bot-pojh', region: 'Oregon', url: 'https://adrian-bot-pojh.onrender.com', tg: '@Zenclaimv28bot' },
  { name: 'raju-bot-fn93', region: 'Virginia', url: 'https://raju-bot-fn93.onrender.com', tg: '@Zenclaimv29bot' },
  { name: 'tanova-bot', region: 'Frankfurt', url: 'https://tanova-bot.onrender.com', tg: '@Zenclaimv30bot' },
  { name: 'rayhan-bot-qo70', region: 'Singapore', url: 'https://rayhan-bot-qo70.onrender.com', tg: '@Zenclaimv31bot' },
  { name: 'muntasir-bot-xbe4', region: 'Ohio', url: 'https://muntasir-bot-xbe4.onrender.com', tg: '@Zenclaimv32bot' },
  { name: 'rakibul-bot', region: 'Frankfurt', url: 'https://rakibul-bot.onrender.com', tg: '@Zenclaimv33bot' },
  { name: 'harun-bot', region: 'Oregon', url: 'https://harun-bot.onrender.com', tg: '@Zenclaimv34bot' },
  { name: 'sakib-bot-5mxr', region: 'Singapore', url: 'https://sakib-bot-5mxr.onrender.com', tg: '@Zenclaimv35bot' },
  { name: 'rakib-bot-q0at', region: 'Virginia', url: 'https://rakib-bot-q0at.onrender.com', tg: '@Zenclaimv36bot' },
  { name: 'bilal-2', region: 'Oregon', url: 'https://bilal-2.onrender.com', tg: '@Zenclaimv37bot' },
  { name: 'nusrat-bot-kb1p', region: 'Frankfurt', url: 'https://nusrat-bot-kb1p.onrender.com', tg: '@Zenclaimv38bot' },
  { name: 'mark-bot-22lb', region: 'Virginia', url: 'https://mark-bot-22lb.onrender.com', tg: '@Zenclaimv39bot' },
  { name: 'humayun-bot', region: 'Singapore', url: 'https://humayun-bot.onrender.com', tg: '@Zenclaimv40bot' },
  { name: 'khadija-bot', region: 'Ohio', url: 'https://khadija-bot.onrender.com', tg: '@Zenclaimv41bot' },
  { name: 'noyon-bot', region: 'Frankfurt', url: 'https://noyon-bot.onrender.com', tg: '@Zenclaimv42bot' },
  { name: 'rumpa-bot', region: 'Singapore', url: 'https://rumpa-bot.onrender.com', tg: '@Zenclaimv43bot' },
  { name: 'mamun-bot-3i3b', region: 'Ohio', url: 'https://mamun-bot-3i3b.onrender.com', tg: '@Zenclaimv44bot' },
  { name: 'adrian2-bot', region: 'Virginia', url: 'https://adrian2-bot.onrender.com', tg: '@Zenclaimv45bot' },
  { name: 'adrian3-bot', region: 'Oregon', url: 'https://adrian3-bot.onrender.com', tg: '@Zenclaimv47bot' },
  { name: 'sohel-bot-m9gx', region: 'Frankfurt', url: 'https://sohel-bot-m9gx.onrender.com', tg: '@Zenclaimv46bot' },
  { name: 'mojahet-bot', region: 'Singapore', url: 'https://mojahet-bot.onrender.com', tg: '@Zenclaimv48bot' },
  { name: 'adrian4-bot', region: 'Virginia', url: 'https://adrian4-bot.onrender.com', tg: '@Zenclaimv49bot' },
  { name: 'adrian5-bot', region: 'Oregon', url: 'https://adrian5-bot.onrender.com', tg: '@Zenclaimv50bot' },
  { name: 'yeasin-bot', region: 'Frankfurt', url: 'https://yeasin-bot.onrender.com', tg: '@Zenclaimv51bot' },
  { name: 'tisha-bot', region: 'Singapore', url: 'https://tisha-bot.onrender.com', tg: '@Zenclaimv52bot' },
  { name: 'adrian6-bot', region: 'Virginia', url: 'https://adrian6-bot.onrender.com', tg: '@Zenclaimv56bot' },
  { name: 'adrian7-bot', region: 'Virginia', url: 'https://adrian7-bot.onrender.com', tg: '@Zenclaimv57bot' }
];

sc = (v) => v === null || v === undefined ? '' : String(v);
esc = (v) => sc(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

async function fetchInfo(bot, key) {
  try {
    const r = await axios.get(`${bot.url}/info`, { params: { key }, timeout: 8000 });
    if (r.data && r.data.error) return { ...bot, ok: false, error: r.data.error };
    return { ...bot, ok: true, info: r.data };
  } catch (e) {
    return { ...bot, ok: false, error: e.code || 'timeout/error' };
  }
}

function fmtNext(dt) {
  if (!dt) return '—';
  const d = new Date(dt);
  if (isNaN(d.getTime())) return dt;
  return d.toLocaleString('en-GB', { timeZone: 'Asia/Dhaka', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

async function render(ctx) {
  const threads = await Promise.all(BOTS.map(b => fetchInfo(b, KEY)));
  const okCount = threads.filter(t => t.ok).length;
  const loggedCount = threads.filter(t => t.ok && t.info.loggedIn).length;

  let rows = '';
  threads.forEach((t, idx) => {
    const i = t.info || {};
    const login = t.ok && i.loggedIn;
    rows += `<tr class="${login ? 'row-ok' : 'row-off'}">
      <td>${idx + 1}</td>
      <td><a href="${esc(t.url)}" target="_blank" rel="noopener">${esc(t.name)}</a></td>
      <td>${esc(t.region)}</td>
      <td>${esc(i.tg || t.tg)}</td>
      <td class="login-cell">${login ? '✅ Logged In' : '❌ Logged Out'}</td>
      <td>${i.chatId ? esc(i.chatId) : '—'}</td>
      <td>${i.chatName ? esc(i.chatName) : '—'}</td>
      <td>${i.username ? esc(i.username) : '—'}</td>
      <td>${i.phone ? esc(i.phone) : '—'}</td>
      <td class="status-cell">${t.ok ? esc(i.lastStatus || '—') : '⚠ ' + esc(t.error)}</td>
      <td>${t.ok ? fmtNext(i.nextClaimAt) : '—'}</td>
    </tr>`;
  });

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="15">
<title>ZenQuant Bot Dashboard</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; font-family: -apple-system, Segoe UI, Roboto, sans-serif; background: #0f1419; color: #e7e9ee; }
  header { padding: 14px 18px; background: #161d26; border-bottom: 1px solid #2a3441; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px; }
  header h1 { font-size: 17px; margin: 0; }
  header .meta { color: #8b98a9; font-size: 13px; }
  .wrap { padding: 14px 18px; }
  .controls { display: flex; gap: 8px; align-items: center; margin-bottom: 12px; flex-wrap: wrap; }
  input[type=text] { background: #111827; border: 1px solid #2a3441; color: #e7e9ee; padding: 8px 12px; border-radius: 6px; width: 260px; }
  button { background: #1d4ed8; color: #fff; border: 0; padding: 8px 14px; border-radius: 6px; cursor: pointer; font-size: 13px; }
  button:hover { background: #2563eb; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; background: #161d26; border: 1px solid #2a3441; border-radius: 8px; overflow: hidden; }
  th { text-align: left; padding: 9px 10px; background: #1c2631; color: #9fb0c3; font-weight: 600; white-space: nowrap; }
  td { padding: 8px 10px; border-top: 1px solid #232e3b; }
  tr:hover { background: #1b2430; }
  td a { color: #60a5fa; text-decoration: none; }
  .login-cell { font-weight: 600; }
  .row-ok .login-cell { color: #4ade80; }
  .row-off .login-cell { color: #f87171; }
  .status-cell { color: #8b98a9; max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .time { color: #6b7a8d; font-size: 12px; }
  @media (max-width: 720px) { .hide-sm { display: none; } input[type=text] { width: 100%; } }
</style>
</head>
<body>
<header>
  <h1>🤖 ZenQuant Bot Dashboard</h1>
  <div class="meta">Auto-refresh every 15s • <b>${sc(loggedCount)}/${sc(BOTS.length)}</b> logged in • <b>${sc(okCount)}/${sc(BOTS.length)}</b> online</div>
</header>
<div class="wrap">
  <div class="controls">
    <input type="text" id="q" placeholder="🔍 Search bot / user / id..." oninput="filterRows()">
    <button onclick="location.reload()">🔄 Refresh</button>
  </div>
  <table>
    <thead><tr>
      <th>#</th><th>Bot</th><th>Region</th><th>TG</th><th>Login</th><th>User ID</th><th>User Name</th><th>ZQ Name</th><th>Phone</th><th>Status</th><th>Next Claim</th>
    </tr></thead>
    <tbody id="tbody">${rows}</tbody>
  </table>
</div>
<script>
  function filterRows() {
    const q = (document.getElementById('q').value || '').toLowerCase();
    document.querySelectorAll('#tbody tr').forEach(tr => {
      tr.style.display = (!q || tr.textContent.toLowerCase().includes(q)) ? '' : 'none';
    });
  }
</script>
</body>
</html>`;
}

const app = express();

app.get('/', async (req, res) => {
  if (req.query.key !== KEY) return res.status(403).send('Access denied');
  try {
    const html = await render(req.query);
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (e) {
    res.status(500).send('Error: ' + esc(e.message));
  }
});

app.listen(PORT, () => console.log(`Dashboard started on port ${PORT}`));