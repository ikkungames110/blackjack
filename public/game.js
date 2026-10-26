import {
  ACTION_NAMES, hiLo, handInfo, simpleStrategy, generalStrategy, countStrategy, computeEVs,
  SIMPLE, GENERAL, DEVIATIONS, col, chartRowKey,
} from './engine.js';

const CHIPS = [5, 10, 50, 100, 500, 1000];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const SUITS = ['♠', '♥', '♦', '♣'];
const DECKS = 6;
const SHOE_SIZE = 52 * DECKS;
const RESHUFFLE_AT = 52 * 2;
const START_BANKROLL = 100;
const METHODS = [
  { key: 'simple', label: '簡易版' },
  { key: 'general', label: '一般' },
  { key: 'count', label: '一般+TC' },
  { key: 'exact', label: '完全暗記' },
];

const $ = (id) => document.getElementById(id);
const val = (rank) => (rank === 'A' ? 1 : ['10', 'J', 'Q', 'K'].includes(rank) ? 10 : Number(rank));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function load(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : JSON.parse(v);
  } catch {
    return fallback;
  }
}
function save(key, v) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch { /* 保存できなくても遊べる */ }
}

const state = {
  bankroll: START_BANKROLL,
  bet: 5,
  shoe: [],
  seen: new Array(11).fill(0), // 値 1..10 ごとの消費枚数
  rc: 0,
  phase: 'bet',
  dealer: [],
  holeHidden: true,
  hands: [],
  active: 0,
  decisions: [],
  justShuffled: false,
  stats: load('bj-stats', Object.fromEntries(METHODS.map((m) => [m.key, { ok: 0, n: 0 }]))),
};

function randInt(n) {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] % n;
}

function newShoe() {
  const shoe = [];
  for (let d = 0; d < DECKS; d++) {
    for (const suit of SUITS) for (const rank of RANKS) shoe.push({ rank, suit, v: val(rank) });
  }
  for (let i = shoe.length - 1; i > 0; i--) {
    const j = randInt(i + 1);
    [shoe[i], shoe[j]] = [shoe[j], shoe[i]];
  }
  state.shoe = shoe;
  state.seen = new Array(11).fill(0);
  state.rc = 0;
}

function markSeen(card) {
  state.seen[card.v]++;
  state.rc += hiLo(card.v);
}

function draw(visible = true) {
  const card = state.shoe.pop();
  if (visible) markSeen(card);
  return card;
}

const seenTotal = () => state.seen.reduce((a, b) => a + b, 0);
const unseen = () => SHOE_SIZE - seenTotal();
const trueCount = () => state.rc / (unseen() / 52);
const values = (cards) => cards.map((c) => c.v);
const best = (cards) => handInfo(values(cards)).best;
const isBlackjack = (cards) => cards.length === 2 && best(cards) === 21;

function unknownCounts() {
  const c = [0];
  for (let v = 1; v <= 10; v++) c.push((v === 10 ? 16 * DECKS : 4 * DECKS) - state.seen[v]);
  return c;
}

// ---------- ラウンド進行 ----------

function deal() {
  if (state.phase !== 'bet' || state.bet > state.bankroll) return;
  state.justShuffled = false;
  if (SHOE_SIZE - state.shoe.length >= RESHUFFLE_AT) {
    newShoe();
    state.justShuffled = true;
  }
  state.bankroll -= state.bet;
  state.hands = [{ cards: [], bet: state.bet, done: false, splitAces: false, fromSplit: false, result: null }];
  state.dealer = [];
  state.holeHidden = true;
  state.active = 0;
  state.decisions = [];
  const hand = state.hands[0];
  hand.cards.push(draw());
  state.dealer.push(draw());
  hand.cards.push(draw());
  state.dealer.push(draw(false));

  const up = state.dealer[0].v;
  const dealerBJ = isBlackjack(state.dealer);
  if (((up === 1 || up === 10) && dealerBJ) || isBlackjack(hand.cards)) {
    revealHole();
    settle();
    return;
  }
  state.phase = 'player';
  setMessage(up === 1 || up === 10 ? 'ディーラーはブラックジャックではありません' : 'アクションを選んでください');
  renderJudge();
  render();
}

