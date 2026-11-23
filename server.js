import express from 'express';
import { getDb } from './lib/db.js';
import { verifyInitData } from './lib/telegram.js';
import { BETS, CENTS, HttpError, afterSettle, getActive, settle, tickers } from './lib/core.js';
import * as mines from './lib/games/mines.js';
import * as crash from './lib/games/crash.js';
import * as roulette from './lib/games/roulette.js';
import * as poop from './lib/games/poop.js';
import * as penalty from './lib/games/penalty.js';
import * as hilo from './lib/games/hilo.js';
import { PACKS, checkPreCheckout, createInvoice, refundPayment, settlePayment, tgApi } from './lib/shop.js';

const ALL = { mines, penalty, hilo, crash, roulette, poop };
// Release 2-1 offers Mines, Penalty and Higher or Lower. The rest stay in the code, switched off: ENABLED_GAMES lists what is on.
const ENABLED = (process.env.ENABLED_GAMES || 'mines,penalty,hilo').split(',').filter(id => Object.hasOwn(ALL, id));
const GAMES = Object.fromEntries(ENABLED.map(id => [id, ALL[id]]));

// A round a player left open in a switched-off game would block Mines ("finish your round first") with no screen to finish it.
// Close it on first touch instead: cash out at its current value (crash: the live multiplier), or refund the bet if nothing was won yet.
for (const id of Object.keys(ALL).filter(id => !GAMES[id])) {
  const own = tickers[id];
  tickers[id] = async (q, g) => (await own?.(q, g)) || settle(q, g, {
    won: true, multX100: id === 'crash' ? crash.multAt(Date.now() - g.data.startsAt) : g.mult_x100 || 100,
  });
}
const { BOT_TOKEN, WEBHOOK_SECRET, APP_URL, BOT_USERNAME } = process.env;
const DEV_AUTH = process.env.ALLOW_DEV_AUTH === '1' && !process.env.VERCEL; // never on the deployed app
const START_BALANCE = 1000 * CENTS;
// Daily bonus climbs over a 7-day streak and stays at the top step; missing 48h restarts it at day 1.
const DAILY_STEPS = [100, 120, 150, 200, 250, 300, 500].map(c => c * CENTS);
const BONUS_EVERY_MS = 24 * 3600 * 1000;
// Rescue: a player who ran out (under 10 coins, no round in play) gets 200 coins, at most every 6 hours.
const RESCUE = 200 * CENTS, RESCUE_BELOW = 10 * CENTS, RESCUE_EVERY_MS = 6 * 3600 * 1000;
// Referrals are staged so throwaway accounts earn little: the friend gets a welcome gift, the inviter a small
// signup reward, and the larger part only once the friend has really played (10 rounds on 2+ days within 14 days).
const REF = { welcome: 300 * CENTS, signup: 100 * CENTS, active: 400 * CENTS, rounds: 10, days: 2, windowDays: 14, monthlyCap: 20 };

const view = g => g && ALL[g.game].view(g);

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '10kb' }));
app.use(express.static('public')); // on Vercel public/ is served by the CDN instead

const credit = async (q, uid, kind, amount) => {
  const { rows: [u] } = await q('UPDATE users SET balance = balance + $2 WHERE id=$1 RETURNING balance', [uid, amount]);
  await q(`INSERT INTO ledger (user_id, kind, amount, balance_after) VALUES ($1,$2,$3,$4)`, [uid, kind, amount, u.balance]);
  return u.balance;
};

// Launch payload from a bot /start or a mini-app link: ref_<telegram id> = invited by, src_<code> = marketing source.
export function parseStart(p) {
  if (typeof p !== 'string') return {};
  const ref = /^ref_(-?\d{1,15})$/.exec(p)?.[1], src = /^src_([a-z0-9_]{1,32})$/i.exec(p)?.[1];
  return ref ? { referrer: Number(ref), source: 'ref' } : src ? { source: src.toLowerCase() } : {};
}

