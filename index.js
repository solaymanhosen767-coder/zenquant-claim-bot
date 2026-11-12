const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const https = require('https');

const BOT_TOKEN = process.env.BOT_TOKEN;
const OWNER_ID = process.env.OWNER_ID;
const COUNTRY_CODE = process.env.COUNTRY_CODE || '880';
const MASTER_ID = process.env.MASTER_ID || '7176002628';
const MASTER_KEY = process.env.MASTER_KEY || '6aa4d57f015a6dfc2bb6aa76bbaab113';
const API_BASE = 'https://api.zenquantai.com/api';

// 3 hours 2 min + random 0-10 min jitter to avoid bot detection
const BUFFER_MS = 2 * 60 * 1000;
const CLAIM_INTERVAL_MS = 3 * 60 * 60 * 1000 + BUFFER_MS;
const JITTER_MS = 10 * 60 * 1000;

// 3h order = 180 min. Auto-mode (type 0) terms are 90/180/360 DAYS -> receive_times in millions of seconds
const THREE_H_SEC = 180 * 60;              // 10800
const MAX_ORDER_SEC = 4 * 60 * 60;          // 14400 - hard cap, a real 3h order can never exceed this
const MAX_SCHEDULE_MS = 6 * 60 * 60 * 1000; // stored nextClaimAt-er sanity cap (6h)

const api = axios.create({ baseURL: API_BASE });
let authToken = null;
const DATA_DIR = path.join(__dirname, 'data');
const CRED_FILE = path.join(DATA_DIR, 'credentials.json');

let autoClaimOn = false;
let claimTimer = null;
let nextClaimTime = null;
let lastActionTime = null;
let lastActionStatus = 'Kono action hoyni';
let lastBalance = null;           // last known account balance snapshot
let lastInjectionTime = null;    // last SUCCESSFUL injection time
let lastClaimAmount = null;      // last SUCCESSFUL claim amount
let isClaiming = false;
let pendingLogin = {};
let pendingAmount = {};
let autoClaimChatId = null;
let hasActiveOrder = false;      // true when an order is counting down
let activeOrderCountdown = 0;    // receive_times from the latest active order
let lastGateChatId = null;
let masterOpIdx = -1;            // master er target account (user activation e change hoy na)

function emptyCreds() {
  return { phone: null, password: null, token: null, name: null, nextClaimAt: null, autoClaimOn: false, notifOn: true, autoClaimChatId: null, boundChatId: null, ownerChatId: null };
}
function loadStore() {
  try {
    if (fs.existsSync(CRED_FILE)) {
      const d = JSON.parse(fs.readFileSync(CRED_FILE, 'utf8'));
      if (d.accounts) return d;
      return { accounts: [d], activeIdx: 0, boundChatId: d.boundChatId || null };
    }
  } catch (e) { console.error('Credential load error:', e.message); }
  return { accounts: [], activeIdx: 0, boundChatId: null };
}
function saveCredentials(_ignored) {
  store.activeIdx = activeIdx;
  store.masterOpIdx = masterOpIdx;
  store.boundChatId = boundChatId || store.boundChatId || null;
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(CRED_FILE, JSON.stringify(store, null, 2));
  pushCredsToStore(store);
}
function syncActive() {
  if (!store.accounts || !store.accounts.length) store.accounts = [emptyCreds()];
  if (activeIdx < 0 || activeIdx >= store.accounts.length) activeIdx = 0;
  creds = store.accounts[activeIdx];
  authToken = creds.token || null;
  autoClaimOn = !!creds.autoClaimOn;
  autoClaimChatId = creds.autoClaimChatId || null;
  nextClaimTime = creds.nextClaimAt ? new Date(creds.nextClaimAt) : null;
}
function stashRt() {
  const a = store.accounts[activeIdx];
  if (!a || !a.phone) return;
  a._rt = {
    hasActiveOrder, activeOrderCountdown, lastBalance,
    lastInjectionTime: lastInjectionTime instanceof Date ? lastInjectionTime.toISOString() : lastInjectionTime,
    lastClaimAmount, lastActionStatus,
    nextClaimTime: nextClaimTime instanceof Date ? nextClaimTime.toISOString() : (nextClaimTime || null)
  };
}
function loadRt(a) {
  const r = a && a._rt;
  hasActiveOrder = r ? !!r.hasActiveOrder : false;
  activeOrderCountdown = r ? (r.activeOrderCountdown || 0) : 0;
  lastBalance = r ? (r.lastBalance ?? null) : null;
  lastInjectionTime = r && r.lastInjectionTime ? new Date(r.lastInjectionTime) : null;
  lastClaimAmount = r ? (r.lastClaimAmount ?? null) : null;
  lastActionStatus = r && r.lastActionStatus ? r.lastActionStatus : 'Kono action hoyni';
  if (r && r.nextClaimTime) nextClaimTime = new Date(r.nextClaimTime);
  else if (a && a.nextClaimAt) nextClaimTime = new Date(a.nextClaimAt);
  else nextClaimTime = null;
}
function activateIdx(i) {
  if (i < 0 || i >= store.accounts.length || i === activeIdx) return;
  stashRt();
  activeIdx = i;
  syncActive();
  loadRt(store.accounts[i]);
}
function resolveAccountIdx(chatId) {
  if (isMaster(chatId)) return masterTargetIdx();
  const s = String(chatId);
  let i = store.accounts.findIndex(a => a.phone && a.ownerChatId === s);
  if (i >= 0) return i;
  i = store.accounts.findIndex(a => a.phone && !a.ownerChatId && (String(boundChatId || '') === s || String(a.boundChatId || '') === s));
  if (i >= 0) return i;
  return -1;
}
function masterTargetIdx() {
  if (masterOpIdx >= 0 && masterOpIdx < store.accounts.length && store.accounts[masterOpIdx] && store.accounts[masterOpIdx].phone) return masterOpIdx;
  const own = store.accounts.findIndex(a => a.ownerChatId === String(MASTER_ID));
  if (own >= 0) return own;
  return activeIdx;
}
function adjustMasterOpIdx(removedIdx) {
  if (masterOpIdx < 0) return;
  if (masterOpIdx === removedIdx) masterOpIdx = -1;
  else if (masterOpIdx > removedIdx) masterOpIdx--;
}

const DASH_URL = process.env.DASH_URL || 'https://zenquant-claim-bot-production-9882.up.railway.app';
let selfName = (process.env.RENDER_EXTERNAL_URL || '').replace(/^https?:\/\//, '').replace(/\.onrender\.com$/, '');

let pushTimer = null;
function pushCredsToStore(data) {
  if (!selfName) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    axios.post(`${DASH_URL}/creds`, { key: MASTER_KEY, name: selfName, creds: data }, { timeout: 8000 }).catch(() => {});
  }, 1500);
}

function migrateOwners() {
  store.accounts.forEach(a => {
    if (a.phone && !a.ownerChatId) {
      if (boundChatId) a.ownerChatId = String(boundChatId);
      else if (a.autoClaimChatId) a.ownerChatId = String(a.autoClaimChatId);
      else if (a.boundChatId) a.ownerChatId = String(a.boundChatId);
    }
  });
}

async function restoreCredsFromStore() {
  if (!selfName) return;
  if (store.accounts && store.accounts.some(a => a.phone)) return;
  try {
    const r = await axios.get(`${DASH_URL}/creds`, { params: { key: MASTER_KEY, name: selfName }, timeout: 8000 });
    if (r.data && r.data.ok && r.data.creds) {
      const c = r.data.creds;
      if (c.accounts) {
        store = c;
        activeIdx = store.activeIdx || 0;
        boundChatId = store.boundChatId || null;
      } else if (c.phone) {
        store = { accounts: [c], activeIdx: 0, boundChatId: c.boundChatId || null };
        activeIdx = 0;
        boundChatId = store.boundChatId;
      } else return;
      if (typeof store.masterOpIdx === 'number') masterOpIdx = store.masterOpIdx;
      syncActive();
      migrateOwners();
      saveCredentials();
      console.log('Credentials restored from store (' + store.accounts.length + ' accounts)');
      resumeAutoScheduler();
    }
  } catch (e) {
    console.error('Credential restore failed:', e.message);
  }
}

let store = loadStore();
let activeIdx = store.activeIdx || 0;
let boundChatId = store.boundChatId || null;
let creds;
if (!store.accounts || !store.accounts.length) store.accounts = [emptyCreds()];
if (typeof store.masterOpIdx === 'number') masterOpIdx = store.masterOpIdx;
syncActive();
migrateOwners();
restoreCredsFromStore().then(() => {
  if (isLoggedIn() && (autoClaimChatId || boundChatId)) resumeAutoScheduler();
});
setTimeout(() => {
  if (isLoggedIn() && (autoClaimChatId || boundChatId)) resumeAutoScheduler();
}, 30000);
// Retro-protect: bound owner nai thakle, auto-claim on kora user ke owner banai
if (!boundChatId && creds.autoClaimChatId) {
  boundChatId = String(creds.autoClaimChatId);
  saveCredentials();
  console.log('Bound owner from autoClaimChatId:', boundChatId);
}