function revealHole() {
  if (!state.holeHidden) return;
  state.holeHidden = false;
  markSeen(state.dealer[1]);
}

function canDouble(h) {
  return h.cards.length === 2 && !h.splitAces && state.bankroll >= h.bet;
}
function canSplit(h) {
  return h.cards.length === 2 && h.cards[0].v === h.cards[1].v && !h.splitAces
    && state.hands.length < 4 && state.bankroll >= h.bet;
}

function act(code) {
  if (state.phase !== 'player') return;
  const h = state.hands[state.active];
  if (code === 'D' && !canDouble(h)) return;
  if (code === 'P' && !canSplit(h)) return;

  judge(code, h);

  if (code === 'H') {
    h.cards.push(draw());
    if (best(h.cards) >= 21) h.done = true;
  } else if (code === 'S') {
    h.done = true;
  } else if (code === 'D') {
    state.bankroll -= h.bet;
    h.bet *= 2;
    h.doubled = true;
    h.cards.push(draw());
    h.done = true;
  } else if (code === 'P') {
    state.bankroll -= h.bet;
    const aces = h.cards[0].v === 1;
    const second = h.cards.pop();
    const other = { cards: [second], bet: h.bet, done: false, splitAces: aces, fromSplit: true, result: null };
    h.fromSplit = true;
    h.splitAces = aces;
    h.cards.push(draw());
    if (aces || best(h.cards) === 21) h.done = true;
    state.hands.splice(state.active + 1, 0, other);
  }
  advance();
}

function advance() {
  for (;;) {
    const h = state.hands[state.active];
    if (!h) {
      dealerPlay();
      return;
    }
    if (h.cards.length === 1) {
      h.cards.push(draw());
      if (h.splitAces || best(h.cards) === 21) h.done = true;
    }
    if (!h.done) {
      setMessage(state.hands.length > 1 ? `ハンド ${state.active + 1} のアクションを選んでください` : 'アクションを選んでください');
      render();
      return;
    }
    state.active++;
  }
}

async function dealerPlay() {
  state.phase = 'dealer';
  revealHole();
  setMessage('ディーラーの番です');
  render();
  const live = state.hands.some((h) => best(h.cards) <= 21);
  while (live && best(state.dealer) < 17) {
    await sleep(500);
    state.dealer.push(draw());
    render();
  }
  await sleep(300);
  settle();
}

function settle() {
  const dealerBJ = isBlackjack(state.dealer);
  const d = best(state.dealer);
  let net = 0;
  for (const h of state.hands) {
    const p = best(h.cards);
    const playerBJ = !h.fromSplit && isBlackjack(h.cards);
    let pay = 0;
    if (playerBJ && dealerBJ) { h.result = 'push'; pay = h.bet; }
    else if (playerBJ) { h.result = 'bj'; pay = h.bet * 2.5; }
    else if (dealerBJ) { h.result = 'lose'; }
    else if (p > 21) { h.result = 'bust'; }
    else if (d > 21 || p > d) { h.result = 'win'; pay = h.bet * 2; }
    else if (p === d) { h.result = 'push'; pay = h.bet; }
    else { h.result = 'lose'; }
    state.bankroll += pay;
    net += pay - h.bet;
  }
  state.phase = 'bet';
  const head = dealerBJ ? 'ディーラーのブラックジャック。' : '';
  const sign = net > 0 ? `+$${fmt(net)}` : net < 0 ? `-$${fmt(-net)}` : '±$0';
  setMessage(`${head}収支 ${sign}　次の掛け金を選んでください`);
  if (state.bet > state.bankroll) {
    state.bet = [...CHIPS].reverse().find((c) => c <= state.bankroll) || CHIPS[0];
  }
  render();
}