// First visit creates the wallet with the 1,000-coin grant (same transaction as its ledger row).
// The source and the inviter are fixed on that first contact and never change afterwards.
async function ensureUser(q, tg, { referrer = null, source = null } = {}) {
  const { rows: [r] } = await q(
    `INSERT INTO users (id, username, first_name, balance, referred_by, source)
     VALUES ($1,$2,$3,$4,(SELECT id FROM users WHERE id=$5 AND id<>$1),$6)
     ON CONFLICT (id) DO UPDATE SET username = EXCLUDED.username, first_name = EXCLUDED.first_name
     RETURNING (xmax = 0) AS inserted, referred_by`,
    [tg.id, tg.username ?? null, (tg.first_name ?? '').slice(0, 64), START_BALANCE, referrer, source]);
  if (!r.inserted) return;
  await q(`INSERT INTO ledger (user_id, kind, amount, balance_after) VALUES ($1,'signup',$2,$2)`, [tg.id, START_BALANCE]);
  if (!r.referred_by) return; // only brand-new users count as an invite
  await credit(q, tg.id, 'welcome', REF.welcome);
  const { rows: [{ n }] } = await q(
    `SELECT COUNT(*)::int AS n FROM referrals WHERE inviter=$1 AND signup_paid AND created_at > now() - interval '30 days'`, [r.referred_by]);
  const pay = n < REF.monthlyCap; // over the monthly cap the invite is still recorded, just not rewarded
  await q(`INSERT INTO referrals (invitee, inviter, signup_paid) VALUES ($1,$2,$3)`, [tg.id, r.referred_by, pay]);
  if (pay) await credit(q, r.referred_by, 'referral', REF.signup);
}

// After each finished round of an invited player: pay the inviter once the friend has really played.
afterSettle.push(async (q, g) => {
  const { rows: [ref] } = await q(`SELECT * FROM referrals WHERE invitee=$1 AND status='pending' FOR UPDATE`, [g.user_id]);
  if (!ref) return;
  if (Date.now() - new Date(ref.created_at) > REF.windowDays * 864e5) {
    await q(`UPDATE referrals SET status='expired' WHERE invitee=$1`, [g.user_id]);
    return;
  }
  const { rows: [s] } = await q(
    `SELECT COUNT(*)::int AS rounds, COUNT(DISTINCT (created_at AT TIME ZONE 'Asia/Tehran')::date)::int AS days
     FROM games WHERE user_id=$1 AND status <> 'active'`, [g.user_id]);
  if (s.rounds < REF.rounds || s.days < REF.days) return;
  await q(`UPDATE referrals SET status='active', activated_at=now() WHERE invitee=$1`, [g.user_id]);
  if (ref.signup_paid) await credit(q, ref.inviter, 'referral', REF.active); // invites over the cap stay unpaid
});

// Users whose row already exists: a warm instance skips the upsert, saving one DB transaction on every tap.
const known = new Set();

// Per-instance token bucket for state-changing calls: bursts of 6, refilling 3 per second. Stops scripted clicking;
// the real guarantees (one round, exact balances) live in the database.
const buckets = new Map();
export function rateOk(uid, now = Date.now()) {
  const b = buckets.get(uid) ?? { t: 6, at: now };
  b.t = Math.min(6, b.t + ((now - b.at) / 1000) * 3); b.at = now;
  if (buckets.size > 50000) buckets.clear();
  buckets.set(uid, b);
  if (b.t < 1) return false;
  b.t -= 1; return true;
}

// ---------- auth: every /api call carries Telegram initData; the server verifies its HMAC ----------
async function auth(req, _res, next) {
  try {
    const raw = (req.get('authorization') || '').replace(/^tma /, '');
    const signed = verifyInitData(raw, BOT_TOKEN);
    let tg = signed?.user, start = parseStart(signed?.startParam);
    if (!tg && DEV_AUTH && req.get('x-dev-user')) {
      tg = { id: Number(req.get('x-dev-user')), first_name: 'Dev' };
      start = parseStart(req.get('x-dev-start'));
    }
    if (!tg || !Number.isSafeInteger(tg.id)) throw new HttpError(401, 'Open the game from Telegram');
    if (signed && req.method === 'POST' && !rateOk(tg.id)) throw new HttpError(429, 'Slow down a little'); // dev auth (local tests) is not limited
    const db = await getDb();
    if (!known.has(tg.id)) {
      await db.tx(q => ensureUser(q, tg, start));
      if (known.size > 50000) known.clear();
      known.add(tg.id);
    }
    req.uid = tg.id; req.db = db;
    next();
  } catch (e) { next(e); }
}

