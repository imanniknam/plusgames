import { COIN, S, api, bindFair, fmt, haptic, makeAct, rid, setBalance } from '../core.js';
import * as fx from '../fx.js';
import { I } from '../icons.js';

// corner centres inside the goal mouth, in % of its box: top-left, top-right, middle, bottom-left, bottom-right
const Z = [[14, 26], [86, 26], [50, 44], [14, 72], [86, 72]];
const ZNAME = ['top left', 'top right', 'middle', 'bottom left', 'bottom right'];

const BALL = `<svg viewBox="0 0 48 48" aria-hidden="true"><defs>
  <radialGradient id="psBall" cx=".36" cy=".3" r=".78"><stop offset="0" stop-color="#fff"/><stop offset=".55" stop-color="#eef1f7"/><stop offset="1" stop-color="#9aa3b8"/></radialGradient>
  <radialGradient id="psBallHi" cx=".32" cy=".26" r=".3"><stop offset="0" stop-color="#fff" stop-opacity=".95"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs>
  <circle cx="24" cy="24" r="22.5" fill="url(#psBall)" stroke="#6b7280" stroke-width=".8"/>
  <path d="M24 14.5l8.6 6.2-3.3 10.1H18.7l-3.3-10.1z" fill="#151827"/>
  <path d="M24 14.5V5M32.6 20.7l8.8-3M29.3 30.8l5.4 7.6M18.7 30.8l-5.4 7.6M15.4 20.7l-8.8-3" stroke="#151827" stroke-width="1.8"/>
  <path d="M6.6 17.7l3.6-7.4 7.2-4M41.4 17.7l-3.6-7.4-7.2-4M13.3 38.4l8.3 3.9h4.8l8.3-3.9" fill="none" stroke="#151827" stroke-width="1.8"/>
  <path d="M8.4 12.6l-2.2 6 2 5.2 4-2.6zM39.6 12.6l2.2 6-2 5.2-4-2.6zM20.6 43.6l3.4-2.8 3.4 2.8" fill="#151827"/>
  <circle cx="24" cy="24" r="22.5" fill="url(#psBallHi)"/></svg>`;

const KEEPER = `<svg viewBox="0 0 80 110" aria-hidden="true"><defs>
  <linearGradient id="psKit" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#c084fc"/><stop offset=".55" stop-color="#7c3aed"/><stop offset="1" stop-color="#4c1d95"/></linearGradient>
  <linearGradient id="psGlove" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#a5f3fc"/><stop offset="1" stop-color="#0891b2"/></linearGradient>
  <linearGradient id="psSkin" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#f1c9a5"/><stop offset="1" stop-color="#d39b74"/></linearGradient></defs>
  <g class="ps-arms"><path d="M24 40C16 34 11 24 9 13M56 40c8-6 13-16 15-27" fill="none" stroke="url(#psKit)" stroke-width="9" stroke-linecap="round"/>
    <path d="M9 13l-1-4M71 13l1-4" stroke="#22d3ee" stroke-width="9" stroke-linecap="round" opacity=".35"/>
    <rect x="1" y="1" width="15" height="15" rx="6" fill="url(#psGlove)" stroke="#e0fbff" stroke-width="1.2"/>
    <rect x="64" y="1" width="15" height="15" rx="6" fill="url(#psGlove)" stroke="#e0fbff" stroke-width="1.2"/></g>
  <circle cx="40" cy="20" r="10" fill="url(#psSkin)"/><path d="M30 18c1-9 19-10 20 0-5-3-15-3-20 0z" fill="#1f130b"/>
  <path d="M36 23.5q4 2.5 8 0" stroke="#7c4a2d" stroke-width="1.3" fill="none" stroke-linecap="round"/><circle cx="36" cy="19.5" r="1.2" fill="#1f130b"/><circle cx="44" cy="19.5" r="1.2" fill="#1f130b"/>
  <path d="M22 37q18-9 36 0l-3 31H25z" fill="url(#psKit)" stroke="#22d3ee" stroke-width="1.4" stroke-linejoin="round"/>
  <path d="M27 44h26" stroke="#22d3ee" stroke-width="2.4" opacity=".85"/>
  <text x="40" y="62" text-anchor="middle" font-size="15" font-weight="800" fill="#ecfeff" font-family="system-ui, sans-serif">1</text>
  <path d="M25 67h30l-2 14H27z" fill="#0f172a"/>
  <path d="M30 80l-2 20M50 80l2 20" stroke="#e5e7eb" stroke-width="8" stroke-linecap="round"/>
  <path d="M30 88h-5M50 88h5" stroke="#22d3ee" stroke-width="2"/>
  <path d="M21 104h12M47 104h12" stroke="#0b1020" stroke-width="7" stroke-linecap="round"/></svg>`;