function resetGame() {
  state.bankroll = START_BANKROLL;
  state.bet = 5;
  state.hands = [];
  state.dealer = [];
  state.decisions = [];
  state.phase = 'bet';
  newShoe();
  setMessage('チップを選んで「ディール」を押してください');
  renderJudge();
  render();
}

// ---------- 判定 ----------

function judge(code, h) {
  const up = state.dealer[0].v;
  const ctx = {
    values: values(h.cards),
    up,
    canDouble: canDouble(h),
    canSplit: canSplit(h),
    canDoubleAfterSplit: state.bankroll >= h.bet * 2,
  };
  const tc = trueCount();
  const excl = up === 1 ? 10 : up === 10 ? 1 : 0;
  const counted = countStrategy(ctx, tc);
  const exact = computeEVs(ctx, unknownCounts(), excl);
  const answers = {
    simple: simpleStrategy(ctx),
    general: generalStrategy(ctx),
    count: counted.code,
    exact: exact.best,
  };
  for (const m of METHODS) {
    state.stats[m.key].n++;
    if (answers[m.key] === code) state.stats[m.key].ok++;
  }
  save('bj-stats', state.stats);
  state.decisions.unshift({
    you: code,
    hand: h.cards.map((c) => c.rank).join(' '),
    total: totalLabel(h.cards),
    up: state.dealer[0].rank,
    tc,
    answers,
    deviation: counted.deviation,
    evs: exact.evs,
    handNo: state.hands.length > 1 ? state.active + 1 : null,
  });
  renderJudge();
}

function renderJudge() {
  const el = $('judge');
  if (!state.decisions.length) {
    el.className = 'judge empty';
    el.textContent = 'アクションを取ると、4つの基準での正解が表示されます。';
    return;
  }
  el.className = 'judge';
  el.innerHTML = state.decisions.map((d, i) => {
    const rows = METHODS.map((m) => {
      const a = d.answers[m.key];
      const ok = a === d.you;
      let note = '';
      if (m.key === 'count' && d.deviation) {
        note = `<span class="note">指数 ${d.deviation.index >= 0 ? '+' : ''}${d.deviation.index}</span>`;
      }
      return `<tr class="${ok ? 'ok' : 'ng'}"><th>${m.label}</th><td><span class="badge ${a}">${ACTION_NAMES[a]}</span>${note}</td><td class="mark">${ok ? '○' : '×'}</td></tr>`;
    }).join('');
    const evs = Object.entries(d.evs)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `<span class="ev ${k === d.answers.exact ? 'top' : ''} ${k === d.you ? 'mine' : ''}">${ACTION_NAMES[k]} ${v >= 0 ? '+' : ''}${v.toFixed(3)}</span>`)
      .join('');
    return `<div class="decision ${i ? 'old' : ''}">
      <div class="dhead">${d.handNo ? `ハンド${d.handNo}：` : ''}<b>${d.hand}</b>（${d.total}） vs <b>${d.up}</b>
        <span class="tcv">TC ${d.tc >= 0 ? '+' : ''}${d.tc.toFixed(1)}</span></div>
      <div class="you">あなた：<span class="badge ${d.you}">${ACTION_NAMES[d.you]}</span></div>
      <table>${rows}</table>
      <div class="evs" title="1ベットあたりの期待値">期待値：${evs}</div>
    </div>`;
  }).join('');
}

function renderStats() {
  $('stats').innerHTML = METHODS.map((m) => {
    const s = state.stats[m.key];
    const pct = s.n ? Math.round((s.ok / s.n) * 100) : 0;
    return `<tr><th>${m.label}</th><td>${s.ok} / ${s.n}</td><td class="pct">${s.n ? pct + '%' : '–'}</td></tr>`;
  }).join('');
}

// ---------- 描画 ----------