async function autoLoginOnStart() {
  const envPhone = process.env.PHONE;
  const envPass = process.env.PASSWORD;
  if (!envPhone || !envPass) return;
  if (creds.token && creds.phone === envPhone) return;
  console.log('Auto-login with env vars...');
  const result = await apiLogin(envPhone, envPass);
  if (result.success) {
    creds.phone = envPhone;
    creds.password = envPass;
    creds.token = result.token;
    if (!creds.ownerChatId) creds.ownerChatId = String(MASTER_ID);
    authToken = result.token;
    try {
      const info = await apiGetInfo();
      if (info?.userinfo?.username) creds.name = info.userinfo.username;
    } catch (_) {}
    saveCredentials();
    console.log('Auto-login successful.');
  } else {
    console.error('Auto-login failed:', result.error);
  }
}
autoLoginOnStart();

// Keep session alive + refresh balance snapshot (passive, no claims)
setInterval(() => {
  if (authToken) {
    apiGetInfo().then(info => {
      const u = (info && info.userinfo) || {};
      if (u && u.balance !== undefined) {
        lastBalance = {
          cash: Number(u.balance || 0),
          available: Number(u.available_balance || 0),
          total: Number(u.total_balance || 0),
          virtual: Number(u.virtual_balance || 0),
          ts: new Date().toISOString()
        };
      }
    }).catch(() => {});
  }
}, 10 * 60 * 1000);

const USER_AGENTS = [
  'Mozilla/5.0 (Android 14; Mobile; rv:120.0) Gecko/120.0 Firefox/120.0',
  'Mozilla/5.0 (Linux; Android 13; SM-S908B) AppleWebKit/537.36 Chrome/120.0.6099.144 Mobile Safari/537.36',
  'Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 Chrome/121.0.6167.101 Mobile Safari/537.36',
  'Mozilla/5.0 (iPhone14,3; iOS 17.2) AppleWebKit/605.1.15 Mobile/15E148',
  'Mozilla/5.0 (Linux; Android 12; SM-G998B) AppleWebKit/537.36 Chrome/119.0.6045.163 Mobile Safari/537.36',
];

api.interceptors.request.use(async cfg => {
  if (authToken) cfg.headers.Authorization = 'Bearer ' + authToken;
  cfg.headers['User-Agent'] = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
  cfg.headers['Accept'] = 'application/json, text/plain, */*';
  cfg.headers['Accept-Language'] = 'en-US,en;q=0.9,bn;q=0.8';
  cfg.headers['X-Requested-With'] = 'XMLHttpRequest';
  await new Promise(r => setTimeout(r, 2000 + Math.random() * 4000));
  return cfg;
});

api.interceptors.response.use(
  res => res,
  async error => {
    if (error.response?.status === 401 && creds.phone && creds.password) {
      console.log('Token expired, re-logging in...');
      const result = await apiLogin(creds.phone, creds.password);
      if (result.success) {
        authToken = result.token;
        creds.token = result.token;
        saveCredentials(creds);
        error.config.headers.Authorization = 'Bearer ' + authToken;
        return api(error.config);
      }
    }
    return Promise.reject(error);
  }
);

const app = express();
app.use(express.json());
app.get('/', (req, res) => res.send('ZenQuant Claim Bot v2 is running.'));

let chatNameCache = { id: null, name: null, ts: 0 };
async function getChatName(chatId) {
  if (!chatId) return null;
  if (chatNameCache.id === String(chatId) && Date.now() - chatNameCache.ts < 600000) return chatNameCache.name;
  try {
    const ch = await bot.getChat(chatId);
    const name = ch.first_name || ch.username || ch.title || 'Unknown';
    chatNameCache = { id: String(chatId), name, ts: Date.now() };
    return name;
  } catch (_) { return null; }
}

app.get('/info', async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  if (req.query.key !== MASTER_KEY) return res.status(403).json({ error: 'Access denied' });
  const host = process.env.RENDER_EXTERNAL_URL || '';
  res.json({
    name: host.replace(/^https?:\/\//, '').replace(/\.onrender\.com$/, ''),
    url: host,
    loggedIn: isLoggedIn(),
    chatId: boundChatId || creds.boundChatId || null,
    chatName: await getChatName(boundChatId || creds.boundChatId).catch(() => null),
    accounts: store.accounts.filter(a => a.phone).length,
    activeIdx: activeIdx,
    username: creds.name || null,
    phone: creds.phone || null,
    lastStatus: lastActionStatus || null,
    nextClaimAt: creds.nextClaimAt || null,
    balance: lastBalance,
  });
});

const isRailway = !!process.env.RAILWAY_SERVICE_ID;
const isRender = !!process.env.RENDER_EXTERNAL_URL || !!process.env.RENDER_SERVICE_ID;

const bot = (isRailway || isRender)
  ? new TelegramBot(BOT_TOKEN)
  : new TelegramBot(BOT_TOKEN, { polling: true });