// a goal with depth: posts in front, back frame and side nets behind
const GOAL = `<svg class="ps-goal" viewBox="0 0 340 170" preserveAspectRatio="none" aria-hidden="true"><defs>
  <linearGradient id="psPost" x1="0" x2="1"><stop offset="0" stop-color="#c9d1e0"/><stop offset=".45" stop-color="#fff"/><stop offset="1" stop-color="#aeb8cb"/></linearGradient>
  <linearGradient id="psBar" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#b6c0d2"/></linearGradient>
  <pattern id="psNet" width="10" height="10" patternUnits="userSpaceOnUse"><path d="M0 5L5 0 10 5 5 10z" fill="none" stroke="#e0f2fe" stroke-opacity=".34" stroke-width=".9"/></pattern>
  <linearGradient id="psDepth" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#020617" stop-opacity=".55"/><stop offset="1" stop-color="#020617" stop-opacity=".15"/></linearGradient></defs>
  <g class="ps-net">
    <rect x="40" y="26" width="260" height="144" fill="url(#psDepth)"/>
    <path d="M10 8L40 26V170H10zM330 8L300 26V170h30zM10 8L40 26H300L330 8z" fill="url(#psNet)"/>
    <rect x="40" y="26" width="260" height="144" fill="url(#psNet)"/>
    <path d="M40 26H300M40 26V170M300 26V170M10 8L40 26M330 8L300 26" stroke="#e0f2fe" stroke-opacity=".45" stroke-width="1.2" fill="none"/></g>
  <path d="M7 170V7h326v163" fill="none" stroke="#000" stroke-opacity=".35" stroke-width="12" transform="translate(3 4)"/>
  <rect x="2" y="2" width="10" height="170" rx="3" fill="url(#psPost)"/><rect x="328" y="2" width="10" height="170" rx="3" fill="url(#psPost)"/>
  <rect x="2" y="2" width="336" height="10" rx="3" fill="url(#psBar)"/></svg>`;

// box lines drawn in perspective under the goal: 6-yard box, penalty area, the arc and the spot
const LINES = `<svg class="ps-lines" viewBox="0 0 200 100" preserveAspectRatio="none" aria-hidden="true">
  <g fill="none" stroke="#fff" stroke-opacity=".55" stroke-width=".9" vector-effect="non-scaling-stroke">
    <path d="M-40 0H240"/><path d="M62 0L56 16H144L138 0"/><path d="M28 0L8 56H192L172 0"/><path d="M76 56Q100 72 124 56"/></g>
  <ellipse cx="100" cy="40" rx="2.6" ry="1.1" fill="#fff" fill-opacity=".8"/></svg>`;

