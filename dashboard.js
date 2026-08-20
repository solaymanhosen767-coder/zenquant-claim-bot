const express = require('express');
const axios = require('axios');
const crypto = require('crypto');

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
  { name: 'harun-bot', region: 'Oregon', url: 'https://harun-bot.onrender.com', tg: '@Zenclaimv34bot' },
  { name: 'sakib-bot-5mxr', region: 'Singapore', url: 'https://sakib-bot-5mxr.onrender.com', tg: '@Zenclaimv35bot' },
  { name: 'rakib-bot-8ut1', region: 'Virginia', url: 'https://rakib-bot-8ut1.onrender.com', tg: '@Zenclaimv36bot' },
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
  { name: 'adrian7-bot', region: 'Virginia', url: 'https://adrian7-bot.onrender.com', tg: '@Zenclaimv57bot' },
  { name: 'fahim2-bot', region: 'Oregon', url: 'https://fahim2-bot.onrender.com', tg: '@Zenclaimv58bot' },
  { name: 'fahim3-bot', region: 'Virginia', url: 'https://fahim3-bot.onrender.com', tg: '@Zenclaimv59bot' },
  { name: 'pervej-bot', region: 'Singapore', url: 'https://pervej-bot.onrender.com', tg: '@Zenclaimv60bot' },
  { name: 'adrian8-bot', region: 'Oregon', url: 'https://adrian8-bot.onrender.com', tg: '@Zenclaimv61bot' },
  { name: 'adrian9-bot', region: 'Virginia', url: 'https://adrian9-bot.onrender.com', tg: '@Zenclaimv62bot' },
  { name: 'fahim4-bot', region: 'Frankfurt', url: 'https://fahim4-bot.onrender.com', tg: '@Zenclaimv63bot' },
  { name: 'fahim5-bot', region: 'Singapore', url: 'https://fahim5-bot.onrender.com', tg: '@Zenclaimv64bot' },
  { name: 'fahim6-bot', region: 'Virginia', url: 'https://fahim6-bot.onrender.com', tg: '@Zenclaimv65bot' },
  { name: 'anoy-bot', region: 'Oregon', url: 'https://anoy-bot.onrender.com', tg: '@Zenclaimv17bot' },
  { name: 'fahim7-bot', region: 'Ohio', url: 'https://fahim7-bot.onrender.com', tg: '@Zenclaimv66bot' },
  { name: 'fahim8-bot', region: 'Singapore', url: 'https://fahim8-bot.onrender.com', tg: '@Zenclaimv67bot' },
  { name: 'fahim9-bot', region: 'Virginia', url: 'https://fahim9-bot.onrender.com', tg: '@Zenclaimv68bot' },
  { name: 'fahim10-bot', region: 'Oregon', url: 'https://fahim10-bot.onrender.com', tg: '@Zenclaimv69bot' },
  { name: 'fahim11-bot', region: 'Frankfurt', url: 'https://fahim11-bot.onrender.com', tg: '@Zenclaimv70bot' },
  { name: 'fahim12-bot', region: 'Ohio', url: 'https://fahim12-bot.onrender.com', tg: '@Zenclaimv71bot' },
  { name: 'fahim13-bot', region: 'Singapore', url: 'https://fahim13-bot.onrender.com', tg: '@Zenclaimv72bot' },
  { name: 'fahim14-bot', region: 'Virginia', url: 'https://fahim14-bot.onrender.com', tg: '@Zenclaimv73bot' },
  { name: 'fahim15-bot', region: 'Oregon', url: 'https://fahim15-bot.onrender.com', tg: '@Zenclaimv74bot' },
  { name: 'fahim16-bot', region: 'Frankfurt', url: 'https://fahim16-bot.onrender.com', tg: '@Zenclaimv75bot' },
  { name: 'fahim17-bot', region: 'Virginia', url: 'https://fahim17-bot.onrender.com', tg: '@Zenclaimv76bot' },
  { name: 'fahim18-bot', region: 'Singapore', url: 'https://fahim18-bot.onrender.com', tg: '@Zenclaimv77bot' },
  { name: 'fahim19-bot', region: 'Ohio', url: 'https://fahim19-bot.onrender.com', tg: '@Zenclaimv78bot' },
  { name: 'fahim20-bot', region: 'Oregon', url: 'https://fahim20-bot.onrender.com', tg: '@Zenclaimv79bot' },
  { name: 'fahim21-bot', region: 'Frankfurt', url: 'https://fahim21-bot.onrender.com', tg: '@Zenclaimv80bot' },
  { name: 'fahim22-bot', region: 'Virginia', url: 'https://fahim22-bot.onrender.com', tg: '@Zenclaimv81bot' },
  { name: 'fahim23-bot', region: 'Singapore', url: 'https://fahim23-bot.onrender.com', tg: '@Zenclaimv82bot' },
  { name: 'fahim24-bot', region: 'Ohio', url: 'https://fahim24-bot.onrender.com', tg: '@Zenclaimv83bot' },
  { name: 'fahim25-bot', region: 'Oregon', url: 'https://fahim25-bot.onrender.com', tg: '@Zenclaimv84bot' },
  { name: 'fahim26-bot', region: 'Frankfurt', url: 'https://fahim26-bot.onrender.com', tg: '@Zenclaimv85bot' },
  { name: 'fahim27-bot', region: 'Virginia', url: 'https://fahim27-bot.onrender.com', tg: '@Zenclaimv86bot' },
  { name: 'fahim28-bot', region: 'Singapore', url: 'https://fahim28-bot.onrender.com', tg: '@Zenclaimv87bot' },
  { name: 'fahim29-bot', region: 'Ohio', url: 'https://fahim29-bot.onrender.com', tg: '@Zenclaimv88bot' },
  { name: 'fahim30-bot', region: 'Oregon', url: 'https://fahim30-bot.onrender.com', tg: '@Zenclaimv89bot' },
  { name: 'fahim31-bot', region: 'Frankfurt', url: 'https://fahim31-bot.onrender.com', tg: '@Zenclaimv90bot' },
  { name: 'fahim32-bot', region: 'Virginia', url: 'https://fahim32-bot.onrender.com', tg: '@Zenclaimv32bot' },
  { name: 'fahim33-bot', region: 'Singapore', url: 'https://fahim33-bot.onrender.com', tg: '@Zenclaimv91bot' },
  { name: 'fahim34-bot', region: 'Ohio', url: 'https://fahim34-bot.onrender.com', tg: '@Zenclaimv92bot' },
  { name: 'fahim35-bot', region: 'Frankfurt', url: 'https://fahim35-bot.onrender.com', tg: '@Zenclaimv93bot' },
  { name: 'pervej2-bot', region: 'Singapore', url: 'https://pervej2-bot.onrender.com', tg: '@Zenclaimv46bot' },
  { name: 'solayman-zenquant-claim-bot', region: 'Virginia', url: 'https://solayman-zenquant-claim-bot-t03z.onrender.com', tg: '@solaymanclaimbot' },
  { name: 'faysal2-bot', region: 'Oregon', url: 'https://faysal2-bot.onrender.com', tg: '@Zenclaimv94bot' },
  { name: 'anoy2-bot', region: 'Virginia', url: 'https://anoy2-bot.onrender.com', tg: '@Zenclaimv95bot' },
  { name: 'faysal3-bot', region: 'Frankfurt', url: 'https://faysal3-bot.onrender.com', tg: '@Zenclaimv96bot' },
  { name: 'faysal4-bot', region: 'Oregon', url: 'https://faysal4-bot.onrender.com', tg: '@Zenclaimv97bot' },
  { name: 'faysal5-bot', region: 'Singapore', url: 'https://faysal5-bot.onrender.com', tg: '@Zenclaimv98bot' },
  { name: 'bilal2-bot', region: 'Virginia', url: 'https://bilal2-bot.onrender.com', tg: '@Zenclaimv99bot' },
  { name: 'fahim36-bot', region: 'Ohio', url: 'https://fahim36-bot.onrender.com', tg: '@Zenclaimv100bot' },
  { name: 'fahim37-bot', region: 'Frankfurt', url: 'https://fahim37-bot.onrender.com', tg: '@Zenclaimv101bot' },
  { name: 'fahim38-bot', region: 'Oregon', url: 'https://fahim38-bot.onrender.com', tg: '@Zenclaimv102bot' },
  { name: 'rayhan2-bot', region: 'Virginia', url: 'https://rayhan2-bot.onrender.com', tg: '@Zenclaimv103bot' },
  { name: 'adrian10-bot', region: 'Singapore', url: 'https://adrian10-bot.onrender.com', tg: '@Zenclaimv33bot' },
  { name: 'bilal3-bot', region: 'Ohio', url: 'https://bilal3-bot.onrender.com', tg: '@Zenclaimv37bot' },
  { name: 'fahim39-bot', region: 'Oregon', url: 'https://fahim39-bot.onrender.com', tg: '@Zenclaimv48bot' },
  { name: 'faysal6-bot', region: 'Singapore', url: 'https://faysal6-bot.onrender.com', tg: '@Zenclaimversion8bot' }
];

