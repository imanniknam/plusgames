// Telegram Stars coin packs, end to end over HTTP. Telegram itself is replaced by a fake at the fetch layer.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.ALLOW_DEV_AUTH = '1';
if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL; else delete process.env.DATABASE_URL;
process.env.BOT_TOKEN = '123:TEST';
process.env.WEBHOOK_SECRET = 'hook';
process.env.APP_URL = 'https://example.test/index.html';
const { default: app } = await import('../server.js');
const { PACKS } = await import('../lib/shop.js');
const dbq = async (sql, p) => (await (await import('../lib/db.js')).getDb()).query(sql, p);

const realFetch = globalThis.fetch, calls = [];
let invoiceFails = false;
globalThis.fetch = async (url, opts) => {
  if (!String(url).startsWith('https://api.telegram.org/')) return realFetch(url, opts);
  const method = String(url).split('/').pop(), body = JSON.parse(opts.body);
  calls.push({ method, body });
  if (method === 'createInvoiceLink' && invoiceFails) return Response.json({ ok: false, description: 'down' });
  return Response.json({ ok: true, result: method === 'createInvoiceLink' ? `https://t.me/$invoice${calls.length}` : true });
};

let server, origin;
before(() => new Promise(r => { server = app.listen(0, () => { origin = `http://127.0.0.1:${server.address().port}`; r(); }); }));
after(async () => {
  server.close();
  if (process.env.DATABASE_URL) {
    await dbq('DELETE FROM purchases WHERE user_id < 0');
    await dbq('DELETE FROM ledger WHERE user_id < 0');
    await dbq('DELETE FROM users WHERE id < 0');
    process.exit(0);
  }
});

