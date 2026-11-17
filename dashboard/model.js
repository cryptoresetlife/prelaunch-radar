/* Prelaunch Radar: the value model and the farm planner.
 * ONE file, run twice: main.ts runs it on the sealed snapshot to write board.json, and the page runs it
 * again in the browser on the same rows (snapshot-data.js). Nothing here names a protocol: every figure
 * comes from the snapshot's ten fields. Reading order: splitUniverse -> fitPeers -> scoreProtocol ->
 * farmPlan -> buildRadar. */
(function (root) {
  'use strict';

  // ---------------------------------------------------------------- 1. who still has a token to come
  var PRODUCT_CATEGORIES = ['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX'];
  var VERSION_MARK = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
  var PRODUCT_WORD = /\b(wrapped|staked|staking)\b/i;
  var EXCHANGE = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)/;
  var GENERIC = /^(the|defi|open|liquid|stable|yield|token|super|meta|usd.*|[a-z]{1,3})$/;

  function recordsNoToken(p) { return p.gecko_id == null && p.symbol == null; }

  /** Why a token-less record is a product of something that already trades, or null when it is not. */
  function productReason(p) {
    if (PRODUCT_CATEGORIES.indexOf(p.category) >= 0) return p.category + ' product: it wraps an asset that already trades';
    if (VERSION_MARK.test(p.name)) return 'a later version of a protocol on record';
    if (PRODUCT_WORD.test(p.name)) return 'a wrapped or staked product by name';
    if (EXCHANGE.test(p.name)) return 'an exchange product';
    return null;
  }

  function firstWord(name) { return String(name).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)[0] || ''; }

  /** Three classes: trading (token on record), aside (token-less product), candidates (own launch still to come). */
  function splitUniverse(snapshot) {
    var watch = {}, trading = [], aside = [], candidates = [], family = {};
    snapshot.watchlist.forEach(function (s) { watch[s] = true; });
    snapshot.protocols.forEach(function (p) {
      if (!recordsNoToken(p)) {
        trading.push(p);
        var w = firstWord(p.name);
        if (!GENERIC.test(w) && !family[w]) family[w] = p;
      }
    });
    snapshot.protocols.forEach(function (p) {
      if (!recordsNoToken(p)) return;
      var why = watch[p.slug] ? null : productReason(p);
      if (why) aside.push({ p: p, why: why }); else candidates.push(p);
    });
    return { watch: watch, trading: trading, aside: aside, candidates: candidates, family: family };
  }

  // ---------------------------------------------------------------- 2. the peer curve
  function median(v) {
    if (!v.length) return 0;
    var s = v.slice().sort(function (a, b) { return a - b; }), m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }
  function log10(x) { return Math.log(x) / Math.LN10; }

  /** Fit log10(mcap) = a + b*log10(TVL) on every protocol whose token trades with a market cap on record.
   *  Theil-Sen (median of pairwise slopes), because sub-products carry their parent's whole market cap and
   *  would drag a least-squares line. Each category then gets a median residual, shrunk toward 0 by n/(n+3). */
  function fitPeers(trading) {
    var peers = trading.filter(function (p) { return p.mcap_usd > 0 && p.tvl_usd > 0; });
    var x = peers.map(function (p) { return log10(p.tvl_usd); }), y = peers.map(function (p) { return log10(p.mcap_usd); });
    var slopes = [], i, j;
    for (i = 0; i < x.length; i++) for (j = i + 1; j < x.length; j++) if (x[i] !== x[j]) slopes.push((y[j] - y[i]) / (x[j] - x[i]));
    var b = median(slopes);
    var a = median(y.map(function (v, k) { return v - b * x[k]; }));
    var res = y.map(function (v, k) { return v - a - b * x[k]; });
    var sigma = 1.4826 * median(res.map(Math.abs));
    var byCat = {};
    peers.forEach(function (p, k) { (byCat[p.category] = byCat[p.category] || []).push(res[k]); });
    var offsets = {};
    Object.keys(byCat).forEach(function (c) {
      var n = byCat[c].length, raw = Math.max(-sigma, Math.min(sigma, median(byCat[c]))); // one loud peer cannot set a category
      offsets[c] = { n: n, raw: raw, off: raw * n / (n + 3) };
    });
    return { a: a, b: b, sigma: sigma, n: peers.length, offsets: offsets, peers: peers };
  }

  // ---------------------------------------------------------------- 3. the implied value of one protocol
  var AIRDROP_SHARE = 0.07;   // share of launch value assumed to reach farmers; the page lets the reader move it
  var KIN_HAIRCUT = 0.4;      // shares a name with a protocol whose token trades: the token may already exist
  var PARENT_HAIRCUT = 0.55;  // at or over the floor yet off the watchlist: only the parent rule can explain it

  function daysBetween(from, to) { return Math.round((Date.parse(to) - Date.parse(from)) / 864e5); }
  /** Seven-day TVL growth, damped: +-20% moves the value about +-19%, never past +-25%. */
  function growthFactor(change7d) { return change7d == null ? 1 : 1 + 0.25 * tanh(change7d / 20); }
  /** How long it has run with no token: TVL that stayed unpaid is sticky. 0.70 on day one, 0.89 at a year, toward 1. */
  function tenureFactor(days) { return days == null ? 0.85 : 0.7 + 0.3 * (1 - Math.exp(-Math.max(days, 0) / 365)); }
  /** Chains deployed: each doubling adds 4%, capped at +15%. */
  function breadthFactor(chains) { return Math.min(1.15, 1 + 0.04 * Math.log(Math.max(chains, 1)) / Math.LN2); }
  function tanh(v) { var e = Math.exp(2 * v); return (e - 1) / (e + 1); }

  function scoreProtocol(p, fit, uni, snapshot) {
    var days = p.listed_at ? daysBetween(p.listed_at, snapshot.as_of) : null;
    var cat = fit.offsets[p.category] || { n: 0, raw: 0, off: 0 };
    var curve = Math.pow(10, fit.a + fit.b * log10(p.tvl_usd));
    var catMult = Math.pow(10, cat.off);
    var g = growthFactor(p.change_7d), t = tenureFactor(days), c = breadthFactor(p.chains.length);
    var onWatch = !!uni.watch[p.slug], overFloor = p.tvl_usd >= snapshot.floor_usd;
    var kin = uni.family[firstWord(p.name)] || null, k = 1, flags = [];
    if (kin) { k = KIN_HAIRCUT; flags.push('Shares a name with ' + kin.name + ' (' + (kin.symbol || kin.gecko_id) + ' trades): its token may already exist'); }
    else if (overFloor && !onWatch) { k = PARENT_HAIRCUT; flags.push('Over the floor but off the watchlist: DefiLlama records a parent protocol, so the token may launch at the parent'); }
    if (p.change_7d != null && p.change_7d <= -10) flags.push('TVL fell ' + (-p.change_7d).toFixed(1) + '% in 7 days: capital is leaving');
    if (days != null && days < 90) flags.push('Tracked for only ' + days + ' days: contracts are young');
    if (days == null) flags.push('No listing date on record: tenure unknown');
    if (p.chains.length === 1) flags.push('Single chain (' + p.chains[0] + '): no fallback venue');
    var value = Math.max(1, Math.round(curve * catMult * g * t * c * k));
    // Confidence: how much of the estimate rests on data rather than on the default.
    // 20 base, up to 40 for same-category peers, 10 each for a growth figure and a listing date, up to 20 for tenure.
    var conf = Math.round(20 + 40 * cat.n / (cat.n + 4) + (p.change_7d == null ? 0 : 10) + (days == null ? 0 : 10 + 20 * (1 - Math.exp(-days / 365))) - (k < 1 ? 15 : 0));
    var spread = Math.pow(10, 0.6745 * fit.sigma);
    return {
      slug: p.slug, name: p.name, category: p.category || 'Uncategorised', chains: p.chains, tvl: p.tvl_usd, change7d: p.change_7d,
      listed: p.listed_at, days: days, cls: onWatch ? 'watch' : overFloor ? 'offlist' : 'early',
      curve: Math.round(curve), catN: cat.n, catMult: catMult, growth: g, tenure: t, breadth: c, haircut: k,
      value: value, lo: Math.round(value / spread), hi: Math.round(value * spread), multiple: value / p.tvl_usd,
      perK: value * AIRDROP_SHARE * 1000 / p.tvl_usd, conf: conf, grade: conf >= 75 ? 'A' : conf >= 58 ? 'B' : 'C', flags: flags
    };
  }

  // ---------------------------------------------------------------- 4. the farm plan
  /** Typical cost of one transaction in USD, by chain. An assumption table about chains, not protocols. */
  var GAS_USD = { Ethereum: 4, Bitcoin: 2.5, Tron: 1.5, Binance: 0.15, Avalanche: 0.08, Solana: 0.01, Polygon: 0.02 };
  function gasOf(chain) { return GAS_USD[chain] != null ? GAS_USD[chain] : 0.05; }
  var WEEKS = 12, CASH_YIELD = 0.045, EARNS = /lend|rwa|stable|stake|vault/;
  /** The verdict a reader acts on: modelled drop over the plan's whole cost. */
  function verdictOf(edge) { return edge >= 3 ? 'Farm' : edge >= 1 ? 'Marginal' : 'Skip'; }
  /** The cheapest other chain to repeat on, or null when it runs on one. */
  function secondChain(chains) {
    var best = null;
    chains.slice(1).forEach(function (c) { if (best == null || gasOf(c) < gasOf(best)) best = c; });
    return best;
  }

  /** What a farmer actually does, by the kind of protocol. Matched on the category's words. */
  var ARCHETYPES = [
    { key: 'lend', re: /lend|collateral/i, asset: 'USDC', core: 'Supply {size} of USDC to the main market', depth: 'Borrow 25% of it back in a stablecoin (health factor above 2.0) and re-supply: borrowers are counted apart from suppliers', weekly: 'one repay-and-reborrow', txs: 2 },
    { key: 'perps', re: /deriv|option|prediction|perp/i, asset: 'USDC', core: 'Deposit {size} of USDC as margin', depth: 'Open a 2x position of about {half} on the most liquid market and close it the same day: volume counts, not profit', weekly: 'two round-trip trades of about {half} each', txs: 4 },
    { key: 'dex', re: /dex|otc|marketplace|launchpad/i, asset: 'USDC', core: 'Swap {half} of USDC into the deepest pair and back', depth: 'Add the other {half} as liquidity in a stable or blue-chip pool, and keep the LP position', weekly: 'two swaps of about {tenth}', txs: 2 },
    { key: 'rwa', re: /rwa/i, asset: 'USDC', core: 'Pass the issuer onboarding (KYC where it asks), then mint {size} of its yield token with USDC', depth: 'Hold the token in your own wallet, not on an exchange: holders are read from the chain', weekly: 'a balance check, and one small top-up of {tenth} a month', txs: 1 },
    { key: 'stable', re: /basis|cdp|stable|synthetic|reserve/i, asset: 'USDC', core: 'Mint or buy {size} of its dollar token with USDC', depth: 'Stake half of it in the protocol\'s own savings vault and keep half liquid: both balances are usually counted', weekly: 'one stake or unstake of about {tenth}', txs: 2 },
    { key: 'stake', re: /staking|restak|btc|governance|insurance/i, asset: 'the chain\'s staking asset', core: 'Deposit {size} of the asset it accepts', depth: 'Delegate or allocate the receipt inside the protocol (an operator, a vault or a vote) instead of leaving it idle', weekly: 'one re-delegation or vote', txs: 1 },
    { key: 'vault', re: /curator|allocator|yield|farm|liquidity|index|cedefi|vault/i, asset: 'USDC', core: 'Deposit {size} of USDC into its largest vault', depth: 'Split a further {tenth} into a second vault of the same curator: breadth is the cheapest multiplier', weekly: 'one top-up of about {tenth}', txs: 1 },
    { key: 'infra', re: /./, asset: 'its native asset', core: 'Move {size} onto it through its own official route', depth: 'Use two apps built on it (a swap and a deposit) so the wallet shows real use, not a single transfer', weekly: 'two transactions on it', txs: 2 }
  ];
  function archetypeOf(category) {
    for (var i = 0; i < ARCHETYPES.length; i++) if (ARCHETYPES[i].re.test(category || '')) return ARCHETYPES[i];
    return ARCHETYPES[ARCHETYPES.length - 1];
  }
  function usd(n) {
    var a = Math.abs(n), s = n < 0 ? '-$' : '$';
    if (a >= 1e9) return s + (a / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return s + (a / 1e6).toFixed(a >= 1e8 ? 0 : 1) + 'M';
    if (a >= 1e4) return s + Math.round(a / 1e3) + 'K';
    if (a >= 100) return s + String(Math.round(a)).replace(/\B(?=(\d{3})+$)/g, ',');
    return s + (a >= 10 ? a.toFixed(0) : a.toFixed(2));
  }
  /** Capital to commit: $1,000 by default, halved for young or shrinking protocols, raised for large seasoned ones. */
  function suggestedSize(r) {
    if ((r.days != null && r.days < 90) || (r.change7d != null && r.change7d <= -10) || r.tvl < 2e7) return 500;
    if (r.tvl >= 5e8 && r.days != null && r.days >= 365) return 2500;
    return 1000;
  }

  /** The plan for one scored row: steps with a cost and a time each, then totals and the break-even. */
  function farmPlan(r, capital) {
    var A = archetypeOf(r.category), chain = r.chains[0] || 'its chain', gas = gasOf(chain), size = capital || suggestedSize(r);
    var fill = function (s) { return s.replace('{size}', usd(size)).replace('{half}', usd(size / 2)).replace('{tenth}', usd(size / 10)); };
    var steps = [], add = function (what, cost, min, note) { steps.push({ what: what, cost: cost, min: min, note: note }); };
    var bridge = chain === 'Ethereum' ? 0 : 3;
    add('Fund a fresh wallet on ' + chain + ' with ' + usd(size) + ' of ' + A.asset + ' and ' + usd(Math.max(gas * 40, 2)) + ' for gas' + (bridge ? ', bridged in from an exchange or Ethereum' : ''), gas + bridge, bridge ? 25 : 15, 'one transfer' + (bridge ? ' and a bridge fee' : ''));
    add(fill(A.core) + ' on ' + r.name + ', on ' + chain, gas * 2, 15, 'an approval and a deposit');
    add(fill(A.depth), gas * A.txs, 20, A.txs + ' transaction' + (A.txs > 1 ? 's' : ''));
    add('Every week for ' + WEEKS + ' weeks, make ' + fill(A.weekly) + ', on a different weekday each time: steady wallets outrank one-day bursts', gas * A.txs * WEEKS, 10 * WEEKS, WEEKS * A.txs + ' transactions, 10 minutes a week');
    var second = secondChain(r.chains);
    if (second) add('Repeat the first deposit at ' + usd(size / 4) + ' on ' + second + ', the cheapest of its other ' + (r.chains.length - 1) + ' chain' + (r.chains.length > 2 ? 's' : '') + ': a second chain is a separate snapshot', gasOf(second) * 2 + 3, 25, 'a bridge and a deposit');
    if (r.change7d != null && r.change7d <= -10) add('TVL fell ' + (-r.change7d).toFixed(1) + '% this week: enter with half first, and add the rest only once a week closes flat or up', 0, 5, 'a check of the TVL chart');
    else if (r.days != null && r.days < 90) add('It has been tracked for only ' + r.days + ' days: read the audit page first, and cap the position at ' + usd(size) + ' until it has run 90 days', 0, 20, 'reading, no transaction');
    else add('Set a monthly reminder: if 7-day TVL change drops under -20%, withdraw half; ' + (r.change7d == null ? 'no change is on record yet' : 'it is ' + (r.change7d >= 0 ? '+' : '') + r.change7d.toFixed(1) + '% now'), 0, 5, 'a check a month');
    add('Log every transaction hash, watch only the protocol\'s own site for a points or claim page, never pay or sign a "claim fee", and withdraw after week ' + WEEKS + ' if nothing is announced', gas * 2, 15, 'the withdrawal');
    var gasTotal = steps.reduce(function (s, x) { return s + x.cost; }, 0);
    // Idle capital costs the cash yield it gives up; a deposit that earns its own yield (EARNS) gives up nothing.
    var carry = EARNS.test(A.key) ? 0 : size * CASH_YIELD * WEEKS / 52;
    var minutes = steps.reduce(function (s, x) { return s + x.min; }, 0);
    var drop = r.perK * size / 1000;
    return {
      archetype: A.key, chain: chain, size: size, steps: steps, gas: gasTotal, carry: carry, cost: gasTotal + carry, hours: minutes / 60, weeks: WEEKS,
      drop: drop, edge: drop / (gasTotal + carry), verdict: verdictOf(drop / (gasTotal + carry)),
      text: steps.map(function (x) { return x.what + '. Cost: ' + (x.cost > 0 ? 'about ' + usd(x.cost) + ' (' + x.note + ')' : 'nothing (' + x.note + ')') + '. Time: ' + (x.min >= 60 ? (x.min / 60).toFixed(0) + ' hours in all' : x.min + ' minutes') + '.'; })
    };
  }

  // ---------------------------------------------------------------- 5. the whole radar
  /** Rank every candidate by implied value; rank 1 is the largest. Ties break on TVL, then slug. */
  function buildRadar(snapshot) {
    var uni = splitUniverse(snapshot), fit = fitPeers(uni.trading);
    var rows = uni.candidates.map(function (p) { return scoreProtocol(p, fit, uni, snapshot); });
    rows.sort(function (x, y) { return y.value - x.value || y.tvl - x.tvl || (x.slug < y.slug ? -1 : 1); });
    rows.forEach(function (r, i) { r.rank = i + 1; r.plan = farmPlan(r); });
    return { fit: fit, rows: rows, trading: uni.trading, aside: uni.aside, as_of: snapshot.as_of, source: snapshot.source, floor: snapshot.floor_usd, total: snapshot.protocols.length, watchlist: snapshot.watchlist };
  }
  /** board.json's rows, as the gate reads them. */
  function boardRows(radar) {
    return radar.rows.map(function (r) { return { slug: r.slug, name: r.name, rank: r.rank, implied_value_usd: r.value, farm_steps: r.plan.text, tvl_usd: r.tvl, class: r.cls, confidence: r.grade, value_low_usd: r.lo, value_high_usd: r.hi, est_drop_per_1k_usd: Math.round(r.perK * 100) / 100, plan_capital_usd: r.plan.size, plan_cost_usd: Math.round(r.plan.cost * 100) / 100, verdict: r.plan.verdict, plan_hours: Math.round(r.plan.hours * 10) / 10 }; });
  }

  // ---------------------------------------------------------------- the page's copy of the snapshot
  /** snapshot-data.js holds the snapshot's ten fields per protocol as arrays; these two turn it there and back. */
  var FIELDS = ['slug', 'name', 'category', 'chains', 'tvl_usd', 'change_7d', 'mcap_usd', 'listed_at', 'gecko_id', 'symbol'];
  function packSnapshot(s) {
    var cats = [], chains = [], ix = function (list, v) { var i = list.indexOf(v); return i >= 0 ? i : list.push(v) - 1; };
    var rows = s.protocols.map(function (p) { return [p.slug, p.name, p.category == null ? -1 : ix(cats, p.category), p.chains.map(function (c) { return ix(chains, c); }), p.tvl_usd, p.change_7d, p.mcap_usd, p.listed_at, p.gecko_id, p.symbol]; });
    return { as_of: s.as_of, source: s.source, floor_usd: s.floor_usd, fields: FIELDS, categories: cats, chains: chains, watchlist: s.watchlist, protocols: rows };
  }
  function unpackSnapshot(d) {
    return { as_of: d.as_of, source: d.source, floor_usd: d.floor_usd, watchlist: d.watchlist, protocols: d.protocols.map(function (r) {
      return { slug: r[0], name: r[1], category: r[2] < 0 ? null : d.categories[r[2]], chains: r[3].map(function (i) { return d.chains[i]; }), tvl_usd: r[4], change_7d: r[5], mcap_usd: r[6], listed_at: r[7], gecko_id: r[8], symbol: r[9] };
    }) };
  }

  root.RadarModel = { buildRadar: buildRadar, boardRows: boardRows, splitUniverse: splitUniverse, fitPeers: fitPeers, scoreProtocol: scoreProtocol, farmPlan: farmPlan, archetypeOf: archetypeOf, verdictOf: verdictOf, gasOf: gasOf, suggestedSize: suggestedSize, growthFactor: growthFactor, tenureFactor: tenureFactor, breadthFactor: breadthFactor, productReason: productReason, packSnapshot: packSnapshot, unpackSnapshot: unpackSnapshot, usd: usd, median: median, AIRDROP_SHARE: AIRDROP_SHARE, GAS_USD: GAS_USD, WEEKS: WEEKS };
})(typeof globalThis !== 'undefined' ? globalThis : this);
