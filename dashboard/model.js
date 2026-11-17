/* Prelaunch Radar: the value model, its blind test and the farm planner.
 * ONE file, run twice: main.ts runs it on the sealed snapshot to write board.json, and the page runs it
 * again in the browser on the same rows (snapshot-data.js). Nothing here names a protocol: every figure
 * comes from the snapshot's ten fields. Reading order: splitUniverse -> tokenFamilies -> fitOn ->
 * backtest -> rankRanges -> scoreProtocol -> farmPlan -> buildRadar. */
(function (root) {
  'use strict';

  // ----1. who still has a token to come
  const PRODUCT_CATEGORIES = ['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX'];
  const VERSION_MARK = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
  const PRODUCT_WORD = /\b(wrapped|staked|staking)\b/i;
  const EXCHANGE = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)/;
  const GENERIC = /^(the|defi|open|liquid|stable|yield|token|super|meta|usd.*|[a-z]{1,3})$/;

  const recordsNoToken = (p) => p.gecko_id == null && p.symbol == null;
  const firstWord = (name) => String(name).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)[0] || '';

  /** Why a token-less record is a product of something that already trades, or null when it is not. */
  function productReason(p) {
    if (p.category === 'CEX') return 'an exchange: its TVL is customer deposits, not a protocol awaiting a launch';
    if (PRODUCT_CATEGORIES.includes(p.category)) return p.category + ' product: it wraps an asset that already trades';
    if (VERSION_MARK.test(p.name)) return 'a later version of a protocol on record';
    if (PRODUCT_WORD.test(p.name)) return 'a wrapped or staked product by name';
    if (EXCHANGE.test(p.name)) return 'an exchange product';
    return null;
  }

  /** Three classes: trading (token on record), aside (token-less product), candidates (own launch still to come). */
  function splitUniverse(snapshot) {
    const watch = new Set(snapshot.watchlist), trading = [], aside = [], candidates = [], kin = {};
    for (const p of snapshot.protocols) {
      if (!recordsNoToken(p)) {
        trading.push(p);
        const w = firstWord(p.name);
        if (!GENERIC.test(w) && !kin[w]) kin[w] = p;
      } else {
        const why = watch.has(p.slug) ? null : productReason(p);
        if (why) aside.push({ p, why }); else candidates.push(p);
      }
    }
    return { watch, trading, aside, candidates, kin };
  }

  // ----2. the peers: one point per token
  const log10 = (x) => Math.log(x) / Math.LN10;
  const tanh = (v) => { const e = Math.exp(2 * v); return (e - 1) / (e + 1); };
  const days = (from, to) => Math.round((Date.parse(to) - Date.parse(from)) / 864e5);
  function median(v) {
    if (!v.length) return 0;
    const s = v.slice().sort((a, b) => a - b), m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }
  const quantile = (sorted, q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];

  /** What the model reads off any protocol or family: size, damped 7-day growth, seasoning (0 new, toward 1 old), chains. */
  function features(tvl, change7d, listed, chains, asOf) {
    return { t: log10(tvl), g: change7d == null ? null : tanh(change7d / 20), s: listed ? 1 - Math.exp(-Math.max(days(listed, asOf), 0) / 365) : null, c: Math.log2(Math.max(chains, 1)) };
  }

  /** A token's market cap belongs to the token, not to each product that carries it: Aave V2 and V3 are one point.
   *  So the trading protocols are grouped by ticker: TVL summed, market cap taken once, the largest member leading. */
  function tokenFamilies(trading, asOf) {
    const by = {};
    for (const p of trading) {
      const key = String(p.symbol || p.gecko_id).toUpperCase();
      const f = by[key] || (by[key] = { key, name: p.name, category: p.category, tvl: 0, mcap: 0, members: 0, lead: 0, listed: null });
      f.tvl += p.tvl_usd; f.members++; f.mcap = Math.max(f.mcap, p.mcap_usd || 0);
      if (p.tvl_usd > f.lead) Object.assign(f, { lead: p.tvl_usd, name: p.name, category: p.category, change: p.change_7d, chains: p.chains.length });
      if (p.listed_at && (!f.listed || p.listed_at < f.listed)) f.listed = p.listed_at;
    }
    return Object.keys(by).sort().map((k) => by[k]).filter((f) => f.mcap > 0)
      .map((f) => Object.assign(f, { x: features(f.tvl, f.change, f.listed, f.chains, asOf), y: log10(f.mcap) }));
  }

  // ----3. the fit
  /** What a designer would assume before seeing the peers, in log10 units per unit of the feature, with its width:
   *  growth +25% at the top, seasoning x1.43 from new to old, +4% a doubling of chains. The peers then move it. */
  const PRIORS = { g: [0.097, 0.1], s: [0.155, 0.15], c: [0.017, 0.02] };

  /** Size curve: log10(mcap) = a + b*log10(TVL), by Theil-Sen (median of pairwise slopes; no outlier can steer it).
   *  Category: median residual, clamped to one sigma and shrunk by n/(n+3). Then each of growth, seasoning and
   *  breadth gets a slope on what is left, blended with its prior by precision (a posterior, not a guess). */
  function fitOn(peers) {
    const slopes = [];
    for (let i = 0; i < peers.length; i++) for (let j = i + 1; j < peers.length; j++) if (peers[i].x.t !== peers[j].x.t) slopes.push((peers[j].y - peers[i].y) / (peers[j].x.t - peers[i].x.t));
    const b = median(slopes), a = median(peers.map((p) => p.y - b * p.x.t));
    const res = peers.map((p) => p.y - a - b * p.x.t), sigma = 1.4826 * median(res.map(Math.abs));
    const groups = {}, offsets = {};
    peers.forEach((p, i) => (groups[p.category] = groups[p.category] || []).push(res[i]));
    for (const c of Object.keys(groups)) {
      const n = groups[c].length, raw = Math.max(-sigma, Math.min(sigma, median(groups[c])));
      offsets[c] = { n, raw, off: raw * n / (n + 3) };
    }
    const left = peers.map((p, i) => res[i] - offsets[p.category].off), coef = {};
    for (const k of Object.keys(PRIORS)) {
      const pts = peers.map((p, i) => [p.x[k], left[i]]).filter((q) => q[0] != null), n = pts.length;
      const mx = pts.reduce((s, q) => s + q[0], 0) / n, my = pts.reduce((s, q) => s + q[1], 0) / n;
      const sxx = pts.reduce((s, q) => s + (q[0] - mx) ** 2, 0), fit = pts.reduce((s, q) => s + (q[0] - mx) * (q[1] - my), 0) / sxx;
      const se = Math.sqrt(pts.reduce((s, q) => s + (q[1] - my - fit * (q[0] - mx)) ** 2, 0) / (n - 2) / sxx);
      const [prior, tau] = PRIORS[k], w = 1 / (se * se), w0 = 1 / (tau * tau);
      coef[k] = { n, mean: mx, prior, fit, se, post: (prior * w0 + fit * w) / (w0 + w) };
    }
    const part = (k, x) => x[k] == null ? 0 : coef[k].post * (x[k] - coef[k].mean);
    const predict = (x, category) => a + b * x.t + (offsets[category] ? offsets[category].off : 0) + part('g', x) + part('s', x) + part('c', x);
    return { a, b, sigma, offsets, coef, n: peers.length, peers, part, predict };
  }

  /** The test: every family priced by a model that never saw it (leave-one-out), and the newer half priced by a
   *  model fitted on the older half only. The rows' bands are the middle half of the leave-one-out misses. */
  function backtest(peers) {
    const errs = peers.map((p, i) => p.y - fitOn(peers.filter((_, j) => j !== i)).predict(p.x, p.category));
    const sorted = errs.slice().sort((x, y) => x - y), abs = errs.map(Math.abs);
    const dated = peers.filter((p) => p.listed).sort((p, q) => (p.listed < q.listed ? -1 : 1)), half = dated.length >> 1;
    const old = fitOn(dated.slice(0, half)), fresh = dated.slice(half);
    return {
      n: peers.length, errs, miss: 10 ** median(abs), q25: quantile(sorted, 0.25), q75: quantile(sorted, 0.75),
      within3: abs.filter((e) => e <= log10(3)).length / abs.length,
      split: { train: half, test: fresh.length, cut: dated[half].listed, miss: 10 ** median(fresh.map((p) => Math.abs(p.y - old.predict(p.x, p.category)))) }
    };
  }

  /** How firm each rank is: 200 refits on peers drawn again with replacement (seeded, so every run agrees), and the
   *  5th to 95th percentile of the rank each row lands on. A wide range says the order there is not to be trusted. */
  function rankRanges(peers, rows) {
    let seed = 20261114;
    const draw = () => peers[Math.floor((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296 * peers.length)];
    const seen = rows.map(() => []);
    for (let k = 0; k < 200; k++) {
      const fit = fitOn(peers.map(draw)), v = rows.map((r) => fit.predict(r.x, r.peerCategory) + log10(r.haircut));
      v.map((_, i) => i).sort((i, j) => v[j] - v[i]).forEach((i, at) => seen[i].push(at + 1));
    }
    rows.forEach((r, i) => { const s = seen[i].sort((a, b) => a - b); r.rankLo = s[10]; r.rankHi = s[189]; });
  }

  // ----4. the implied value of one protocol
  const AIRDROP_SHARE = 0.07;   // share of launch value assumed to reach farmers; the page lets the reader move it
  const KIN_HAIRCUT = 0.4;      // shares a name with a protocol whose token trades: the token may already exist
  const PARENT_HAIRCUT = 0.55;  // at or over the floor yet off the watchlist: only the parent rule can explain it

  function scoreProtocol(p, fit, test, uni, snapshot) {
    const x = features(p.tvl_usd, p.change_7d, p.listed_at, p.chains.length, snapshot.as_of);
    const age = p.listed_at ? days(p.listed_at, snapshot.as_of) : null;
    const cat = fit.offsets[p.category] || { n: 0, off: 0 };
    const onWatch = uni.watch.has(p.slug), overFloor = p.tvl_usd >= snapshot.floor_usd;
    const kin = uni.kin[firstWord(p.name)] || null, flags = [];
    let haircut = 1;
    if (kin) { haircut = KIN_HAIRCUT; flags.push('Shares a name with ' + kin.name + ' (' + (kin.symbol || kin.gecko_id) + ' trades): its token may already exist'); }
    else if (overFloor && !onWatch) { haircut = PARENT_HAIRCUT; flags.push('Over the floor but off the watchlist: DefiLlama records a parent protocol, so the token may launch at the parent'); }
    if (p.change_7d != null && p.change_7d <= -10) flags.push('TVL fell ' + (-p.change_7d).toFixed(1) + '% in 7 days: capital is leaving');
    if (age != null && age < 90) flags.push('Tracked for only ' + age + ' days: contracts are young');
    if (age == null) flags.push('No listing date on record: tenure unknown, so the seasoning step is neutral');
    if (p.chains.length === 1) flags.push('Single chain (' + p.chains[0] + '): no fallback venue');
    const curve = 10 ** (fit.a + fit.b * x.t), catMult = 10 ** cat.off;
    const growth = 10 ** fit.part('g', x), tenure = 10 ** fit.part('s', x), breadth = 10 ** fit.part('c', x);
    const value = Math.max(1, Math.round(10 ** fit.predict(x, p.category) * haircut));
    // Confidence: 20 base, up to 40 for same-category peers, 10 each for a growth figure and a listing date, up to 20 for tenure.
    const conf = Math.round(20 + 40 * cat.n / (cat.n + 4) + (x.g == null ? 0 : 10) + (x.s == null ? 0 : 10 + 20 * x.s) - (haircut < 1 ? 15 : 0));
    return {
      slug: p.slug, name: p.name, category: p.category || 'Uncategorised', chains: p.chains, tvl: p.tvl_usd, change7d: p.change_7d,
      listed: p.listed_at, days: age, cls: onWatch ? 'watch' : overFloor ? 'offlist' : 'early',
      curve: Math.round(curve), catN: cat.n, catMult, growth, tenure, breadth, haircut, x, peerCategory: p.category,
      value, lo: Math.round(value * 10 ** test.q25), hi: Math.round(value * 10 ** test.q75), multiple: value / p.tvl_usd,
      perK: value * AIRDROP_SHARE * 1000 / p.tvl_usd, conf, grade: conf >= 75 ? 'A' : conf >= 58 ? 'B' : 'C', flags
    };
  }

  // ----5. the farm plan
  /** Typical cost of one transaction in USD, by chain. An assumption table about chains, not protocols. */
  const GAS_USD = { Ethereum: 4, Bitcoin: 2.5, Tron: 1.5, Binance: 0.15, Avalanche: 0.08, Solana: 0.01, Polygon: 0.02 };
  const gasOf = (chain) => GAS_USD[chain] != null ? GAS_USD[chain] : 0.05;
  const WEEKS = 12, CASH_YIELD = 0.045, EARNS = /lend|rwa|stable|stake|vault/;

  /** What a farmer actually does, by the kind of protocol. Matched on the category's words. */
  const ARCHETYPES = [
    { key: 'lend', re: /lend|collateral/i, asset: 'USDC', core: 'Supply {size} of USDC to the main market', depth: 'Borrow 25% of it back in a stablecoin (health factor above 2.0) and re-supply: borrowers are counted apart from suppliers', weekly: 'one repay-and-reborrow', txs: 2 },
    { key: 'perps', re: /deriv|option|prediction|perp/i, asset: 'USDC', core: 'Deposit {size} of USDC as margin', depth: 'Open a 2x position of about {half} on the most liquid market and close it the same day: volume counts, not profit', weekly: 'two round-trip trades of about {half} each', txs: 4 },
    { key: 'dex', re: /dex|otc|marketplace|launchpad/i, asset: 'USDC', core: 'Swap {half} of USDC into the deepest pair and back', depth: 'Add the other {half} as liquidity in a stable or blue-chip pool, and keep the LP position', weekly: 'two swaps of about {tenth}', txs: 2 },
    { key: 'rwa', re: /rwa/i, asset: 'USDC', core: 'Pass the issuer onboarding (KYC where it asks), then mint {size} of its yield token with USDC', depth: 'Hold the token in your own wallet, not on an exchange: holders are read from the chain', weekly: 'a balance check, and one small top-up of {tenth} a month', txs: 1 },
    { key: 'stable', re: /basis|cdp|stable|synthetic|reserve/i, asset: 'USDC', core: 'Mint or buy {size} of its dollar token with USDC', depth: 'Stake half of it in the protocol\'s own savings vault and keep half liquid: both balances are usually counted', weekly: 'one stake or unstake of about {tenth}', txs: 2 },
    { key: 'stake', re: /staking|restak|btc|governance|insurance/i, asset: 'the chain\'s staking asset', core: 'Deposit {size} of the asset it accepts', depth: 'Delegate or allocate the receipt inside the protocol (an operator, a vault or a vote) instead of leaving it idle', weekly: 'one re-delegation or vote', txs: 1 },
    { key: 'vault', re: /curator|allocator|yield|farm|liquidity|index|cedefi|vault/i, asset: 'USDC', core: 'Deposit {size} of USDC into its largest vault', depth: 'Split a further {tenth} into a second vault of the same curator: breadth is the cheapest multiplier', weekly: 'one top-up of about {tenth}', txs: 1 },
    { key: 'infra', re: /./, asset: 'its native asset', core: 'Move {size} onto it through its own official route', depth: 'Use two apps built on it (a swap and a deposit) so the wallet shows real use, not a single transfer', weekly: 'two transactions on it', txs: 2 }
  ];
  const archetypeOf = (category) => ARCHETYPES.find((a) => a.re.test(category || ''));
  function usd(n) {
    const a = Math.abs(n), s = n < 0 ? '-$' : '$';
    if (a >= 1e9) return s + (a / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return s + (a / 1e6).toFixed(a >= 1e8 ? 0 : 1) + 'M';
    if (a >= 1e4) return s + Math.round(a / 1e3) + 'K';
    if (a >= 100) return s + String(Math.round(a)).replace(/\B(?=(\d{3})+$)/g, ',');
    return s + (a >= 10 ? a.toFixed(0) : a.toFixed(2));
  }
  /** Capital to commit: $1,000 by default, halved for young or shrinking protocols, raised for large seasoned ones. */
  function suggestedSize(r) {
    if ((r.days != null && r.days < 90) || (r.change7d != null && r.change7d <= -10) || r.tvl < 2e7) return 500;
    return r.tvl >= 5e8 && r.days != null && r.days >= 365 ? 2500 : 1000;
  }
  /** The cheapest other chain to repeat on, or null when it runs on one. */
  const secondChain = (chains) => chains.slice(1).reduce((best, c) => (best == null || gasOf(c) < gasOf(best) ? c : best), null);
  /** Farm: the drop is 3x the cost AND still covers it at the band's low end. Marginal: it covers the cost. Else Skip. */
  const verdictOf = (edge, lowEdge) => (edge >= 3 && lowEdge >= 1 ? 'Farm' : edge >= 1 ? 'Marginal' : 'Skip');

  /** The plan for one scored row: dated steps with a cost and a time each, then the totals netted against the drop. */
  function farmPlan(r, capital) {
    const A = archetypeOf(r.category), chain = r.chains[0] || 'its chain', gas = gasOf(chain), size = capital || suggestedSize(r);
    const fill = (s) => s.replace('{size}', usd(size)).replace('{half}', usd(size / 2)).replace('{tenth}', usd(size / 10));
    const steps = [], add = (when, what, cost, min, note) => steps.push({ when, what, cost, min, note });
    const bridge = chain === 'Ethereum' ? 0 : 3, second = secondChain(r.chains);
    add('Day 1', 'Fund a fresh wallet on ' + chain + ' with ' + usd(size) + ' of ' + A.asset + ' and ' + usd(Math.max(gas * 40, 2)) + ' for gas' + (bridge ? ', bridged in from an exchange or Ethereum' : ''), gas + bridge, bridge ? 25 : 15, 'one transfer' + (bridge ? ' and a bridge fee' : ''));
    add('Day 1', fill(A.core) + ' on ' + r.name + ', on ' + chain, gas * 2, 15, 'an approval and a deposit');
    add('Day 2', fill(A.depth), gas * A.txs, 20, A.txs + ' transaction' + (A.txs > 1 ? 's' : ''));
    if (r.change7d != null && r.change7d <= -10) add('Day 8', 'TVL fell ' + (-r.change7d).toFixed(1) + '% this week, so the plan starts at half size: add the rest only once a week closes flat or up', gas, 5, 'a check of the TVL chart, then one deposit');
    else if (r.days != null && r.days < 90) add('Day 2', 'It has been tracked for only ' + r.days + ' days: read the audit page, and cap the position at ' + usd(size) + ' until it has run 90 days', 0, 20, 'reading, no transaction');
    if (second) add('Week 2', 'Repeat the first deposit at ' + usd(size / 4) + ' on ' + second + ', the cheapest of its other ' + (r.chains.length - 1) + ' chain' + (r.chains.length > 2 ? 's' : '') + ': a second chain is a separate snapshot', gasOf(second) * 2 + 3, 25, 'a bridge and a deposit');
    add('Weeks 2-' + WEEKS, 'Each week make ' + fill(A.weekly) + ', on a different weekday each time: steady wallets outrank one-day bursts', gas * A.txs * (WEEKS - 1), 10 * (WEEKS - 1), (WEEKS - 1) * A.txs + ' transactions, 10 minutes a week');
    add('Monthly', 'Check the 7-day TVL change (' + (r.change7d == null ? 'none on record yet' : (r.change7d >= 0 ? '+' : '') + r.change7d.toFixed(1) + '% now') + '): under -20%, withdraw half the same day', 0, 15, 'three checks of 5 minutes');
    add('Week ' + WEEKS, 'Log every transaction hash, watch only the protocol\'s own site for a points or claim page, never pay or sign a "claim fee", and withdraw if nothing is announced', gas * 2, 15, 'the withdrawal');
    const gasTotal = steps.reduce((s, x) => s + x.cost, 0), minutes = steps.reduce((s, x) => s + x.min, 0);
    // Idle capital costs the cash yield it gives up; a deposit that earns its own yield (EARNS) gives up nothing.
    const carry = EARNS.test(A.key) ? 0 : size * CASH_YIELD * WEEKS / 52, cost = gasTotal + carry;
    const drop = r.perK * size / 1000, low = drop * r.lo / r.value;
    return {
      archetype: A.key, chain, size, steps, gas: gasTotal, carry, cost, hours: minutes / 60, weeks: WEEKS,
      drop, low, net: drop - cost, edge: drop / cost, lowEdge: low / cost, verdict: verdictOf(drop / cost, low / cost),
      breakEven: r.value * cost / drop, // the launch value at which the drop only just pays for the plan
      text: steps.map((x) => x.when + ': ' + x.what + '. Cost: ' + (x.cost > 0 ? 'about ' + usd(x.cost) + ' (' + x.note + ')' : 'nothing (' + x.note + ')') + '. Time: ' + (x.min >= 60 ? (x.min / 60).toFixed(1) + ' hours in all' : x.min + ' minutes') + '.')
    };
  }

  // ----6. the whole radar
  /** Rank every candidate by implied value; rank 1 is the largest. Ties break on TVL, then slug. */
  function buildRadar(snapshot) {
    const uni = splitUniverse(snapshot), peers = tokenFamilies(uni.trading, snapshot.as_of), fit = fitOn(peers), test = backtest(peers);
    const rows = uni.candidates.map((p) => scoreProtocol(p, fit, test, uni, snapshot));
    rows.sort((x, y) => y.value - x.value || y.tvl - x.tvl || (x.slug < y.slug ? -1 : 1));
    rows.forEach((r, i) => { r.rank = i + 1; r.plan = farmPlan(r); });
    rankRanges(peers, rows);
    return { fit, test, rows, trading: uni.trading, aside: uni.aside, as_of: snapshot.as_of, source: snapshot.source, floor: snapshot.floor_usd, total: snapshot.protocols.length, watchlist: snapshot.watchlist };
  }
  /** board.json's rows, as the gate reads them. */
  function boardRows(radar) {
    const cents = (v) => Math.round(v * 100) / 100;
    return radar.rows.map((r) => ({
      slug: r.slug, name: r.name, rank: r.rank, implied_value_usd: r.value, farm_steps: r.plan.text, tvl_usd: r.tvl, class: r.cls, confidence: r.grade,
      rank_range_90: [r.rankLo, r.rankHi], break_even_value_usd: Math.round(r.plan.breakEven),
      value_low_usd: r.lo, value_high_usd: r.hi, est_drop_per_1k_usd: cents(r.perK), plan_capital_usd: r.plan.size, plan_cost_usd: cents(r.plan.cost),
      plan_net_usd: cents(r.plan.net), plan_hours: Math.round(r.plan.hours * 10) / 10, verdict: r.plan.verdict
    }));
  }

  root.RadarModel = { buildRadar, boardRows, splitUniverse, tokenFamilies, fitOn, backtest, scoreProtocol, farmPlan, archetypeOf, verdictOf, gasOf, suggestedSize, productReason, features, usd, median, PRIORS, AIRDROP_SHARE, GAS_USD, WEEKS };
})(typeof globalThis !== 'undefined' ? globalThis : this);