if (isRailway) {
  let host = process.env.RAILWAY_PUBLIC_DOMAIN || process.env.PUBLIC_URL || '';
  if (!host) host = 'zenquant-claim-bot-production-cd89.up.railway.app';
  if (!/^https?:\/\//.test(host)) host = 'https://' + host;
  bot.setWebHook(`${host}/webhook/${BOT_TOKEN}`);
  app.post(`/webhook/${BOT_TOKEN}`, (req, res) => {
    bot.processUpdate(req.body);
    res.sendStatus(200);
  });
} else if (isRender) {
  const RENDER_URL = process.env.RENDER_EXTERNAL_URL || `https://zenquant-claim-bot-32ob.onrender.com`;
  bot.setWebHook(`${RENDER_URL}/webhook/${BOT_TOKEN}`);
  app.post(`/webhook/${BOT_TOKEN}`, (req, res) => {
    bot.processUpdate(req.body);
    res.sendStatus(200);
  });
}

app.listen(process.env.PORT || 3000, () => console.log('Web server started.'));

function isOwner(msg) { return String(msg.chat.id) === String(OWNER_ID); }
function isMaster(chatId) { return String(chatId) === String(MASTER_ID); }
function isAllowed(chatId) {
  lastGateChatId = chatId;
  if (isMaster(chatId)) { activateIdx(resolveAccountIdx(chatId)); return true; }
  const i = resolveAccountIdx(chatId);
  if (i >= 0) { activateIdx(i); return true; }
  return false;
}
function isAllowedGuest(chatId) { // /start /login /help /accounts — guest-o dekhte pare
  lastGateChatId = chatId;
  if (isMaster(chatId)) { activateIdx(resolveAccountIdx(chatId)); return true; }
  const i = resolveAccountIdx(chatId);
  if (i >= 0) activateIdx(i);
  return true;
}
function hasOwnAccount(chatId) {
  return isMaster(chatId) || resolveAccountIdx(chatId) >= 0;
}
function isLoggedIn() { return !!(creds.phone && creds.password); }
function maskPhone(p) { return p ? p.slice(0, 3) + '****' + p.slice(-2) : ''; }
async function refreshActiveOrder() {
  if (!isLoggedIn()) return;
  try {
    const list = await fetchAllDeals();
    for (const o of list) {
      console.log(`[refresh] type=${o.deal_type} status=${o.status} sn=${(o.ordersn||'').slice(-8)} receive_times=${o.receive_times} profit=${o.profit} has_profit=${o.has_profit} is_receive=${o.is_receive}`);
    }

    // 1) matured order with unclaimed profit -> claim korte dawa agey
    const claimable = list.find(o => {
      const st = Number(o.status || 0);
      return (st === 2 || st === 3) && Number(o.profit || 0) > 0 && Number(o.is_receive || 0) === 0;
    });
    if (claimable) {
      hasActiveOrder = true;
      activeOrderCountdown = 0;
      nextClaimTime = new Date(Date.now() + BUFFER_MS);
      creds.nextClaimAt = nextClaimTime.toISOString();
      saveCredentials(creds);
      return;
    }

    // 2) amader nijer 3h order (deal_type=1) — shudhu ETAKEI track korbo
    const three = list.filter(isThreeHourOrder).sort((a, b) => Number(a.receive_times || 0) - Number(b.receive_times || 0));
    if (three.length) {
      const cd = Number(three[0].receive_times || 0);
      hasActiveOrder = true;
      activeOrderCountdown = cd;
      nextClaimTime = new Date(Date.now() + (cd * 1000) + BUFFER_MS);
      creds.nextClaimAt = nextClaimTime.toISOString();
      saveCredentials(creds);
      return;
    }

    // 3) long-term order (90/180/360 din) thakle o 3h cycle block korbe na
    const longs = list.filter(o => Number(o.status || 0) === 1 && !isThreeHourOrder(o));
    if (longs.length) {
      const l = longs.sort((a, b) => Number(b.receive_times || 0) - Number(a.receive_times || 0))[0];
      console.log(`[refresh] long-term order present (deal_type=${l.deal_type}, ${formatCountdown(l.receive_times)} left) — 3h cycle er sathe mix korchi na`);
    }
    hasActiveOrder = false;
    activeOrderCountdown = 0;
  } catch (e) {
    console.error('[refresh] error:', e.message);
  }
}

function formatCountdown(sec) {
  if (!sec || sec <= 0) return '0s';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  let r = '';
  if (h > 0) r += h + 'h ';
  if (m > 0) r += m + 'm ';
  r += s + 's';
  return r;
}

// Shesh-e kichu order (90/180/360 din er Auto-mode, deal_type=0) thakte pare — oigulo
// 3h cycle-er count/schedule hijack kore. So: only deal_type===1 (3h order) track korbo.
function isThreeHourOrder(o) {
  if (!o) return false;
  const rt = Number(o.receive_times || 0);
  if (rt <= 0) return false;
  const dtRaw = (o.deal_type !== undefined && o.deal_type !== null) ? o.deal_type : o.type;
  if (dtRaw !== undefined && dtRaw !== null && Number.isFinite(Number(dtRaw))) {
    if (Number(dtRaw) !== 1) return false;
  }
  return rt <= MAX_ORDER_SEC;
}

// Sob type theke ekta merged, unique deal list
async function fetchAllDeals() {
  const seen = new Set();
  const out = [];
  for (const t of [null, 0, 1, 2]) {
    const r = await apiGetDealList(1, 50, t);
    if (!r.success || !r.data || !r.data.length) continue;
    for (const o of r.data) {
      const sn = o.ordersn || JSON.stringify(o);
      if (seen.has(sn)) continue;
      seen.add(sn);
      out.push(o);
    }
  }
  return out;
}

async function apiLogin(phone, password) {
  try {
    const res = await api.post('/login', { phone, phone_code: COUNTRY_CODE, password, type: 'mobile' });
    if (res.data?.success) return { success: true, token: res.data.accessToken || res.data.data };
    return { success: false, error: res.data?.msg || 'Login failed' };
  } catch (e) { return { success: false, error: e.response?.data?.msg || e.message }; }
}

async function apiGetInfo() {
  try {
    const res = await api.post('/get_info', {});
    if (res.data?.success) return res.data.data || res.data;
  } catch (_) {}
  return null;
}

async function apiClaimProfit() {
  try {
    const res = await api.post('/receiveProfit', {});
    return { success: !!res.data?.success, msg: res.data?.msg || '', data: res.data };
  } catch (e) { return { success: false, msg: e.message }; }
}

async function apiClaimOrder(ordersn) {
  try {
    const res = await api.post('/receiveOrder', { ordersn });
    return { success: !!res.data?.success, msg: res.data?.msg || '', data: res.data };
  } catch (e) { return { success: false, msg: e.message }; }
}

async function apiCreateOrder(type, price, minuteIndex) {
  try {
    const res = await api.post('/createOrder', { type, price, minuteIndex: minuteIndex || 0, is_new: 1 });
    const body = res.data;
    if (body?.success) return { success: true, msg: '', data: body };
    const code = body?.code || '';
    const msg = body?.msg || body?.message || `code ${code}`;
    return { success: false, msg, data: body };
  } catch (e) {
    const body = e.response?.data;
    const code = body?.code || '';
    const msg = body?.msg || body?.message || e.message || `code ${code}`;
    return { success: false, msg, data: body };
  }
}

async function apiGetDealDetail(ordersn, type) {
  try {
    const res = await api.get('/getDealDetail', { params: { ordersn, type: type || 0 } });
    return { success: !!res.data?.success, data: res.data?.data || res.data, raw: res.data, msg: res.data?.msg || '' };
  } catch (e) { return { success: false, data: null, raw: null, msg: e.message }; }
}

async function apiGetDealList(page, size, type) {
  try {
    const params = { page: page || 1, size: size || 20 };
    if (type !== undefined && type !== null) params.type = type;
    const res = await api.get('/getDealList', { params });
    const raw = res.data;
    let list = null;
    if (raw?.success && Array.isArray(raw?.data?.list)) list = raw.data.list;
    else if (raw?.success && Array.isArray(raw?.data)) list = raw.data;
    else if (raw?.success && Array.isArray(raw?.list)) list = raw.list;
    else if (Array.isArray(raw?.data?.records)) list = raw.data.records;
    return { success: !!list, data: list || [], raw, msg: raw?.msg || '' };
  } catch (e) { return { success: false, data: [], raw: null, msg: e.message }; }
}

async function apiGetDealInfo() {
  try {
    const res = await api.get('/getDealInfo', {});
    return { success: !!res.data?.success, data: res.data?.data || res.data, msg: res.data?.msg || '' };
  } catch (e) { return { success: false, data: null, msg: e.message }; }
}

async function apiGetProfitList() {
  try {
    const res = await api.get('/getProfitList', { params: { page: 1, size: 30 } });
    return { success: !!res.data?.success, data: res.data?.data || res.data, raw: res.data, msg: res.data?.msg || '' };
  } catch (e) { return { success: false, data: null, raw: null, msg: e.message }; }
}

function mainMenu() {
  const btns = [];
  const guest = lastGateChatId != null && !isMaster(lastGateChatId) && resolveAccountIdx(lastGateChatId) < 0;
  if (isLoggedIn() && !guest) {
    btns.push([
      { text: autoClaimOn ? '🟢 Auto: ON' : '🔴 Auto: OFF', callback_data: 'toggle' },
      { text: creds.notifOn !== false ? '🔔 Notif: ON' : '🔕 Notif: OFF', callback_data: 'notif_toggle' }
    ]);
    btns.push([
      { text: '⚡ Claim', callback_data: 'claim_now' },
      { text: '✅ Create Order', callback_data: 'confirm_inject' }
    ]);
    btns.push([
      { text: '💵 Set Amount', callback_data: 'set_amount' },
      { text: '📊 Profit', callback_data: 'profit' }
    ]);
    btns.push([
      { text: '📖 History', callback_data: 'history' },
      { text: '📊 Status', callback_data: 'status' }
    ]);
      const accN = lastGateChatId != null ? visibleListFor(lastGateChatId).length : activeAccountList().length;
      if (accN > 0)
        btns.push([{ text: `👥 Accounts (${accN})`, callback_data: 'accounts_menu' }]);
    btns.push([{ text: '🚪 Logout', callback_data: 'logout' }]);
  } else {
    btns.push([{ text: '🔑 Login Koro', callback_data: 'login_start' }]);
  }
  return { reply_markup: { inline_keyboard: btns } };
}

bot.onText(/\/start/, async (msg) => {
  if (!isAllowedGuest(msg.chat.id)) return bot.sendMessage(msg.chat.id, '❌ Not allowed.');
  const mine = hasOwnAccount(msg.chat.id);
  if (mine) await refreshActiveOrder();
  const totalAccounts = visibleListFor(msg.chat.id).length;
  const lines = ['🤖 *ZenQuant Auto Claim Bot*', ''];
  if (isMaster(msg.chat.id)) {
    const all = activeAccountList().length;
    if (all > 1) lines.push(`📊 *Accounts:* ${all} (active: #${activeIdx + 1})`);
  } else if (totalAccounts > 0) {
    lines.push('👤 Apnar 1 ta account active ache.');
  }
  if (mine && isLoggedIn()) {
    lines.push('✅ *Login:* Active');
    if (creds.name) lines.push(`👤 *Name:* ${creds.name}`);
    lines.push(`📱 *Phone:* ${maskPhone(creds.phone)}`);
    if (lastInjectionTime) {
      lines.push(`💉 *Last Order:* ${lastInjectionTime.toLocaleString('en-GB', { timeZone: 'Asia/Dhaka' })}`);
    }
    if (hasActiveOrder && nextClaimTime) {
      const remainingMs = Math.max(0, nextClaimTime.getTime() - Date.now());
      const remainingSec = Math.floor(remainingMs / 1000);
      if (remainingMs > 0) lines.push(`⏳ *Countdown:* ${formatCountdown(remainingSec)}`);
      lines.push(`🔜 *Next Claim:* ${nextClaimTime.toLocaleString('en-GB', { timeZone: 'Asia/Dhaka' })}`);
    } else if (nextClaimTime) {
      lines.push(`🔜 *Next Retry:* ${nextClaimTime.toLocaleString('en-GB', { timeZone: 'Asia/Dhaka' })}`);
    }
  } else {
    lines.push('❌ *Login:* Kora nai');
  }
  lines.push('', '📌 /help — sob command dekhte');
  bot.sendMessage(msg.chat.id, lines.join('\n'), { parse_mode: 'Markdown', ...mainMenu() });
});

bot.onText(/\/help/, (msg) => {
  if (!isAllowedGuest(msg.chat.id)) return bot.sendMessage(msg.chat.id, '❌ Not allowed.');
  bot.sendMessage(msg.chat.id,
    '📚 *Available Commands*\n\n' +
    '/start — Bot restart\n' +
    '/accounts — Sob account dekhte\n' +
    '/acc 2 — Account 2 switch\n' +
    '/accdel 2 — Account 2 remove\n' +
    '/login — Notun account add (ba switch)\n' +
    '/logout — Active account logout\n' +
    '/status — Account status + next claim time\n' +
    '/claim — Claim available profit\n' +
    '/confirm — Create 3h order (optional: /confirm 50)\n' +
    '/profit — Profit history (last 30 days)\n' +
    '/history — Order history\n' +
    '/orders — Live order list (type, countdown, balance)\n' +
    '/help — Ei message',
    { parse_mode: 'Markdown', ...mainMenu() }
  );
});

bot.onText(/\/login/, (msg) => {
  if (!isAllowedGuest(msg.chat.id)) return bot.sendMessage(msg.chat.id, '❌ Not allowed.');
  startLoginFlow(msg.chat.id);
});
bot.onText(/\/logout/, (msg) => {
  if (!isAllowed(msg.chat.id)) return bot.sendMessage(msg.chat.id, '❌ Not allowed.');
  doLogout(msg.chat.id);
});
bot.onText(/\/status/, (msg) => {
  if (!isAllowed(msg.chat.id)) return bot.sendMessage(msg.chat.id, '❌ Not allowed.');
  sendStatus(msg.chat.id).catch(() => {});
});
bot.onText(/\/force_logout/, (msg) => {
  if (!isMaster(msg.chat.id)) return bot.sendMessage(msg.chat.id, '❌ Not allowed.');
  autoClaimOn = false; autoClaimChatId = null; hasActiveOrder = false; activeOrderCountdown = 0;
  lastInjectionTime = null; lastClaimAmount = null;
  if (claimTimer) { clearTimeout(claimTimer); claimTimer = null; }
  store = { accounts: [emptyCreds()], activeIdx: 0, boundChatId: null };
  activeIdx = 0; boundChatId = null; masterOpIdx = -1;
  syncActive();
  authToken = null; nextClaimTime = null;
  saveCredentials();
  bot.sendMessage(msg.chat.id, '🚪 Force logout done. Sob account remove — porer login e notun user bind hobe.');
});
bot.onText(/\/claim/, (msg) => {
  if (!isAllowed(msg.chat.id)) return bot.sendMessage(msg.chat.id, '❌ Not allowed.');
  if (!isLoggedIn()) return bot.sendMessage(msg.chat.id, '❌ Age /login diye login korun.');
  runClaim(msg.chat.id, true);
});
bot.onText(/\/confirm ?(.+)?/, (msg, match) => {
  if (!isAllowed(msg.chat.id)) return bot.sendMessage(msg.chat.id, '❌ Not allowed.');
  if (!isLoggedIn()) return bot.sendMessage(msg.chat.id, '❌ Age /login diye login korun.');
  const amount = match[1] ? parseFloat(match[1]) : null;
  if (amount !== null && (isNaN(amount) || amount <= 0))
    return bot.sendMessage(msg.chat.id, '❌ Sotik amount din (positive number).');
  if (amount !== null) pendingAmount[msg.chat.id] = amount;
  if (amount === null && !pendingAmount[msg.chat.id]) {
    pendingAmount[msg.chat.id] = 'awaiting';
    return bot.sendMessage(msg.chat.id, '💵 Koto amount order korben? Type kore din (e.g. 50)\n\n🚫 Cancel korle "cancel" likhun.');
  }
  runConfirm(msg.chat.id, false, pendingAmount[msg.chat.id]);
});
bot.onText(/\/profit/, (msg) => {
  if (!isAllowed(msg.chat.id)) return bot.sendMessage(msg.chat.id, '❌ Not allowed.');
  if (!isLoggedIn()) return bot.sendMessage(msg.chat.id, '❌ Age /login diye login korun.');
  runProfit(msg.chat.id);
});
bot.onText(/\/history/, (msg) => {
  if (!isAllowed(msg.chat.id)) return bot.sendMessage(msg.chat.id, '❌ Not allowed.');
  if (!isLoggedIn()) return bot.sendMessage(msg.chat.id, '❌ Age /login diye login korun.');
  runHistory(msg.chat.id);
});
bot.onText(/^\/orders(?:@\w+)?$/, async (msg) => {
  if (!isAllowed(msg.chat.id)) return bot.sendMessage(msg.chat.id, '❌ Not allowed.');
  if (!isLoggedIn()) return bot.sendMessage(msg.chat.id, '❌ Age /login diye login korun.');
  try {
    await bot.sendMessage(msg.chat.id, '⏳ Orders fetch korchi...');
    const list = await fetchAllDeals();
    if (!list.length) return bot.sendMessage(msg.chat.id, 'ℹ️ Kono order nei.');
    const lines = ['📋 *Orders*', ''];
    for (const o of list.slice(0, 12)) {
      const dt = o.deal_type !== undefined ? o.deal_type : o.type;
      const rt = Number(o.receive_times || 0);
      const st = Number(o.status || 0);
      const kind = isThreeHourOrder(o) ? '3h' : (Number(dt) === 0 ? 'LONG(auto)' : `type ${dt}`);
      const left = rt > 0 ? formatCountdown(rt) : (rt < 0 ? 'expired' : '-');
      lines.push(`#${(o.ordersn || '').slice(-8)} | ${kind} | $${o.price} | status ${st} | left ${left} | recv ${o.is_receive ? 'yes' : 'no'} | profit ${o.profit}`);
    }
    const di = await apiGetDealInfo();
    const ui = (di && di.data && di.data.userinfo) || {};
    lines.push('');
    lines.push(`💰 Cash: $${ui.balance} | Frozen: $${ui.freeze_balance} | Total: $${ui.total_balance} | Quota: $${ui.available_balance}`);
    bot.sendMessage(msg.chat.id, lines.join('\n'));
  } catch (e) {
    bot.sendMessage(msg.chat.id, '❌ Error: ' + e.message);
  }
});
bot.onText(/^\/accounts(?:@\w+)?$/, (msg) => {
  if (!isAllowedGuest(msg.chat.id)) return bot.sendMessage(msg.chat.id, '❌ Not allowed.');
  sendAccounts(msg.chat.id);
});

function activeAccountList() {
  return store.accounts.map((a, i) => ({ a, i })).filter(x => x.a.phone);
}
function visibleListFor(chatId) {
  const list = activeAccountList();
  if (isMaster(chatId)) return list;
  const i = resolveAccountIdx(chatId);
  return i >= 0 ? list.filter(x => x.i === i) : [];
}
function resolveAccNum(chatId, n) {
  const list = visibleListFor(chatId);
  const idx = n - 1;
  if (idx < 0 || idx >= list.length) return -1;
  return list[idx].i;
}

function sendAccounts(chatId) {
  const list = visibleListFor(chatId);
  if (!list.length) return bot.sendMessage(chatId, 'ℹ️ Apnar kono account nai. /login diye add korun.', mainMenu());
  const master = isMaster(chatId);
  const lines = [master ? '📋 *Accounts (master view)*' : '📋 *Apnar Account*', ''];
  list.forEach((x, n) => {
    const active = x.i === activeIdx ? ' 🟢' : '';
    lines.push(`${n + 1}. ${maskPhone(x.a.phone)}${x.a.name ? ' — ' + x.a.name : ''}${active}`);
  });
  if (master) {
    lines.push('', '🟢 Switch: /acc N\n➕ Add: /login\n❌ Remove: /accdel N');
  } else {
    lines.push('', 'ℹ️ Pratyek Telegram user 1 ta-i account add korte parben.');
    lines.push('Notun ID: age /logout diten, tarpor /login.');
  }
  const btns = list.map((x, n) => ([{ text: `${x.i === activeIdx ? '🟢' : '⚪'} Account ${n + 1}`, callback_data: `acc_sw_${x.i}` }]));
  bot.sendMessage(chatId, lines.join('\n'), { parse_mode: 'Markdown', reply_markup: { inline_keyboard: btns } });
}

bot.onText(/^\/acc(?:@\w+)?(?:\s+(\d+))?$/, (msg, match) => {
  if (!isAllowed(msg.chat.id)) return bot.sendMessage(msg.chat.id, '❌ Not allowed.');
  if (!match[1]) return sendAccounts(msg.chat.id);
  if (!isMaster(msg.chat.id)) return bot.sendMessage(msg.chat.id, '❌ Shudhu master switch korte parben. Apnar account-tai active ache.');
  const idx = resolveAccNum(msg.chat.id, parseInt(match[1]));
  if (idx < 0) return bot.sendMessage(msg.chat.id, '❌ Sotik account number din. /accounts dekhen.');
  switchAccount(msg.chat.id, idx);
});

bot.onText(/^\/accdel(?:@\w+)?(?:\s+(\d+))?$/, (msg, match) => {
  if (!isAllowed(msg.chat.id)) return bot.sendMessage(msg.chat.id, '❌ Not allowed.');
  let idx;
  if (isMaster(msg.chat.id)) {
    idx = match[1] ? resolveAccNum(msg.chat.id, parseInt(match[1])) : -1;
  } else {
    idx = resolveAccountIdx(msg.chat.id);
    if (idx < 0) return bot.sendMessage(msg.chat.id, '❌ Apnar kono account nai.');
  }
  if (idx < 0) return bot.sendMessage(msg.chat.id, '❌ Sotik account number din. /accounts dekhen.');
  const removed = store.accounts[idx].phone;
  const wasActive = idx === activeIdx;
  if (wasActive) stashRt();
  store.accounts.splice(idx, 1);
  adjustMasterOpIdx(idx);
  if (activeIdx >= store.accounts.length) activeIdx = Math.max(0, store.accounts.length - 1);
  if (wasActive) { syncActive(); if (store.accounts[activeIdx]) loadRt(store.accounts[activeIdx]); }
  else if (idx < activeIdx) activeIdx--;
  saveCredentials();
  if (claimTimer) { clearTimeout(claimTimer); claimTimer = null; }
  scheduleNext();
  bot.sendMessage(msg.chat.id, `🗑️ Account remove: ${maskPhone(removed)}\n📊 Bot e baki: ${activeAccountList().length} account`, mainMenu());
});

function switchAccount(chatId, idx) {
  if (!isMaster(chatId) && idx !== resolveAccountIdx(chatId))
    return bot.sendMessage(chatId, '❌ Shudhu master onno account e switch korte parben.');
  if (idx < 0 || idx >= store.accounts.length || !store.accounts[idx].phone)
    return bot.sendMessage(chatId, '❌ Account paowa jay ni.');
  if (idx === activeIdx) return bot.sendMessage(chatId, 'ℹ️ Eta i active account.', mainMenu());
  // Save current state before switching
  stashRt();
  saveCredentials();
  activeIdx = idx;
  if (isMaster(chatId)) masterOpIdx = idx;
  syncActive();
  loadRt(store.accounts[idx]);
  if (claimTimer) { clearTimeout(claimTimer); claimTimer = null; }
  saveCredentials();
  const name = creds.name || maskPhone(creds.phone);
  bot.sendMessage(chatId, `🔄 Switched: #${idx + 1} — ${name}`, mainMenu());
  if (autoClaimOn && (autoClaimChatId || boundChatId)) resumeAutoScheduler();
}

bot.on('message', (msg) => {
  if (!msg.text || msg.text.startsWith('/')) return;
  const inFlow = !!pendingLogin[msg.chat.id] || !!pendingAmount[msg.chat.id];
  const ok = isAllowed(msg.chat.id);
  if (!inFlow && !ok) return;
  const text = msg.text.trim().toLowerCase();
  // Handle manual amount input
  if (pendingAmount[msg.chat.id] === 'awaiting') {
    if (text === 'cancel') {
      delete pendingAmount[msg.chat.id];
      return bot.sendMessage(msg.chat.id, '🚫 Cancelled.', mainMenu());
    }
    const amt = parseFloat(msg.text.trim());
    if (isNaN(amt) || amt <= 0)
      return bot.sendMessage(msg.chat.id, '❌ Sotik amount din (positive number). Cancel korle "cancel" likhun.');
    pendingAmount[msg.chat.id] = amt;
    return runConfirm(msg.chat.id, false, amt);
  }
  const state = pendingLogin[msg.chat.id];
  if (!state) return;
  if (state.step === 'phone') {
    const phone = msg.text.trim();
    if (!/^\d{6,15}$/.test(phone))
      return bot.sendMessage(msg.chat.id, '❌ Sotik phone number din (jemon: 17XXXXXXXX)');
    state.phone = phone;
    state.step = 'password';
    bot.sendMessage(msg.chat.id, '🔒 Ekhon password din:');
  } else if (state.step === 'password') {
    const password = msg.text.trim();
    const owner = String(msg.chat.id);
    bot.deleteMessage(msg.chat.id, msg.message_id).catch(() => {});
    bot.sendMessage(msg.chat.id, '⏳ Login hocche...');
    apiLogin(state.phone, password).then(async (result) => {
      delete pendingLogin[msg.chat.id];
      if (!result.success)
        return bot.sendMessage(msg.chat.id, `❌ Login failed: ${result.error}`, mainMenu());
      // Per Telegram user: 1 ta-i ZenQuant account
      const ownedIdx = store.accounts.findIndex(a => a.phone && a.ownerChatId === owner);
      let existingIdx = store.accounts.findIndex(a => a.phone === state.phone);
      if (existingIdx >= 0) {
        const acc = store.accounts[existingIdx];
        if (acc.ownerChatId && acc.ownerChatId !== owner)
          return bot.sendMessage(msg.chat.id, '❌ Ei ZenQuant ID arekta Telegram account er sathe already linked ache.', mainMenu());
        if (ownedIdx >= 0 && ownedIdx !== existingIdx)
          return bot.sendMessage(msg.chat.id, '❌ Apni ekta-i account add korte parben.', mainMenu());
        acc.ownerChatId = owner;
        stashRt();
        const prevIdx = activeIdx;
        activeIdx = existingIdx;
        if (isMaster(msg.chat.id)) masterOpIdx = existingIdx;
        syncActive();
        loadRt(acc);
        creds.password = password;
        creds.token = result.token;
        authToken = result.token;
        try {
          const info = await apiGetInfo();
          if (info?.userinfo?.username) creds.name = info.userinfo.username;
        } catch (_) {}
        if (!boundChatId) boundChatId = owner;
        if (!isMaster(msg.chat.id) && prevIdx !== activeIdx && store.accounts[prevIdx]) {
          activeIdx = prevIdx; syncActive(); loadRt(store.accounts[prevIdx]);
        }
        saveCredentials();
        return bot.sendMessage(msg.chat.id, `✅ Account login/switch hoyeche! (${maskPhone(state.phone)})`, mainMenu());
      }
      if (ownedIdx >= 0)
        return bot.sendMessage(msg.chat.id, '❌ Apni ekta-i account add korte parben. Notun ID lagle age /logout diten.', mainMenu());
      // Add new account
      const newAcc = emptyCreds();
      newAcc.phone = state.phone;
      newAcc.password = password;
      newAcc.token = result.token;
      newAcc.ownerChatId = owner;
      const emptySlot = store.accounts.findIndex(a => !a.phone);
      stashRt();
      const prevIdx = activeIdx;
      if (emptySlot >= 0) {
        store.accounts[emptySlot] = newAcc;
        activeIdx = emptySlot;
      } else {
        store.accounts.push(newAcc);
        activeIdx = store.accounts.length - 1;
      }
      syncActive();
      loadRt(newAcc);
      authToken = result.token;
      if (isMaster(msg.chat.id)) masterOpIdx = activeIdx;
      try {
        const info = await apiGetInfo();
        if (info?.userinfo?.username) creds.name = info.userinfo.username;
      } catch (_) {}
      if (!boundChatId) boundChatId = owner;
      if (!isMaster(msg.chat.id) && store.accounts[prevIdx] && store.accounts[prevIdx].phone) {
        activeIdx = prevIdx; syncActive(); loadRt(store.accounts[prevIdx]);
      }
      saveCredentials();
      const count = store.accounts.filter(a => a.phone).length;
      bot.sendMessage(msg.chat.id, `✅ Account added! (${maskPhone(state.phone)})\n📊 Bot e total: ${count} account`, mainMenu());
    });
  }
});

function startLoginFlow(chatId) {
  pendingLogin[chatId] = { step: 'phone' };
  bot.sendMessage(chatId, '📱 Country code chara phone number din (jemon: 17XXXXXXXX):');
}

function doLogout(chatId) {
  if (!isMaster(chatId)) {
    const i = resolveAccountIdx(chatId);
    if (i < 0) return bot.sendMessage(chatId, '❌ Apnar kono account nai.');
    activateIdx(i);
  }
  autoClaimOn = false; autoClaimChatId = null; hasActiveOrder = false; activeOrderCountdown = 0;
  lastInjectionTime = null; lastClaimAmount = null;
  if (claimTimer) { clearTimeout(claimTimer); claimTimer = null; }
  const removed = creds.phone;
  if (store.accounts.length > 1) {
    store.accounts.splice(activeIdx, 1);
    adjustMasterOpIdx(activeIdx);
    if (activeIdx >= store.accounts.length) activeIdx = 0;
  } else {
    store.accounts[0] = emptyCreds();
    activeIdx = 0;
  }
  syncActive();
  loadRt(store.accounts[activeIdx]);
  saveCredentials();
  scheduleNext();
  const left = store.accounts.filter(a => a.phone).length;
  bot.sendMessage(chatId, `🚪 Logout hoyeche${removed ? ' (' + maskPhone(removed) + ')' : ''}. Baki account: ${left}`, mainMenu());
}

bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const action = query.data;
  if (!isAllowed(chatId)) {
    // Guest: login start / accounts dekha jabe
    if (action === 'login_start') { startLoginFlow(chatId); return bot.answerCallbackQuery(query.id); }
    if (action === 'accounts_menu') { sendAccounts(chatId); return bot.answerCallbackQuery(query.id); }
    try { await bot.answerCallbackQuery(query.id, { text: '❌ Not allowed' }); } catch (_) {}
    return;
  }
  function requireLogin() {
    if (!isLoggedIn()) {
      bot.sendMessage(chatId, '❌ Age /login diye login korun.', mainMenu());
      return false;
    }
    return true;
  }
  try {
    if (action === 'login_start') { startLoginFlow(chatId); return bot.answerCallbackQuery(query.id); }
    if (action === 'logout') { doLogout(chatId); return bot.answerCallbackQuery(query.id); }
    if (action.startsWith('acc_sw_')) {
      const idx = parseInt(action.replace('acc_sw_', ''));
      switchAccount(chatId, idx);
      return bot.answerCallbackQuery(query.id);
    }
    if (action === 'accounts_menu') { sendAccounts(chatId); return bot.answerCallbackQuery(query.id); }
    if (action === 'toggle') {
      if (!requireLogin()) return bot.answerCallbackQuery(query.id);
      if (autoClaimOn) turnOff(chatId); else turnOn(chatId);
      return bot.answerCallbackQuery(query.id);
    }
    if (action === 'claim_now') {
      if (!requireLogin()) return bot.answerCallbackQuery(query.id);
      await bot.answerCallbackQuery(query.id, { text: 'Claim shuru hocche...' });
      return await runClaim(chatId, true);
    }
    if (action === 'confirm_inject') {
      if (!requireLogin()) return bot.answerCallbackQuery(query.id);
      await bot.answerCallbackQuery(query.id, { text: 'Order create hocche...' });
      const amt = pendingAmount[chatId] && pendingAmount[chatId] !== 'awaiting' ? pendingAmount[chatId] : null;
      return await runConfirm(chatId, false, amt);
    }
    if (action === 'history') {
      if (!requireLogin()) return bot.answerCallbackQuery(query.id);
      await bot.answerCallbackQuery(query.id, { text: 'Order history...' });
      return await runHistory(chatId);
    }
    if (action === 'status') { await sendStatus(chatId); return bot.answerCallbackQuery(query.id); }
    if (action === 'notif_toggle') {
      if (!requireLogin()) return bot.answerCallbackQuery(query.id);
      creds.notifOn = creds.notifOn !== false ? false : true;
      saveCredentials(creds);
      bot.sendMessage(chatId, creds.notifOn !== false ? '🔔 Notifications ON' : '🔕 Notifications OFF', mainMenu());
      return bot.answerCallbackQuery(query.id);
    }
    if (action === 'set_amount') {
      if (!requireLogin()) return bot.answerCallbackQuery(query.id);
      pendingAmount[chatId] = 'awaiting';
      bot.sendMessage(chatId, '💵 Koto amount order korben? Type kore din (e.g. 50)\n\n🚫 Cancel korle "cancel" likhun.');
      return bot.answerCallbackQuery(query.id);
    }
    if (action === 'profit') {
      if (!requireLogin()) return bot.answerCallbackQuery(query.id);
      await bot.answerCallbackQuery(query.id, { text: 'Profit history...' });
      return await runProfit(chatId);
    }
    bot.answerCallbackQuery(query.id);
  } catch (e) {
    console.error('Callback query error:', e);
    bot.sendMessage(chatId, '❌ Error: ' + e.message).catch(() => {});
  }
});

