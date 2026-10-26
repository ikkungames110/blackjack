// 戦略表・Hi-Lo・確率計算エンジン
// カードの値: 1 = A, 2..9, 10 = 10/J/Q/K
// アクション: 'H' ヒット, 'S' スタンド, 'D' ダブル, 'P' スプリット

export const ACTION_NAMES = { H: 'ヒット', S: 'スタンド', D: 'ダブル', P: 'スプリット' };

export function hiLo(v) {
  if (v >= 2 && v <= 6) return 1;
  if (v === 1 || v === 10) return -1;
  return 0;
}

export function handInfo(values) {
  let total = 0;
  let hasAce = false;
  for (const v of values) {
    total += v;
    if (v === 1) hasAce = true;
  }
  const soft = hasAce && total + 10 <= 21;
  return { hard: total, best: soft ? total + 10 : total, soft };
}

// 列: ディーラーのアップカード 2,3,4,5,6,7,8,9,10,A
export const col = (up) => (up === 1 ? 9 : up - 2);

// 表の行キー（h=ハード, s=ソフト, p=ペア）。表にない手は null
export function chartRowKey(values, canSplit) {
  if (values.length === 2 && values[0] === values[1] && canSplit) return `p${values[0]}`;
  const info = handInfo(values);
  if (info.soft) return info.best >= 13 && info.best <= 20 ? `s${info.best}` : null;
  if (info.best <= 8) return 'h8';
  if (info.best <= 16) return `h${info.best}`;
  return info.best <= 20 ? 'h17' : null;
}

// ---- 簡易版最適戦略 ----
export const SIMPLE = {
  hard(t) {
    if (t <= 9) return 'HHHHHHHHHH';
    if (t <= 11) return 'DDDDDDDDDD';
    if (t <= 16) return 'SSSSSHHHHH';
    return 'SSSSSSSSSS';
  },
  soft(t) {
    if (t <= 12) return 'HHHHHHHHHH';
    if (t <= 18) return 'DDDDDHHHHH';
    return 'SSSSSSSSSS';
  },
  pair(v) {
    return {
      1: 'PPPPPPPPPP', 2: 'PPPPPHHHHH', 3: 'PPPPPHHHHH', 4: 'PPPPPHHHHH', 5: 'DDDDDDDDDD',
      6: 'PPPPPHHHHH', 7: 'PPPPPHHHHH', 8: 'PPPPPPPPPP', 9: 'PPPPPPPPPP', 10: 'SSSSSSSSSS',
    }[v];
  },
};

// ---- 一般の最適戦略 ----
export const GENERAL = {
  hard(t) {
    if (t <= 8) return 'HHHHHHHHHH';
    if (t === 9) return 'HDDDDHHHHH';
    if (t === 10) return 'DDDDDDDDHH';
    if (t === 11) return 'DDDDDDDDDD';
    if (t === 12) return 'HHSSSHHHHH';
    if (t <= 16) return 'SSSSSHHHHH';
    return 'SSSSSSSSSS';
  },
  soft(t) {
    if (t <= 12) return 'HHHHHHHHHH';
    if (t <= 17) return 'HHDDDHHHHH';
    if (t === 18) return 'SDDDDSSHHH';
    return 'SSSSSSSSSS';
  },
  pair(v) {
    return {
      1: 'PPPPPPPPPP', 2: 'HHPPPPHHHH', 3: 'HHPPPPHHHH', 4: 'HHHHHHHHHH', 5: 'DDDDDHHHHH',
      6: 'PPPPPHHHHH', 7: 'PPPPPPHHHH', 8: 'PPPPPPPPPP', 9: 'PPPPPSPPSS', 10: 'SSSSSSSSSS',
    }[v];
  },
};