const api = express.Router();
api.use(auth);

api.get('/state', async (req, res) => {
  res.json(await req.db.tx(async q => {
    const g = await getActive(q, req.uid); // also settles a crash round that ended while the app was closed
    const { rows: [u] } = await q(
      `SELECT id, first_name, balance, last_bonus_at, bonus_streak, last_rescue_at,
         (SELECT COUNT(*) FROM users r WHERE r.referred_by = u.id) AS invited
       FROM users u WHERE id=$1`, [req.uid]);
    return {
      user: { id: u.id, name: u.first_name, balance: u.balance / CENTS, invited: Number(u.invited), ...bonusState(u),
        rescue: rescueState(u, !!g) },
      game: view(g) ?? null,
      serverNow: Date.now(),
      config: {
        bets: BETS, bot: BOT_USERNAME ?? null, shop: PACKS, dailySteps: DAILY_STEPS.map(c => c / CENTS), rescue: RESCUE / CENTS,
        referral: { welcome: REF.welcome / CENTS, signup: REF.signup / CENTS, active: REF.active / CENTS, rounds: REF.rounds, days: REF.days, windowDays: REF.windowDays },
        games: Object.fromEntries(Object.entries(GAMES).map(([id, m]) => [id, m.config])),
      },
    };
  }));
});

for (const m of Object.values(GAMES)) m.routes(api);

// streak: the day the next claim would be (1..7), its amount, and when it can be claimed
function bonusState(u, now = Date.now()) {
  const last = u.last_bonus_at ? new Date(u.last_bonus_at).getTime() : 0;
  const kept = last && now - last <= 2 * BONUS_EVERY_MS;
  const day = kept ? Math.min(u.bonus_streak + 1, DAILY_STEPS.length) : 1;
  return { bonusAt: last ? last + BONUS_EVERY_MS : 0, bonusDay: day, bonusNext: DAILY_STEPS[day - 1] / CENTS };
}
function rescueState(u, inRound, now = Date.now()) {
  const at = u.last_rescue_at ? new Date(u.last_rescue_at).getTime() + RESCUE_EVERY_MS : 0;
  return { available: !inRound && u.balance < RESCUE_BELOW && at <= now, at };
}

api.post('/bonus', async (req, res) => {
  res.json(await req.db.tx(async q => {
    const { rows: [u] } = await q('SELECT * FROM users WHERE id=$1 FOR UPDATE', [req.uid]);
    const st = bonusState(u);
    if (st.bonusAt > Date.now()) throw new HttpError(429, 'Daily bonus already claimed');
    await q('UPDATE users SET last_bonus_at = now(), bonus_streak = $2 WHERE id=$1', [req.uid, st.bonusDay]);
    const balance = await credit(q, req.uid, 'bonus', DAILY_STEPS[st.bonusDay - 1]);
    return { balance: balance / CENTS, amount: st.bonusNext, ...bonusState({ last_bonus_at: new Date(), bonus_streak: st.bonusDay }) };
  }));
});

api.post('/rescue', async (req, res) => {
  res.json(await req.db.tx(async q => {
    const { rows: [u] } = await q('SELECT * FROM users WHERE id=$1 FOR UPDATE', [req.uid]);
    const active = await getActive(q, req.uid);
    const st = rescueState(u, !!active);
    if (!st.available) throw new HttpError(429, active ? 'Finish your round first' : u.balance >= RESCUE_BELOW ? 'You still have coins to play' : 'Rescue coins are not ready yet');
    await q('UPDATE users SET last_rescue_at = now() WHERE id=$1', [req.uid]);
    const balance = await credit(q, req.uid, 'rescue', RESCUE);
    return { balance: balance / CENTS, rescue: rescueState({ balance, last_rescue_at: new Date() }, false) };
  }));
});

// Coin shop: the client opens this Stars invoice; only the bot webhook credits the coins
api.post('/shop/invoice', async (req, res) => {
  res.json(await createInvoice(req.db, req.uid, req.body?.pack, BOT_TOKEN));
});
api.get('/shop/purchase/:id', async (req, res) => {
  if (!/^\d{1,15}$/.test(req.params.id)) throw new HttpError(400, 'Bad purchase id');
  const { rows: [p] } = await req.db.query(
    `SELECT p.status, p.coins, u.balance FROM purchases p JOIN users u ON u.id = p.user_id WHERE p.id=$1 AND p.user_id=$2`, [Number(req.params.id), req.uid]);
  if (!p) throw new HttpError(404, 'Purchase not found');
  res.json({ status: p.status, coins: p.coins / CENTS, balance: p.balance / CENTS });
});