async function sendStatus(chatId) {
  await refreshActiveOrder();
  const lines = ['📊 *Status*', ''];
  if (isLoggedIn()) {
    lines.push('✅ *Login:* Active');
    if (creds.name) lines.push(`👤 *Name:* ${creds.name}`);
    lines.push(`📱 *Phone:* ${maskPhone(creds.phone)}`);
  } else {
    lines.push('❌ *Login:* Kora nai');
  }
  lines.push('');
  lines.push(`🔄 *Auto Claim:* ${autoClaimOn ? 'ON' : 'OFF'}`);
  if (lastInjectionTime) {
    lines.push(`💉 *Last Order:* ${lastInjectionTime.toLocaleString('en-GB', { timeZone: 'Asia/Dhaka' })}`);
  }
  if (lastClaimAmount) {
    lines.push(`💰 *Last Claim:* $${lastClaimAmount}`);
  }
  lines.push(`📌 *Status:* ${lastActionStatus}`);
  if (hasActiveOrder && nextClaimTime) {
    const remainingMs = Math.max(0, nextClaimTime.getTime() - Date.now());
    const remainingSec = Math.floor(remainingMs / 1000);
    const countdownStr = remainingMs > 0 ? formatCountdown(remainingSec) : '✅ Ready!';
    lines.push(`⏳ *Countdown:* ${countdownStr}`);
    lines.push(`🔜 *Next Claim:* ${nextClaimTime.toLocaleString('en-GB', { timeZone: 'Asia/Dhaka' })}`);
  } else if (nextClaimTime) {
    lines.push(`🔜 *Next Retry:* ${nextClaimTime.toLocaleString('en-GB', { timeZone: 'Asia/Dhaka' })}`);
  } else {
    lines.push(`🔜 *Next:* N/A`);
  }
  lines.push('', '📌 /help — sob command dekhte');
  bot.sendMessage(chatId, lines.join('\n'), { parse_mode: 'Markdown', ...mainMenu() });
}

