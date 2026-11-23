// Coin packs paid with Telegram Stars. Coins stay virtual: there is no way to turn them back into Stars or money.
// The webhook is the only thing that credits a purchase; the client's "paid" callback is never trusted.
import { CENTS, HttpError } from './core.js';

export const PACKS = [
  { id: 'p1', coins: 1000, stars: 50, bonus: 0 },
  { id: 'p2', coins: 5500, stars: 250, bonus: 10 },
  { id: 'p3', coins: 12000, stars: 500, bonus: 20, tag: 'Popular' },
  { id: 'p4', coins: 32500, stars: 1250, bonus: 30, tag: 'Best value' },
];
const packOf = id => PACKS.find(p => p.id === id);
const payloadOf = id => `pg:${id}`;
export const parsePayload = p => { const m = /^pg:(\d{1,15})$/.exec(p ?? ''); return m ? Number(m[1]) : null; };

export async function tgApi(token, method, body) {
  const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(6000),
  });
  const j = await r.json();
  if (!j.ok) throw new Error(`${method}: ${j.description ?? r.status}`);
  return j.result;
}

// An unpaid invoice from the last hour is reused, so tapping a pack repeatedly does not pile up rows.
export async function createInvoice(db, uid, packId, token) {
  const pack = typeof packId === 'string' ? packOf(packId) : null;
  if (!pack) throw new HttpError(400, 'Unknown coin pack');
  const { rows: [open] } = await db.query(
    `SELECT id, invoice_link FROM purchases WHERE user_id=$1 AND pack=$2 AND stars=$3 AND status='pending'
       AND invoice_link IS NOT NULL AND created_at > now() - interval '1 hour' ORDER BY id DESC LIMIT 1`, [uid, pack.id, pack.stars]);
  if (open) return { id: open.id, link: open.invoice_link };
  const { rows: [row] } = await db.query(
    `INSERT INTO purchases (user_id, pack, stars, coins) VALUES ($1,$2,$3,$4) RETURNING id`, [uid, pack.id, pack.stars, pack.coins * CENTS]);
  let link;
  try {
    link = await tgApi(token, 'createInvoiceLink', {
      title: `${pack.coins.toLocaleString('en-US')} coins`,
      description: 'Virtual coins for Plus Games. They cannot be withdrawn or exchanged for money.',
      payload: payloadOf(row.id), provider_token: '', currency: 'XTR',
      prices: [{ label: `${pack.coins.toLocaleString('en-US')} coins`, amount: pack.stars }],
    });
  } catch (e) {
    console.error('invoice', e);
    await db.query(`DELETE FROM purchases WHERE id=$1 AND status='pending'`, [row.id]);
    throw new HttpError(502, 'Payment is unavailable right now, try again');
  }
  await db.query('UPDATE purchases SET invoice_link=$2 WHERE id=$1', [row.id, link]);
  return { id: row.id, link };
}

// Telegram asks before charging: returns null to approve, or the message to show the buyer.
export async function checkPreCheckout(db, q) {
  const id = parsePayload(q.invoice_payload);
  const { rows: [row] } = id ? await db.query('SELECT * FROM purchases WHERE id=$1', [id]) : { rows: [] };
  if (!row || Number(row.user_id) !== q.from?.id) return 'This invoice is not valid. Open the shop and try again.';
  if (row.status !== 'pending') return 'This invoice was already paid.';
  if (q.currency !== 'XTR' || q.total_amount !== row.stars) return 'The price changed. Open the shop and try again.';
  return null;
}

// Safe to receive twice: the row lock and the charge id make a repeated webhook a no-op.
export async function settlePayment(db, msg) {
  const sp = msg.successful_payment, id = parsePayload(sp.invoice_payload);
  return db.tx(async q => {
    const { rows: [row] } = id ? await q('SELECT * FROM purchases WHERE id=$1 FOR UPDATE', [id]) : { rows: [] };
    if (row?.charge_id === sp.telegram_payment_charge_id) return false;
    if (!row || row.status !== 'pending' || Number(row.user_id) !== msg.from?.id || sp.currency !== 'XTR' || sp.total_amount !== row.stars) {
      console.error('payment needs review', { id, charge: sp.telegram_payment_charge_id });
      return false;
    }
    await q(`UPDATE purchases SET status='paid', charge_id=$2, paid_at=now() WHERE id=$1`, [id, sp.telegram_payment_charge_id]);
    const { rows: [u] } = await q('UPDATE users SET balance = balance + $2 WHERE id=$1 RETURNING balance', [row.user_id, row.coins]);
    await q(`INSERT INTO ledger (user_id, kind, amount, balance_after) VALUES ($1,'purchase',$2,$3)`, [row.user_id, row.coins, u.balance]);
    return true;
  });
}

// A refunded purchase takes its coins back, as many as are left (the balance never goes negative).
export async function refundPayment(db, msg) {
  const charge = msg.refunded_payment?.telegram_payment_charge_id;
  return db.tx(async q => {
    const { rows: [row] } = await q(`SELECT * FROM purchases WHERE charge_id=$1 AND status='paid' FOR UPDATE`, [charge]);
    if (!row) return false;
    const { rows: [u] } = await q('SELECT balance FROM users WHERE id=$1 FOR UPDATE', [row.user_id]);
    const take = Math.min(Number(u.balance), Number(row.coins));
    await q(`UPDATE purchases SET status='refunded', refunded_at=now(), coins_taken_back=$2 WHERE id=$1`, [row.id, take]);
    if (take > 0) {
      const { rows: [nu] } = await q('UPDATE users SET balance = balance - $2 WHERE id=$1 RETURNING balance', [row.user_id, take]);
      await q(`INSERT INTO ledger (user_id, kind, amount, balance_after) VALUES ($1,'refund',$2,$3)`, [row.user_id, -take, nu.balance]);
    }
    return true;
  });
}
