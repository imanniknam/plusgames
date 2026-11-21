import { COIN, S, api, bindFair, fmt, haptic, makeAct, rid, setBalance } from '../core.js';
import * as fx from '../fx.js';
import { I } from '../icons.js';

const RN = ['', '', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
// spade, heart, diamond, club in a 100×96 box
const SUIT = [
  'M50 4C40 22 8 38 8 58c0 14 11 22 23 22 8 0 14-4 17-9-1 8-5 15-12 21h28c-7-6-11-13-12-21 3 5 9 9 17 9 12 0 23-8 23-22C92 38 60 22 50 4z',
  'M50 88C20 62 5 47 5 29 5 15 16 6 28 6c10 0 18 6 22 15 4-9 12-15 22-15 12 0 23 9 23 23 0 18-15 33-45 59z',
  'M50 2l40 45-40 45-40-45z',
  'M50 8a18 18 0 0118 18 18 18 0 01-6 13 18 18 0 0111-4 18 18 0 0118 18 18 18 0 01-18 18 18 18 0 01-17-11c1 13 5 22 12 28H32c7-6 11-15 12-28a18 18 0 01-17 11A18 18 0 019 53a18 18 0 0118-18 18 18 0 0111 4 18 18 0 01-6-13A18 18 0 0150 8z',
];
const LABEL = { higher_or_same: 'Higher or same', lower_or_same: 'Lower or same', higher: 'Higher', lower: 'Lower', same: 'Same' };

function cardSvg({ rank, suit }) {
  const col = suit === 1 || suit === 2 ? '#c0163f' : '#14141c', R = RN[rank];
  const s = (x, y, k) => `<path d="${SUIT[suit]}" fill="${col}" transform="translate(${x} ${y}) scale(${k})"/>`;
  const face = rank >= 11 && rank <= 13
    ? `<rect x="46" y="74" width="108" height="132" rx="10" fill="#f6efe0" stroke="#a855f7" stroke-width="2"/><path d="M72 122l-6-30 20 14 14-22 14 22 20-14-6 30z" fill="#a855f7"/><text x="100" y="186" text-anchor="middle" font-size="58" font-weight="800" fill="${col}">${R}</text>`
    : rank === 14 ? `<circle cx="100" cy="140" r="58" fill="none" stroke="#a855f7" stroke-width="2.5"/>${s(62, 104, 0.76)}` : s(56, 98, 0.88);
  return `<svg viewBox="0 0 200 280" aria-label="${R}"><rect x="1" y="1" width="198" height="278" rx="16" fill="#fbfaf6" stroke="#cbd5e1"/>
    <rect x="9" y="9" width="182" height="262" rx="11" fill="none" stroke="#a855f7" stroke-opacity=".35"/>
    <text x="18" y="50" font-size="40" font-weight="700" fill="${col}">${R}</text>${s(17, 58, 0.26)}
    <g transform="rotate(180 100 140)"><text x="18" y="50" font-size="40" font-weight="700" fill="${col}">${R}</text>${s(17, 58, 0.26)}</g>${face}</svg>`;
}
const BACK = `<svg viewBox="0 0 200 280" aria-hidden="true"><defs><linearGradient id="hlBack" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#4c1d95"/><stop offset="1" stop-color="#0e7490"/></linearGradient>
  <pattern id="hlLat" width="16" height="16" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><path d="M0 8h16M8 0v16" stroke="#fff" stroke-opacity=".14" stroke-width="1.2"/></pattern></defs>
  <rect x="1" y="1" width="198" height="278" rx="16" fill="url(#hlBack)" stroke="#22d3ee" stroke-opacity=".6"/><rect x="12" y="12" width="176" height="256" rx="10" fill="url(#hlLat)" stroke="#22d3ee" stroke-opacity=".5"/>
  <text x="100" y="152" text-anchor="middle" font-size="44" font-style="italic" font-weight="700" fill="#e0f2fe">P+</text></svg>`;

export default function mount(root, { initial, refresh, resync }) {
  const cfg = S.config.games.hilo, bets = S.config.bets;
  let g = initial, sheet = null, play = null;
  const act = makeAct(render, async () => { g = await resync(); });
  if (g?.status === 'active') S.bet = g.bet;
  const x2 = n => `${n.toFixed(2)}x`, pct = p => `${Math.round(p * 100)}%`;

  function panel(active) {
    if (g && !active) return g.won
      ? `<div class="mx won">${I.gauge}<div><small>You won</small><span class="mx-now">+${fmt(g.net)}</span></div><div class="mx-next"><small>Right guesses</small><b>${g.correct}</b></div></div>`
      : `<div class="mx lost">${I.close}<div><small>Wrong guess</small><span class="mx-now">−${fmt(g.bet)}</span></div><div class="mx-next"><small>Right guesses</small><b>${g.correct}</b></div></div>`;
    return `<div class="mx">${I.gauge}<div><small>Current multiplier</small><span class="mx-now">${x2(active ? g.current : 1)}</span></div>
      <div class="mx-next"><small>Guesses</small><b>${active ? g.guesses : 0}/${cfg.maxGuesses}</b></div></div>`;
  }

  function sheetHtml() {
    if (sheet === 'help') return `
      <div class="bsheet-back" data-close><section class="bsheet" role="dialog" aria-modal="true" aria-labelledby="sheetT">
        <header><h3 id="sheetT">${I.help}How to play</h3><button type="button" class="x" data-close aria-label="Close">${I.close}</button></header>
        <ol class="rules">
          <li>Choose your bet: ${bets.join(', ')} coins, and press Deal. A card is turned face up.</li>
          <li>Guess whether the next card is <b>higher or same</b>, or <b>lower or same</b>. A same rank wins either way.</li>
          <li>2 is the lowest card and Ace the highest; suits do not matter. On an Ace you pick "Same" or "Lower"; on a 2, "Same" or "Higher".</li>
          <li>Each button shows its chance and the multiplier you reach if right. Every right guess multiplies; a wrong one loses the bet.</li>
          <li>Every card is drawn from a fresh deck, so counting cards does not help. You may skip a card ${cfg.maxSkips} times per round.</li>
          <li>Cash out after any right guess. The round ends by itself after ${cfg.maxGuesses} right guesses or a ${fmt(cfg.winCap)}-coin win.</li>
        </ol>
        <p class="note">Coins are virtual and have no cash value.</p>
      </section></div>`;
    if (sheet === 'fair') {
      const over = g && g.status !== 'active';
      return `
      <div class="bsheet-back" data-close><section class="bsheet" role="dialog" aria-modal="true" aria-labelledby="sheetT">
        <header><h3 id="sheetT">${I.shield}Provably fair</h3><button type="button" class="x" data-close aria-label="Close">${I.close}</button></header>
        <p>Every card of the round is fixed by a secret seed <b>before</b> the first card is shown. You see its SHA-256 fingerprint now; the seed is revealed when the round ends, so you can check no card changed.</p>
        <p class="mono"><small>Hash</small>${g?.seedHash ?? 'Deal to get a round hash'}</p>
        ${over ? `<p class="mono"><small>Seed</small>${g.seed}</p><button type="button" class="ghost-btn wide" data-verify>${I.shield}Verify last round</button><p class="verify-out" data-verify-out aria-live="polite"></p>` : ''}
      </section></div>`;
    }
    return '';
  }

  function render() {
    const active = g?.status === 'active';
    const cur = g ? g.cards.at(-1) : null, trail = g ? g.cards.slice(0, -1).slice(-7) : [];
    const i = bets.indexOf(S.bet), betLocked = active || act.busy;
    const cta = active && g.guesses ? [`${I.cash}Cash out <small>${fmt(g.cashout)}</small>`, 'cash', act.busy]
      : active ? ['Make your guess', 'wait', true]
      : S.user.balance < S.bet ? ['Not enough coins', '', true]
      : [`${I.play}${g ? 'Deal again' : 'Deal'}`, '', act.busy];
    const btn = (p, arrow) => {
      const o = active ? g[p] : null;
      return `<button type="button" class="hl-pick ${p}" data-pick="${p}" ${!active || act.busy ? 'disabled' : ''}>
        <span class="hl-arrow">${arrow}</span><b>${o ? LABEL[o.label] : p === 'hi' ? 'Higher' : 'Lower'}</b>
        <span class="hl-mult">${o ? x2(o.multiplier) : '—'}</span><small>${o ? `${pct(o.chance)} chance` : '&nbsp;'}</small></button>`;
    };
    root.innerHTML = `
      <div class="hlboard">
        <div class="hl-trail" aria-label="Cards played">${trail.map(c => `<span class="hl-mini">${cardSvg(c)}</span>`).join('')}</div>
        <div class="hl-table">
          <div class="hl-deck" aria-hidden="true">${BACK}${BACK}${BACK}</div>
          <div class="hl-card ${g?.status === 'busted' ? 'bad' : ''}" aria-live="polite">${cur ? cardSvg(cur) : BACK}</div>
        </div>
        <div class="hl-picks">${btn('hi', '▲')}${btn('lo', '▼')}</div>
        <button type="button" class="hl-skip" data-pick="skip" ${!active || act.busy || !g.skipsLeft ? 'disabled' : ''}>Skip card${active ? ` · ${g.skipsLeft} left` : ''}</button>
      </div>
      <div class="console">
        <div class="ctl-row">
          <div class="ctl-box bet"><span class="lbl">${I.stack}<span>Bet</span></span>
            <button type="button" class="step-btn" data-step="-1" aria-label="Lower bet" ${betLocked || i <= 0 ? 'disabled' : ''}>${I.minus}</button>
            <output aria-live="polite" aria-label="Bet amount">${S.bet}</output>
            <button type="button" class="step-btn" data-step="1" aria-label="Raise bet" ${betLocked || i >= bets.length - 1 ? 'disabled' : ''}>${I.plus}</button></div>
          <div class="ctl-box mines" aria-label="Cards 2 to Ace"><b>2–A</b><small>Ace high</small></div>
        </div>
        <div aria-live="polite">${panel(active)}</div>
        <div class="act-row">
          <button type="button" class="icon-btn" data-help-open aria-label="How to play">${I.help}</button>
          <button type="button" class="play ${cta[1]} ${act.busy ? 'busy' : ''}" data-cta ${cta[2] ? 'disabled' : ''}>${cta[0]}</button>
          <button type="button" class="icon-btn" data-fair aria-label="Provably fair">${I.shield}</button>
        </div>
      </div>
      ${sheetHtml()}`;
    if (play && !act.busy) { const p = play; play = null; p(); }
  }

  const $ = s => root.querySelector(s);
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  // the new card slides off the deck and flips over (Web Animations: runs without GSAP too)
  const deal = () => { const c = $('.hl-card'); if (c && !still) c.animate([{ transform: 'translateX(-90px) rotateY(90deg) scale(.7)', opacity: 0.4 }, { transform: 'none', opacity: 1 }], { duration: 420, easing: 'cubic-bezier(.3,.7,.3,1)' }); };
  const pop = (el, from = 0.6) => fx.on && el && fx.gsap.from(el, { scale: from, duration: 0.55, ease: 'elastic.out(1, 0.45)', clearProps: 'scale' });

  const after = r => {
    g = r.game;
    if (r.balance != null) setBalance(r.balance, g.status === 'cashed' && fx.on ? 0.75 : 0);
    if (g.status === 'active') S.bet = g.bet; else refresh();
  };
  function pick(p) {
    if (act.busy || g?.status !== 'active') return;
    haptic('impactOccurred', 'light');
    act.run(async () => {
      after(await api('/hilo/play', { pick: p, step: g.actions.length }));
      play = () => {
        deal();
        if (g.status === 'busted') { if (fx.on) { fx.flash(); fx.shake($('.hlboard'), 10); } pop($('.mx-now'), 0.4); haptic('notificationOccurred', 'error'); }
        else if (g.status === 'cashed') { if (fx.on) { fx.coinsTo($('.hl-card'), document.querySelector('.wallet'), 20); fx.banner('TOP WIN!', `${x2(g.multiplier)} · +${fmt(g.net)}`); } }
        else if (p !== 'skip') { pop($('.mx-now'), 0.6); pop($('.play.cash'), 0.94); haptic('impactOccurred', 'heavy'); }
      };
    });
  }
  const openSheet = name => { sheet = name; haptic('selectionChanged'); render(); root.querySelector('.bsheet .x')?.focus(); };
  const closeSheet = () => { sheet = null; render(); };

  root.addEventListener('click', e => {
    const t = e.target;
    if (sheet) {
      if (t.closest('[data-verify]')) return;
      if (t.closest('[data-close]') && (t.closest('.x') || !t.closest('.bsheet'))) closeSheet();
      return;
    }
    const pk = t.closest('[data-pick]');
    if (pk && !pk.disabled) return pick(pk.dataset.pick);
    const step = t.closest('[data-step]');
    if (step && !step.disabled) { S.bet = bets[Math.max(0, Math.min(bets.length - 1, bets.indexOf(S.bet) + Number(step.dataset.step)))]; haptic('selectionChanged'); return render(); }
    if (t.closest('[data-fair]')) return openSheet('fair');
    if (t.closest('[data-help-open]')) return openSheet('help');
    if (t.closest('[data-cta]')) act.run(async () => {
      if (g?.status === 'active') {
        after(await api('/hilo/cashout', {})); haptic('notificationOccurred', 'success');
        play = () => { if (fx.on) fx.coinsTo($('[data-cta]'), document.querySelector('.wallet'), 16); pop($('.mx-now'), 0.4); };
      } else {
        after(await api('/hilo/bet', { bet: S.bet, rid: rid() })); haptic('impactOccurred', 'medium');
        play = deal;
      }
    });
  });
  const onHelp = () => openSheet('help');
  const onKey = e => { if (e.key === 'Escape' && sheet) closeSheet(); };
  addEventListener('game-help', onHelp);
  addEventListener('keydown', onKey);
  bindFair(root, () => g);
  render();
  return { destroy() { removeEventListener('game-help', onHelp); removeEventListener('keydown', onKey); } };
}