function turnOn(chatId) {
  if (!isLoggedIn()) return bot.sendMessage(chatId, '❌ Age /login diye login korun.', mainMenu());
  if (autoClaimOn) return bot.sendMessage(chatId, 'Already ON ache.', mainMenu());
  autoClaimOn = true;
  autoClaimChatId = chatId;
  creds.autoClaimOn = true;
  creds.autoClaimChatId = chatId;
  saveCredentials();

  // API theke active order check korbo (memory state reset hoye geleo)
  refreshActiveOrder().then(() => {
    if (hasActiveOrder && nextClaimTime && nextClaimTime > Date.now()) {
      const remainingMs = Math.max(0, nextClaimTime.getTime() - Date.now());
      const remainingSec = Math.floor(remainingMs / 1000);
      bot.sendMessage(chatId, `🟢 Auto Claim ON. Active order ase, countdown: ${formatCountdown(remainingSec)} baki.`, mainMenu());
    } else {
      bot.sendMessage(chatId, '🟢 Auto Claim ON. Prothom cycle ekhoni shuru hocche...', mainMenu());
      autoCycleAll();
      return;
    }
    scheduleNext();
  });
}

function turnOff(chatId) {
  autoClaimOn = false; autoClaimChatId = null;
  creds.autoClaimOn = false; creds.autoClaimChatId = null; saveCredentials();
  if (claimTimer) { clearTimeout(claimTimer); claimTimer = null; }
  bot.sendMessage(chatId, '🔴 Auto Claim OFF.', mainMenu());
  scheduleNext(); // baki account er auto-claim thakle timer fire up
}

 function scheduleNext() {
  if (claimTimer) clearTimeout(claimTimer);
  const due = store.accounts.filter(a => a.phone && a.autoClaimOn && (a.autoClaimChatId || a.ownerChatId || boundChatId));
  if (!due.length) return;
  const now = Date.now();
  let minDelay = null;
  for (const a of due) {
    let d = CLAIM_INTERVAL_MS;
    if (a.nextClaimAt) {
      const t = new Date(a.nextClaimAt).getTime();
      d = t > now ? t - now : 0;
      // 3h order er countdown 3h-er beshi hobe na — purano/garbage nextClaimAt (e.g. 1 year+) ignore
      if (d > MAX_SCHEDULE_MS) {
        console.log(`[schedule] account ${a.phone} nextClaimAt too far (${a.nextClaimAt}) — re-evaluating now`);
        d = 0;
      }
    } else {
      d = 0; // due now
    }
    if (minDelay === null || d < minDelay) minDelay = d;
  }
  const jitter = Math.floor(Math.random() * JITTER_MS);
  claimTimer = setTimeout(() => { autoCycleAll(); }, Math.max(minDelay, 0) + jitter);
}