// Illustrious 18（保険を除く 17 項目、マルチデッキ・S17）
// tc >= index なら yes、未満なら no
export const DEVIATIONS = [
  { hard: 16, up: 10, index: 0, yes: 'S', no: 'H' },
  { hard: 15, up: 10, index: 4, yes: 'S', no: 'H' },
  { pair: 10, up: 5, index: 5, yes: 'P', no: 'S' },
  { pair: 10, up: 6, index: 4, yes: 'P', no: 'S' },
  { hard: 10, up: 10, index: 4, yes: 'D', no: 'H' },
  { hard: 12, up: 3, index: 2, yes: 'S', no: 'H' },
  { hard: 12, up: 2, index: 3, yes: 'S', no: 'H' },
  { hard: 11, up: 1, index: 1, yes: 'D', no: 'H' },
  { hard: 9, up: 2, index: 1, yes: 'D', no: 'H' },
  { hard: 10, up: 1, index: 4, yes: 'D', no: 'H' },
  { hard: 9, up: 7, index: 3, yes: 'D', no: 'H' },
  { hard: 16, up: 9, index: 5, yes: 'S', no: 'H' },
  { hard: 13, up: 2, index: -1, yes: 'S', no: 'H' },
  { hard: 12, up: 4, index: 0, yes: 'S', no: 'H' },
  { hard: 12, up: 5, index: -2, yes: 'S', no: 'H' },
  { hard: 12, up: 6, index: -1, yes: 'S', no: 'H' },
  { hard: 13, up: 3, index: -2, yes: 'S', no: 'H' },
];

// ダブル不可のときの代替（ソフト18はスタンド、それ以外はヒット）
function fallback(code, info, canDouble) {
  if (code === 'D' && !canDouble) return info.soft && info.best === 18 ? 'S' : 'H';
  return code;
}

function chartAction(chart, ctx) {
  const { values, up, canDouble, canSplit } = ctx;
  const info = handInfo(values);
  if (values.length === 2 && values[0] === values[1] && canSplit) {
    const code = chart.pair(values[0])[col(up)];
    if (code !== 'P') return { code: fallback(code, info, canDouble), info, isPair: false };
    return { code, info, isPair: true };
  }
  const row = info.soft ? chart.soft(info.best) : chart.hard(info.best);
  return { code: fallback(row[col(up)], info, canDouble), info, isPair: false };
}

export function simpleStrategy(ctx) {
  return chartAction(SIMPLE, ctx).code;
}

export function generalStrategy(ctx) {
  return chartAction(GENERAL, ctx).code;
}

// 戻り値: { code, deviation } deviation は適用した指数（なければ null）
export function countStrategy(ctx, tc) {
  const base = chartAction(GENERAL, ctx);
  const { values, up, canDouble, canSplit } = ctx;
  const isTenPair = values.length === 2 && values[0] === 10 && values[1] === 10 && canSplit;
  for (const d of DEVIATIONS) {
    if (d.up !== up) continue;
    if (d.pair) {
      if (!isTenPair) continue;
    } else {
      if (base.isPair || base.info.soft || base.info.best !== d.hard) continue;
      if (isTenPair) continue;
    }
    const raw = tc >= d.index ? d.yes : d.no;
    return { code: fallback(raw, base.info, canDouble), deviation: d };
  }
  return { code: base.code, deviation: null };
}

// ---- 完全暗記（残りカード構成）に基づく期待値計算 ----
// counts[1..10]: 未知のカード（ディーラーの伏せ札を含む）の枚数
// excl: ディーラーがピーク済みでブラックジャックでないとき、伏せ札があり得ない値（1 or 10）。なければ 0
// ディーラーはソフト17でスタンド。スプリットはダブル可・再スプリットなしで近似。

const KEY_W = [0];
for (let r = 1; r <= 10; r++) KEY_W.push(16 ** (r - 1));

