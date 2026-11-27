import { $, COIN, S, ago, api, esc, fmt, haptic, initData, setBalance, tg, toast } from './core.js';
import mines from './games/mines.js';
import * as fx from './fx.js';
import { GEM, I } from './icons.js';
import { LANG, LANGS, guessLang, setLang, t } from './i18n.js';

// names and texts are English keys; t() shows them in the player's language
const ALL_GAMES = {
  mines: { mount: mines, icon: GEM, name: 'Mines', title: 'Mines', sub: 'Find safe tiles. Avoid the mines.', tag: 'Risk & Strategy', max: '34.20x',
    help: 'Mines — 3×3 board, 2 bombs. Each safe tile raises the multiplier; cash out any time.' },
  penalty: { load: () => import('./games/penalty.js'), icon: '⚽', name: 'Penalty', title: 'Penalty', sub: 'Pick a corner. Beat the keeper.', tag: 'Football', max: '2.89x',
    help: 'Penalty — up to 5 shots; the keeper saves 1 corner in 5. Each goal raises the multiplier; cash out any time.' },
  hilo: { load: () => import('./games/hilo.js'), icon: '🃏', name: 'Higher or Lower', title: 'Higher or Lower', sub: 'Will the next card be higher or lower?', tag: 'Cards', max: '10k coins',
    help: 'Higher or Lower — guess the next card; a same rank wins both ways. Each right guess multiplies; cash out any time.' },
  crash: { load: () => import('./games/crash.js'), icon: '🚀', name: 'Crash', title: 'Crash', sub: 'Cash out before it blows!', tag: 'High Multiplier', max: '1000x',
    help: 'Crash — the multiplier climbs from 1.00x. Cash out before it crashes, or set auto cash-out.' },
  roulette: { load: () => import('./games/roulette.js'), icon: '🎡', name: 'Roulette', title: 'European Roulette', sub: 'Place your bet and spin the wheel.', tag: 'Classic & Elegant', max: '36x',
    help: 'Roulette — red/black or odd/even pay 2x, a single number pays 36x. Zero loses outside bets.' },
  poop: { load: () => import('./games/poop.js'), icon: '💩', name: 'Poop', title: 'Poop', sub: 'The luckiest little poop!', tag: 'Fun & Crazy', max: '30.40x',
    help: 'Poop — pick 💩 or 😂, 50/50 per stage, up to 5 stages (30.40x).' },
};
// Switched-off games are only downloaded if the server turns them back on.
// The games the server has switched on (config.games); the rest stay hidden. Filled in by loadState().
const GAMES = {};
const isGame = k => typeof k === 'string' && Object.hasOwn(GAMES, k);
const RLABEL = { red: '🔴 Red', black: '⚫ Black', odd: 'Odd', even: 'Even' };
const KIND = { signup: [I.spark, 'Welcome bonus'], bonus: [I.gift, 'Daily bonus'], referral: [I.users, 'Invite reward'], welcome: [I.users, 'Invited by a friend'], rescue: [I.gift, 'Rescue coins'], purchase: [I.star, 'Coins purchased'], refund: [I.star, 'Purchase refunded'] };

let screen = null, mounted = null, activeGame = null, histFilter = '', openSheet = '';

// the server works out the level (/profile: level, xp, from, to); this only turns it into a progress bar
const level = p => ({ lv: p.level, xp: p.xp, hi: p.to, pct: Math.min(100, ((p.xp - p.from) / (p.to - p.from)) * 100) });

async function loadState() {
  const s = await api('/state');
  S.user = { ...s.user, balance: S.user?.balance ?? null }; S.config = s.config;
  for (const id of Object.keys(GAMES)) delete GAMES[id];
  for (const id of Object.keys(ALL_GAMES)) if (s.config.games[id]) GAMES[id] = ALL_GAMES[id];
  activeGame = s.game;
  if (s.user.lang && s.user.lang !== LANG) setLang(s.user.lang);
  setBalance(s.user.balance);
  return s;
}

