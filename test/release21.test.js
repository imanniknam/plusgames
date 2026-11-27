// Release 2-1: Penalty, Higher or Lower, the daily streak, rescue coins, staged referrals and source tracking.
// Same harness as api.test.js: real HTTP, dev auth header, in-memory PGlite unless TEST_DATABASE_URL is set.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

process.env.ALLOW_DEV_AUTH = '1';
if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL; else delete process.env.DATABASE_URL;
process.env.BOT_TOKEN = '123:TEST';
process.env.WEBHOOK_SECRET = 'hook';
process.env.APP_URL = 'https://example.test/index.html';
process.env.ENABLED_GAMES = 'mines,penalty,hilo';
const { default: app, parseStart, rateOk } = await import('../server.js');
const penalty = await import('../lib/games/penalty.js');
const hilo = await import('../lib/games/hilo.js');
const { newSeed } = await import('../lib/core.js');
const dbq = async (sql, p) => (await (await import('../lib/db.js')).getDb()).query(sql, p);

let server, origin;
before(() => new Promise(r => { server = app.listen(0, () => { origin = `http://127.0.0.1:${server.address().port}`; r(); }); }));
after(async () => {
  server.close();
  if (process.env.DATABASE_URL) {
    await dbq('DELETE FROM referrals WHERE invitee < 0');
    await dbq('DELETE FROM ledger WHERE user_id < 0');
    await dbq('DELETE FROM games WHERE user_id < 0');
    await dbq('DELETE FROM users WHERE id < 0');
    process.exit(0);
  }
});

let uidSeq = -(Date.now() % 1e9) - 5e8; // negative and apart from api.test.js ids
const client = (uid = --uidSeq, start) => {
  const c = async (method, path, body) => {
    const headers = { 'content-type': 'application/json', 'x-dev-user': String(uid) };
    if (start) headers['x-dev-start'] = start;
    const r = await fetch(origin + '/api' + path, { method, headers, body: body && JSON.stringify(body) });
    return { status: r.status, ...(await r.json()) };
  };
  c.uid = uid;
  return c;
};
const balance = async c => (await c('GET', '/state')).user.balance;

// ---------- math ----------
test('penalty: ladder = floor(0.95 × 1.25^n), RTP <= 95% at every step', () => {
  assert.deepEqual(penalty.LADDER, [118, 148, 185, 231, 289]);
  penalty.LADDER.forEach((m, i) => {
    const ev = 0.8 ** (i + 1) * m / 100;
    assert.ok(ev <= 0.95 + 1e-12 && ev > 0.94, `n=${i + 1} ev=${ev}`);
  });
});

test('penalty: keeper dives are uniform over 5 corners and reproducible', () => {
  const counts = Array(5).fill(0);
  for (let i = 0; i < 20000; i++) counts[penalty.keeper(newSeed().seed, i % 5)]++;
  assert.ok(counts.every(c => c > 3700 && c < 4300), counts.join(','));
  const { seed } = newSeed();
  assert.deepEqual(penalty.keepersFromSeed(seed), penalty.keepersFromSeed(seed));
});

test('hilo: options never pay under 1x, and every pick returns 95%', () => {
  for (let r = 2; r <= 14; r++) {
    const o = hilo.options(r);
    for (const p of [o.hi, o.lo]) {
      const wins = [...Array(13).keys()].map(k => k + 2).filter(p.wins).length;
      assert.equal(wins, p.count, `rank ${r} ${p.label}`);
      const m = hilo.nextX100(100, p.count);
      assert.ok(m >= 100, `rank ${r} ${p.label} pays ${m}`);
      const ev = (p.count / 13) * m / 100;
      assert.ok(ev <= 0.95 + 1e-12 && ev > 0.93, `rank ${r} ${p.label} ev=${ev}`);
    }
  }
  assert.equal(hilo.nextX100(100, 8), 154); // a 7 showing, "higher or same": 0.95 × 13/8
});