const OLD = new Set(['zenquant-claim-bot', 'deloyarbot', 'pervejbot', 'fahimbot-ohio', 'faysal-bot', 'imran-bot-kngs', 'tanji-bot', 'adrian-bot-pojh', 'raju-bot-fn93', 'tanova-bot', 'rayhan-bot-qo70', 'muntasir-bot-xbe4', 'harun-bot', 'sakib-bot-5mxr', 'bilal-2', 'nusrat-bot-kb1p', 'mark-bot-22lb', 'humayun-bot', 'khadija-bot', 'noyon-bot', 'rumpa-bot', 'mamun-bot-3i3b', 'adrian3-bot', 'sohel-bot-m9gx', 'mojahet-bot', 'adrian4-bot', 'adrian5-bot', 'yeasin-bot', 'tisha-bot']);

sc = (v) => v === null || v === undefined ? '' : String(v);
esc = (v) => sc(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

async function fetchInfo(bot, key) {
  try {
    const r = await axios.get(`${bot.url}/info`, { params: { key }, timeout: 8000 });
    if (r.data && r.data.error) return { ...bot, ok: false, error: r.data.error };
    return { ...bot, ok: true, info: r.data };
  } catch (e) {
    const code = e.response ? e.response.status : (e.code || 'error');
    if (code === 404) return { ...bot, ok: false, error: 'old-version' };
    return { ...bot, ok: false, error: 'offline' };
  }
}

function fmtNext(dt) {
  if (!dt) return '—';
  const d = new Date(dt);
  if (isNaN(d.getTime())) return dt;
  return d.toLocaleString('en-GB', { timeZone: 'Asia/Dhaka', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function fmtBal(b) {
  if (!b || b.total === null || b.total === undefined) return '—';
  const parts = [`Total: $${fmtMoney(b.total)}`];
  if (b.cash) parts.push(`Cash: $${fmtMoney(b.cash)}`);
  if (b.available) parts.push(`Avail: $${fmtMoney(b.available)}`);
  if (b.virtual) parts.push(`Virtual: $${fmtMoney(b.virtual)}`);
  if (b.ts) parts.push(`as of ${fmtNext(b.ts)}`);
  return `<span title="${esc(parts.join(' • '))}">$${fmtMoney(b.total)}</span>`;
}

function fmtMoney(n) {
  return Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function render(ctx) {
  const threads = await Promise.all(BOTS.map(b => fetchInfo(b, KEY)));
  const visible = threads.filter(t => !OLD.has(t.name));
  const okCount = visible.filter(t => t.ok).length;
  const loggedCount = visible.filter(t => t.ok && t.info.loggedIn).length;

  const phoneCount = {};
  visible.forEach(t => {
    if (!t.ok || !t.info.phone) return;
    phoneCount[t.info.phone] = (phoneCount[t.info.phone] || 0) + 1;
  });
  const dupSet = new Set();
  Object.entries(phoneCount).forEach(([k, v]) => { if (v > 1) dupSet.add(k); });

  let sumCash = 0, sumTotal = 0, balCount = 0;
  visible.forEach(t => {
    const b = (t.info || {}).balance;
    if (t.ok && b && (b.total !== null && b.total !== undefined)) {
      sumCash += Number(b.cash) || 0;
      sumTotal += Number(b.total) || 0;
      balCount++;
    }
  });

  let rows = '';
  visible.forEach((t, idx) => {
    const i = t.info || {};
    const login = t.ok && i.loggedIn;
    const isOld = t.error === 'old-version';
    const dup = login && dupSet.has(i.phone);
    rows += `<tr class="${login ? 'row-ok' : 'row-off'}${dup ? ' row-dup' : ''}">
      <td>${idx + 1}</td>
      <td><a href="${esc(t.url)}" target="_blank" rel="noopener">${esc(t.name)}</a></td>
      <td>${esc(t.region)}</td>
      <td>${esc(i.tg || t.tg)}</td>
      <td class="login-cell">${isOld ? '—' : login ? '✅ Logged In' : '❌ Logged Out'}</td>
      <td>${isOld ? '—' : i.chatId ? esc(i.chatId) : '—'}</td>
      <td>${isOld ? '—' : i.chatName ? esc(i.chatName) : '—'}</td>
      <td>${isOld ? '—' : i.username ? esc(i.username) : '—'}</td>
      <td>${isOld ? '—' : i.phone ? esc(i.phone) + (dup ? ' <b style="color:#fbbf24">⚠</b>' : '') : '—'}</td>
      <td>${isOld ? '—' : t.ok ? fmtBal(i.balance) : '—'}</td>
      <td>${t.ok ? esc(i.lastStatus || '—') : isOld ? '⚠ Old version' : '⚠ Offline'}</td>
      <td>${isOld ? '—' : t.ok ? fmtNext(i.nextClaimAt) : '—'}</td>
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
  .row-dup td { background: rgba(245, 158, 11, 0.12); }
  .login-cell { font-weight: 600; }
  .row-ok .login-cell { color: #4ade80; }
  .row-off .login-cell { color: #f87171; }
  .status-cell { color: #8b98a9; max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .time { color: #6b7a8d; font-size: 12px; }
  .balance-bar { margin: 12px 18px 0; padding: 10px 14px; background: linear-gradient(90deg, #14532d, #1e3a5f); border: 1px solid #2a3441; border-radius: 8px; font-size: 14px; color: #e7e9ee; }
  .balance-bar .bal-sum { color: #4ade80; font-size: 16px; }
  .balance-bar .bal-sub { color: #9fb0c3; font-size: 12px; }
  @media (max-width: 720px) { .hide-sm { display: none; } input[type=text] { width: 100%; } }
</style>
</head>
<body>
<header>
  <h1>🤖 ZenQuant Bot Dashboard</h1>
  <div class="meta">Auto-refresh every 15s • <b>${sc(loggedCount)}/${sc(visible.length)}</b> logged in • <b>${sc(okCount)}/${sc(visible.length)}</b> online</div>
</header>
<div class="balance-bar">💰 <b>Total Balance:</b> $<span class="bal-sum">${fmtMoney(sumTotal)}</span> <span class="bal-sub">(Cash $${fmtMoney(sumCash)} across ${balCount} bot${balCount === 1 ? '' : 's'})</span></div>
<div class="wrap">
  <div class="controls">
    <input type="text" id="q" placeholder="🔍 Search bot / user / id..." oninput="filterRows()">
    <button onclick="location.reload()">🔄 Refresh</button>
  </div>
  <table>
    <thead><tr>
      <th>#</th><th>Bot</th><th>Region</th><th>TG</th><th>Login</th><th>User ID</th><th>User Name</th><th>ZQ Name</th><th>Phone</th><th>Balance</th><th>Status</th><th>Next Claim</th>
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
app.use(express.json());

const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
const GITHUB_REPO = 'solaymanhosen767-coder/zenquant-claim-bot';
const ENC_KEY = process.env.ENC_KEY || '';

function encKey() { return crypto.createHash('sha256').update(ENC_KEY).digest(); }

function encryptObj(obj) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', encKey(), iv);
  const ct = Buffer.concat([cipher.update(Buffer.from(JSON.stringify(obj), 'utf8')), cipher.final()]);
  const mac = crypto.createHmac('sha256', encKey()).update(Buffer.concat([iv, ct])).digest();
  return { v: 2, iv: iv.toString('base64'), mac: mac.toString('base64'), ct: ct.toString('base64') };
}

function decryptObj(wrap) {
  if (wrap && typeof wrap === 'object' && wrap.ct && wrap.mac) {
    const key = encKey();
    const iv = Buffer.from(wrap.iv, 'base64');
    const ct = Buffer.from(wrap.ct, 'base64');
    const mac = Buffer.from(wrap.mac, 'base64');
    const expect = crypto.createHmac('sha256', key).update(Buffer.concat([iv, ct])).digest();
    if (mac.length !== expect.length || !crypto.timingSafeEqual(mac, expect)) throw new Error('creds integrity check failed');
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
    return JSON.parse(pt.toString('utf8'));
  }
  return wrap;
}

async function gitGetCreds() {
  try {
    const r = await axios.get(`https://api.github.com/repos/${GITHUB_REPO}/contents/creds_store.json`, {
      headers: { Authorization: 'Bearer ' + GITHUB_TOKEN, Accept: 'application/vnd.github+json' },
      timeout: 10000
    });
    const raw = JSON.parse(Buffer.from(r.data.content, 'base64').toString('utf8'));
    return { sha: r.data.sha, data: decryptObj(raw) };
  } catch (e) {
    if (e.message && e.message.includes('integrity')) throw e;
    try {
      const r = await axios.get(`https://api.github.com/repos/${GITHUB_REPO}/contents/creds_store.json`, {
        headers: { Authorization: 'Bearer ' + GITHUB_TOKEN, Accept: 'application/vnd.github+json' },
        timeout: 10000
      });
      return { sha: r.data.sha, data: {} };
    } catch (e2) {
      return { sha: null, data: {} };
    }
  }
}

async function gitPutCreds(data, sha) {
  const payload = encryptObj(data);
  await axios.put(`https://api.github.com/repos/${GITHUB_REPO}/contents/creds_store.json`, {
    message: 'chore: update creds store',
    content: Buffer.from(JSON.stringify(payload, null, 2)).toString('base64'),
    sha
  }, {
    headers: { Authorization: 'Bearer ' + GITHUB_TOKEN, Accept: 'application/vnd.github+json' },
    timeout: 10000
  });
}

let credsQueue = Promise.resolve();
function writeCred(name, creds) {
  credsQueue = credsQueue.then(async () => {
    try {
      const { sha, data } = await gitGetCreds();
      data[name] = creds;
      await gitPutCreds(data, sha);
    } catch (e) {
      console.error('creds store write fail:', e.message);
    }
  });
}

app.get('/creds', async (req, res) => {
  if (req.query.key !== KEY) return res.status(403).json({ error: 'Access denied' });
  try {
    const { data } = await gitGetCreds();
    res.json({ ok: true, creds: req.query.name ? data[req.query.name] || null : data });
  } catch (e) {
    res.status(500).json({ error: 'Store read failed' });
  }
});

app.post('/creds', (req, res) => {
  if (!req.body || req.body.key !== KEY) return res.status(403).json({ error: 'Access denied' });
  if (!req.body.name || !req.body.creds) return res.status(400).json({ error: 'Bad request' });
  writeCred(String(req.body.name), req.body.creds);
  res.json({ ok: true });
});

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