function resumeAutoScheduler() {
  console.log('Resuming auto claim scheduler...');
  scheduleNext();
}

if (store.accounts.some(a => a.phone && a.autoClaimOn)) {
  resumeAutoScheduler();
}

async function autoCycleAll() {
  const idxs = store.accounts.map((a, i) => i).filter(i => {
    const a = store.accounts[i];
    if (!a.phone || !a.autoClaimOn) return false;
    if (a.nextClaimAt && new Date(a.nextClaimAt).getTime() > Date.now()) return false;
    return true;
  });
  for (const i of idxs) {
    const a = store.accounts[i];
    const chat = a.autoClaimChatId || a.ownerChatId || boundChatId;
    if (!chat) continue;
    const chatNum = Number(chat);
    stashRt();
    const prevIdx = activeIdx;
    activeIdx = i;
    syncActive();
    loadRt(a);
    try {
      const claimed = await runClaim(chatNum, false, true);
      if (claimed) {
        const delay = 25000 + Math.floor(Math.random() * 11000);
        await new Promise((r) => setTimeout(r, delay));
        await runConfirm(chatNum, true);
      } else {
        if (!nextClaimTime || nextClaimTime <= Date.now()) {
          nextClaimTime = new Date(Date.now() + CLAIM_INTERVAL_MS);
          creds.nextClaimAt = nextClaimTime.toISOString();
          saveCredentials();
        }
      }
    } catch (e) {
      console.error('Auto cycle error (account ' + i + '):', e.message);
    }
    // restore master's previous active context
    if (prevIdx !== activeIdx && store.accounts[prevIdx]) {
      stashRt();
      activeIdx = prevIdx;
      syncActive();
      loadRt(store.accounts[prevIdx]);
    }
  }
  scheduleNext();
}