test('hilo: simulated 100k rounds of one guess each return about 95%', () => {
  let bet = 0, back = 0;
  for (let i = 0; i < 100000; i++) {
    const { seed } = newSeed(), cur = hilo.card(seed, 0), next = hilo.card(seed, 1), o = hilo.options(cur.rank);
    const p = o.hi.count >= o.lo.count ? o.hi : o.lo; // a sensible player takes the likelier side
    bet += 1;
    if (p.wins(next.rank)) back += hilo.nextX100(100, p.count) / 100;
  }
  assert.ok(back / bet > 0.93 && back / bet < 0.97, `rtp=${back / bet}`);
});

test('penalty: simulated 100k one-shot rounds return about 95%', () => {
  let back = 0;
  for (let i = 0; i < 100000; i++) if (penalty.keeper(newSeed().seed, 0) !== i % 5) back += penalty.LADDER[0] / 100;
  assert.ok(back / 100000 > 0.93 && back / 100000 < 0.96, `rtp=${back / 100000}`);
});

test('start payload: ref_ and src_ parsed, anything else ignored', () => {
  assert.deepEqual(parseStart('ref_123'), { referrer: 123, source: 'ref' });
  assert.deepEqual(parseStart('src_Sport_TV'), { source: 'sport_tv' });
  for (const bad of [undefined, '', 'ref_', 'ref_abc', 'src_', 'src_a-b', 'src_' + 'x'.repeat(33), 'hello']) assert.deepEqual(parseStart(bad), {});
});

test('rate limit: a burst of 6, then 3 per second', () => {
  const t0 = 1e12, uid = 'rl-test';
  for (let i = 0; i < 6; i++) assert.equal(rateOk(uid, t0), true);
  assert.equal(rateOk(uid, t0), false);
  assert.equal(rateOk(uid, t0 + 340), true); // ~1 token back after a third of a second
});

// ---------- penalty over HTTP ----------
test('penalty: keepers hidden while live, retried shot is a no-op, cash out once', async () => {
  const c = client();
  let g = (await c('POST', '/penalty/bet', { bet: 100 })).game;
  assert.equal(g.seed, undefined); assert.deepEqual(g.keepers, []);
  assert.equal((await c('POST', '/penalty/cashout')).status, 400); // no goal yet
  for (let tries = 0; ; tries++) {
    // aim away from the keeper's first dive: only possible because the test can read the seed from the DB
    const { rows: [row] } = await dbq(`SELECT seed FROM games WHERE id=$1`, [g.id]);
    const zone = (penalty.keeper(row.seed, 0) + 1) % 5;
    g = (await c('POST', '/penalty/shoot', { zone, shot: 0 })).game;
    assert.equal(g.status, 'active'); assert.equal(g.goals, 1); assert.equal(g.cashout, 118);
    const again = (await c('POST', '/penalty/shoot', { zone, shot: 0 })).game; // retry of the same shot
    assert.equal(again.shots.length, 1);
    break;
  }
  const before = await balance(c);
  const rs = await Promise.all(Array.from({ length: 5 }, () => c('POST', '/penalty/cashout')));
  const ok = rs.filter(r => r.status === 200);
  assert.equal(ok.length, 1);
  assert.equal(ok[0].balance, before + 118);
  assert.deepEqual(ok[0].game.keepers, penalty.keepersFromSeed(ok[0].game.seed));
  assert.equal(createHash('sha256').update(ok[0].game.seed).digest('hex'), ok[0].game.seedHash);
});