function fmt(n) {
  return Number.isInteger(n) ? n.toLocaleString() : n.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

function setMessage(text) {
  $('message').textContent = text;
}

function totalLabel(cards) {
  const info = handInfo(values(cards));
  if (cards.length === 2 && info.best === 21) return 'BJ';
  if (info.soft && info.best < 21) return `ソフト${info.best}`;
  return String(info.best);
}

function cardHTML(card, hidden = false) {
  if (hidden) return '<div class="card back"></div>';
  const red = card.suit === '♥' || card.suit === '♦';
  return `<div class="card ${red ? 'red' : ''}"><span class="r">${card.rank}</span><span class="s">${card.suit}</span><span class="r2">${card.rank}</span></div>`;
}

const RESULT_LABEL = { win: '勝ち', bj: 'ブラックジャック!', push: '引き分け', lose: '負け', bust: 'バースト' };

function render() {
  $('bankroll').textContent = `$${fmt(state.bankroll)}`;

  // ディーラー
  $('dealerCards').innerHTML = state.dealer.map((c, i) => cardHTML(c, i === 1 && state.holeHidden)).join('');
  if (!state.dealer.length) $('dealerTotal').textContent = '';
  else if (state.holeHidden) $('dealerTotal').textContent = totalLabel([state.dealer[0]]);
  else $('dealerTotal').textContent = best(state.dealer) > 21 ? `${best(state.dealer)} バースト` : totalLabel(state.dealer);

  // プレイヤー
  $('playerHands').innerHTML = state.hands.map((h, i) => {
    const active = state.phase === 'player' && i === state.active;
    const total = best(h.cards) > 21 ? `${best(h.cards)} バースト` : totalLabel(h.cards);
    const result = h.result ? `<span class="result ${h.result}">${RESULT_LABEL[h.result]}</span>` : '';
    return `<div class="hand ${active ? 'active' : ''}">
      <div class="cards">${h.cards.map((c) => cardHTML(c)).join('')}</div>
      <div class="hand-meta"><span class="total">${total}</span><span class="hbet">$${fmt(h.bet)}${h.doubled ? ' (ダブル)' : ''}</span>${result}</div>
    </div>`;
  }).join('');

  // 操作
  const betting = state.phase === 'bet';
  const broke = betting && state.bankroll < CHIPS[0];
  $('betPanel').classList.toggle('hidden', !betting || broke);
  $('brokePanel').classList.toggle('hidden', !broke);
  $('actionPanel').classList.toggle('hidden', state.phase === 'bet');
  $('chips').innerHTML = CHIPS.map((c) => `<button class="chip c${c} ${c === state.bet ? 'sel' : ''}" data-chip="${c}" ${c > state.bankroll ? 'disabled' : ''}>$${c}</button>`).join('');
  $('betAmount').textContent = `$${fmt(state.bet)}`;
  $('dealBtn').disabled = state.bet > state.bankroll;
  const h = state.hands[state.active];
  for (const btn of document.querySelectorAll('.act')) {
    const a = btn.dataset.act;
    let ok = state.phase === 'player' && h && !h.done;
    if (ok && a === 'D') ok = canDouble(h);
    if (ok && a === 'P') ok = canSplit(h);
    btn.disabled = !ok;
  }

  // シュー
  const dealt = SHOE_SIZE - state.shoe.length;
  $('shoeInfo').innerHTML = `シュー残り <b>${state.shoe.length}</b> 枚 ／ シャッフルまで <b>${Math.max(0, RESHUFFLE_AT - dealt)}</b> 枚${state.justShuffled ? ' <span class="shuffled">シャッフルしました</span>' : ''}`;

  // カウント
  const tc = trueCount();
  $('rc').textContent = (state.rc > 0 ? '+' : '') + state.rc;
  $('decksLeft').textContent = (unseen() / 52).toFixed(2);
  $('tc').textContent = (tc > 0 ? '+' : '') + tc.toFixed(1);
  $('tc').className = `v ${tc >= 1 ? 'pos' : tc <= -1 ? 'neg' : ''}`;

  // 消費カード
  const rows = [];
  for (let v = 1; v <= 10; v++) {
    const totalCards = v === 10 ? 16 * DECKS : 4 * DECKS;
    const used = state.seen[v];
    const label = v === 1 ? 'A' : v === 10 ? '10・J・Q・K' : String(v);
    const hl = hiLo(v);
    rows.push(`<tr><th>${label} <span class="hl">${hl > 0 ? '+1' : hl < 0 ? '−1' : '0'}</span></th><td>${used}枚</td><td>${totalCards - used}</td>
      <td class="bar-col"><div class="bar"><i style="width:${(used / totalCards) * 100}%"></i></div></td></tr>`);
  }
  $('usedBody').innerHTML = rows.join('');
  $('usedTotal').textContent = `計 ${seenTotal()} 枚`;

  renderStats();
  renderCharts();
  renderDeviations();
}

// ---------- 戦略表・TC変化ポイント ----------

const CHART_ROWS = (() => {
  const rows = [{ key: 'h8', label: '3〜8', kind: 'hard', n: 8 }];
  for (let t = 9; t <= 16; t++) rows.push({ key: `h${t}`, label: String(t), kind: 'hard', n: t });
  rows.push({ key: 'h17', label: '17〜20', kind: 'hard', n: 17 });
  for (let o = 2; o <= 9; o++) rows.push({ key: `s${o + 11}`, label: `A-${o}`, kind: 'soft', n: o + 11 });
  for (let v = 2; v <= 10; v++) rows.push({ key: `p${v}`, label: `${v}-${v}`, kind: 'pair', n: v });
  rows.push({ key: 'p1', label: 'A-A', kind: 'pair', n: 1 });
  return rows;
})();
const UPS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 1];
const CELL_TEXT = { H: 'H', S: 'S', D: 'DD', P: 'SP' };
const upLabel = (up) => (up === 1 ? 'A' : String(up));
const devKey = (d) => (d.pair ? `p${d.pair}` : `h${d.hard}`);
const devLabel = (d) => (d.pair ? `${d.pair}-${d.pair}` : String(d.hard));
const chartCode = (chart, kind, n, up) => chart[kind](n)[col(up)];
const fmtIndex = (i) => (i > 0 ? `+${i}` : String(i));

