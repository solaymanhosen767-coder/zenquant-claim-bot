// Unit tests for lib/orders.js — run: node test/orders.test.js
const {
  formatCountdown,
  isThreeHourOrder,
  pickThreeHourOrders,
  pickLongOrders,
  pickClaimableOrders,
  MAX_ORDER_SEC,
} = require('../lib/orders');

let pass = 0, fail = 0;
function t(name, cond) {
  if (cond) { pass++; console.log('PASS - ' + name); }
  else { fail++; console.log('FAIL - ' + name); }
}

// ---- Abdul Ahad's real scenario (reconstructed from live API + bot /info) ----
// long 360-day Auto order created 2026-09-21, ends 2027-09-16
const LONG_360 = { ordersn: 'LONG360AAAAAA', deal_type: 0, status: 1, receive_times: 26642403, price: 117, is_receive: 0, profit: 0 };
// the $10 3h order the bot created
const MY_3H    = { ordersn: 'MY3HBBBBBBBBB', deal_type: 1, status: 1, receive_times: 2553, price: 10, is_receive: 0, profit: 0.006 };
// an already matured 3h order with unclaimed profit
const MATURED  = { ordersn: 'MATUREDCCCCCC', deal_type: 1, status: 3, receive_times: -100, price: 13, is_receive: 0, profit: 0.05 };

console.log('\n== 360-day order hijack (Abdul Ahad bug) ==');
const oldPick = [MY_3H, LONG_360].sort((a, b) => Number(b.receive_times) - Number(a.receive_times))[0];
t('OLD code picked the 360-day order (bug reproduced)', oldPick.ordersn === LONG_360.ordersn);
t('OLD countdown would be ' + formatCountdown(26642403), formatCountdown(26642403) === '7400h 40m 3s');
t('360-day order is NOT a 3h order', isThreeHourOrder(LONG_360) === false);
t('3h order IS a 3h order', isThreeHourOrder(MY_3H) === true);
t('matured order is not "active"', isThreeHourOrder(MATURED) === false);

const picked = pickThreeHourOrders([LONG_360, MY_3H, MATURED]);
t('only our 3h order is tracked', picked.length === 1 && picked[0].ordersn === MY_3H.ordersn);
t('tracked countdown is the real 3h one (~42m)', formatCountdown(picked[0].receive_times) === '42m 33s');
t('long order surfaced separately', pickLongOrders([LONG_360, MY_3H]).length === 1);
t('claimable order detected', pickClaimableOrders([MATURED]).length === 1);
t('active 3h order is not "claimable"', pickClaimableOrders([MY_3H]).length === 0);

console.log('\n== edge cases ==');
t('no deal_type -> falls back to the 4h cap', isThreeHourOrder({ receive_times: 5000 }) === true);
t('no deal_type but 10-day left -> rejected', isThreeHourOrder({ receive_times: 864000 }) === false);
t('deal_type as string "1" accepted', isThreeHourOrder({ deal_type: '1', receive_times: 500 }) === true);
t('deal_type 2 (PLUS) rejected', isThreeHourOrder({ deal_type: 2, receive_times: 500 }) === false);
t('receive_times 0 rejected', isThreeHourOrder({ deal_type: 1, receive_times: 0 }) === false);
t('exactly 10800s (3h) accepted', isThreeHourOrder({ deal_type: 1, receive_times: 10800 }) === true);
t('14401s rejected (just over cap)', isThreeHourOrder({ deal_type: 1, receive_times: MAX_ORDER_SEC + 1 }) === false);
t('null input safe', isThreeHourOrder(null) === false);
t('empty list safe', pickThreeHourOrders([]).length === 0);

console.log('\n== countdown format ==');
t('0s', formatCountdown(0) === '0s');
t('45s', formatCountdown(45) === '45s');
t('2h 5m 3s', formatCountdown(7503) === '2h 5m 3s');
t('7400h 40m 3s', formatCountdown(26642403) === '7400h 40m 3s');

console.log('\n' + (fail ? fail + ' TEST(S) FAILED' : 'ALL ' + pass + ' TESTS PASSED'));
process.exit(fail ? 1 : 0);