test('penalty: shooting at the keeper loses; five goals auto-pay 2.89x', async () => {
  const c = client();
  let g = (await c('POST', '/penalty/bet', { bet: 10 })).game;
  let { rows: [row] } = await dbq(`SELECT seed FROM games WHERE id=$1`, [g.id]);
  g = (await c('POST', '/penalty/shoot', { zone: penalty.keeper(row.seed, 0), shot: 0 })).game;
  assert.equal(g.status, 'busted'); assert.equal(g.payout, 0);
  g = (await c('POST', '/penalty/bet', { bet: 10 })).game;
  ({ rows: [row] } = await dbq(`SELECT seed FROM games WHERE id=$1`, [g.id]));
  for (let i = 0; i < 5; i++) g = (await c('POST', '/penalty/shoot', { zone: (penalty.keeper(row.seed, i) + 2) % 5, shot: i })).game;
  assert.equal(g.status, 'cashed'); assert.equal(g.multiplier, 2.89); assert.equal(g.payout, 28.9);
  assert.equal(await balance(c), 1000 - 10 - 10 + 28.9);
});

test('penalty: a round abandoned for a day settles itself (refund if no goal)', async () => {
  const c = client();
  const g = (await c('POST', '/penalty/bet', { bet: 50 })).game;
  await dbq(`UPDATE games SET created_at = now() - interval '25 hours' WHERE id=$1`, [g.id]);
  const s = await c('GET', '/state');
  assert.equal(s.game, null);
  assert.equal(s.user.balance, 1000);
});

// ---------- higher or lower over HTTP ----------
test('hilo: right guesses multiply, wrong guess loses, skips limited, future card never sent', async () => {
  const c = client();
  let g = (await c('POST', '/hilo/bet', { bet: 100 })).game;
  assert.equal(g.cards.length, 1); assert.equal(g.seed, undefined);
  const { rows: [row] } = await dbq(`SELECT seed FROM games WHERE id=$1`, [g.id]);
  assert.equal((await c('POST', '/hilo/cashout')).status, 400);
  for (let i = 0; i < 3; i++) g = (await c('POST', '/hilo/play', { pick: 'skip', step: g.actions.length })).game;
  assert.equal(g.skipsLeft, 0); assert.equal(g.cards.length, 4);
  assert.equal((await c('POST', '/hilo/play', { pick: 'skip', step: g.actions.length })).status, 400);
  // play the side that wins against the known next card (test-only knowledge)
  const n = g.actions.length, next = hilo.card(row.seed, n + 1).rank, o = hilo.options(g.cards[n].rank);
  const pick = o.hi.wins(next) ? 'hi' : 'lo';
  const expect = hilo.nextX100(100, o[pick].count) / 100;
  g = (await c('POST', '/hilo/play', { pick, step: n })).game;
  assert.equal(g.status, 'active'); assert.equal(g.current, expect); assert.equal(g.cards.length, n + 2);
  const replay = (await c('POST', '/hilo/play', { pick, step: n })).game; // retried request
  assert.equal(replay.actions.length, n + 1);
  const cash = await c('POST', '/hilo/cashout');
  assert.equal(cash.game.status, 'cashed'); assert.equal(cash.game.payout, Math.round(expect * 100)); // 100-coin bet: payout in coins = multiplier × 100
  // a losing pick
  g = (await c('POST', '/hilo/bet', { bet: 10 })).game;
  const { rows: [r2] } = await dbq(`SELECT seed FROM games WHERE id=$1`, [g.id]);
  const nx = hilo.card(r2.seed, 1).rank, o2 = hilo.options(g.cards[0].rank);
  const lose = !o2.hi.wins(nx) ? 'hi' : !o2.lo.wins(nx) ? 'lo' : null;
  if (lose) {
    g = (await c('POST', '/hilo/play', { pick: lose, step: 0 })).game;
    assert.equal(g.status, 'busted'); assert.equal(g.cards.length, 2);
  } else await c('POST', '/hilo/play', { pick: 'hi', step: 0 }); // both sides win (equal ranks): nothing to test
});