export default function mount(root, { initial, refresh, resync }) {
  const cfg = S.config.games.penalty, bets = S.config.bets, N = cfg.shots;
  let g = initial, sheet = null, play = null, aim = null;
  const act = makeAct(render, async () => { g = await resync(); });
  if (g?.status === 'active') S.bet = g.bet;
  const x2 = n => `${n.toFixed(2)}x`;

  function panel(active) {
    if (g && !active) return g.won
      ? `<div class="mx won">${I.gauge}<div><small>You won</small><span class="mx-now">+${fmt(g.net)}</span></div><div class="mx-next"><small>Goals</small><b>${g.goals}/${N}</b></div></div>`
      : `<div class="mx lost">${I.shield}<div><small>Saved</small><span class="mx-now">−${fmt(g.bet)}</span></div><div class="mx-next"><small>Goals</small><b>${g.goals}/${N}</b></div></div>`;
    const k = active ? g.goals : 0;
    return `<div class="mx">${I.gauge}<div><small>Current multiplier</small><span class="mx-now">${x2(k ? g.multiplier : 1)}</span></div>
      <div class="mx-next"><small>Next goal</small><b>${x2(active ? g.next : cfg.ladder[0])}</b></div></div>`;
  }

  // shootout scoreboard: one slot per shot with its multiplier
  function scoreboard() {
    const shots = g?.shots ?? [], active = g?.status === 'active';
    return `<div class="ps-score" aria-label="${g?.goals ?? 0} goals of ${N}">${cfg.ladder.map((m, s) => {
      const taken = s < shots.length, saved = taken && g.keepers[s] === shots[s];
      const st = saved ? 'saved' : taken ? 'goal' : active && s === shots.length ? 'next' : '';
      return `<span class="ps-slot ${st}"><i>${saved ? I.close : taken ? '✓' : s + 1}</i><b>${x2(m)}</b></span>`;
    }).join('')}</div>`;
  }

  function sheetHtml() {
    if (sheet === 'help') return `
      <div class="bsheet-back" data-close><section class="bsheet" role="dialog" aria-modal="true" aria-labelledby="sheetT">
        <header><h3 id="sheetT">${I.help}How to play</h3><button type="button" class="x" data-close aria-label="Close">${I.close}</button></header>
        <ol class="rules">
          <li>Choose your bet: ${bets.join(', ')} coins, and press Play.</li>
          <li>Tap one of the ${cfg.zones} glowing corners to shoot. Each goal raises the multiplier.</li>
          <li>The keeper dives to one corner per shot. Shoot where he goes and the bet is lost.</li>
          <li>Where you aim does not change your chances: every shot scores 4 times in 5.</li>
          <li>Cash out after any goal. Five goals pay the top prize automatically.</li>
        </ol>
        <table class="ladder-t"><thead><tr><th>Goals</th><th>Multiplier</th><th>Pays (${S.bet}${COIN})</th></tr></thead>
          <tbody>${cfg.ladder.map((m, i) => `<tr class="${g?.status === 'active' && i === g.goals ? 'next' : ''}"><td>${i + 1}</td><td>${x2(m)}</td><td>${fmt(Math.round(S.bet * m * 100) / 100)}</td></tr>`).join('')}</tbody></table>
        <p class="note">Coins are virtual and have no cash value.</p>
      </section></div>`;
    if (sheet === 'fair') {
      const over = g && g.status !== 'active';
      return `
      <div class="bsheet-back" data-close><section class="bsheet" role="dialog" aria-modal="true" aria-labelledby="sheetT">
        <header><h3 id="sheetT">${I.shield}Provably fair</h3><button type="button" class="x" data-close aria-label="Close">${I.close}</button></header>
        <p>The keeper's five dives are fixed by a secret seed <b>before</b> your first shot. You see its SHA-256 fingerprint now; the seed is revealed when the round ends, so you can check nothing changed.</p>
        <p class="mono"><small>Hash</small>${g?.seedHash ?? 'Place a bet to get a round hash'}</p>
        ${over ? `<p class="mono"><small>Seed</small>${g.seed}</p><button type="button" class="ghost-btn wide" data-verify>${I.shield}Verify last round</button><p class="verify-out" data-verify-out aria-live="polite"></p>` : ''}
      </section></div>`;
    }
    return '';
  }

  function render() {
    const active = g?.status === 'active', k = active ? g.goals : 0;
    const i = bets.indexOf(S.bet), betLocked = active || act.busy;
    const cta = active && k ? [`${I.cash}Cash out <small>${fmt(g.cashout)}</small>`, 'cash', act.busy]
      : active ? ['Tap a corner', 'wait', true]
      : S.user.balance < S.bet ? ['Not enough coins', '', true]
      : [`${I.play}${g ? 'Play again' : 'Play'}`, '', act.busy];
    // after the round: where each shot went (green = goal, red = saved)
    const marks = g && !active ? g.shots.map((z, s) => `<i class="ps-mark ${g.keepers[s] === z ? 'saved' : 'goal'}" style="left:${Z[z][0]}%;top:${Z[z][1]}%"></i>`).join('') : '';
    // after a save the keeper stays where he dived (his box is 26% of the goal wide, centred 67% down it)
    let keeperPose = '';
    if (g?.status === 'busted') {
      const [zx, zy] = Z[g.keepers[g.shots.length - 1]];
      keeperPose = `style="transform:translate(${((zx - 50) / 26) * 80}%, ${Math.min(0, ((zy - 67) / 71.5) * 100)}%) rotate(${zx < 40 ? -78 : zx > 60 ? 78 : 0}deg)"`;
    }
    root.innerHTML = `
      <div class="pkboard ps ${active ? 'live' : ''} ${g && !active ? (g.won ? 'won' : 'lost') : ''}">
        <canvas class="ps-crowd" aria-hidden="true"></canvas>
        <span class="ps-flood l" aria-hidden="true"></span><span class="ps-flood r" aria-hidden="true"></span>
        <div class="ps-led" aria-hidden="true"><span>PLUS GAMES · PENALTY · PLUS GAMES · PENALTY · PLUS GAMES · PENALTY · </span></div>
        <div class="ps-grass" aria-hidden="true"></div>
        ${scoreboard()}
        <div class="ps-goalbox">${GOAL}${LINES}
          ${Z.map(([x, y], z) => `<button type="button" class="ps-zone ${aim === z ? 'aim' : ''}" data-zone="${z}" style="left:${x}%;top:${y}%" aria-label="Shoot ${ZNAME[z]}" ${!active || act.busy ? 'disabled' : ''}><i></i></button>`).join('')}
          ${marks}<div class="ps-keeper" ${keeperPose}>${KEEPER}</div></div>
        <div class="ps-shadow" aria-hidden="true"></div><div class="ps-ball">${BALL}</div>
        <div class="ps-word" aria-hidden="true"></div>
      </div>
      <div class="console">
        <div class="ctl-row">
          <div class="ctl-box bet"><span class="lbl">${I.stack}<span>Bet</span></span>
            <button type="button" class="step-btn" data-step="-1" aria-label="Lower bet" ${betLocked || i <= 0 ? 'disabled' : ''}>${I.minus}</button>
            <output aria-live="polite" aria-label="Bet amount">${S.bet}</output>
            <button type="button" class="step-btn" data-step="1" aria-label="Raise bet" ${betLocked || i >= bets.length - 1 ? 'disabled' : ''}>${I.plus}</button></div>
          <div class="ctl-box mines" aria-label="Goal chance 80 percent per shot"><b>80%</b><small>per shot</small></div>
        </div>
        <div aria-live="polite">${panel(active)}</div>
        <div class="act-row">
          <button type="button" class="icon-btn" data-random aria-label="Shoot a random corner" ${!active || act.busy ? 'disabled' : ''}>${I.dice}</button>
          <button type="button" class="play ${cta[1]} ${act.busy ? 'busy' : ''}" data-cta ${cta[2] ? 'disabled' : ''}>${cta[0]}</button>
          <button type="button" class="icon-btn" data-fair aria-label="Provably fair">${I.shield}</button>
        </div>
      </div>
      ${sheetHtml()}`;
    crowd();
    if (play && !act.busy) { const p = play; play = null; p(); }
  }

  // ---------- the crowd: drawn once per size into a canvas (cheap; no per-frame work) ----------
  let crowdImg = null, crowdKey = '';
  function crowd() {
    const cv = root.querySelector('.ps-crowd');
    if (!cv) return;
    const w = cv.clientWidth, h = cv.clientHeight, d = Math.min(2, devicePixelRatio || 1), key = `${w}x${h}`;
    cv.width = w * d; cv.height = h * d;
    const x = cv.getContext('2d');
    if (crowdImg && crowdKey === key) { x.putImageData(crowdImg, 0, 0); return; }
    x.scale(d, d);
    const cols = ['#a855f7', '#22d3ee', '#ec4899', '#e2e8f0', '#facc15', '#64748b', '#38bdf8'];
    for (let row = 0; row < 9; row++) for (let i = 0; i < w / 6 + 2; i++) {
      const cx = i * 6 + (row % 2) * 3 + Math.random() * 1.5, cy = 6 + row * (h / 9.5) + Math.random() * 2;
      x.globalAlpha = 0.18 + Math.random() * 0.32 - row * 0.012;
      x.fillStyle = cols[(Math.random() * cols.length) | 0];
      x.beginPath(); x.arc(cx, cy, 2.2, 0, 7); x.fill(); // head
      x.fillRect(cx - 2.4, cy + 2, 4.8, 3.2); // shoulders
    }
    x.globalAlpha = 1;
    crowdImg = x.getImageData(0, 0, cv.width, cv.height); crowdKey = key;
  }

  // ---------- effects ----------
  const $ = s => root.querySelector(s);
  const centre = el => { const r = el.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; };
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  function word(text, kind) {
    const w = $('.ps-word');
    if (!w) return;
    w.textContent = text; w.className = `ps-word ${kind}`;
    if (!still) w.animate([{ opacity: 0, transform: 'scale(.3) rotate(-8deg)' }, { opacity: 1, transform: 'scale(1.12) rotate(2deg)', offset: 0.3 },
      { opacity: 1, transform: 'scale(1)', offset: 0.75 }, { opacity: 0, transform: 'scale(1.05) translateY(-10px)' }], { duration: 1100, easing: 'ease-out' });
  }

  // wind-up, then the ball curls to the corner (shrinking with distance, shadow sliding along the grass)
  // while the keeper dives; plain Web Animations so it runs without GSAP too
  async function kick(zone, keeperZone, scored) {
    const ball = $('.ps-ball'), shadow = $('.ps-shadow'), keeper = $('.ps-keeper'), zones = root.querySelectorAll('.ps-zone');
    if (!ball || still) return;
    const [bx, by] = centre(ball), [zx, zy] = centre(zones[zone]), [kx, ky] = centre(keeper), [tx, ty] = centre(zones[keeperZone]);
    const dx = zx - bx, dy = zy - by, curl = (Z[zone][0] - 50) * -0.5;
    const kdx = (tx - kx) * 0.8, kdy = Math.min(0, ty - ky + 18), lean = Z[keeperZone][0] < 40 ? -78 : Z[keeperZone][0] > 60 ? 78 : 0;
    const flight = ball.animate([
      { transform: 'none' },
      { transform: `translate(${dx * 0.5 + curl}px, ${dy * 0.55 - 34}px) rotate(420deg) scale(.74)`, offset: 0.5 },
      { transform: `translate(${dx}px, ${dy}px) rotate(820deg) scale(.5)` }], { duration: 560, easing: 'cubic-bezier(.25,.6,.35,1)', fill: 'forwards' });
    shadow?.animate([{ transform: 'none', opacity: 0.9 }, { transform: `translate(${dx * 0.92}px, ${dy * 0.36 + 30}px) scale(.42)`, opacity: 0.25 }],
      { duration: 560, easing: 'ease-out', fill: 'forwards' });
    await wait(110);
    keeper.classList.add('diving');
    keeper.animate([{ transform: 'none' }, { transform: `translate(${kdx * 0.35}px, ${kdy * 0.3 - 6}px) rotate(${lean * 0.3}deg)`, offset: 0.3 },
      { transform: `translate(${kdx}px, ${kdy}px) rotate(${lean}deg)` }], { duration: 430, easing: 'cubic-bezier(.2,.8,.3,1)', fill: 'forwards' });
    await wait(450); // a timer, not flight.finished: animations pause in a background tab and the round would hang
    void flight;
    if (scored) {
      $('.ps-net')?.animate([{ transform: 'none' }, { transform: 'scale(1.04, 1.06) translateY(-2px)' }, { transform: 'scale(.99)' }, { transform: 'none' }],
        { duration: 520, easing: 'ease-out', transformOrigin: '50% 60%' });
      ball.animate([{ transform: `translate(${dx}px, ${dy}px) scale(.5)` }, { transform: `translate(${dx}px, ${dy + 22}px) scale(.46)` }], { duration: 300, easing: 'cubic-bezier(.5,0,.5,1)', fill: 'forwards' });
      word('GOAL!', 'goal');
    } else {
      ball.animate([{ transform: `translate(${dx}px, ${dy}px) scale(.5)` }, { transform: `translate(${dx * 0.55 + (dx >= 0 ? 70 : -70)}px, ${dy * 0.25}px) rotate(200deg) scale(.7)`, opacity: 0 }],
        { duration: 460, easing: 'ease-out', fill: 'forwards' });
      word('SAVED!', 'saved');
    }
    await wait(scored ? 650 : 600);
  }

  const pop = (el, from = 0.6) => fx.on && el && fx.gsap.from(el, { scale: from, duration: 0.55, ease: 'elastic.out(1, 0.45)', clearProps: 'scale' });
  function winFx(fromEl) {
    if (!fx.on) return;
    fx.coinsTo(fromEl, document.querySelector('.wallet'), Math.min(24, 8 + g.goals * 3));
    pop($('.mx-now'), 0.4);
    if (g.goals === N) { fx.confetti(90); fx.banner('PERFECT 5/5!', `${x2(g.multiplier)} · +${fmt(g.net)}`); }
  }

  const after = r => {
    g = r.game;
    if (r.balance != null) setBalance(r.balance, g.status === 'cashed' && fx.on ? 0.75 : 0);
    if (g.status === 'active') S.bet = g.bet; else refresh();
  };
  function shoot(zone) {
    if (act.busy || g?.status !== 'active') return;
    const shot = g.shots.length;
    aim = zone; haptic('impactOccurred', 'medium');
    act.run(async () => {
      try {
        const r = await api('/penalty/shoot', { zone, shot });
        const scored = r.game.status !== 'busted';
        await kick(zone, r.game.keepers[shot], scored);
        after(r);
        play = r.game.status === 'busted' ? () => { if (fx.on) { fx.flash(); fx.shake($('.pkboard'), 12); } pop($('.mx-now'), 0.4); }
          : r.game.status === 'cashed' ? () => winFx($('.ps-goalbox'))
          : () => { if (fx.on) fx.sparks($('.ps-slot.goal:last-of-type') ?? $('.ps-score'), { count: 14 }); pop($('.ps-slot.goal:last-of-type'), 1.8); pop($('.mx-now'), 0.6); pop($('.play.cash'), 0.94); };
        haptic(scored ? 'impactOccurred' : 'notificationOccurred', scored ? 'heavy' : 'error');
      } finally { aim = null; }
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
    const z = t.closest('[data-zone]');
    if (z && !z.disabled) return shoot(Number(z.dataset.zone));
    const step = t.closest('[data-step]');
    if (step && !step.disabled) { S.bet = bets[Math.max(0, Math.min(bets.length - 1, bets.indexOf(S.bet) + Number(step.dataset.step)))]; haptic('selectionChanged'); return render(); }
    if (t.closest('[data-random]') && g?.status === 'active') return shoot(Math.floor(Math.random() * cfg.zones));
    if (t.closest('[data-fair]')) return openSheet('fair');
    if (t.closest('[data-cta]')) act.run(async () => {
      if (g?.status === 'active') {
        after(await api('/penalty/cashout', {})); haptic('notificationOccurred', 'success');
        play = () => winFx($('[data-cta]'));
      } else {
        after(await api('/penalty/bet', { bet: S.bet, rid: rid() })); haptic('impactOccurred', 'medium');
        play = () => { if (!still) root.querySelectorAll('.ps-zone').forEach((el, j) => el.animate([{ transform: 'scale(0)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }], { duration: 380, delay: j * 60, easing: 'cubic-bezier(.3,1.6,.5,1)', fill: 'backwards' })); };
      }
    });
  });
  const onHelp = () => openSheet('help');
  const onKey = e => { if (e.key === 'Escape' && sheet) closeSheet(); };
  const onResize = () => crowd();
  addEventListener('game-help', onHelp);
  addEventListener('keydown', onKey);
  addEventListener('resize', onResize);
  bindFair(root, () => g);
  render();
  return { destroy() { removeEventListener('game-help', onHelp); removeEventListener('keydown', onKey); removeEventListener('resize', onResize); } };
}
