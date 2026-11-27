import { CENTS, HttpError, baseView, balanceOf, getActive, openRound, parseBet, parseRid, settle, sha256, tickers } from '../core.js';

// Ranks 2..14 (J=11, Q=12, K=13, A=14), suits 0..3. Each card is drawn on its own from the seed, as if from a fresh deck.
export const STEP_PCT = 92, MAX_GUESSES = 10, MAX_SKIPS = 3;
export const WIN_CAP = 10000 * CENTS; // payout cap per round; reaching it cashes out on the spot
const LIMIT = Math.floor(2 ** 32 / 52) * 52;
export function card(seed, i) {
  for (let j = 0; ; j++) {
    const v = parseInt(sha256(`${seed}:${i}:${j}`).slice(0, 8), 16);
    if (v < LIMIT) { const c = v % 52; return { rank: 2 + (c % 13), suit: Math.floor(c / 13) }; }
  }
}

// How many of the 13 ranks win each pick. Equal counts as a win both ways; at an ace "higher" becomes "ace only"
// and "lower" becomes strictly lower (mirror at a two), so no pick ever pays under 1x.
export function options(rank) {
  const hi = rank === 14 ? { label: 'same', wins: r => r === 14, count: 1 }
    : rank === 2 ? { label: 'higher', wins: r => r > 2, count: 12 }
    : { label: 'higher_or_same', wins: r => r >= rank, count: 15 - rank };
  const lo = rank === 2 ? { label: 'same', wins: r => r === 2, count: 1 }
    : rank === 14 ? { label: 'lower', wins: r => r < 14, count: 12 }
    : { label: 'lower_or_same', wins: r => r <= rank, count: rank - 1 };
  return { hi, lo };
}
// multiplier after a correct pick: current × 0.92 × 13 / count, floored to 2dp. The 8% share is taken on every guess,
// so long runs get harder. A right guess always adds at least 0.01x (the 12-in-13 picks would otherwise pay under 1x).
export const nextX100 = (curX100, count) => Math.max(curX100 + 1, Math.floor((curX100 * STEP_PCT * 13) / (100 * count)));

// revealed = the action log: 1 = higher, 0 = lower, 2 = skip. Card k is shown after k actions.
const ACT = { hi: 1, lo: 0, skip: 2 };
const guessesOf = g => g.revealed.filter(a => a !== 2).length;

export function view(g) {
  const active = g.status === 'active', n = g.revealed.length;
  const cards = Array.from({ length: n + 1 }, (_, k) => card(g.seed, k)); // only cards already on the table
  const cur = cards[n], cur100 = g.mult_x100 || 100, o = options(cur.rank), guesses = guessesOf(g);
  const pick = p => ({ label: o[p].label, chance: o[p].count / 13, multiplier: nextX100(cur100, o[p].count) / 100 });
  return {
    ...baseView(g),
    cards,
    actions: g.revealed,
    guesses,
    correct: guesses - (g.status === 'busted' ? 1 : 0),
    skipsLeft: MAX_SKIPS - g.revealed.filter(a => a === 2).length,
    current: active ? cur100 / 100 : g.mult_x100 / 100,
    cashout: active && guesses ? (g.bet * cur100) / 100 / 100 : 0,
    ...(active && { hi: pick('hi'), lo: pick('lo') }),
  };
}

export const config = { maxGuesses: MAX_GUESSES, maxSkips: MAX_SKIPS, winCap: WIN_CAP / CENTS };

const STALE_MS = 24 * 3600 * 1000;
tickers.hilo = async (q, g) => {
  if (Date.now() - new Date(g.created_at) < STALE_MS) return false;
  await settle(q, g, { won: true, multX100: guessesOf(g) ? g.mult_x100 : 100 }); // keep the winnings, or refund an untouched round
  return true;
};

export function routes(api) {
  api.post('/hilo/bet', async (req, res) => {
    const bet = parseBet(req.body?.bet), rid = parseRid(req.body?.rid);
    const { g, balance } = await req.db.tx(q => openRound(q, req.uid, { game: 'hilo', bet, rid }));
    res.json({ game: view(g), balance: balance / 100 });
  });

  // pick: 'hi' | 'lo' | 'skip'; step = how many actions the client has seen (a retry of an old step is a no-op)
  api.post('/hilo/play', async (req, res) => {
    const pick = req.body?.pick, step = req.body?.step;
    if (!Object.hasOwn(ACT, pick)) throw new HttpError(400, 'Pick higher, lower or skip');
    res.json(await req.db.tx(async q => {
      const g = await getActive(q, req.uid, 'hilo');
      if (!g) throw new HttpError(409, 'No active round');
      if (Number.isInteger(step) && step < g.revealed.length) return { game: view(g) };
      const n = g.revealed.length, log = [...g.revealed, ACT[pick]];
      if (pick === 'skip') {
        if (g.revealed.filter(a => a === 2).length >= MAX_SKIPS) throw new HttpError(400, 'No skips left this round');
        const { rows: [done] } = await q(`UPDATE games SET revealed=$2 WHERE id=$1 RETURNING *`, [g.id, log]);
        return { game: view(done) };
      }
      const o = options(card(g.seed, n).rank)[pick], next = card(g.seed, n + 1);
      if (!o.wins(next.rank)) return { game: view(await settle(q, g, { won: false, revealed: log })), balance: await balanceOf(q, req.uid) };
      let mult = nextX100(g.mult_x100 || 100, o.count);
      const capped = (g.bet * mult) / 100 >= WIN_CAP;
      if (capped) mult = Math.floor((WIN_CAP * 100) / g.bet);
      let done;
      if (capped || guessesOf(g) + 1 >= MAX_GUESSES) done = await settle(q, g, { won: true, multX100: mult, revealed: log }); // auto cash-out
      else ({ rows: [done] } = await q(`UPDATE games SET revealed=$2, mult_x100=$3 WHERE id=$1 RETURNING *`, [g.id, log, mult]));
      return { game: view(done), balance: await balanceOf(q, req.uid) };
    }));
  });

  api.post('/hilo/cashout', async (req, res) => {
    res.json(await req.db.tx(async q => {
      const g = await getActive(q, req.uid, 'hilo');
      if (!g) throw new HttpError(409, 'No active round');
      if (!guessesOf(g)) throw new HttpError(400, 'Make at least one right guess first');
      const done = await settle(q, g, { won: true, multX100: g.mult_x100 });
      return { game: view(done), balance: await balanceOf(q, req.uid) };
    }));
  });
}
