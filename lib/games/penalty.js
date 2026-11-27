import { HttpError, baseView, balanceOf, getActive, openRound, parseBet, parseRid, settle, sha256, tickers } from '../core.js';

// 5 corners, the keeper covers one per shot: P(goal) = 4/5. Multiplier after n goals = (0.92 × 5/4)^n, floored to 2dp:
// the house share grows with every goal (92% back after one goal, about 66% after five).
export const ZONES = 5, SHOTS = 5, STEP_PCT = 92;
export const multiplierX100 = n => Number((100n * (BigInt(STEP_PCT) * 5n) ** BigInt(n)) / (400n ** BigInt(n)));
export const LADDER = Array.from({ length: SHOTS }, (_, i) => multiplierX100(i + 1)); // 115, 132, 152, 174, 201

// Keeper's dive for shot i (0-based): uniform 0..4 from sha256(seed:i:j), rejecting the biased tail of 2^32.
const LIMIT = Math.floor(2 ** 32 / ZONES) * ZONES;
export function keeper(seed, i) {
  for (let j = 0; ; j++) {
    const v = parseInt(sha256(`${seed}:${i}:${j}`).slice(0, 8), 16);
    if (v < LIMIT) return v % ZONES;
  }
}
export const keepersFromSeed = seed => Array.from({ length: SHOTS }, (_, i) => keeper(seed, i));

export function view(g) {
  const active = g.status === 'active', shots = g.revealed;
  const goals = shots.length - (g.status === 'busted' ? 1 : 0);
  return {
    ...baseView(g),
    shots, // the corners the player kicked at
    goals,
    next: active && goals < SHOTS ? multiplierX100(goals + 1) / 100 : null,
    cashout: active && goals ? (g.bet * multiplierX100(goals)) / 100 / 100 : 0,
    // where the keeper dived: past shots only while the round is live, every shot once it is over
    keepers: active ? shots.map((_, i) => keeper(g.seed, i)) : keepersFromSeed(g.seed),
  };
}

export const config = { zones: ZONES, shots: SHOTS, ladder: LADDER.map(m => m / 100) };

// A round left open for a day settles itself: goals so far are cashed out, an untouched round is refunded.
const STALE_MS = 24 * 3600 * 1000;
tickers.penalty = async (q, g) => {
  if (Date.now() - new Date(g.created_at) < STALE_MS) return false;
  await settle(q, g, { won: true, multX100: g.revealed.length ? multiplierX100(g.revealed.length) : 100 });
  return true;
};

export function routes(api) {
  api.post('/penalty/bet', async (req, res) => {
    const bet = parseBet(req.body?.bet), rid = parseRid(req.body?.rid);
    const { g, balance } = await req.db.tx(q => openRound(q, req.uid, { game: 'penalty', bet, rid }));
    res.json({ game: view(g), balance: balance / 100 });
  });

  api.post('/penalty/shoot', async (req, res) => {
    const zone = req.body?.zone, shot = req.body?.shot;
    if (!Number.isInteger(zone) || zone < 0 || zone >= ZONES) throw new HttpError(400, 'Pick a corner');
    res.json(await req.db.tx(async q => {
      const g = await getActive(q, req.uid, 'penalty');
      if (!g) throw new HttpError(409, 'No active round');
      // the client says which shot this is: a retried request for a shot already taken changes nothing
      if (Number.isInteger(shot) && shot < g.revealed.length) return { game: view(g) };
      const i = g.revealed.length, shots = [...g.revealed, zone];
      let done;
      if (keeper(g.seed, i) === zone) done = await settle(q, g, { won: false, revealed: shots });
      else if (shots.length === SHOTS) done = await settle(q, g, { won: true, multX100: multiplierX100(SHOTS), revealed: shots }); // 5/5: auto cash-out
      else ({ rows: [done] } = await q(`UPDATE games SET revealed=$2, mult_x100=$3 WHERE id=$1 RETURNING *`, [g.id, shots, multiplierX100(shots.length)]));
      return { game: view(done), balance: await balanceOf(q, req.uid) };
    }));
  });

  api.post('/penalty/cashout', async (req, res) => {
    res.json(await req.db.tx(async q => {
      const g = await getActive(q, req.uid, 'penalty');
      if (!g) throw new HttpError(409, 'No active round');
      if (!g.revealed.length) throw new HttpError(400, 'Score at least one goal first');
      const done = await settle(q, g, { won: true, multX100: multiplierX100(g.revealed.length) });
      return { game: view(done), balance: await balanceOf(q, req.uid) };
    }));
  });
}