export function computeEVs(ctx, baseCounts, excl) {
  const counts = baseCounts.slice();
  let N = 0;
  for (let r = 1; r <= 10; r++) N += counts[r];
  const up = ctx.up;
  const dealerCache = new Map(); // プレイヤーが引いたカードの組み合わせ -> ディーラー最終分布

  // 次の 1 枚の確率（伏せ札が excl でないという条件つき）
  function drawProb(r, n) {
    const p = counts[r] / n;
    if (!excl) return p;
    const nx = counts[excl];
    const nx2 = nx - (r === excl ? 1 : 0);
    return (p * (1 - nx2 / (n - 1))) / (1 - nx / n);
  }

  // ディーラー最終結果 [17,18,19,20,21,bust]
  function dealerDist(n) {
    const memo = new Map();
    function rec(hard, ace, m, key) {
      const best = ace && hard + 10 <= 21 ? hard + 10 : hard;
      if (hard > 21) return [0, 0, 0, 0, 0, 1];
      if (best >= 17) {
        const out = [0, 0, 0, 0, 0, 0];
        out[best - 17] = 1;
        return out;
      }
      const hit = memo.get(key);
      if (hit) return hit;
      const out = [0, 0, 0, 0, 0, 0];
      for (let r = 1; r <= 10; r++) {
        if (!counts[r]) continue;
        const p = counts[r] / m;
        counts[r]--;
        const sub = rec(hard + r, ace || r === 1, m - 1, key + KEY_W[r]);
        counts[r]++;
        for (let i = 0; i < 6; i++) out[i] += p * sub[i];
      }
      memo.set(key, out);
      return out;
    }
    // 伏せ札（excl を除いて正規化）
    const out = [0, 0, 0, 0, 0, 0];
    const denom = n - (excl ? counts[excl] : 0);
    for (let r = 1; r <= 10; r++) {
      if (!counts[r] || r === excl) continue;
      const p = counts[r] / denom;
      counts[r]--;
      const sub = rec(up + r, up === 1 || r === 1, n - 1, KEY_W[r]);
      counts[r]++;
      for (let i = 0; i < 6; i++) out[i] += p * sub[i];
    }
    return out;
  }

  function standEV(best, n, pkey) {
    let dist = dealerCache.get(pkey);
    if (!dist) {
      dist = dealerDist(n);
      dealerCache.set(pkey, dist);
    }
    let ev = dist[5];
    for (let i = 0; i < 5; i++) {
      const d = 17 + i;
      if (best > d) ev += dist[i];
      else if (best < d) ev -= dist[i];
    }
    return ev;
  }

  // ヒット/スタンドのみで最適に打ったときの期待値
  function playEV(hard, ace, n, pkey, memo) {
    const hit = memo.get(pkey);
    if (hit !== undefined) return hit;
    const best = ace && hard + 10 <= 21 ? hard + 10 : hard;
    const s = standEV(best, n, pkey);
    const h = best >= 21 ? -Infinity : hitEV(hard, ace, n, pkey, memo);
    const v = Math.max(s, h);
    memo.set(pkey, v);
    return v;
  }

  function hitEV(hard, ace, n, pkey, memo) {
    let ev = 0;
    for (let r = 1; r <= 10; r++) {
      if (!counts[r]) continue;
      const p = drawProb(r, n);
      if (hard + r > 21) {
        ev -= p;
        continue;
      }
      counts[r]--;
      ev += p * playEV(hard + r, ace || r === 1, n - 1, pkey + KEY_W[r], memo);
      counts[r]++;
    }
    return ev;
  }

  function doubleEV(hard, ace, n, pkey) {
    let ev = 0;
    for (let r = 1; r <= 10; r++) {
      if (!counts[r]) continue;
      const p = drawProb(r, n);
      if (hard + r > 21) {
        ev -= 2 * p;
        continue;
      }
      const h = hard + r;
      const a = ace || r === 1;
      const best = a && h + 10 <= 21 ? h + 10 : h;
      counts[r]--;
      ev += 2 * p * standEV(best, n - 1, pkey + KEY_W[r]);
      counts[r]++;
    }
    return ev;
  }

  const info = handInfo(ctx.values);
  const ace = ctx.values.includes(1);
  const evs = {};
  const memo = new Map();
  evs.S = standEV(info.best, N, 0);
  evs.H = info.best >= 21 ? -1 : hitEV(info.hard, ace, N, 0, memo);
  if (ctx.canDouble) evs.D = doubleEV(info.hard, ace, N, 0);
  if (ctx.canSplit) {
    const v = ctx.values[0];
    const splitMemo = new Map();
    let ev = 0;
    for (let r = 1; r <= 10; r++) {
      if (!counts[r]) continue;
      const p = drawProb(r, N);
      const h = v + r;
      const a = v === 1 || r === 1;
      const best = a && h + 10 <= 21 ? h + 10 : h;
      counts[r]--;
      const key = KEY_W[r];
      let hv;
      if (v === 1) {
        hv = standEV(best, N - 1, key);
      } else {
        hv = playEV(h, a, N - 1, key, splitMemo);
        if (ctx.canDoubleAfterSplit) hv = Math.max(hv, doubleEV(h, a, N - 1, key));
      }
      counts[r]++;
      ev += p * hv;
    }
    evs.P = 2 * ev;
  }
  let bestCode = 'S';
  for (const k of Object.keys(evs)) if (evs[k] > evs[bestCode]) bestCode = k;
  return { evs, best: bestCode };
}