// プレイ中のハンドが表のどのマスか
function currentCell() {
  if (state.phase !== 'player') return null;
  const h = state.hands[state.active];
  if (!h || h.done) return null;
  const key = chartRowKey(values(h.cards), canSplit(h));
  return key ? { key, up: state.dealer[0].v } : null;
}

function chartHTML(chart, withDev) {
  const cur = currentCell();
  const tc = trueCount();
  const head = `<tr><th></th>${UPS.map((u) => `<th class="${cur && cur.up === u ? 'cur' : ''}">${upLabel(u)}</th>`).join('')}</tr>`;
  let prevKind = 'hard';
  const body = CHART_ROWS.map((r) => {
    const sep = r.kind !== prevKind ? 'sep' : '';
    prevKind = r.kind;
    const rowCur = cur && cur.key === r.key;
    const cells = UPS.map((u) => {
      const code = chartCode(chart, r.kind, r.n, u);
      let mark = '';
      let changed = false;
      if (withDev) {
        const d = DEVIATIONS.find((x) => devKey(x) === r.key && x.up === u);
        if (d) {
          changed = (tc >= d.index ? d.yes : d.no) !== code;
          mark = `<sup>${fmtIndex(d.index)}</sup>`;
        }
      }
      const isCur = rowCur && cur.up === u;
      return `<td class="${code} ${changed ? 'changed' : ''} ${isCur ? 'cur' : ''}">${CELL_TEXT[code]}${mark}</td>`;
    }).join('');
    return `<tr class="${sep}"><th class="${rowCur ? 'cur' : ''}">${r.label}</th>${cells}</tr>`;
  }).join('');
  return `<table class="strategy"><thead>${head}</thead><tbody>${body}</tbody></table>`;
}

function renderCharts() {
  if (!$('simplePanel').classList.contains('hidden')) $('simpleChart').innerHTML = chartHTML(SIMPLE, false);
  if (!$('generalPanel').classList.contains('hidden')) $('generalChart').innerHTML = chartHTML(GENERAL, true);
}