test('hilo: payout capped at 10,000 coins and auto cashed', async () => {
  const c = client();
  const g = (await c('POST', '/hilo/bet', { bet: 100 })).game;
  await dbq(`UPDATE games SET mult_x100 = 9990 WHERE id=$1`, [g.id]); // pretend a long winning run
  const { rows: [row] } = await dbq(`SELECT seed FROM games WHERE id=$1`, [g.id]);
  const o = hilo.options(g.cards[0].rank), next = hilo.card(row.seed, 1).rank;
  const pick = o.hi.wins(next) ? 'hi' : 'lo';
  const r = await c('POST', '/hilo/play', { pick, step: 0 });
  assert.equal(r.game.status, 'cashed'); assert.equal(r.game.payout, 10000);
});

test('bad payloads on the new games are clean 4xx and never charged', async () => {
  const c = client();
  for (const [path, body] of [
    ['/penalty/bet', { bet: 5 }], ['/penalty/shoot', { zone: 0 }], ['/penalty/cashout', {}], ['/hilo/bet', { bet: '10' }],
    ['/hilo/play', { pick: 'hi' }], ['/hilo/play', { pick: 'up' }], ['/hilo/play', { pick: '__proto__' }], ['/hilo/cashout', {}],
  ]) {
    const r = await c('POST', path, body);
    assert.ok(r.status >= 400 && r.status < 500, `${path} ${JSON.stringify(body)} -> ${r.status}`);
  }
  await c('POST', '/penalty/bet', { bet: 10 });
  for (const zone of [-1, 5, 1.5, '1', null]) assert.equal((await c('POST', '/penalty/shoot', { zone })).status, 400);
  assert.equal(await balance(c), 990);
});

// ---------- economy ----------
test('daily streak: 100, 120, 150 … 500, then stays; a 48h gap restarts at day 1', async () => {
  const c = client();
  const got = [];
  for (let d = 0; d < 9; d++) {
    const r = await c('POST', '/bonus');
    assert.equal(r.status, 200, JSON.stringify(r));
    got.push(r.amount);
    assert.equal((await c('POST', '/bonus')).status, 429); // twice in a day
    await dbq(`UPDATE users SET last_bonus_at = last_bonus_at - interval '25 hours' WHERE id=$1`, [c.uid]);
  }
  assert.deepEqual(got, [100, 120, 150, 200, 250, 300, 500, 500, 500]);
  await dbq(`UPDATE users SET last_bonus_at = now() - interval '49 hours' WHERE id=$1`, [c.uid]);
  assert.equal((await c('GET', '/state')).user.bonusDay, 1);
  assert.equal((await c('POST', '/bonus')).amount, 100);
});

test('rescue: only when broke with no round in play, then every 6 hours', async () => {
  const c = client();
  assert.equal((await c('POST', '/rescue')).status, 429); // still has 1000
  await dbq(`UPDATE users SET balance = 500 WHERE id=$1`, [c.uid]); // 5 coins
  await dbq(`INSERT INTO ledger (user_id, kind, amount, balance_after) VALUES ($1,'bonus',-99500,500)`, [c.uid]); // keep the ledger whole
  assert.equal((await c('GET', '/state')).user.rescue.available, true);
  const rs = await Promise.all(Array.from({ length: 4 }, () => c('POST', '/rescue')));
  assert.equal(rs.filter(r => r.status === 200).length, 1);
  assert.equal(await balance(c), 205);
  await dbq(`UPDATE users SET balance = 500 WHERE id=$1`, [c.uid]);
  await dbq(`INSERT INTO ledger (user_id, kind, amount, balance_after) VALUES ($1,'bonus',-20000,500)`, [c.uid]);
  assert.equal((await c('POST', '/rescue')).status, 429); // too soon
  await dbq(`UPDATE users SET last_rescue_at = now() - interval '7 hours' WHERE id=$1`, [c.uid]);
  assert.equal((await c('POST', '/rescue')).status, 200);
});

