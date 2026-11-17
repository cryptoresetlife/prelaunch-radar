/* Prelaunch Radar: the page. It holds no figures of its own: RadarModel.buildRadar (model.js) derives the
 * board from the snapshot rows in snapshot-data.js, and everything below only filters, sorts and draws it. */
(function () {
  'use strict';
  var M = window.RadarModel, D = window.RADAR_DATA;
  var $ = function (id) { return document.getElementById(id); };
  if (!M || !D) { $('funnel').innerHTML = '<p class="empty">No data beside the page. Run <code>node main.ts</code>: it writes snapshot-data.js next to index.html.</p>'; return; }

  var radar = M.buildRadar(M.unpackSnapshot(D)), rows = radar.rows, usd = M.usd;
  var bySlug = {}; rows.forEach(function (r) { bySlug[r.slug] = r; });
  var DEFAULTS = { view: 'ranked', cls: '', q: '', cat: '', chain: '', verdict: '', grade: '', min: '', sort: 'rank', dir: 'asc', share: '7', p: '' };
  var S = {}, shown = [];

  // ---------------------------------------------------------------- small helpers
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function pct(v) { if (v != null && Math.abs(v) < 0.05) v = 0; return v == null ? '<span class="na">n/a</span>' : '<span class="' + (v >= 0 ? 'pos' : 'neg') + '">' + (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(1) + '%</span>'; }
  function round$(e) { return '$' + [1, 10, 100][e % 3] + ['', 'K', 'M', 'B'][Math.floor(e / 3)]; }
  function tenure(d) { return d == null ? '<span class="na">n/a</span>' : d < 365 ? d + ' d' : (d / 365).toFixed(1) + ' y'; }
  function times(v) { return (v >= 10 ? v.toFixed(0) : v >= 1 ? v.toFixed(1) : v.toFixed(2)) + '×'; }
  function chainsShort(c, n) { return esc(c.slice(0, n).join(', ')) + (c.length > n ? ' +' + (c.length - n) : ''); }
  var CLASS = { watch: 'Watchlist', offlist: 'Off-list', early: 'Early' };
  var CLASS_NOTE = { watch: 'on the snapshot\'s watchlist: at or over the floor, no token on record', offlist: 'at or over the floor but left off the watchlist', early: 'under the $' + radar.floor / 1e6 + 'M floor: the early ones' };
  /** The reader's airdrop-share setting rescales the drop, the edge and the verdict; value and rank never move. */
  function farm(r) {
    var k = Number(S.share) / (M.AIRDROP_SHARE * 100), edge = r.plan.edge * k;
    return { perK: r.perK * k, drop: r.plan.drop * k, edge: edge, verdict: M.verdictOf(edge) };
  }

  // ---------------------------------------------------------------- the link is the state
  function readHash() {
    S = {}; Object.keys(DEFAULTS).forEach(function (k) { S[k] = DEFAULTS[k]; });
    location.hash.replace(/^#/, '').split('&').forEach(function (kv) {
      var i = kv.indexOf('='), k = kv.slice(0, i);
      if (i > 0 && k in DEFAULTS) S[k] = decodeURIComponent(kv.slice(i + 1));
    });
  }
  function writeHash() {
    var parts = Object.keys(DEFAULTS).filter(function (k) { return S[k] !== DEFAULTS[k]; }).map(function (k) { return k + '=' + encodeURIComponent(S[k]); });
    history.replaceState(null, '', parts.length ? '#' + parts.join('&') : location.pathname + location.search);
  }
  function set(patch) { Object.keys(patch).forEach(function (k) { S[k] = patch[k]; }); writeHash(); render(); }

  // ---------------------------------------------------------------- columns: one definition sorts and draws
  var lo = Math.min.apply(null, rows.map(function (r) { return r.lo; })), hi = Math.max.apply(null, rows.map(function (r) { return r.hi; }));
  function scale(v) { return 100 * Math.log(v / lo) / Math.log(hi / lo); }
  var COLS = {
    ranked: [
      { k: 'rank', t: '#', num: 1, v: function (r) { return r.rank; }, h: function (r) { return r.rank; } },
      { k: 'name', t: 'Protocol', v: function (r) { return r.name.toLowerCase(); }, h: function (r) { return '<b>' + esc(r.name) + '</b><span class="tag ' + r.cls + '">' + CLASS[r.cls] + '</span><small>' + esc(r.category) + ' · ' + chainsShort(r.chains, 2) + '</small>'; } },
      { k: 'tvl', t: 'TVL', num: 1, v: function (r) { return r.tvl; }, h: function (r) { return usd(r.tvl); } },
      { k: 'change7d', t: '7d TVL', num: 1, v: function (r) { return r.change7d; }, h: function (r) { return pct(r.change7d); } },
      { k: 'days', t: 'No token for', num: 1, v: function (r) { return r.days; }, h: function (r) { return tenure(r.days); } },
      { k: 'value', t: 'Implied value', tip: 'What the launch would be worth: the peer curve at its TVL, times category, growth, tenure, breadth and haircut. The bar is the 50% band on a log scale.', v: function (r) { return r.value; }, h: function (r) { return '<b>' + usd(r.value) + '</b><span class="band"><i style="left:' + scale(r.lo).toFixed(1) + '%;width:' + (scale(r.hi) - scale(r.lo)).toFixed(1) + '%"></i><u style="left:' + scale(r.value).toFixed(1) + '%"></u></span><small>' + usd(r.lo) + ' to ' + usd(r.hi) + '</small>'; } },
      { k: 'multiple', t: '× TVL', num: 1, v: function (r) { return r.multiple; }, h: function (r) { return times(r.multiple); } },
      { k: 'perK', t: 'Drop per $1k', num: 1, tip: 'Implied value × the airdrop share, split pro rata over TVL, for $1,000 deposited.', v: function (r) { return r.perK; }, h: function (r) { return usd(farm(r).perK); } },
      { k: 'edge', t: 'Farm plan', tip: 'Verdict = modelled drop ÷ the plan\'s whole cost: Farm at 3× or more, Marginal from 1×, Skip under it.', v: function (r) { return r.plan.edge; }, h: function (r) { var f = farm(r); return '<span class="verdict ' + f.verdict + '">' + f.verdict + ' ' + times(f.edge) + '</span><small>' + r.plan.steps.length + ' steps · ' + usd(r.plan.cost) + ' · ' + r.plan.hours.toFixed(1) + ' h · ' + esc(r.plan.chain) + '</small>'; } },
      { k: 'conf', t: 'Conf.', tip: 'How much of the estimate rests on data: same-category peers, a growth figure, a listing date, tenure.', v: function (r) { return r.conf; }, h: function (r) { return '<span class="grade ' + r.grade + '">' + r.grade + '</span>'; } }
    ],
    trading: [
      { k: 'name', t: 'Protocol', v: function (p) { return p.name.toLowerCase(); }, h: function (p) { return '<b>' + esc(p.name) + '</b><span class="tag live">' + esc(p.symbol || p.gecko_id) + ' trades</span><small>' + esc(p.category || 'Uncategorised') + ' · ' + chainsShort(p.chains, 2) + '</small>'; } },
      { k: 'tvl', t: 'TVL', num: 1, v: function (p) { return p.tvl_usd; }, h: function (p) { return usd(p.tvl_usd); } },
      { k: 'change7d', t: '7d TVL', num: 1, v: function (p) { return p.change_7d; }, h: function (p) { return pct(p.change_7d); } },
      { k: 'mcap', t: 'Market cap', num: 1, v: function (p) { return p.mcap_usd; }, h: function (p) { return p.mcap_usd ? usd(p.mcap_usd) : '<span class="na">none on record</span>'; } },
      { k: 'multiple', t: 'Mcap ÷ TVL', num: 1, v: function (p) { return p.mcap_usd ? p.mcap_usd / p.tvl_usd : null; }, h: function (p) { return p.mcap_usd ? times(p.mcap_usd / p.tvl_usd) : ''; } },
      { k: 'use', t: 'Role in the model', v: function (p) { return p.mcap_usd ? 0 : 1; }, h: function (p) { return p.mcap_usd ? 'A peer: one point of the fitted curve' : 'Token on record, no market cap: not fitted'; } }
    ],
    aside: [
      { k: 'name', t: 'Protocol', v: function (a) { return a.p.name.toLowerCase(); }, h: function (a) { return '<b>' + esc(a.p.name) + '</b><small>' + esc(a.p.category || 'Uncategorised') + ' · ' + chainsShort(a.p.chains, 2) + '</small>'; } },
      { k: 'tvl', t: 'TVL', num: 1, v: function (a) { return a.p.tvl_usd; }, h: function (a) { return usd(a.p.tvl_usd); } },
      { k: 'change7d', t: '7d TVL', num: 1, v: function (a) { return a.p.change_7d; }, h: function (a) { return pct(a.p.change_7d); } },
      { k: 'why', t: 'Why it is set aside (productReason)', v: function (a) { return a.why; }, h: function (a) { return esc(a.why); } }
    ]
  };

  // ---------------------------------------------------------------- filter and sort
  function applyFilters() {
    var q = S.q.trim().toLowerCase(), min = Number(S.min) || 0;
    var list = S.view === 'ranked' ? rows : radar[S.view];
    list = list.filter(function (x) {
      var p = x.p || x, cat = p.category || 'Uncategorised', tvl = p.tvl != null ? p.tvl : p.tvl_usd;
      if (q && (p.name + ' ' + cat + ' ' + p.chains.join(' ')).toLowerCase().indexOf(q) < 0) return false;
      if (S.cat && cat !== S.cat) return false;
      if (S.chain && p.chains.indexOf(S.chain) < 0) return false;
      if (tvl < min) return false;
      if (S.view !== 'ranked') return true;
      return (!S.cls || x.cls === S.cls) && (!S.grade || x.grade === S.grade) && (!S.verdict || farm(x).verdict === S.verdict);
    });
    return sortRows(list);
  }
  function sortRows(list) {
    var cols = COLS[S.view], col = cols.filter(function (c) { return c.k === S.sort; })[0] || cols[0], sign = S.dir === 'asc' ? 1 : -1;
    return list.slice().sort(function (x, y) {
      var a = col.v(x), b = col.v(y);
      if (a == null || b == null) return a == null ? (b == null ? 0 : 1) : -1; // unknowns last, either direction
      return a < b ? -sign : a > b ? sign : 0;
    });
  }

  // ---------------------------------------------------------------- header, funnel, model bar
  function renderFrame() {
    var c = D.board_check, sum = rows.reduce(function (s, r) { return s + r.value; }, 0), ok = c && c.rows === rows.length && c.value_sum_usd === sum && c.top === rows[0].slug;
    $('meta').innerHTML = '<span>Snapshot <b>' + esc(radar.as_of) + '</b> · DefiLlama /protocols</span><span class="chip ' + (ok ? 'ok' : 'bad') + '">' + (ok ? '✓ recomputed in this page: ' + rows.length + ' rows, ' + usd(sum) + ' total, equal to board.json' : 'This page\'s run differs from board.json') + '</span>';
    var n = function (cls) { return rows.filter(function (r) { return r.cls === cls; }).length; };
    var cell = function (view, cls, num, label, note) { return '<button type="button" class="stat" data-view="' + view + '" data-cls="' + cls + '"><b>' + num + '</b><span>' + label + '</span><small>' + note + '</small></button>'; };
    $('funnel').innerHTML = '<div class="stat fixed"><b>' + radar.total + '</b><span>protocols in the snapshot</span><small>every one at or over $5M TVL</small></div><i class="arrow">→</i>' +
      cell('trading', '', radar.trading.length, 'token already trades', radar.fit.n + ' with a market cap: the peers') +
      cell('aside', '', radar.aside.length, 'set aside', 'wrapped, staked, bridged or exchange products') +
      cell('ranked', '', rows.length, 'still to come: ranked', 'no token on record, a launch of its own') + '<i class="arrow">=</i>' +
      cell('ranked', 'watch', n('watch') + ' / ' + radar.watchlist.length, 'watchlist covered', CLASS_NOTE.watch) +
      cell('ranked', 'early', n('early'), 'early', CLASS_NOTE.early) +
      cell('ranked', 'offlist', n('offlist'), 'off-list', 'over the floor, parent on record: haircut');
    var f = radar.fit, band = Math.pow(10, 0.6745 * f.sigma);
    $('modelbar').innerHTML = '<div class="formula"><span class="lbl">Value model</span><code>implied value = 10^(' + f.a.toFixed(2) + ' + ' + f.b.toFixed(3) + ' · log10 TVL) × category × 7d growth × no-token tenure × chain breadth × haircut</code>' +
      '<small>The curve is fitted (Theil-Sen) on the ' + f.n + ' protocols in this snapshot whose token trades with a market cap; half of them sit within ÷' + band.toFixed(1) + ' to ×' + band.toFixed(1) + ' of it, and that is each row\'s band. No list of names: change the snapshot and the board changes.</small></div>' +
      '<label class="share"><span class="lbl">Airdrop share of launch value</span><input type="range" id="share" min="2" max="15" step="1" value="' + esc(S.share) + '"><output>' + esc(S.share) + '%</output><small>Sets drop per $1k and the verdict. Rank does not move.</small></label>';
  }

  // ---------------------------------------------------------------- controls
  function options(list, cur, all) {
    return '<option value="">' + all + '</option>' + list.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (o[0] === cur ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('');
  }
  function tally(list, pick) {
    var m = {}; list.forEach(function (x) { [].concat(pick(x.p || x)).forEach(function (v) { m[v] = (m[v] || 0) + 1; }); });
    return Object.keys(m).sort(function (a, b) { return m[b] - m[a] || (a < b ? -1 : 1); }).map(function (k) { return [k, k + ' (' + m[k] + ')']; });
  }
  function renderControls() {
    var list = S.view === 'ranked' ? rows : radar[S.view], ranked = S.view === 'ranked';
    var tab = function (v, label, n) { return '<button type="button" role="tab" data-view="' + v + '" data-cls="" aria-selected="' + (S.view === v) + '">' + label + ' <em>' + n + '</em></button>'; };
    var seg = function (v, label) { return '<button type="button" data-cls="' + v + '" aria-pressed="' + (S.cls === v) + '">' + label + '</button>'; };
    $('controls').innerHTML = '<div class="tabs" role="tablist">' + tab('ranked', 'Still to come', rows.length) + tab('trading', 'Token trades', radar.trading.length) + tab('aside', 'Set aside', radar.aside.length) + '</div>' +
      '<input type="search" id="q" placeholder="Search name, category or chain" value="' + esc(S.q) + '" aria-label="Search">' +
      (ranked ? '<div class="seg" aria-label="Class">' + seg('', 'All') + seg('watch', 'Watchlist') + seg('early', 'Early') + seg('offlist', 'Off-list') + '</div>' : '') +
      '<select id="cat" aria-label="Category">' + options(tally(list, function (p) { return p.category || 'Uncategorised'; }), S.cat, 'All categories') + '</select>' +
      '<select id="chain" aria-label="Chain">' + options(tally(list, function (p) { return p.chains; }).slice(0, 40), S.chain, 'All chains') + '</select>' +
      '<select id="min" aria-label="Minimum TVL">' + options([['20000000', 'TVL ≥ $20M'], ['50000000', 'TVL ≥ $50M'], ['200000000', 'TVL ≥ $200M']], S.min, 'Any TVL') + '</select>' +
      (ranked ? '<select id="verdict" aria-label="Verdict">' + options([['Farm', 'Farm'], ['Marginal', 'Marginal'], ['Skip', 'Skip']], S.verdict, 'Any verdict') + '</select>' +
        '<select id="grade" aria-label="Confidence">' + options([['A', 'Confidence A'], ['B', 'Confidence B'], ['C', 'Confidence C']], S.grade, 'Any confidence') + '</select>' : '') +
      '<button type="button" class="reset" data-act="reset">Reset</button><p class="count" id="count" aria-live="polite"></p>';
  }

  // ---------------------------------------------------------------- the board
  function renderBoard() {
    var cols = COLS[S.view];
    shown = applyFilters();
    $('board').tHead.innerHTML = '<tr>' + cols.map(function (c) {
      var on = c.k === S.sort || (!cols.some(function (x) { return x.k === S.sort; }) && c === cols[0]);
      return '<th' + (c.num ? ' class="num"' : '') + (on ? ' aria-sort="' + (S.dir === 'asc' ? 'ascending' : 'descending') + '"' : '') + '><button type="button" data-sort="' + c.k + '"' + (c.tip ? ' title="' + esc(c.tip) + '"' : '') + '>' + c.t + (on ? (S.dir === 'asc' ? ' ▲' : ' ▼') : '') + '</button></th>';
    }).join('') + '</tr>';
    $('board').tBodies[0].innerHTML = shown.map(function (x) {
      return '<tr' + (S.view === 'ranked' ? ' tabindex="0" data-slug="' + esc(x.slug) + '"' + (x.slug === S.p ? ' class="on"' : '') : '') + '>' + cols.map(function (c) { return '<td' + (c.num ? ' class="num"' : '') + '>' + c.h(x) + '</td>'; }).join('') + '</tr>';
    }).join('');
    $('empty').hidden = shown.length > 0;
    var total = (S.view === 'ranked' ? rows : radar[S.view]).length, col = cols.filter(function (c) { return c.k === S.sort; })[0] || cols[0];
    $('count').innerHTML = '<b>' + shown.length + '</b> of ' + total + (S.view === 'ranked' ? ' ranked protocols' : S.view === 'trading' ? ' protocols whose token trades' : ' set-aside products') + ' · sorted by ' + col.t + (S.dir === 'asc' ? ' ▲' : ' ▼') + (S.view === 'ranked' ? ' · select a row for its value walk and farm plan' : '');
  }

  // ---------------------------------------------------------------- the detail view
  /** The traded protocols nearest in TVL, same category first: the comparables a reader can check by hand. */
  function nearestComps(r, n) {
    var d = function (p) { return Math.abs(Math.log(p.tvl_usd / r.tvl)); };
    var kind = M.archetypeOf(r.category).key, tier = function (p) { return p.category === r.category ? 0 : M.archetypeOf(p.category).key === kind ? 1 : 2; };
    return radar.fit.peers.slice().sort(function (a, b) { return tier(a) - tier(b) || d(a) - d(b); }).slice(0, n);
  }
  /** Every traded peer as a dot (TVL across, market cap up, both log), the fitted curve, and this protocol on it. */
  function drawScatter(r) {
    var W = 560, H = 230, L = 46, B = 26, f = radar.fit, x0 = 6.6, x1 = 10.6, y0 = 4.5, y1 = 10.6, lg = function (v) { return Math.log(v) / Math.LN10; };
    var X = function (v) { return L + (lg(v) - x0) / (x1 - x0) * (W - L - 8); }, Y = function (v) { return H - B - (lg(v) - y0) / (y1 - y0) * (H - B - 8); };
    var s = '<svg class="scatter" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Market cap against TVL for the traded peers, with the fitted curve">';
    [5, 6, 7, 8, 9, 10].forEach(function (e) { s += '<line class="grid" x1="' + L + '" x2="' + (W - 8) + '" y1="' + Y(Math.pow(10, e)) + '" y2="' + Y(Math.pow(10, e)) + '"/><text class="ax" x="' + (L - 6) + '" y="' + (Y(Math.pow(10, e)) + 4) + '" text-anchor="end">' + round$(e) + '</text>'; });
    [7, 8, 9, 10].forEach(function (e) { s += '<text class="ax" x="' + X(Math.pow(10, e)) + '" y="' + (H - 8) + '" text-anchor="middle">' + round$(e) + ' TVL</text>'; });
    s += '<text class="ax" x="' + (L + 6) + '" y="16">market cap</text>';
    f.peers.forEach(function (p) { s += '<circle class="' + (p.category === r.category ? 'peer same' : 'peer') + '" cx="' + X(p.tvl_usd).toFixed(1) + '" cy="' + Y(Math.min(Math.max(p.mcap_usd, 4e4), 2e11)).toFixed(1) + '" r="' + (p.category === r.category ? 4 : 2.5) + '"/>'; });
    var c = function (e) { return Math.pow(10, f.a + f.b * e); };
    s += '<line class="fit" x1="' + X(Math.pow(10, x0)) + '" y1="' + Y(c(x0)) + '" x2="' + X(Math.pow(10, x1)) + '" y2="' + Y(c(x1)) + '"/>';
    s += '<line class="whisk" x1="' + X(r.tvl) + '" x2="' + X(r.tvl) + '" y1="' + Y(r.lo) + '" y2="' + Y(r.hi) + '"/><circle class="me" cx="' + X(r.tvl) + '" cy="' + Y(r.value) + '" r="6"/>';
    return s + '</svg>';
  }
  function renderDetail() {
    var r = bySlug[S.p], el = $('detail');
    el.hidden = $('scrim').hidden = !r;
    if (!r) return;
    var f = farm(r), pl = r.plan, cat = radar.fit.offsets[r.category];
    var step = function (label, input, factor, running) { var w = Math.min(50, Math.abs(Math.log(factor)) / Math.log(2.5) * 50); return '<tr><th>' + label + '</th><td>' + input + '</td><td class="num">' + (factor === null ? '' : times(factor)) + '</td><td class="bar">' + (factor === null ? '' : '<i class="' + (factor >= 1 ? 'up' : 'down') + '" style="width:' + w.toFixed(1) + '%;' + (factor >= 1 ? 'left:50%' : 'right:50%') + '"></i>') + '</td><td class="num">' + usd(running) + '</td></tr>'; };
    var run = r.curve, walk = step('Peer curve', usd(r.tvl) + ' of TVL on the fitted curve', null, run);
    [['Category', esc(r.category) + ': ' + (cat ? cat.n + ' traded peer' + (cat.n > 1 ? 's' : '') + ', median shrunk by n/(n+3)' : 'no traded peer, so the curve alone'), r.catMult],
      ['7d growth', r.change7d == null ? 'not reported: neutral' : 'TVL ' + (r.change7d >= 0 ? '+' : '−') + Math.abs(r.change7d).toFixed(1) + '% in seven days', r.growth],
      ['No-token tenure', r.days == null ? 'no listing date: 0.85 default' : r.days + ' days tracked with no token (since ' + r.listed + ')', r.tenure],
      ['Chain breadth', r.chains.length + ' chain' + (r.chains.length > 1 ? 's' : ''), r.breadth],
      ['Haircut', r.haircut < 1 ? (r.cls === 'offlist' ? 'parent protocol on record' : 'shares a name with a traded token') : 'none: no traded relative found', r.haircut]
    ].forEach(function (s) { run *= s[2]; walk += step(s[0], s[1], s[2], run); });
    var comps = nearestComps(r, 5).map(function (p) { return '<tr><td><b>' + esc(p.name) + '</b> <span class="na">' + esc(p.symbol || '') + '</span></td><td>' + esc(p.category || '') + '</td><td class="num">' + usd(p.tvl_usd) + '</td><td class="num">' + usd(p.mcap_usd) + '</td><td class="num">' + times(p.mcap_usd / p.tvl_usd) + '</td></tr>'; }).join('');
    var at = shown.indexOf(r);
    el.innerHTML = '<header><div><p class="eyebrow">Rank ' + r.rank + ' of ' + rows.length + ' · <span class="tag ' + r.cls + '">' + CLASS[r.cls] + '</span> ' + CLASS_NOTE[r.cls] + '</p><h2 id="d-name">' + esc(r.name) + '</h2><p class="sub">' + esc(r.category) + ' on ' + chainsShort(r.chains, 6) + ' · TVL ' + usd(r.tvl) + ' · records no token</p></div>' +
      '<nav><button type="button" data-step="-1"' + (at > 0 ? '' : ' disabled') + '>← Prev</button><button type="button" data-step="1"' + (at >= 0 && at < shown.length - 1 ? '' : ' disabled') + '>Next →</button><button type="button" class="close" data-act="close">Close ✕</button></nav></header>' +
      '<div class="cols"><section><h3>Implied value</h3><div class="hero"><b>' + usd(r.value) + '</b><span>50% band ' + usd(r.lo) + ' to ' + usd(r.hi) + ' · ' + times(r.multiple) + ' TVL · confidence <span class="grade ' + r.grade + '">' + r.grade + '</span> ' + r.conf + '/100</span></div>' +
      '<table class="walk"><thead><tr><th>Step</th><th>From the snapshot</th><th class="num">Factor</th><th></th><th class="num">Running</th></tr></thead><tbody>' + walk + '</tbody></table>' +
      '<h3>Where it sits among the ' + radar.fit.n + ' traded peers</h3>' + drawScatter(r) + '<p class="legend"><i class="k me"></i>' + esc(r.name) + ' with its band <i class="k same"></i>' + esc(r.category) + ' peers <i class="k peer"></i>other peers <i class="k fit"></i>fitted curve</p>' +
      '<h3>Nearest comparables that trade</h3><table class="comps"><thead><tr><th>Protocol</th><th>Category</th><th class="num">TVL</th><th class="num">Market cap</th><th class="num">Mcap ÷ TVL</th></tr></thead><tbody>' + comps + '</tbody></table></section>' +
      '<section><h3>Farm plan <span class="verdict ' + f.verdict + '">' + f.verdict + ' ' + times(f.edge) + '</span></h3>' +
      '<div class="tiles"><div><b>' + usd(pl.size) + '</b><span>capital, on ' + esc(pl.chain) + '</span></div><div><b>' + usd(pl.cost) + '</b><span>whole cost: ' + usd(pl.gas) + ' gas' + (pl.carry ? ' + ' + usd(pl.carry) + ' idle cash' : ', deposit keeps earning') + '</span></div><div><b>' + pl.hours.toFixed(1) + ' h</b><span>over ' + pl.weeks + ' weeks</span></div><div><b>' + usd(f.drop) + '</b><span>modelled drop at ' + esc(S.share) + '% share</span></div></div>' +
      '<p class="why">' + (f.verdict === 'Farm' ? 'The modelled drop is ' + times(f.edge) + ' the plan\'s cost: worth the ' + pl.hours.toFixed(1) + ' hours.' : f.verdict === 'Marginal' ? 'The modelled drop covers the cost ' + times(f.edge) + ': farm it only if the launch is likely or you would use it anyway.' : 'The modelled drop does not cover the cost (' + times(f.edge) + '): its TVL dilutes a ' + usd(pl.size) + ' position. Skip unless you already use it.') + '</p>' +
      '<ol class="steps">' + pl.steps.map(function (s) { return '<li><p>' + esc(s.what) + '.</p><span class="cost">' + (s.cost > 0 ? usd(s.cost) : 'free') + '</span><span class="time">' + (s.min >= 60 ? (s.min / 60).toFixed(0) + ' h' : s.min + ' min') + '</span><small>' + esc(s.note) + '</small></li>'; }).join('') + '</ol>' +
      '<h3>The same plan at three sizes</h3><table class="comps"><thead><tr><th class="num">Capital</th><th class="num">Whole cost</th><th class="num">Modelled drop</th><th class="num">Drop ÷ cost</th><th>Verdict</th></tr></thead><tbody>' +
      [pl.size / 2, pl.size, pl.size * 5].map(function (c) { var q = M.farmPlan(r, c), e = q.edge * Number(S.share) / (M.AIRDROP_SHARE * 100); return '<tr><td class="num">' + (c === pl.size ? 'the plan: ' : '') + usd(c) + '</td><td class="num">' + usd(q.cost) + '</td><td class="num">' + usd(q.cost * e) + '</td><td class="num">' + times(e) + '</td><td><span class="verdict ' + M.verdictOf(e) + '">' + M.verdictOf(e) + '</span></td></tr>'; }).join('') + '</tbody></table>' +
      '<h3>What the snapshot flags</h3><ul class="flags">' + (r.flags.length ? r.flags.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') : '<li class="none">Nothing: growing or flat, seasoned, multi-chain, no traded relative.</li>') + '</ul></section></div>';
    el.querySelector('.close').focus();
  }

  // ---------------------------------------------------------------- wiring
  function render() { renderFrame(); renderControls(); renderBoard(); renderDetail(); }
  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-sort],[data-view],[data-cls],[data-act],[data-step],tr[data-slug]');
    if (e.target.id === 'scrim') return set({ p: '' });
    if (!t) return;
    var d = t.dataset;
    if (d.sort) set(S.sort === d.sort ? { dir: S.dir === 'asc' ? 'desc' : 'asc' } : { sort: d.sort, dir: d.sort === 'rank' || d.sort === 'name' || d.sort === 'why' ? 'asc' : 'desc' });
    else if (d.view) set({ view: d.view, cls: d.cls, cat: '', chain: '', verdict: '', grade: '', sort: d.view === 'ranked' ? 'rank' : 'tvl', dir: d.view === 'ranked' ? 'asc' : 'desc', p: '' });
    else if (d.cls != null) set({ cls: d.cls });
    else if (d.act === 'reset') { location.hash = ''; readHash(); render(); }
    else if (d.act === 'close') set({ p: '' });
    else if (d.step) { var n = shown[shown.indexOf(bySlug[S.p]) + Number(d.step)]; if (n) set({ p: n.slug }); }
    else if (d.slug) set({ p: d.slug });
  });
  document.addEventListener('input', function (e) {
    var id = e.target.id;
    if (id === 'q') { S.q = e.target.value; writeHash(); renderBoard(); }
    else if (id === 'share') { S.share = e.target.value; writeHash(); e.target.nextElementSibling.textContent = S.share + '%'; renderBoard(); renderDetail(); }
  });
  document.addEventListener('change', function (e) { if (/^(cat|chain|min|verdict|grade)$/.test(e.target.id)) { var p = {}; p[e.target.id] = e.target.value; set(p); } });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && S.p) set({ p: '' });
    else if (e.key === 'Enter' && e.target.dataset && e.target.dataset.slug) set({ p: e.target.dataset.slug });
    else if (S.p && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) { var n = shown[shown.indexOf(bySlug[S.p]) + (e.key === 'ArrowLeft' ? -1 : 1)]; if (n) set({ p: n.slug }); }
  });
  window.addEventListener('hashchange', function () { readHash(); render(); });
  readHash(); render();
})();
