/* The page. It holds no figures of its own: RadarModel.buildRadar derives the board from the snapshot rows. */
(function () {
  'use strict';
  var M = window.RadarModel, D = window.RADAR_DATA;
  var $ = function (id) { return document.getElementById(id); };
  if (!M || !D) { $('funnel').innerHTML = '<p class="empty">Run main.ts first: it writes snapshot-data.js beside this page.</p>'; return; }

  var radar = M.buildRadar(D), rows = radar.rows, usd = M.usd, T = radar.test;
  var peerKeys = {}; radar.fit.peers.forEach(function (f) { peerKeys[f.key] = f; });
  function fam(p) { return peerKeys[String(p.symbol || p.gecko_id).toUpperCase()]; }
  var bySlug = {}; rows.forEach(function (r) { bySlug[r.slug] = r; });
  var DEFAULTS = { view: 'ranked', cls: '', q: '', cat: '', chain: '', verdict: '', grade: '', min: '', sort: 'rank', dir: 'asc', share: '7', x: '', p: '' };
  var S = {}, shown = [];

  // ----small helpers
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function pct(v) { if (v != null && Math.abs(v) < 0.05) v = 0; return v == null ? '<span class="na">n/a</span>' : '<span class="' + (v >= 0 ? 'pos' : 'neg') + '">' + (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(1) + '%</span>'; }
  function round$(e) { return '$' + [1, 10, 100][e % 3] + ['', 'K', 'M', 'B'][Math.floor(e / 3)]; }
  function tenure(d) { return d == null ? '<span class="na">n/a</span>' : d < 365 ? d + ' d' : (d / 365).toFixed(1) + ' y'; }
  function times(v) { return (v >= 10 ? v.toFixed(0) : v >= 1 ? v.toFixed(1) : v >= 0.01 ? v.toFixed(2) : v.toFixed(3)) + '×'; }
  function chainsShort(c, n) { return esc(c.slice(0, n).join(', ')) + (c.length > n ? ' +' + (c.length - n) : ''); }
  var CLASS = { watch: 'Watchlist', above: 'Above floor', early: 'Early' };
  /** The reader's airdrop-share setting rescales the drop, the edge and the verdict; value and rank never move. */
  function farm(r, plan) {
    var k = Number(S.share) / (M.AIRDROP_SHARE * 100), pl = plan || r.plan, edge = pl.edge * k;
    return { perK: r.perK * k, drop: pl.drop * k, low: pl.low * k, net: pl.drop * k - pl.cost, edge: edge, verdict: M.verdictOf(edge, pl.lowEdge * k) };
  }

  // ----the link is the state
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

  // ----columns: one definition sorts and draws
  var lo = Math.min.apply(null, rows.map(function (r) { return r.lo; })), hi = Math.max.apply(null, rows.map(function (r) { return r.hi; }));
  function scale(v) { return 100 * Math.log(v / lo) / Math.log(hi / lo); }
  var COLS = {
    ranked: [
      { k: 'rank', t: 'Rank', num: 1, tip: 'Under each rank: where it lands in 90% of 200 bootstrap refits (rankRanges).',v: function (r) { return r.rank; }, h: function (r) { return '<b>' + r.rank + '</b><small>' + r.rankLo + '–' + r.rankHi + '</small>'; } },
      { k: 'name', t: 'Protocol', v: function (r) { return r.name.toLowerCase(); }, h: function (r) { return '<b>' + esc(r.name) + '</b><span class="tag ' + r.cls + '">' + CLASS[r.cls] + '</span><small>' + esc(r.category) + ' · ' + chainsShort(r.chains, 2) + '</small>'; } },
      { k: 'tvl', t: 'TVL', num: 1, v: function (r) { return r.tvl; }, h: function (r) { return usd(r.tvl); } },
      { k: 'change7d', t: '7d TVL', num: 1, v: function (r) { return r.change7d; }, h: function (r) { return pct(r.change7d); } },
      { k: 'days', t: 'No token for', num: 1, v: function (r) { return r.days; }, h: function (r) { return tenure(r.days); } },
      { k: 'value', t: 'Implied value', v: function (r) { return r.value; }, h: function (r) { return '<b>' + usd(r.value) + '</b><span class="band"><i style="left:' + scale(r.lo).toFixed(1) + '%;width:' + (scale(r.hi) - scale(r.lo)).toFixed(1) + '%"></i><u style="left:' + scale(r.value).toFixed(1) + '%"></u></span><small>' + usd(r.lo) + ' to ' + usd(r.hi) + '</small>'; } },
      { k: 'multiple', t: '× TVL', num: 1, v: function (r) { return r.multiple; }, h: function (r) { return times(r.multiple); } },
      { k: 'perK', t: 'Drop per $1k', num: 1, v: function (r) { return r.perK; }, h: function (r) { return usd(farm(r).perK); } },
      { k: 'edge', t: 'Farm plan', tip: 'Modelled drop ÷ the plan\'s whole cost. Farm: 3× or more and still covered at the band\'s low end. Marginal: covered. Skip: not.', v: function (r) { return r.plan.edge; }, h: function (r) { var f = farm(r); return '<span class="verdict ' + f.verdict + '">' + f.verdict + ' ' + times(f.edge) + '</span> <span class="net">net ' + usd(f.net) + '</span><small>' + r.plan.steps.length + ' steps · ' + usd(r.plan.cost) + ' · ' + r.plan.hours.toFixed(1) + ' h · <button type="button" class="more" data-x="' + esc(r.slug) + '">steps ▾</button></small>'; } },
      { k: 'conf', t: 'Conf.', v: function (r) { return r.conf; }, h: function (r) { return '<span class="grade ' + r.grade + '">' + r.grade + '</span>'; } }
    ],
    trading: [
      { k: 'name', t: 'Protocol', v: function (p) { return p.name.toLowerCase(); }, h: function (p) { return '<b>' + esc(p.name) + '</b><span class="tag live">' + esc(p.symbol || p.gecko_id) + ' trades</span><small>' + esc(p.category || 'Uncategorised') + ' · ' + chainsShort(p.chains, 2) + '</small>'; } },
      { k: 'tvl', t: 'TVL', num: 1, v: function (p) { return p.tvl_usd; }, h: function (p) { return usd(p.tvl_usd); } },
      { k: 'mcap', t: 'Market cap', num: 1, v: function (p) { return p.mcap_usd; }, h: function (p) { return p.mcap_usd ? usd(p.mcap_usd) : '<span class="na">none on record</span>'; } },
      { k: 'use', t: 'Role (tokenFamilies)', v: function (p) { return fam(p) ? 0 : 1; }, h: function (p) { var f = fam(p); return f ? 'Peer ' + esc(f.key) + ', ' + usd(f.tvl) + ' TVL in ' + f.members : '<span class="na">not fitted</span>'; } }
    ],
    aside: [
      { k: 'name', t: 'Protocol', v: function (a) { return a.p.name.toLowerCase(); }, h: function (a) { return '<b>' + esc(a.p.name) + '</b><small>' + esc(a.p.category || 'Uncategorised') + ' · ' + chainsShort(a.p.chains, 2) + '</small>'; } },
      { k: 'tvl', t: 'TVL', num: 1, v: function (a) { return a.p.tvl_usd; }, h: function (a) { return usd(a.p.tvl_usd); } },
      { k: 'why', t: 'Why it is set aside (productReason)', v: function (a) { return a.why; }, h: function (a) { return esc(a.why); } }
    ]
  };

  // ----filter and sort
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

  // ----header, funnel, model bar
  function renderFrame() {
    var c = D.board_check, sum = rows.reduce(function (s, r) { return s + r.value; }, 0), ok = c && c.rows === rows.length && c.value_sum_usd === sum && c.top === rows[0].slug;
    $('meta').innerHTML = '<span>Snapshot <b>' + esc(radar.as_of) + '</b></span><span class="chip ok">✓ watchlist ' + rows.filter(function (r) { return r.cls === 'watch'; }).length + '/' + radar.watchlist.length + ' ranked</span><span class="chip ' + (ok ? 'ok' : 'bad') + '">' + (ok ? '✓ this page = board.json: ' + rows.length + '/' + c.rows + ' rows, ' + usd(sum) + ' total' : 'This page\'s run differs from board.json') + '</span>';
    var n = function (cls) { return rows.filter(function (r) { return r.cls === cls; }).length; };
    $('funnel').innerHTML = '<b>' + radar.total + '</b> protocols in the snapshot → <b>' + radar.trading.length + '</b> record a token (the ' + radar.fit.n + ' tickers with a market cap set the curve; none is ranked) · <b>' + radar.aside.length + '</b> set aside as wrapped, staked, bridged or exchange products · <b>' + rows.length + '</b> ranked = <b>all ' + n('watch') + ' of the watchlist\'s ' + radar.watchlist.length + '</b> + ' + n('above') + ' more above the $' + radar.floor / 1e6 + 'M floor + ' + n('early') + ' early ones under it';
    var f = radar.fit, co = f.coef, span = function (k) { var v = rows.map(function (r) { return r[k]; }); return '×' + Math.min.apply(null, v).toFixed(2) + ' to ×' + Math.max.apply(null, v).toFixed(2); };
    $('modelbar').innerHTML = '<article><h3>How a value is built <code>scoreProtocol</code></h3><ol>' +
      '<li><b>Size curve</b> <code>log10 value = ' + f.a.toFixed(2) + ' + ' + f.b.toFixed(3) + ' · log10 TVL</code>: ten times the TVL is worth ×' + Math.pow(10, f.b).toFixed(1) + ', not ×10. Theil-Sen fit on the ' + f.n + ' tickers that trade.</li>' +
      '<li><b>× 7-day growth</b> against the peers\' week: ' + span('growth') + ' across this board.</li>' +
      '<li><b>× no-token tenure</b>, days tracked with no token: ' + span('tenure') + '. <b>× chains</b>: ' + span('breadth') + '.</li>' +
      '<li><b>× haircut</b> 0.4 if it shares a name with a traded token, 0.55 if a parent is on record.</li></ol>' +
      '<p>Band: the middle half of the blind misses, ÷' + Math.pow(10, -T.q25).toFixed(1) + ' to ×' + Math.pow(10, T.q75).toFixed(1) + '. Rank range: 200 bootstrap refits.</p>' +
      '<label class="share">Airdrop share of launch value <input type="range" id="share" min="2" max="15" step="1" value="' + esc(S.share) + '"><output>' + esc(S.share) + '%</output></label></article>' +
      '<article><h3>Traded tokens set the curve; the board sits on it</h3>' + drawScatter(null) + '<p>Grey: ' + f.n + ' traded tickers at their market cap. Blue: the ' + rows.length + ' ranked protocols at their implied value. Dashed: the size curve.</p></article>' +
      '<article><h3>Tested out of sample <code>compareModels</code></h3><table class="ladder"><thead><tr><th>Each priced blind</th><th class="num">Miss</th><th class="num">Within ×3</th><th class="num">Walk-fwd</th></tr></thead><tbody>' +
      radar.ladder.rungs.map(function (g) { return '<tr' + (g.terms === f.terms ? ' class="used"' : '') + '><td>' + g.name + (g.verdict ? '<small>' + g.verdict + '</small>' : '') + '</td><td class="num">×' + g.miss.toFixed(2) + '</td><td class="num">' + Math.round(g.within3 * 100) + '%</td><td class="num">×' + g.split.miss.toFixed(2) + '</td></tr>'; }).join('') +
      '</tbody></table><p>Miss: median error pricing each ticker with a fit that never saw it. Walk-fwd: fit on the ' + T.split.train + ' listed before ' + T.split.cut + ', price the ' + T.split.test + ' after. Growth and tenure stay by design, capped.</p></article>';
  }

  // ----controls
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
      (ranked ? '<div class="seg" aria-label="Class">' + seg('', 'All') + seg('watch', 'Watchlist') + seg('early', 'Early') + seg('above', 'Above floor') + '</div>' : '') +
      '<select id="cat" aria-label="Category">' + options(tally(list, function (p) { return p.category || 'Uncategorised'; }), S.cat, 'All categories') + '</select>' +
      '<select id="chain" aria-label="Chain">' + options(tally(list, function (p) { return p.chains; }).slice(0, 40), S.chain, 'All chains') + '</select>' +
      '<select id="min" aria-label="Minimum TVL">' + options([['20000000', 'TVL ≥ $20M'], ['50000000', 'TVL ≥ $50M'], ['200000000', 'TVL ≥ $200M']], S.min, 'Any TVL') + '</select>' +
      (ranked ? '<select id="verdict" aria-label="Verdict">' + options([['Farm', 'Farm'], ['Marginal', 'Marginal'], ['Skip', 'Skip']], S.verdict, 'Any verdict') + '</select>' +
        '<select id="grade" aria-label="Confidence">' + options([['A', 'Confidence A'], ['B', 'Confidence B'], ['C', 'Confidence C']], S.grade, 'Any confidence') + '</select>' : '') +
      '<button type="button" class="reset" data-act="reset">Reset</button><p class="count" id="count" aria-live="polite"></p>';
  }

  // ----the board
  function renderBoard() {
    var cols = COLS[S.view];
    shown = applyFilters();
    $('board').tHead.innerHTML = '<tr>' + cols.map(function (c) {
      var on = c.k === S.sort || (!cols.some(function (x) { return x.k === S.sort; }) && c === cols[0]);
      return '<th' + (c.num ? ' class="num"' : '') + (on ? ' aria-sort="' + (S.dir === 'asc' ? 'ascending' : 'descending') + '"' : '') + '><button type="button" data-sort="' + c.k + '"' + (c.tip ? ' title="' + esc(c.tip) + '"' : '') + '>' + c.t + (on ? (S.dir === 'asc' ? ' ▲' : ' ▼') : '') + '</button></th>';
    }).join('') + '</tr>';
    // One row at a time opens its farm steps in the table itself: the first row by default, any row by its "steps" button.
    var open = S.view !== 'ranked' || S.x === 'none' ? null : S.x || (shown[0] && shown[0].slug);
    $('board').tBodies[0].innerHTML = shown.map(function (x) {
      return '<tr' + (S.view === 'ranked' ? ' tabindex="0" data-slug="' + esc(x.slug) + '"' + (x.slug === S.p ? ' class="on"' : '') : '') + '>' + cols.map(function (c) { return '<td' + (c.num ? ' class="num"' : '') + '>' + c.h(x) + '</td>'; }).join('') + '</tr>' +
        (x.slug === open ? '<tr class="plan"><td></td><td colspan="' + (cols.length - 1) + '"><b>How to farm ' + esc(x.name) + ': ' + usd(x.plan.size) + ' on ' + esc(x.plan.chain) + ', ' + usd(x.plan.cost) + ' whole cost, ' + x.plan.hours.toFixed(1) + ' hours over ' + x.plan.weeks + ' weeks</b><ol>' + x.plan.steps.map(function (s) { return '<li><i>' + esc(s.when) + '</i> ' + esc(s.what) + ' <em>' + (s.cost > 0 ? usd(s.cost) : 'free') + ' · ' + s.min + ' min</em></li>'; }).join('') + '</ol></td></tr>' : '');
    }).join('');
    $('empty').hidden = shown.length > 0;
    var total = (S.view === 'ranked' ? rows : radar[S.view]).length, col = cols.filter(function (c) { return c.k === S.sort; })[0] || cols[0];
    var active = [CLASS[S.cls], S.cat, S.chain, S.verdict && 'verdict ' + S.verdict, S.grade && 'confidence ' + S.grade, S.min && 'TVL ≥ ' + usd(Number(S.min)), S.q && '“' + esc(S.q) + '”'].filter(Boolean);
    $('count').innerHTML = (active.length ? '<span class="filtered">Filtered: ' + active.map(esc).join(' + ') + '</span> ' : '') + '<b>' + shown.length + '</b> of ' + total + (S.view === 'ranked' ? ' ranked protocols' : S.view === 'trading' ? ' protocols whose token trades' : ' set-aside products') + ' · sorted by ' + col.t + (S.dir === 'asc' ? ' ▲' : ' ▼');
  }

  // ----the detail view
  /** The traded protocols nearest in TVL, same category first: the comparables a reader can check by hand. */
  function nearestComps(r, n) {
    var d = function (p) { return Math.abs(Math.log(p.tvl / r.tvl)); };
    var kind = M.archetypeOf(r.category).key, tier = function (p) { return p.category === r.category ? 0 : M.archetypeOf(p.category).key === kind ? 1 : 2; };
    return radar.fit.peers.slice().sort(function (a, b) { return tier(a) - tier(b) || d(a) - d(b); }).slice(0, n);
  }
  /** Every traded peer as a dot (TVL across, market cap up, both log), the fitted curve, and this protocol on it. */
  function drawScatter(r) {
    var W = 560, H = 230, L = 46, B = 26, f = radar.fit, x0 = 6.6, x1 = 10.6, y0 = 4.5, y1 = 10.6, lg = function (v) { return Math.log(v) / Math.LN10; };
    var X = function (v) { return L + (lg(v) - x0) / (x1 - x0) * (W - L - 8); }, Y = function (v) { return H - B - (lg(v) - y0) / (y1 - y0) * (H - B - 8); };
    var s = '<svg class="scatter" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Market cap against TVL, traded peers">';
    [5, 6, 7, 8, 9, 10].forEach(function (e) { s += '<line class="grid" x1="' + L + '" x2="' + (W - 8) + '" y1="' + Y(Math.pow(10, e)) + '" y2="' + Y(Math.pow(10, e)) + '"/><text class="ax" x="' + (L - 6) + '" y="' + (Y(Math.pow(10, e)) + 4) + '" text-anchor="end">' + round$(e) + '</text>'; });
    [7, 8, 9, 10].forEach(function (e) { s += '<text class="ax" x="' + X(Math.pow(10, e)) + '" y="' + (H - 8) + '" text-anchor="middle">' + round$(e) + ' TVL</text>'; });
    s += '<text class="ax" x="' + (L + 6) + '" y="16">market cap</text>';
    f.peers.forEach(function (p) { var same = r && p.category === r.category; s += '<circle class="' + (same ? 'peer same' : 'peer') + '" cx="' + X(p.tvl).toFixed(1) + '" cy="' + Y(Math.min(Math.max(p.mcap, 4e4), 3e10)).toFixed(1) + '" r="' + (same ? 4 : 2.5) + '"/>'; });
    var c = function (e) { return Math.pow(10, f.a + f.b * e); };
    s += '<line class="fit" x1="' + X(Math.pow(10, x0)) + '" y1="' + Y(c(x0)) + '" x2="' + X(Math.pow(10, x1)) + '" y2="' + Y(c(x1)) + '"/>';
    if (r) s += '<line class="whisk" x1="' + X(r.tvl) + '" x2="' + X(r.tvl) + '" y1="' + Y(r.lo) + '" y2="' + Y(r.hi) + '"/><circle class="me" cx="' + X(r.tvl) + '" cy="' + Y(r.value) + '" r="6"/>';
    else rows.forEach(function (q) { s += '<circle class="mine" cx="' + X(q.tvl).toFixed(1) + '" cy="' + Y(q.value).toFixed(1) + '" r="2.5"/>'; });
    return s + '</svg>';
  }
  function renderDetail() {
    var r = bySlug[S.p], el = $('detail');
    el.hidden = $('scrim').hidden = !r;
    if (!r) return;
    var f = farm(r), pl = r.plan, cat = radar.fit.offsets[r.category];
    var step = function (label, input, factor, running) { var w = Math.min(50, Math.abs(Math.log(factor)) / Math.log(2.5) * 50); return '<tr><th>' + label + '</th><td>' + input + '</td><td class="num">' + (factor === null ? '' : times(factor)) + '</td><td class="bar">' + (factor === null ? '' : '<i class="' + (factor >= 1 ? 'up' : 'down') + '" style="width:' + w.toFixed(1) + '%;' + (factor >= 1 ? 'left:50%' : 'right:50%') + '"></i>') + '</td><td class="num">' + usd(running) + '</td></tr>'; };
    var run = r.curve, walk = step('Peer curve', usd(r.tvl) + ' of TVL on the fitted curve', null, run);
    var co = radar.fit.coef, beta = function (k) { return ' <span class="na">· slope ' + co[k].post.toFixed(3) + ' (prior ' + co[k].prior + ', peers ' + co[k].fit.toFixed(2) + '±' + co[k].se.toFixed(2) + ')</span>'; };
    [['Category', esc(r.category) + ': ' + (radar.fit.terms.category ? (cat ? cat.n : 0) + ' traded peers, median residual shrunk' : 'no offset: category offsets lost the blind test'), r.catMult],
      ['7d growth', (r.change7d == null ? 'not reported: neutral' : 'TVL ' + (r.change7d >= 0 ? '+' : '−') + Math.abs(r.change7d).toFixed(1) + '%, against the peers\' average') + beta('g'), r.growth],
      ['No-token tenure', (r.days == null ? 'no listing date: neutral' : r.days + ' days tracked with no token') + beta('s'), r.tenure],
      ['Chain breadth', r.chains.length + ' chain' + (r.chains.length > 1 ? 's' : '') + beta('c'), r.breadth],
      ['Haircut', esc(r.why), r.haircut]
    ].forEach(function (s) { run *= s[2]; walk += step(s[0], s[1], s[2], run); });
    var comps = nearestComps(r, 5).map(function (p) { return '<tr><td><b>' + esc(p.name) + '</b> <span class="na">' + esc(p.key) + '</span></td><td>' + esc(p.category || '') + '</td><td class="num">' + usd(p.tvl) + '</td><td class="num">' + usd(p.mcap) + '</td><td class="num">' + times(p.mcap / p.tvl) + '</td></tr>'; }).join('');
    var at = shown.indexOf(r);
    el.innerHTML = '<header><div><p class="eyebrow">Rank ' + r.rank + ' of ' + rows.length + ' (' + r.rankLo + ' to ' + r.rankHi + ' in 90% of 200 bootstrap refits)· <span class="tag ' + r.cls + '">' + CLASS[r.cls] + '</span></p><h2 id="d-name">' + esc(r.name) + '</h2><p class="sub">' + esc(r.category) + ' on ' + chainsShort(r.chains, 6) + ' · TVL ' + usd(r.tvl) + ' · records no token</p></div>' +
      '<nav><button type="button" data-step="-1"' + (at > 0 ? '' : ' disabled') + '>← Prev</button><button type="button" data-step="1"' + (at >= 0 && at < shown.length - 1 ? '' : ' disabled') + '>Next →</button><button type="button" class="close" data-act="close">Close ✕</button></nav></header>' +
      '<div class="cols"><section><h3>Implied value</h3><div class="hero"><b>' + usd(r.value) + '</b><span>blind-test band ' + usd(r.lo) + ' to ' + usd(r.hi) + ' · ' + times(r.multiple) + ' TVL · confidence <span class="grade ' + r.grade + '">' + r.grade + '</span> ' + r.conf + '/100</span></div>' +
      '<table class="walk"><thead><tr><th>Step</th><th>From the snapshot</th><th class="num">Factor</th><th></th><th class="num">Running</th></tr></thead><tbody>' + walk + '</tbody></table>' +
      '<h3>Where it sits among the ' + radar.fit.n + ' traded peers</h3>' + drawScatter(r) + '<p class="legend">Blue: ' + esc(r.name) + ' and its band · gold: ' + esc(r.category) + ' peers</p>' +
      '<h3>Nearest comparables that trade</h3><table class="comps"><thead><tr><th>Protocol</th><th>Category</th><th class="num">TVL</th><th class="num">Market cap</th><th class="num">Mcap ÷ TVL</th></tr></thead><tbody>' + comps + '</tbody></table></section>' +
      '<section><h3>Farm plan <span class="verdict ' + f.verdict + '">' + f.verdict + ' ' + times(f.edge) + '</span></h3>' +
      '<div class="tiles"><div><b>' + usd(pl.size) + '</b><span>capital, on ' + esc(pl.chain) + '</span></div><div><b>' + usd(pl.cost) + '</b><span>whole cost: ' + usd(pl.gas) + ' gas' + (pl.carry ? ' + ' + usd(pl.carry) + ' idle cash' : ', deposit keeps earning') + '</span></div><div><b>' + pl.hours.toFixed(1) + ' h</b><span>over ' + pl.weeks + ' weeks</span></div><div><b>' + usd(f.drop) + '</b><span>modelled drop at ' + esc(S.share) + '% share; ' + usd(f.low) + ' at the band\'s low end</span></div><div class="' + (f.net >= 0 ? 'gain' : 'loss') + '"><b>' + usd(f.net) + '</b><span>net of cost</span></div></div>' +
      '<p class="why">' + (f.verdict === 'Farm' ? 'The modelled drop is ' + times(f.edge) + ' the cost and still covers it at the band\'s low end: worth the ' + pl.hours.toFixed(1) + ' hours.' : f.verdict === 'Marginal' ? 'The modelled drop covers the cost ' + times(f.edge) + ': farm it only if you would use it anyway.' : 'The modelled drop does not cover the cost (' + times(f.edge) + '): its TVL dilutes a ' + usd(pl.size) + ' position. Skip.') + '</p>' +
      '<p class="be">Break-even: the plan pays for itself if the launch is worth ' + usd(pl.breakEven * M.AIRDROP_SHARE * 100 / Number(S.share)) + ' or more (' + (100 / f.edge).toFixed(0) + '% of the modelled value). Net per hour of your time: ' + usd(f.net / pl.hours) + '.</p>' +
      '<ol class="steps">' + pl.steps.map(function (s) { return '<li><p><b>' + esc(s.when) + '</b> ' + esc(s.what) + '.</p><span class="cost">' + (s.cost > 0 ? usd(s.cost) : 'free') + '</span><span class="time">' + (s.min >= 60 ? (s.min / 60).toFixed(0) + ' h' : s.min + ' min') + '</span><small>' + esc(s.note) + '</small></li>'; }).join('') + '</ol>' +
      '<h3>The same plan at other sizes</h3><p>' + [pl.size / 2, pl.size * 5].map(function (c) { var q = M.farmPlan(r, c), g = farm(r, q); return 'With ' + usd(c) + ': ' + usd(q.cost) + ' cost, ' + usd(g.drop) + ' modelled drop, net ' + usd(g.net) + ' <span class="verdict ' + g.verdict + '">' + g.verdict + ' ' + times(g.edge) + '</span>'; }).join('<br>') + '</p></section></div>';
    el.querySelector('.close').focus();
  }

  // ----wiring
  function render() { renderFrame(); renderControls(); renderBoard(); renderDetail(); }
  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-x],[data-sort],[data-view],[data-cls],[data-act],[data-step],tr[data-slug]');
    if (e.target.id === 'scrim') return set({ p: '' });
    if (!t) return;
    var d = t.dataset;
    if (d.x) set({ x: t.closest('tr').nextElementSibling && t.closest('tr').nextElementSibling.className === 'plan' ? 'none' : d.x });
    else if (d.sort) set(S.sort === d.sort ? { dir: S.dir === 'asc' ? 'desc' : 'asc' } : { sort: d.sort, dir: d.sort === 'rank' || d.sort === 'name' || d.sort === 'why' ? 'asc' : 'desc' });
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
  });
  window.addEventListener('hashchange', function () { readHash(); render(); });
  readHash(); render();
})();