// ---------- referrals and sources ----------
test('referral: welcome + signup reward at once, the big reward only after real play on 2 days', async () => {
  const inviter = client();
  await inviter('GET', '/state');
  const friend = client(undefined, `ref_${inviter.uid}`);
  assert.equal(await balance(friend), 1300);
  assert.equal(await balance(inviter), 1100);
  let list = await inviter('GET', '/referrals');
  assert.equal(list.items.length, 1); assert.equal(list.items[0].status, 'pending');
  for (let i = 0; i < 10; i++) {
    const g = (await friend('POST', '/hilo/bet', { bet: 10 })).game;
    await friend('POST', '/hilo/play', { pick: 'hi', step: 0 });
    if ((await friend('GET', '/state')).game) await friend('POST', '/hilo/cashout');
    if (i === 4) await dbq(`UPDATE games SET created_at = created_at - interval '2 days' WHERE user_id=$1`, [friend.uid]);
    assert.ok(g.id);
  }
  list = await inviter('GET', '/referrals');
  assert.equal(list.items[0].status, 'active');
  assert.equal(await balance(inviter), 1500);
});

test('referral: rounds on a single day do not activate; source is stored once', async () => {
  const inviter = client();
  await inviter('GET', '/state');
  const friend = client(undefined, `ref_${inviter.uid}`);
  for (let i = 0; i < 10; i++) {
    await friend('POST', '/penalty/bet', { bet: 10 });
    await friend('POST', '/penalty/shoot', { zone: 0, shot: 0 });
    if ((await friend('GET', '/state')).game) await friend('POST', '/penalty/cashout');
  }
  assert.equal((await inviter('GET', '/referrals')).items[0].status, 'pending');
  assert.equal(await balance(inviter), 1100);
  const ad = client(undefined, 'src_sport_tv');
  await ad('GET', '/state');
  const { rows: [u] } = await dbq('SELECT source, referred_by FROM users WHERE id=$1', [ad.uid]);
  assert.deepEqual([u.source, u.referred_by], ['sport_tv', null]);
});

test('ledger invariant after all of the above: balance == sum(ledger), never negative', async () => {
  const { rows } = await dbq(`SELECT u.id, u.balance, COALESCE(SUM(l.amount),0) AS total FROM users u LEFT JOIN ledger l ON l.user_id=u.id
    WHERE u.id < 0 GROUP BY u.id`);
  assert.ok(rows.length > 5);
  for (const u of rows) assert.equal(Number(u.balance), Number(u.total), `user ${u.id}`);
});

// ---------- levels ----------
test('levels: XP per round (not per coin), no XP for refunds, 600 XP a day at most', async () => {
  const { levelOf, levelFloor } = await import('../server.js');
  assert.deepEqual([levelFloor(1), levelFloor(2), levelFloor(5), levelFloor(10)], [0, 200, 3200, 16200]);
  assert.deepEqual(levelOf(199), { level: 1, xp: 199, from: 0, to: 200 });
  assert.equal(levelOf(3200).level, 5);
  const c = client();
  await c('POST', '/penalty/bet', { bet: 100 });
  await c('POST', '/penalty/shoot', { zone: 0, shot: 0 });
  if ((await c('GET', '/state')).game) await c('POST', '/penalty/cashout');
  let p = await c('GET', '/profile');
  assert.deepEqual([p.xp, p.level], [15, 1]); // 5 + 100/10
  // a refunded (abandoned, untouched) round gives nothing
  const g = (await c('POST', '/penalty/bet', { bet: 10 })).game;
  await dbq(`UPDATE games SET created_at = now() - interval '25 hours' WHERE id=$1`, [g.id]);
  await c('GET', '/state');
  assert.equal((await c('GET', '/profile')).xp, 15);
  // a heavy day is capped: pretend 80 rounds of 100 coins finished today
  for (let i = 0; i < 80; i++) await dbq(`INSERT INTO games (user_id, game, bet, status, seed, seed_hash, ended_at) VALUES ($1,'penalty',10000,'busted','s','h',now())`, [c.uid]);
  p = await c('GET', '/profile');
  assert.equal(p.xp, 600); assert.equal(p.level, 2);
});