function renderDeviations() {
  if ($('devPanel').classList.contains('hidden')) return;
  const tc = trueCount();
  $('devTc').textContent = (tc > 0 ? '+' : '') + tc.toFixed(1);
  const sorted = [...DEVIATIONS].sort((a, b) => b.index - a.index || devLabel(a).localeCompare(devLabel(b)));
  const above = sorted.filter((d) => d.index > tc);
  const nextUp = above.length ? above[above.length - 1].index : null;
  const below = sorted.filter((d) => d.index <= tc);
  const nextDown = below.length ? below[0].index : null;
  const cur = currentCell();
  const items = [];
  let dividerDone = false;
  for (const d of sorted) {
    if (!dividerDone && d.index <= tc) {
      items.push(`<li class="now">現在 TC ${(tc > 0 ? '+' : '') + tc.toFixed(1)}</li>`);
      dividerDone = true;
    }
    const kind = d.pair ? 'pair' : 'hard';
    const table = chartCode(GENERAL, kind, d.pair || d.hard, d.up);
    const now = tc >= d.index ? d.yes : d.no;
    const tag = d.index === nextUp ? '<b class="up">▲</b>' : d.index === nextDown ? '<b class="down">▼</b>' : '';
    const here = cur && cur.key === devKey(d) && cur.up === d.up;
    const yesOn = tc >= d.index;
    items.push(`<li class="${here ? 'here' : ''}">
      <span class="idx">${fmtIndex(d.index)}</span>
      <span class="what">${tag}${devLabel(d)} vs ${upLabel(d.up)}${now !== table ? '<span class="diff">表と違う</span>' : ''}</span>
      <span class="rule"><span class="badge ${d.yes} ${yesOn ? '' : 'off'}" title="${fmtIndex(d.index)} 以上">${ACTION_NAMES[d.yes]}</span><span class="badge ${d.no} ${yesOn ? 'off' : ''}" title="${fmtIndex(d.index)} 未満">${ACTION_NAMES[d.no]}</span></span>
    </li>`);
  }
  if (!dividerDone) items.push(`<li class="now">現在 TC ${(tc > 0 ? '+' : '') + tc.toFixed(1)}</li>`);
  $('devList').innerHTML = items.join('');
}

// ---------- イベント ----------

$('chips').addEventListener('click', (e) => {
  const b = e.target.closest('[data-chip]');
  if (!b || b.disabled || state.phase !== 'bet') return;
  state.bet = Number(b.dataset.chip);
  render();
});
$('dealBtn').addEventListener('click', deal);
$('resetBtn').addEventListener('click', resetGame);
$('actionPanel').addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]');
  if (b && !b.disabled) act(b.dataset.act);
});
$('clearStats').addEventListener('click', () => {
  state.stats = Object.fromEntries(METHODS.map((m) => [m.key, { ok: 0, n: 0 }]));
  save('bj-stats', state.stats);
  renderStats();
});

function bindToggle(id, panelId, key) {
  const input = $(id);
  input.checked = load(key, false);
  const apply = () => {
    $(panelId).classList.toggle('hidden', !input.checked);
    save(key, input.checked);
    renderCharts();
    renderDeviations();
  };
  input.addEventListener('change', apply);
  apply();
}
bindToggle('toggleCards', 'cardsPanel', 'bj-show-cards');
bindToggle('toggleCount', 'countPanel', 'bj-show-count');
bindToggle('toggleDev', 'devPanel', 'bj-show-dev');
bindToggle('toggleSimple', 'simplePanel', 'bj-show-simple');
bindToggle('toggleGeneral', 'generalPanel', 'bj-show-general');

document.addEventListener('keydown', (e) => {
  if (e.target.closest('input, textarea')) return;
  const k = e.key.toLowerCase();
  if (state.phase === 'bet' && (k === 'enter' || k === ' ')) { e.preventDefault(); deal(); return; }
  const map = { h: 'H', s: 'S', d: 'D', p: 'P' };
  if (map[k]) act(map[k]);
});

newShoe();
render();