// Invites tab: who joined through my link and where each reward stands
api.get('/referrals', async (req, res) => {
  const { rows } = await req.db.query(
    `SELECT r.status, r.signup_paid, r.created_at, u.first_name,
       (SELECT COUNT(*)::int FROM games g WHERE g.user_id = r.invitee AND g.status <> 'active') AS rounds
     FROM referrals r JOIN users u ON u.id = r.invitee WHERE r.inviter=$1 ORDER BY r.created_at DESC LIMIT 50`, [req.uid]);
  res.json({ items: rows.map(r => ({ name: r.first_name || 'Player', status: r.status, rewarded: r.signup_paid, rounds: Math.min(r.rounds, REF.rounds), at: r.created_at })) });
});

api.get('/history', async (req, res) => {
  const game = req.query.game || undefined;
  if (game !== undefined && !(typeof game === 'string' && Object.hasOwn(GAMES, game))) throw new HttpError(400, 'Unknown game');
  const { rows } = await req.db.query(
    `SELECT * FROM games WHERE user_id=$1 AND status <> 'active' AND ($2::text IS NULL OR game = $2) AND game = ANY($3)
     ORDER BY id DESC LIMIT 10`, [req.uid, game ?? null, ENABLED]);
  res.json({ games: rows.map(view) });
});

// Wallet tab: the user's own ledger, newest first
api.get('/wallet', async (req, res) => {
  const { rows } = await req.db.query(
    `SELECT l.id, l.kind, l.amount, l.balance_after, l.created_at, g.game
     FROM ledger l LEFT JOIN games g ON g.id = l.game_id WHERE l.user_id=$1 ORDER BY l.id DESC LIMIT 20`, [req.uid]);
  res.json({ items: rows.map(r => ({ id: r.id, kind: r.kind, game: r.game, amount: r.amount / CENTS, balance: r.balance_after / CENTS, at: r.created_at })) });
});

// Profile tab: stats derived from real rounds (XP = coins wagered)
api.get('/profile', async (req, res) => {
  const { rows: [s] } = await req.db.query(
    `SELECT COUNT(*) AS rounds, COUNT(*) FILTER (WHERE status='cashed') AS wins,
       COALESCE(SUM(payout - bet), 0) AS net, COALESCE(SUM(bet), 0) AS wagered,
       COALESCE(MAX(mult_x100) FILTER (WHERE status='cashed'), 0) AS best
     FROM games WHERE user_id=$1 AND status <> 'active' AND game = ANY($2)`, [req.uid, ENABLED]);
  res.json({ rounds: Number(s.rounds), wins: Number(s.wins), net: Number(s.net) / CENTS, xp: Number(s.wagered) / CENTS, best: Number(s.best) / 100 });
});

// This week's profit (weeks start Saturday 00:00 Tehran time); ties go to whoever got there first.
api.get('/leaderboard', async (req, res) => {
  const { rows } = await req.db.query(
    `SELECT u.id, u.first_name AS name, SUM(g.payout - g.bet) AS profit, COUNT(*) AS games, MAX(g.ended_at) AS last
     FROM games g JOIN users u ON u.id = g.user_id
     WHERE g.status <> 'active' AND g.game = ANY($1)
       AND g.ended_at >= (date_trunc('week', (now() AT TIME ZONE 'Asia/Tehran') + interval '2 days') - interval '2 days') AT TIME ZONE 'Asia/Tehran'
     GROUP BY u.id ORDER BY profit DESC, last ASC LIMIT 10`, [ENABLED]);
  res.json({ top: rows.map(r => ({ name: r.name || 'Player', profit: Number(r.profit) / CENTS, games: Number(r.games), me: Number(r.id) === req.uid })) });
});

app.use('/api', api);
app.get('/', (_req, res) => res.redirect('/index.html')); // on Vercel the function owns "/", static files live on the CDN
app.get('/config', (_req, res) => res.json({ bot: BOT_USERNAME || null }));