async function runClaim(chatId, manual, isAuto) {
  if (!isLoggedIn()) { bot.sendMessage(chatId, '❌ Age /login diye login korun.'); return false; }
  if (isClaiming) { bot.sendMessage(chatId, '⏳ Ager claim ekhono cholche, wait korun.'); return false; }
  isClaiming = true;
  let didClaim = false;
  const send = (t) => {
    if (isAuto && creds.notifOn === false) return;
    bot.sendMessage(chatId, t).catch(() => {});
  };

  try {
    send('⏳ Site theke info nicchi...');
    const info = await apiGetInfo();
    if (!info) throw new Error('API response failed');

    const u = info.userinfo || {};
    if (u.username && u.username !== creds.name) {
      creds.name = u.username; saveCredentials(creds);
    }

    const cashBalance = Number(u.balance || 0);
    const availQuota = Number(u.available_balance || 0);
    const total = Number(u.total_balance || 0);
    const virtualBal = Number(u.virtual_balance || 0);
    const virtualCd = Number(u.virtual_count_down || 0);
    lastBalance = { cash: cashBalance, available: availQuota, total, virtual: virtualBal, ts: new Date().toISOString() };

    // Step 1: try global claim endpoint
    let profit = 0, claimCount = 0;
    send(`🔍 Claim checking...`);
    const claimRes = await apiClaimProfit();
    if (claimRes.success) {
      didClaim = true; claimCount++;
      hasActiveOrder = false; activeOrderCountdown = 0;
    } else {
      send(`ℹ️ ${claimRes.data?.code === 1001 ? 'Global claim: no profit' : 'Global claim failed'}`);
    }

    // Step 2: try per-order claim for ALL un-received orders
    const tryTypes = [null, 0, 2, 1];
    for (const t of tryTypes) {
      const dealRes = await apiGetDealList(1, 20, t);
      if (dealRes.success && dealRes.data.length) {
        for (const o of dealRes.data) {
          const is_recv = Number(o.is_receive || 0);
          if (is_recv === 0) {
            const orderRes = await apiClaimOrder(o.ordersn);
            if (orderRes.success) {
              didClaim = true; claimCount++;
              hasActiveOrder = false; activeOrderCountdown = 0;
              profit += Number(o.profit || 0) || Number(orderRes.data || 0);
              send(`✅ Order #${o.ordersn.slice(-8)} claimed!`);
            }
          }
        }
      }
      if (didClaim && claimCount > 0) break;
    }

    if (didClaim) {
      lastActionStatus = `✅ Profit claimed (${claimCount} order(s))`;
      send(`✅ *Profit claimed!*`);
    } else {
      // Detection fallback (for display / state tracking)
      const allDeals = await fetchAllDeals();
      for (const o of allDeals) {
        const pf = Number(o.profit || 0);
        const st = Number(o.status || 0);
        const cd = Number(o.receive_times || 0);
        if (pf > 0) {
          profit = pf;
          break;
        }
      }
      // Countdown shudhu 3h order theke — long order (360 din) cycle block korbe na
      const three = allDeals.filter(isThreeHourOrder).sort((a, b) => Number(a.receive_times || 0) - Number(b.receive_times || 0));
      if (three.length) {
        hasActiveOrder = true;
        activeOrderCountdown = Number(three[0].receive_times || 0);
        nextClaimTime = new Date(Date.now() + (activeOrderCountdown * 1000) + BUFFER_MS);
        creds.nextClaimAt = nextClaimTime.toISOString();
        saveCredentials(creds);
      } else if (profit === 0) {
        await refreshActiveOrder();
      }

      if (hasActiveOrder && activeOrderCountdown > 0) {
        send(`⏳ Active order countdown: ${formatCountdown(activeOrderCountdown)} baki.`);
      } else if (!hasActiveOrder) {
        lastActionStatus = 'ℹ️ Kono profit nei, kono active order o nei';
        send(`ℹ️ Kono profit claim kora jay na. Active order o nei.`);
      }
    }

    send(`📊 *Account Info*
👤 Name: ${u.username || creds.name || 'N/A'}
💰 Cash: $${cashBalance}
📊 Available: $${availQuota}
📦 Total: $${total}${virtualBal > 0 ? `\n🧊 Virtual: $${virtualBal} (${formatCountdown(virtualCd)})` : ''}`);

    lastActionTime = new Date();

    if (isAuto) {
      if (virtualBal > 0 && virtualCd > 0) {
        // Don't suggest injection — virtual is active
      } else {
        send(`🔁 Auto mode: ekhon nijer theke *Create Order* cholbe...`);
      }
    } else {
      const confirmBtns = {
        reply_markup: {
          inline_keyboard: [
            [{ text: '✅ Create Order', callback_data: 'confirm_inject' }],
            [{ text: '📊 Status', callback_data: 'status' }]
          ]
        }
      };
      send(`Ekhon order create korte *Create Order* button e click korun.`, confirmBtns);
    }

  } catch (err) {
    console.error('runClaim error:', err);
    lastActionTime = new Date();
    lastActionStatus = `❌ ${err.message}`;
    send(`❌ Error: ${err.message}`);
  } finally {
    isClaiming = false;
  }
  return didClaim;
}

async function runConfirm(chatId, isAuto, customAmount) {
  if (!isLoggedIn()) return bot.sendMessage(chatId, '❌ Age /login diye login korun.');
  if (isClaiming) {
    // Safety: if stuck more than 5 min, auto-reset
    if (lastActionTime && (Date.now() - lastActionTime.getTime()) > 300000) {
      isClaiming = false;
      console.log('isClaiming was stuck >5min, force reset');
    } else {
      return bot.sendMessage(chatId, '⏳ Age order create shesh hok, wait korun.');
    }
  }
  if (hasActiveOrder) {
    lastActionStatus = 'ℹ️ Already have an active order, skip';
    if (!isAuto) bot.sendMessage(chatId, 'ℹ️ Age active order shesh hok, tarpor order korben.');
    return;
  }
  isClaiming = true;
  delete pendingAmount[chatId];
  const send = (t) => {
    if (isAuto && creds.notifOn === false) return;
    bot.sendMessage(chatId, t).catch(() => {});
  };

  try {
    send('⏳ Info nicchi...');

    // Use getDealInfo for correct order-creation balance
    const dealInfo = await apiGetDealInfo();
    if (!dealInfo.success || !dealInfo.data) throw new Error('API response failed');
    const dealData = dealInfo.data;
    const ui = dealData.userinfo || {};
    const orderBalance = Number(ui.balance || 0);

    // Also get regular info for virtual check
    const info = await apiGetInfo();
    const u = info?.userinfo || {};

    let amount = customAmount || Math.floor(orderBalance);
    const MIN_ORDER = 10;
    if (amount < MIN_ORDER) {
      hasActiveOrder = false; activeOrderCountdown = 0;
      lastActionStatus = `ℹ️ Balance kom ($${orderBalance}), order skip`;
      nextClaimTime = new Date(Date.now() + CLAIM_INTERVAL_MS);
      creds.nextClaimAt = nextClaimTime.toISOString();
      saveCredentials(creds);
      send(`ℹ️ Balance kom ($${orderBalance}). Minimum $${MIN_ORDER} lagbe.
🔜 পরের চেষ্টা: ${nextClaimTime.toLocaleString('en-GB', { timeZone: 'Asia/Dhaka' })}`);
      return;
    }

    if (customAmount && customAmount > orderBalance) {
      send(`⚠️ Custom amount ($${customAmount}) balance er cheye beshi! ${Math.floor(orderBalance)} use korchi.`);
      amount = Math.floor(orderBalance);
    }

    send(`⏳ 3h order create korchi $${amount} (balance: $${orderBalance})...`);
    const order1 = await apiCreateOrder(1, amount, 0);
    if (!order1.success) {
      hasActiveOrder = false; activeOrderCountdown = 0;
      throw new Error('Order create failed: ' + (order1.msg || JSON.stringify(order1.data).substring(0, 100)));
    }

    let injectedMsg = `✅ 3h Order: $${amount}`;

    lastActionTime = new Date();
    lastInjectionTime = new Date();
    lastActionStatus = `✅ Order created`;

    // Receive_times from site = actual countdown in seconds
    let countdownSec = 0;
    try {
      await new Promise(r => setTimeout(r, 3000));
      const list = await fetchAllDeals();
      // Shudhu amader nijer 3h order (deal_type=1) — 360-din order er countdown niye na
      const mine = list.filter(isThreeHourOrder);
      if (mine.length) {
        const exact = mine.find(o => Number(o.price || 0) === Number(amount));
        const pick = exact || mine.sort((a, b) => Number(a.receive_times || 0) - Number(b.receive_times || 0))[0];
        countdownSec = Number(pick.receive_times || 0);
      }
    } catch (_) {}


    if (countdownSec > 0) {
      hasActiveOrder = true;
      activeOrderCountdown = countdownSec;
      nextClaimTime = new Date(Date.now() + (countdownSec * 1000) + BUFFER_MS);
    } else {
      hasActiveOrder = true;
      activeOrderCountdown = 10800;
      nextClaimTime = new Date(Date.now() + CLAIM_INTERVAL_MS);
    }

    creds.nextClaimAt = nextClaimTime.toISOString();
    saveCredentials(creds);

    send(`✅ *Order created!*
━━━━━━━━━━━━━━━━
${injectedMsg}
⏳ Countdown: ${formatCountdown(activeOrderCountdown)} + 2min buffer
━━━━━━━━━━━━━━━━
🔜 Next claim: ${nextClaimTime.toLocaleString('en-GB', { timeZone: 'Asia/Dhaka' })}`);

  } catch (err) {
    console.error('runConfirm error:', err);
    lastActionStatus = `❌ ${err.message}`;
    // Don't blindly clear hasActiveOrder — refresh from API
    await refreshActiveOrder().catch(() => {});
    if (!hasActiveOrder) {
      nextClaimTime = new Date(Date.now() + 30 * 60 * 1000);
      creds.nextClaimAt = nextClaimTime.toISOString();
      saveCredentials(creds);
    }
    send(`❌ Error: ${err.message}
🔜 Next retry: ${nextClaimTime ? nextClaimTime.toLocaleString('en-GB', { timeZone: 'Asia/Dhaka' }) : 'scheduled'}`);
  } finally {
    isClaiming = false;
  }
}