// ---------- routing ----------
// inside Telegram the native header always has a back/close control, so ours only shows in a plain browser
const nativeBack = !!tg?.initData || (!!tg?.BackButton && tg.isVersionAtLeast?.('6.1'));
function go(to) {
  mounted?.destroy(); mounted = null;
  screen = to;
  const root = $('#screen'), inGame = isGame(to), sub = inGame || to === 'top' || to === 'invites' || to === 'shop';
  root.innerHTML = '';
  // inside Telegram the header already has a native back arrow; a second one only crowds the screen
  $('#back').hidden = !sub || nativeBack;
  if (tg?.BackButton) sub ? tg.BackButton.show() : tg.BackButton.hide();
  document.querySelectorAll('[data-nav]').forEach(b => b.classList.toggle('on', b.dataset.nav === (inGame ? 'home' : to === 'top' || to === 'invites' ? 'profile' : to === 'shop' ? 'wallet' : to)));
  document.body.classList.toggle('in-game', inGame); // game screens fit the viewport exactly: no page scroll
  scrollTo(0, 0);
  if (!inGame) {
    RENDER[to]();
    fx.enter([...root.children].filter(el => !el.matches('.cards')));
    return fx.enter(root.querySelectorAll('.card'), { y: 40, scale: 0.85, rotation: -2, duration: 0.6, stagger: 0.08, ease: 'back.out(1.6)', delay: 0.12 });
  }
  const m = GAMES[to];
  root.innerHTML = `<div class="ghead c-${to}"><h2>${t(m.title)}</h2><p>${t(m.sub)}</p>${to === 'mines' ? `<span class="ghead-art">${GEM}</span>` : ''}
    <button type="button" class="help" data-help aria-label="${t('How to play')}">${I.help}</button></div><section class="game"></section>`;
  const opts = {
    initial: activeGame?.game === to ? activeGame : null,
    refresh: () => { activeGame = null; },
    resync: async () => { const s = await loadState(); return s.game?.game === to ? s.game : null; },
  };
  if (m.mount) mounted = m.mount($('.game', root), opts);
  else m.load().then(mod => { if (screen === to) mounted = mod.default($('.game', root), opts); }).catch(e => toast(e.message));
  fx.enter(root.querySelector('.ghead'), { x: -24, y: 0 });
}
// Show the screen at once and refresh the state behind it (one round trip can take a second on a slow network).
// Only home shows state-derived bits (resume badge, bonus timer), so only home re-renders when that changes.
function nav(to) {
  go(to);
  const before = `${activeGame?.id}|${S.user?.bonusAt}`;
  loadState().then(() => { if (screen === to && to === 'home' && `${activeGame?.id}|${S.user.bonusAt}` !== before) RENDER.home(); }).catch(() => {});
}
const back = () => { haptic('impactOccurred', 'light'); nav(screen === 'top' || screen === 'invites' ? 'profile' : screen === 'shop' ? 'wallet' : 'home'); };
$('#back').onclick = back;
tg?.BackButton?.onClick(back);
addEventListener('active-game', e => isGame(e.detail) && setTimeout(() => loadState().catch(() => {}).finally(() => go(e.detail)), 900));
$('#nav').onclick = e => {
  const b = e.target.closest('[data-nav]');
  if (!b || !S.user) return;
  haptic('selectionChanged');
  nav(b.dataset.nav);
};
$('#plus').onclick = () => S.user && go('wallet');

// ---------- shared bits ----------
const bonusLeft = () => S.user.bonusAt - Date.now();
const bonusLabel = () => { const l = bonusLeft(); return l <= 0 ? `+${fmt(S.user.bonusNext)}` : t('{h}h {m}m', { h: fmt(Math.floor(l / 3.6e6)), m: fmt(Math.floor(l % 3.6e6 / 6e4)) }); };
const inviteReward = () => S.config.referral.signup + S.config.referral.active;
const signed = n => `${n >= 0 ? '+' : '−'}${fmt(Math.abs(n))}`;