// ---------- bot webhook ----------
const tgSend = body => fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(4000),
}).catch(e => console.error('sendMessage failed', e));

const BOT_BUTTONS = { mines: '💣 Mines', penalty: '⚽ Penalty', hilo: '🃏 Higher or Lower', crash: '🚀 Crash', roulette: '🎡 Roulette', poop: '💩 Poop' };
const appLink = game => `${APP_URL}${game ? `${APP_URL.includes('?') ? '&' : '?'}game=${game}` : ''}`;

app.post('/bot', async (req, res) => {
  if (!WEBHOOK_SECRET || req.get('x-telegram-bot-api-secret-token') !== WEBHOOK_SECRET) return res.sendStatus(401);
  // Stars: Telegram waits at most 10 seconds for this answer before it cancels the payment
  const pre = req.body?.pre_checkout_query;
  if (pre) {
    const error = await getDb().then(db => checkPreCheckout(db, pre)).catch(e => { console.error('pre-checkout', e); return 'Please try again in a moment.'; });
    await tgApi(BOT_TOKEN, 'answerPreCheckoutQuery', { pre_checkout_query_id: pre.id, ok: !error, ...(error && { error_message: error }) });
    return res.sendStatus(200);
  }
  const msg = req.body?.message;
  // money has moved: a database error must answer 500 so Telegram delivers this update again
  if (msg?.successful_payment) {
    if (await settlePayment(await getDb(), msg)) await tgSend({ chat_id: msg.chat.id, text: 'Payment received. Your coins are in your wallet.' });
    return res.sendStatus(200);
  }
  if (msg?.refunded_payment) { await refundPayment(await getDb(), msg); return res.sendStatus(200); }
  if (msg?.text === '/terms') {
    await tgSend({ chat_id: msg.chat.id, text: 'Coin packs are digital goods paid with Telegram Stars and delivered to your wallet right away. Coins are only for playing inside Plus Games and cannot be withdrawn, sold or exchanged for money. If a purchase is refunded, its coins are removed from your wallet.' });
    return res.sendStatus(200);
  }
  if (msg?.text === '/paysupport') {
    await tgSend({ chat_id: msg.chat.id, text: process.env.PAY_SUPPORT ? `Payment problem? Contact ${process.env.PAY_SUPPORT} with the receipt from your Telegram payment.` : 'Payment support is not available yet. Please keep the receipt from your Telegram payment.' });
    return res.sendStatus(200);
  }
  if (msg?.text?.startsWith('/start') && APP_URL && msg.from) {
    // /start ref_<id>: Telegram is the trusted source of who invited whom (webhook is secret-checked)
    const start = parseStart(msg.text.trim().split(/\s+/)[1]);
    if (start.source) await getDb().then(db => db.tx(q => ensureUser(q, msg.from, start))).catch(e => console.error('start', e));
    const buttons = ENABLED.map(id => ({ text: BOT_BUTTONS[id], web_app: { url: appLink(id) } }));
    await tgSend({
      chat_id: msg.chat.id,
      text: ENABLED.join() === 'mines'
        ? `💣 Mines — open safe tiles, dodge the bombs, cash out any time.\n\nYou start with 1,000 free coins.`
        : `🎮 Plus Games — ${ENABLED.length} quick games, one wallet.\n\nYou start with 1,000 free coins. Pick a game:`,
      reply_markup: { inline_keyboard: [
        ...Array.from({ length: Math.ceil(buttons.length / 2) }, (_, i) => buttons.slice(i * 2, i * 2 + 2)),
        ...(ENABLED.length > 1 ? [[{ text: '🏠 Open lobby', web_app: { url: appLink() } }]] : []),
      ] },
    });
  }
  res.sendStatus(200);
});

app.use((err, _req, res, _next) => {
  if (err.status) return res.status(err.status).json({ error: err.message, ...err.extra });
  if (err.code === '23505') return res.status(409).json({ error: 'Finish your current round first' }); // unique index backstop
  console.error(err);
  res.status(500).json({ error: 'Server error, try again' });
});

if (!process.env.VERCEL && process.argv[1]?.endsWith('server.js')) {
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log(`http://localhost:${port}`));
}

export default app;