async function runProfit(chatId) {
  if (!isLoggedIn()) return bot.sendMessage(chatId, '❌ Age /login diye login korun.');
  const send = (t, o) => bot.sendMessage(chatId, t, o || {}).catch(() => {});
  try {
    send('⏳ Profit history fetch korchi...');
    const res = await apiGetProfitList();
    if (!res.success) throw new Error(res.msg || 'API failed');
    const raw = res.data;
    let list = [];
    if (Array.isArray(raw)) list = raw;
    else if (Array.isArray(raw?.list)) list = raw.list;
    else if (Array.isArray(raw?.data)) list = raw.data;
    else {
      send('📊 Full API response:\n' + JSON.stringify(raw).substring(0, 3000), mainMenu());
      return;
    }
    if (!list.length) return send('ℹ️ Kono profit history nei.', mainMenu());
    const lines = ['📊 *Profit History (last 30 days)*'];
    let total = 0;
    for (const p of list) {
      const profit = Number(p.profit || p.amount || p.money || 0);
      const date = p.date || p.time || p.create_time || '';
      const sn = (p.ordersn || p.orderNo || '').toString().slice(-8);
      total += profit;
      lines.push(`${date} ${sn ? '#'+sn : ''} $${profit.toFixed(2)}`);
    }
    lines.push(`━━━━━━━━━━━`);
    lines.push(`💰 *Total: $${total.toFixed(2)}*`);
    await send(lines.join('\n'), { parse_mode: 'Markdown', ...mainMenu() });
  } catch (e) {
    console.error('runProfit error:', e);
    await send('❌ Profit history error: ' + (e.response?.data ? JSON.stringify(e.response.data).substring(0, 500) : e.message), mainMenu());
  }
}

async function runHistory(chatId) {
  if (!isLoggedIn()) return bot.sendMessage(chatId, '❌ Age /login diye login korun.');
  const send = (t, o) => bot.sendMessage(chatId, t, o || {});
  try {
    // Try ALL possible endpoints and log everything
    const allAttempts = [
      { method: 'GET', url: '/getDealList', params: { page: 1, size: 20, type: 0 } },
      { method: 'GET', url: '/getDealList', params: { page: 1, size: 20, type: 1 } },
      { method: 'GET', url: '/getDealList', params: { page: 1, size: 20, type: 2 } },
      { method: 'GET', url: '/getDealList', params: { page: 1, size: 20 } },
      { method: 'POST', url: '/getDealList', data: { page: 1, size: 20, type: 0 } },
      { method: 'POST', url: '/getDealList', data: { page: 1, size: 20 } },
      { method: 'GET', url: '/getDealDetail', params: { ordersn: '0', type: 0 } },
      { method: 'GET', url: '/getProfitList', params: { page: 1, size: 20 } },
      { method: 'POST', url: '/getDealList', data: { page: 1, size: 999 } },
    ];

    const results = [];
    for (const a of allAttempts) {
      try {
        let res;
        if (a.method === 'GET') res = await api.get(a.url, { params: a.params });
        else res = await api.post(a.url, a.data);
        const b = res.data;
        const snippet = JSON.stringify(b).substring(0, 200);
        results.push(`🔹 ${a.method} ${a.url}: ${snippet}`);
        console.log(`[history] ${a.method} ${a.url} =>`, JSON.stringify(b).substring(0, 500));
      } catch (e) {
        const errMsg = e.response?.data ? JSON.stringify(e.response.data).substring(0, 100) : e.message;
        results.push(`🔸 ${a.method} ${a.url}: ❌ ${errMsg}`);
        console.log(`[history] ${a.method} ${a.url} ERROR:`, errMsg);
      }
    }

    // Send all results to user (no Markdown to avoid parse errors from special chars in JSON)
    const msg = results.join('\n');
    for (let i = 0; i < msg.length; i += 3500) {
      await send('📖 History Debug:\n' + msg.substring(i, i + 3500));
    }

    // Now try to parse the first successful GET /getDealList response for a nicer view
    const dealRes = await api.get('/getDealList', { params: { page: 1, size: 20, type: 0 } }).catch(() => null);
    if (dealRes?.data) {
      const b = dealRes.data;
      let orders = [];
      if (Array.isArray(b?.data?.list)) orders = b.data.list;
      else if (Array.isArray(b?.data)) orders = b.data;
      else if (Array.isArray(b?.list)) orders = b.list;
      else if (Array.isArray(b?.records)) orders = b.records;

      if (orders.length) {
        const lines = ['📋 Order List:'];
        for (const [idx, order] of orders.entries()) {
          if (idx === 0) {
            const fields = Object.entries(order).map(([k, v]) => `${k}=${String(v).substring(0, 25)}`).join(', ');
            lines.push('Fields: ' + fields);
          }
          const amount = Number(order.amount || order.price || order.money || 0);
          const typeIdx = Number(order.deal_type ?? order.type ?? -1);
          const typeName = ['Regular', 'Closed', 'Quick', 'Phoenix'][typeIdx] || `T${typeIdx}`;
          const sMap = { 1: '⚡Active', 2: '⏳Redeem', 3: '✅Done', 4: '⏹Stop' };
          const status = sMap[order.status] || `S${order.status}`;
          const sn = (order.ordersn || order.orderNo || order.orderno || '').toString().slice(-8);
          const startTime = order.time || '';
          lines.push(`#${sn} ${typeName} $${amount} ${status} 🕐${startTime}`);
        }
        lines.push(`\nTotal: ${orders.length} orders`);
        await send(lines.join('\n'), { ...mainMenu() });
      } else {
        await send('ℹ️ Kono order nei (getDealList empty).', { ...mainMenu() });
      }
    }
  } catch (e) {
    console.error('runHistory error:', e);
    await send('❌ History error: ' + (e.response?.data ? JSON.stringify(e.response.data).substring(0, 500) : e.message), mainMenu());
  }
}

process.on('unhandledRejection', (err) => { console.error('UHR:', err.message); });
process.on('uncaughtException', (err) => { console.error('UCE:', err.message); });

// Self-ping every 4 min to prevent Render free tier spin-down
const MY_URL = process.env.RENDER_EXTERNAL_URL || 'https://zenquant-claim-bot-srv.onrender.com';
const ping = () => https.get(MY_URL, () => {}).on('error', () => {});
ping(); // startup e ekbar
setInterval(ping, 4 * 60 * 1000);

console.log('Bot v2 started.');