let uidSeq = -(Date.now() % 1e9) - 7e8;
const client = (uid = --uidSeq) => {
  const c = async (method, path, body) => {
    const r = await realFetch(origin + '/api' + path, { method, headers: { 'content-type': 'application/json', 'x-dev-user': String(uid) }, body: body && JSON.stringify(body) });
    return { status: r.status, ...(await r.json()) };
  };
  c.uid = uid;
  return c;
};
const hook = body => realFetch(origin + '/bot', { method: 'POST', headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': 'hook' }, body: JSON.stringify(body) });
const balance = async c => (await c('GET', '/state')).user.balance;
const P3 = PACKS.find(p => p.id === 'p3');
const paid = (c, id, charge, over = {}) => hook({ message: { chat: { id: c.uid }, from: { id: c.uid }, successful_payment: {
  currency: 'XTR', total_amount: P3.stars, invoice_payload: `pg:${id}`, telegram_payment_charge_id: charge, ...over } } });
const pre = async (from, id, over = {}) => {
  calls.length = 0;
  await hook({ pre_checkout_query: { id: 'q1', from: { id: from }, currency: 'XTR', total_amount: P3.stars, invoice_payload: `pg:${id}`, ...over } });
  return calls.find(x => x.method === 'answerPreCheckoutQuery').body;
};

test('packs: bonus percentages match the coins for the Stars price', () => {
  for (const p of PACKS) assert.equal(p.coins, p.stars * 20 * (100 + p.bonus) / 100, p.id);
});

test('invoice: Stars currency, no provider token, reused while unpaid, bad pack refused', async () => {
  const c = client();
  calls.length = 0;
  const a = await c('POST', '/shop/invoice', { pack: 'p3' });
  assert.equal(a.status, 200);
  const sent = calls.find(x => x.method === 'createInvoiceLink').body;
  assert.equal(sent.currency, 'XTR'); assert.equal(sent.provider_token, '');
  assert.deepEqual(sent.prices.map(x => x.amount), [P3.stars]);
  assert.equal(sent.payload, `pg:${a.id}`);
  const b = await c('POST', '/shop/invoice', { pack: 'p3' });
  assert.deepEqual([b.id, b.link], [a.id, a.link]);
  for (const pack of ['nope', '__proto__', 3, null]) assert.equal((await c('POST', '/shop/invoice', { pack })).status, 400);
  assert.equal(await balance(c), 1000); // an invoice alone gives nothing
});

test('invoice: a Telegram failure is a clean 502 and leaves no row', async () => {
  const c = client();
  invoiceFails = true;
  assert.equal((await c('POST', '/shop/invoice', { pack: 'p1' })).status, 502);
  invoiceFails = false;
  const { rows } = await dbq('SELECT id FROM purchases WHERE user_id=$1', [c.uid]);
  assert.equal(rows.length, 0);
});

test('pre-checkout: approves the real invoice, refuses anything else', async () => {
  const c = client(), other = client();
  await other('GET', '/state');
  const { id } = await c('POST', '/shop/invoice', { pack: 'p3' });
  assert.equal((await pre(c.uid, id)).ok, true);
  assert.equal((await pre(other.uid, id)).ok, false);
  assert.equal((await pre(c.uid, id, { total_amount: 1 })).ok, false);
  assert.equal((await pre(c.uid, id, { currency: 'USD' })).ok, false);
  assert.equal((await pre(c.uid, 999999999)).ok, false);
  assert.equal((await pre(c.uid, id, { invoice_payload: 'junk' })).ok, false);
  await paid(c, id, 'charge-pre');
  assert.equal((await pre(c.uid, id)).ok, false); // already paid
});

test('payment: credits once, even with repeated and parallel webhooks', async () => {
  const c = client();
  const { id } = await c('POST', '/shop/invoice', { pack: 'p3' });
  const charge = `charge-${c.uid}`;
  const rs = await Promise.all(Array.from({ length: 5 }, () => paid(c, id, charge)));
  assert.ok(rs.every(r => r.status === 200));
  await paid(c, id, charge);
  assert.equal(await balance(c), 1000 + P3.coins);
  const p = await c('GET', `/shop/purchase/${id}`);
  assert.deepEqual([p.status, p.coins, p.balance], ['paid', P3.coins, 1000 + P3.coins]);
  assert.equal((await c('GET', '/wallet')).items.filter(i => i.kind === 'purchase').length, 1);
  assert.equal((await client()('GET', `/shop/purchase/${id}`)).status, 404); // someone else's purchase
});

test('payment: wrong amount, currency or payer never credits', async () => {
  const c = client(), other = client();
  await other('GET', '/state');
  const { id } = await c('POST', '/shop/invoice', { pack: 'p3' });
  await paid(c, id, `bad-1-${c.uid}`, { total_amount: 1 });
  await paid(c, id, `bad-2-${c.uid}`, { currency: 'USD' });
  await paid(other, id, `bad-3-${c.uid}`);
  assert.equal(await balance(c), 1000); assert.equal(await balance(other), 1000);
});

test('refund: takes the coins back once and never goes below zero', async () => {
  const c = client();
  const { id } = await c('POST', '/shop/invoice', { pack: 'p3' });
  const charge = `refund-${c.uid}`;
  await paid(c, id, charge);
  const refund = () => hook({ message: { chat: { id: c.uid }, from: { id: c.uid }, refunded_payment: { currency: 'XTR', total_amount: P3.stars, invoice_payload: `pg:${id}`, telegram_payment_charge_id: charge } } });
  await refund(); await refund();
  assert.equal(await balance(c), 1000);
  assert.equal((await c('GET', `/shop/purchase/${id}`)).status, 'refunded');

  const d = client();
  const b = await d('POST', '/shop/invoice', { pack: 'p3' });
  const ch2 = `refund-${d.uid}`;
  await paid(d, b.id, ch2);
  await dbq('UPDATE users SET balance = 50000 WHERE id=$1', [d.uid]); // spent most of it
  await dbq(`INSERT INTO ledger (user_id, kind, amount, balance_after) VALUES ($1,'bonus',$2,50000)`, [d.uid, 50000 - (1000 + P3.coins) * 100]);
  await hook({ message: { chat: { id: d.uid }, from: { id: d.uid }, refunded_payment: { currency: 'XTR', total_amount: P3.stars, invoice_payload: `pg:${b.id}`, telegram_payment_charge_id: ch2 } } });
  assert.equal(await balance(d), 0);
});

test('bot: /start asks the language once, the pick is saved and shared with the app', async () => {
  const c = client(), say = text => { calls.length = 0; return hook({ message: { text, chat: { id: c.uid }, from: { id: c.uid, first_name: 'L' } } }); };
  const sent = () => calls.filter(x => x.method === 'sendMessage').map(x => x.body);
  await say('/start');
  assert.deepEqual(sent()[0].reply_markup.keyboard, [[{ text: 'فارسی' }, { text: 'English' }]]);
  assert.equal((await c('GET', '/state')).user.lang, null);
  await say('فارسی');
  assert.ok(sent()[0].reply_markup.remove_keyboard);
  assert.match(sent()[1].text, /پلاس گیمز/);
  assert.ok(sent()[1].reply_markup.inline_keyboard.flat().some(b => b.text.includes('پنالتی')));
  assert.equal((await c('GET', '/state')).user.lang, 'fa');
  await say('/start'); // already chose: straight to the games, in Persian
  assert.equal(sent().length, 1); assert.match(sent()[0].text, /پلاس گیمز/);
  await say('/terms'); assert.match(sent()[0].text, /سکه/);
  await say('/language'); assert.ok(sent()[0].reply_markup.keyboard);
  assert.equal((await c('POST', '/lang', { lang: 'en' })).lang, 'en');
  await say('/start'); assert.match(sent()[0].text, /Plus Games/);
  assert.equal((await c('POST', '/lang', { lang: 'de' })).status, 400);
});

test('webhook secret still guards payment updates', async () => {
  const r = await realFetch(origin + '/bot', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message: { successful_payment: {} } }) });
  assert.equal(r.status, 401);
});

test('ledger invariant holds through purchases and refunds', async () => {
  const { rows } = await dbq(`SELECT u.id, u.balance, COALESCE(SUM(l.amount),0) AS total FROM users u LEFT JOIN ledger l ON l.user_id=u.id WHERE u.id < 0 GROUP BY u.id`);
  assert.ok(rows.length > 5);
  for (const u of rows) { assert.equal(Number(u.balance), Number(u.total), `user ${u.id}`); assert.ok(Number(u.balance) >= 0); }
});
