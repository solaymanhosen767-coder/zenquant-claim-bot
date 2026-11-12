// ZenQuant order helpers — pure functions (no network), unit-testable
//
// ZenQuant order families:
//   deal_type = 1 -> "Normal" 3h order, term = 180 min  (deal_order.deal_order_times)
//   deal_type = 0 -> "Auto" mode, term = 90/180/360 DAYS (deal_rate_list[].minute)
//   deal_type = 2 -> PLUS / Quick  — removed from the site (new_deal_order.open = 0)
//
// receive_times = seconds remaining on the order.
// A 3h order can never have more than 10800s left, so anything above the cap
// is a long-term (days) order and must NOT drive the 3h claim cycle.

const THREE_H_SEC = 180 * 60;        // 10800
const MAX_ORDER_SEC = 4 * 60 * 60;    // 14400 — safety cap for a "3h" order

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

// True only for OUR 3h order (deal_type 1) that still has time left on it.
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

// 3h orders, soonest to expire first
function pickThreeHourOrders(list) {
  return (list || []).filter(isThreeHourOrder)
    .sort((a, b) => Number(a.receive_times || 0) - Number(b.receive_times || 0));
}

// Long-term (90/180/360 day) orders — informational only, never drive the cycle
function pickLongOrders(list) {
  return (list || []).filter(o => Number(o.status || 0) === 1 && !isThreeHourOrder(o))
    .sort((a, b) => Number(b.receive_times || 0) - Number(a.receive_times || 0));
}

// Orders that matured but whose profit was not claimed yet
function pickClaimableOrders(list) {
  return (list || []).filter(o => {
    const st = Number(o.status || 0);
    return (st === 2 || st === 3) && Number(o.profit || 0) > 0 && Number(o.is_receive || 0) === 0;
  });
}

module.exports = {
  THREE_H_SEC,
  MAX_ORDER_SEC,
  formatCountdown,
  isThreeHourOrder,
  pickThreeHourOrders,
  pickLongOrders,
  pickClaimableOrders,
};