async function claimBonus() {
  try {
    const r = await api('/bonus', {});
    setBalance(r.balance); Object.assign(S.user, { bonusAt: r.bonusAt, bonusDay: r.bonusDay, bonusNext: r.bonusNext });
    haptic('notificationOccurred', 'success'); toast(t('+{n} coins! Tomorrow: +{m}', { n: fmt(r.amount), m: fmt(r.bonusNext) }));
  } catch (e) { toast(e.message); await loadState().catch(() => {}); }
  RENDER[screen]?.();
}
async function rescue() {
  try {
    const r = await api('/rescue', {});
    setBalance(r.balance); S.user.rescue = r.rescue;
    haptic('notificationOccurred', 'success'); toast(t('+{n} coins to get you playing again', { n: fmt(S.config.rescue) }));
  } catch (e) { toast(e.message); await loadState().catch(() => {}); }
  RENDER[screen]?.();
}
let buying = false;
async function buyPack(el) {
  if (buying) return;
  if (!tg?.initData || !tg.isVersionAtLeast?.('6.1')) return toast('Open Plus Games in Telegram to buy coins');
  buying = true; el.classList.add('busy'); haptic('impactOccurred', 'medium');
  try {
    const { id, link } = await api('/shop/invoice', { pack: el.dataset.pack });
    tg.openInvoice(link, async status => {
      buying = false; el.classList.remove('busy');
      if (status === 'failed') return toast('Payment failed. You were not charged.');
      if (status !== 'paid') return;
      toast('Payment received. Adding your coins…');
      // the webhook credits the coins; give it a moment, then fall back to the wallet refresh
      for (let i = 0; i < 12; i++) {
        const p = await api(`/shop/purchase/${id}`).catch(() => null);
        if (p?.status === 'paid') {
          setBalance(p.balance); haptic('notificationOccurred', 'success');
          return toast(t('+{n} coins added', { n: fmt(p.coins) }));
        }
        await new Promise(r => setTimeout(r, 1000));
      }
      toast('Your coins will appear in a moment');
    });
  } catch (e) { buying = false; el.classList.remove('busy'); toast(e.message); }
}
function invite() {
  if (!S.config.bot) return toast('Invites are not available yet');
  const link = `https://t.me/${S.config.bot}?start=ref_${S.user.id}`;
  const text = t('🎮 Play {games} with me! You get {n} free coins.', { games: Object.values(GAMES).map(m => t(m.name)).join(LANG === 'fa' ? '، ' : ', '), n: fmt(1000 + S.config.referral.welcome) });
  const share = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`;
  if (tg?.openTelegramLink) tg.openTelegramLink(share);
  else navigator.clipboard?.writeText(link).then(() => toast('Invite link copied'));
}
// pick a language: saved on the server so the bot speaks it too
async function chooseLang(l) {
  haptic('selectionChanged');
  setLang(l);
  try { localStorage.setItem('pg_lang', l); } catch {}
  if (S.user) { S.user.lang = l; api('/lang', { lang: l }).catch(() => {}); }
  if (screen && !isGame(screen)) RENDER[screen]?.();
}
const langButtons = () => Object.entries(LANGS).map(([k, v]) => `<button type="button" class="lang-btn ${LANG === k ? 'on' : ''}" data-lang="${k}">${v}</button>`).join('');

function gameRow(g) {
  const m = ALL_GAMES[g.game];
  const x = g.multiplier.toFixed(2) + 'x';
  const detail = g.game === 'mines' ? `${fmt(g.safe)} 💎 · ${x}`
    : g.game === 'penalty' ? `${t('{n}/5 goals', { n: fmt(g.goals) })}${g.won ? ` · ${x}` : ''}`
    : g.game === 'hilo' ? `${t('{n} right', { n: fmt(g.correct) })}${g.won ? ` · ${x}` : ''}`
    : g.game === 'poop' ? `${g.stage}/5 stages${g.won ? ` · ${x}` : ''}`
    : g.game === 'crash' ? `crashed ${g.crash.toFixed(2)}x${g.won ? ` · out ${x}` : ''}`
    : `${g.type === 'number' ? '#' + g.pick : RLABEL[g.type]} · landed ${g.number}`;
  return `<li class="row panel"><span class="gi c-${g.game}">${m.icon}</span>
    <div class="mid"><b>${t(m.name)}</b><small>${detail} · ${t('bet {n}', { n: fmt(g.bet) })}</small></div>
    <div class="end"><span class="${g.won ? 'pos' : 'neg'}">${t(g.won ? 'Win' : 'Lose')} ${signed(g.net)}</span><small>${ago(g.createdAt)}</small></div></li>`;
}
const listError = e => { const l = $('[data-list]'); if (l) l.innerHTML = `<li class="empty">${esc(t(e.message))}</li>`; };

// ---------- screens ----------
const RENDER = {
  home() {
    const h = new Date().getHours(), greet = h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
    $('#screen').innerHTML = `
      <div class="hello panel"><span class="avatar">${esc((S.user.name || 'P')[0].toUpperCase())}</span>
        <div><small>${t(greet)}${LANG === 'fa' ? '' : ','}</small><b>${esc(S.user.name || t('Player'))}!</b></div>
        <div class="lvl" data-lvl>${t('Lv. {n}', { n: '…' })}<i></i></div></div>
      ${S.user.rescue?.available ? `<div class="promo rescue"><div><small>${t('Out of coins?')}</small><b>${t("Here's {n}<br>to keep playing", { n: fmt(S.config.rescue) })}</b>
          <button type="button" class="claim" data-act="rescue">${t('Get +{n}', { n: fmt(S.config.rescue) })}</button></div><span class="promo-art">${I.spark}</span></div>` : ''}
      <div class="promo">
        <div><small>${t('Daily reward · day {d} of 7', { d: fmt(S.user.bonusDay) })}</small><b>${t('Free coins<br>every day')}</b>
          <div class="streak" aria-label="${t('Daily reward · day {d} of 7', { d: fmt(S.user.bonusDay) })}">${S.config.dailySteps.map((v, d) => `<i class="${d < S.user.bonusDay - (bonusLeft() > 0 ? 0 : 1) ? 'done' : ''} ${d === S.user.bonusDay - 1 ? 'now' : ''}">${fmt(v)}</i>`).join('')}</div>
          <button type="button" class="claim" data-act="bonus" ${bonusLeft() > 0 ? 'disabled' : ''}>${bonusLeft() > 0 ? t('Next in {t}', { t: bonusLabel() }) : t('Claim +{n}', { n: fmt(S.user.bonusNext) })}</button></div>
        <span class="promo-art">${I.gift}</span>
      </div>
      <div class="quick">
        <button type="button" class="panel" data-act="invite">${I.users}<span>${t('Invite <b>+{n}</b>', { n: fmt(inviteReward()) })}</span></button>
        <button type="button" class="panel" data-act="top">${I.trophy}<span>${t('Leaderboard')}</span></button>
      </div>
      <div class="sec-title">${t('Featured Games')}</div>
      <div class="cards ${Object.keys(GAMES).length === 1 ? 'solo' : ''}">${Object.entries(GAMES).map(([id, m]) => `
        <button type="button" class="card c-${id}" data-go="${id}">
          <span class="max">${t('up to {m}', { m: t(m.max) })}</span>${activeGame?.game === id ? `<span class="badge">${t('Round in play')}</span>` : ''}
          <div class="art">${m.icon}</div><div class="txt"><b>${t(m.name)}</b><small>${t(m.tag)}</small></div>
          <span class="go">${I.play}${t(activeGame?.game === id ? 'Resume' : 'Play now')}</span>
        </button>`).join('')}</div>
      <p class="foot">${t('Every round is provably fair.')}</p>`;
    api('/profile').then(p => {
      const L = level(p), el = $('[data-lvl]');
      if (el) { el.innerHTML = `${t('Lv. {n}', { n: fmt(L.lv) })}<i></i>`; el.style.setProperty('--p', L.pct + '%'); }
    }).catch(() => {});
  },

  async wallet() {
    $('#screen').innerHTML = `
      <div class="sec-title" style="margin-top:4px">${t('Wallet')}</div>
      <div class="balance-card panel neon"><small>${t('Your balance')}</small>
        <div class="big">${COIN}<span>${fmt(S.user.balance)}</span></div>
        <div class="acts">
          <button type="button" class="btn-green" data-act="bonus" ${bonusLeft() > 0 ? 'disabled' : ''}>${I.gift}${t('Daily {t}', { t: bonusLabel() })}</button>
          <button type="button" class="btn2" data-act="invite">${I.users}${t('Invite +{n}', { n: fmt(inviteReward()) })}</button>
        </div>
        ${S.user.rescue?.available ? `<button type="button" class="btn-green wide" data-act="rescue">${I.spark}${t('Out of coins? Get +{n}', { n: fmt(S.config.rescue) })}</button>` : ''}
        <button type="button" class="play buy" data-act="shop">${I.cash}${t('Buy coins')}</button></div>
      <div class="sec-title">${t('Transactions')}</div>
      <ul class="list" data-list><li class="empty">${t('Loading…')}</li></ul>`;
    try {
      const { items } = await api('/wallet');
      $('[data-list]').innerHTML = items.map(x => {
        const [icon, label] = KIND[x.kind] ? [KIND[x.kind][0], t(KIND[x.kind][1])]
          : [ALL_GAMES[x.game]?.icon ?? '🎮', `${t(ALL_GAMES[x.game]?.name ?? 'Game')} · ${t(x.kind === 'win' ? 'win' : x.amount > 0 ? 'bet lowered' : 'bet')}`];
        return `<li class="row panel"><span class="gi c-${x.game ?? 'poop'}">${icon}</span>
          <div class="mid"><b>${label}</b><small>${ago(x.at)}</small></div>
          <div class="end"><span class="${x.amount >= 0 ? 'pos' : 'neg'}">${signed(x.amount)}</span><small>${t('bal {n}', { n: fmt(x.balance) })}</small></div></li>`;
      }).join('') || `<li class="empty">${t('No transactions yet')}</li>`;
    } catch (e) { listError(e); }
  },

  async history() {
    $('#screen').innerHTML = `
      <div class="sec-title" style="margin-top:4px">${t('Game History')}</div>
      ${Object.keys(GAMES).length > 1 ? `<div class="filters">${['', ...Object.keys(GAMES)].map(f => `<button type="button" class="pill ${histFilter === f ? 'on' : ''}" data-filter="${f}">${f ? t(GAMES[f].name) : t('All')}</button>`).join('')}</div>` : ''}
      <ul class="list" data-list><li class="empty">${t('Loading…')}</li></ul>`;
    try {
      const { games } = await api('/history' + (histFilter ? `?game=${histFilter}` : ''));
      $('[data-list]').innerHTML = games.map(gameRow).join('') || `<li class="empty">${t('No rounds yet — go play!')}</li>`;
    } catch (e) { listError(e); }
  },

  async profile() {
    const sheet = {
      fair: `<p>${t("Every round's result is fixed by a secret seed <b>before</b> you play. You see its SHA-256 fingerprint up front; when the round ends the seed is revealed.")}</p><p>${t('Open "Provably fair" under any game and tap <b>Verify</b>: your phone recomputes the result from the seed.')}</p>`,
      help: `${Object.values(GAMES).map(m => `<p>${m.icon.length < 4 ? m.icon + ' ' : ''}${t(m.help)}</p>`).join('')}<p>${t('Bets are 10, 50 or 100 coins. Coins are virtual and have no cash value.')}</p>`,
      lang: `<div class="lang-row">${langButtons()}</div>`,
    };
    const item = (k, icon, label) => `<button type="button" class="panel" data-sheet="${k}" aria-expanded="${openSheet === k}"><span>${icon}</span>${label}<span class="chev">${I.chevron}</span></button>
      ${openSheet === k ? `<div class="panel sheet" style="padding:4px 14px">${sheet[k]}</div>` : ''}`;
    $('#screen').innerHTML = `
      <div class="sec-title" style="margin-top:4px">${t('Profile')}</div>
      <div class="player panel neon"><span class="avatar">${esc((S.user.name || 'P')[0].toUpperCase())}</span>
        <div class="info"><b>${esc(S.user.name || t('Player'))}</b><small>ID ${S.user.id}</small>
          <div data-xp><span class="lv">${t('Lv. {n}', { n: '…' })}</span><div class="xpbar"><i style="width:0"></i></div></div></div></div>
      <div class="stats" data-stats>${['Rounds', 'Win rate', 'Net', 'Best'].map(l => `<div class="panel"><b>…</b><small>${t(l)}</small></div>`).join('')}</div>
      <div class="menu">
        <button type="button" class="panel" data-act="top"><span>${I.trophy}</span>${t('Leaderboard')}<span>${I.chevron}</span></button>
        <button type="button" class="panel" data-act="invites"><span>${I.users}</span>${t('Invite friends · {n} joined', { n: fmt(S.user.invited) })}<span>${I.chevron}</span></button>
        ${item('lang', I.globe, `${t('Language')} · ${LANGS[LANG]}`)}
        ${item('fair', I.shield, t('Provably fair'))}
        ${item('help', I.help, t('How to play'))}
      </div>`;
    try {
      const p = await api('/profile'), L = level(p);
      $('[data-xp]').innerHTML = `<span class="lv">${t('Lv. {n}', { n: fmt(L.lv) })}</span><div class="xpbar"><i style="width:${L.pct}%"></i></div><small>${fmt(L.xp)} / ${fmt(L.hi)} XP</small>`;
      $('[data-stats]').innerHTML = [
        [fmt(p.rounds), 'Rounds'], [p.rounds ? fmt(Math.round((p.wins / p.rounds) * 100)) + '%' : '—', 'Win rate'],
        [`<span class="${p.net >= 0 ? 'pos' : 'neg'}">${signed(p.net)}</span>`, 'Net'], [p.best ? p.best.toFixed(2) + 'x' : '—', 'Best'],
      ].map(([v, l]) => `<div class="panel"><b>${v}</b><small>${t(l)}</small></div>`).join('');
    } catch {}
  },

  async invites() {
    const R = S.config.referral;
    $('#screen').innerHTML = `
      <div class="sec-title" style="margin-top:4px">${t('Invite friends')}</div>
      <div class="panel invite-card">
        <p>${t('Your friend gets <b>+{w}</b> coins on top of the usual 1,000. You get <b>+{s}</b> when they join, and <b>+{a}</b> once they have played {r} rounds on {d} different days within {x} days.',
          { w: fmt(R.welcome), s: fmt(R.signup), a: fmt(R.active), r: fmt(R.rounds), d: fmt(R.days), x: fmt(R.windowDays) })}</p>
        <button type="button" class="play" data-act="invite">${I.users}${t('Share my link')}</button>
      </div>
      <div class="sec-title">${t('Your friends')}</div>
      <ul class="list" data-list><li class="empty">${t('Loading…')}</li></ul>`;
    try {
      const { items } = await api('/referrals');
      const label = f => f.status === 'active' ? `<span class="pos">${t('+{n} earned', { n: fmt(R.active) })}</span>` : f.status === 'expired' ? `<span class="muted">${t('Expired')}</span>`
        : `<span class="muted">${t('{n}/{m} rounds', { n: fmt(f.rounds), m: fmt(R.rounds) })}</span>`;
      $('[data-list]').innerHTML = items.map(f => `<li class="row panel"><span class="gi">${I.users}</span>
        <div class="mid"><b>${esc(f.name)}</b><small>${t('joined {t}', { t: ago(f.at) })}${f.rewarded ? '' : t(' · over the monthly limit')}</small></div>
        <div class="end">${label(f)}</div></li>`).join('') || `<li class="empty">${t('No friends yet: share your link!')}</li>`;
    } catch (e) { listError(e); }
  },

  // Coin packs paid with Telegram Stars
  shop() {
    $('#screen').innerHTML = `
      <div class="sec-title" style="margin-top:4px">${t('Buy coins')}</div>
      <div class="packs">${S.config.shop.map((p, i) => `
        <button type="button" class="pack panel ${p.tag ? 'hot' : ''}" data-pack="${p.id}" aria-label="${fmt(p.coins)} ${t('coins')} · ${fmt(p.stars)} Stars">
          ${p.tag ? `<span class="tag">${t(p.tag)}</span>` : ''}
          <span class="pack-art">${COIN.repeat(Math.min(3, i + 1))}</span>
          <b>${fmt(p.coins)}</b><small>${t('coins')}</small>
          ${p.bonus ? `<span class="bonus">${t('+{n}% bonus', { n: fmt(p.bonus) })}</span>` : '<span class="bonus muted">&nbsp;</span>'}
          <span class="price">${I.star}${fmt(p.stars)}</span>
        </button>`).join('')}</div>
      <p class="note center">${t('Coins are for playing inside Plus Games only. They cannot be withdrawn or exchanged for money.')}</p>`;
  },

  async top() {
    $('#screen').innerHTML = `<div class="sec-title" style="margin-top:4px">${t('🏆 This week')} <small class="muted">${t('by virtual profit · resets Saturday')}</small></div><ol class="list" data-list><li class="empty">${t('Loading…')}</li></ol>`;
    try {
      const { top } = await api('/leaderboard');
      $('[data-list]').innerHTML = top.map((p, i) => `<li class="row panel ${p.me ? 'me' : ''}"><span class="gi">${['🥇', '🥈', '🥉'][i] ?? fmt(i + 1)}</span>
        <div class="mid"><b>${esc(p.name)}${p.me ? t(' (you)') : ''}</b><small>${t('{n} rounds', { n: fmt(p.games) })}</small></div>
        <div class="end"><span class="${p.profit >= 0 ? 'pos' : 'neg'}">${signed(p.profit)}</span></div></li>`).join('') || `<li class="empty">${t('No players yet')}</li>`;
    } catch (e) { listError(e); }
  },
};

$('#screen').addEventListener('click', e => {
  if (e.target.closest('[data-help]')) return dispatchEvent(new CustomEvent('game-help')); // the game opens its own sheet
  if (isGame(screen)) return; // game modules handle their own clicks
  const card = e.target.closest('[data-go]'), act = e.target.closest('[data-act]'), f = e.target.closest('[data-filter]'), sh = e.target.closest('[data-sheet]');
  const lang = e.target.closest('[data-lang]');
  if (lang) { openSheet = ''; return chooseLang(lang.dataset.lang); }
  if (card) { haptic('impactOccurred', 'light'); return go(card.dataset.go); }
  const pack = e.target.closest('[data-pack]');
  if (pack) return buyPack(pack);
  if (f) { histFilter = f.dataset.filter; haptic('selectionChanged'); return RENDER.history(); }
  if (sh) { openSheet = openSheet === sh.dataset.sheet ? '' : sh.dataset.sheet; return RENDER.profile(); }
  if (!act || act.disabled) return;
  if (act.dataset.act === 'bonus') { act.disabled = true; return claimBonus(); }
  if (act.dataset.act === 'invite') return invite();
  if (act.dataset.act === 'rescue') { act.disabled = true; return rescue(); }
  if (act.dataset.act === 'invites') return go('invites');
  if (act.dataset.act === 'shop') { haptic('impactOccurred', 'light'); return go('shop'); }
  if (act.dataset.act === 'top') return go('top');
});

// ---------- boot ----------
function hideSplash() {
  const s = $('#splash');
  s.style.pointerEvents = 'none';
  s.classList.add('out'); setTimeout(() => (s.hidden = true), 700); // outro is CSS (style.css), same with or without GSAP
}
const seen = () => { try { return localStorage.getItem('pg_seen') === '1'; } catch { return true; } };

(async function boot() {
  tg?.ready(); tg?.expand();
  try { tg?.setHeaderColor?.('#080812'); tg?.setBackgroundColor?.('#080812'); tg?.disableVerticalSwipes?.(); } catch {}
  // until the server says which language this player picked: the last one used here, else Telegram's app language
  let stored = null;
  try { stored = localStorage.getItem('pg_lang'); } catch {}
  setLang(stored ?? guessLang(tg?.initDataUnsafe?.user?.language_code ?? navigator.language));
  const params = new URLSearchParams(location.search);
  if (!initData && !params.get('dev')) {
    const cfg = await fetch('/config').then(r => r.json()).catch(() => ({}));
    if (cfg.bot) $('#botLink').href = `https://t.me/${cfg.bot}`;
    hideSplash(); $('#gate').hidden = false; return;
  }
  try {
    await loadState();
    // an unfinished round wins over the deep link: the player resumes it after a refresh/disconnect
    const want = activeGame?.game ?? params.get('game');
    go(isGame(want) ? want : 'home');
  } catch (e) {
    hideSplash();
    $('#screen').innerHTML = `<div class="empty" style="padding-top:80px">${esc(t(e.message))}<br><br><button type="button" class="cta inline" onclick="location.reload()">${t('Try again')}</button></div>`;
    return;
  }
  // Effects arrive once the first screen has settled: parsing GSAP is a ~100ms main-thread job on a mid-range phone,
  // and at 300ms it landed right on the splash outro and the first board render, which read as a stutter.
  (window.requestIdleCallback ?? (f => setTimeout(f, 1200)))(() => fx.init(), { timeout: 2500 });
  setInterval(() => { if (screen === 'home') RENDER.home(); }, 60000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && S.user && !isGame(screen)) loadState().then(() => RENDER[screen]?.()).catch(() => {});
  });
  // first visit, or no language chosen yet: the splash asks for the language, then doubles as a welcome screen
  if (!S.user.lang) {
    $('#splashAct').innerHTML = `<p class="lang-q">Choose your language<br>زبان خود را انتخاب کنید</p><div class="lang-row">${langButtons()}</div>`;
    $('#splashAct').onclick = e => {
      const b = e.target.closest('[data-lang]');
      if (!b) return;
      chooseLang(b.dataset.lang);
      try { localStorage.setItem('pg_seen', '1'); } catch {}
      haptic('impactOccurred', 'medium'); hideSplash(); go(screen ?? 'home');
    };
    return;
  }
  if (seen() || activeGame || !S.user) return hideSplash();
  $('#splashAct').innerHTML = `<button type="button" class="cta inline" id="start">${I.play}${t('START PLAYING')}</button>`;
  $('#start').onclick = () => { try { localStorage.setItem('pg_seen', '1'); } catch {} haptic('impactOccurred', 'medium'); hideSplash(); };
})();
