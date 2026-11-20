// Token Radar's dashboard (radar-2). It reads window.RADAR (written beside dashboard/ by main.ts)
// and renders the ranked board, a filterable table, a per-protocol detail drawer with the model's
// own factors and the protocol's farm plan. No network: every byte it shows is in data.js.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', chain: 'all', scope: 'all', sort: 'implied', dir: -1, selected: null };

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function fmtMult(n) { return n.toFixed(3) + 'x'; }
  // The model in one function, the same arithmetic lib/model.ts runs: the page recomputes a row
  // from the snapshot figures and checks the number board.json carries.
  function impliedOf(row, model) {
    var g = row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d;
    var spike = Math.max(0, g - model.spike_start) / 100;
    var growthMult = 1 + model.growth_scale * (Math.tanh(g / model.growth_width) / (1 + spike * spike));
    var age = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
    var maturity = model.age_floor + model.age_range * (1 - Math.pow(2, -age / model.age_half_life_days));
    var base = model.anchor_usd * Math.pow(row.tvl_usd / model.anchor_tvl_usd, model.tvl_exponent);
    return Math.max(1, Math.round(base * growthMult * maturity));
  }
  function growthOf(row, model) {
    var g = row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d;
    var spike = Math.max(0, g - model.spike_start) / 100;
    return 1 + model.growth_scale * (Math.tanh(g / model.growth_width) / (1 + spike * spike));
  }
  function maturityOf(row, model) {
    var age = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
    return model.age_floor + model.age_range * (1 - Math.pow(2, -age / model.age_half_life_days));
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // The farm plan is the same derivation main.ts writes to board.json: category, chains, TVL and age
  // decide the action, the review and every cost and time. No name is special-cased.
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function familyOf(p) {
    var c = (p.category || '').toLowerCase();
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'curator';
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'lending';
    if (c.indexOf('dex') >= 0 || c.indexOf('liquidity manager') >= 0) return 'dex';
    if (c.indexOf('rwa') >= 0) return 'rwa';
    if (c.indexOf('basis') >= 0) return 'basis';
    if (c.indexOf('yield') >= 0) return 'yield';
    if (c.indexOf('restak') >= 0) return 'restaking';
    if (c.indexOf('liquid staking') >= 0) return 'liquid-staking';
    if (c.indexOf('staking') >= 0) return 'staking';
    if (c.indexOf('bridge') >= 0) return 'bridge';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'derivatives';
    if (c.indexOf('insurance') >= 0) return 'insurance';
    if (c.indexOf('stable') >= 0) return 'stable';
    if (c.indexOf('prediction') >= 0) return 'prediction';
    if (c.indexOf('payment') >= 0) return 'payments';
    if (c.indexOf('governance') >= 0) return 'governance';
    if (c.indexOf('chain') >= 0 && c.indexOf('blockchain') < 0) return 'chain';
    if (c.indexOf('cedefi') >= 0) return 'cedefi';
    return 'other';
  }
  function subjectOf(family) {
    if (family === 'curator') return 'vault';
    if (family === 'dex') return 'pool';
    if (family === 'lending') return 'market';
    if (family === 'bridge') return 'route';
    if (family === 'staking') return 'stake';
    if (family === 'liquid-staking') return 'receipt';
    if (family === 'restaking') return 'vault';
    if (family === 'insurance') return 'policy';
    if (family === 'governance') return 'program';
    return 'position';
  }
  function verifyStep(p, family, chain) {
    var subject = subjectOf(family);
    if (family === 'governance') {
      return { text: 'Check whether ' + p.name + ' runs a governance program you can join without a token, on its own forum or docs. If it needs a token that does not exist yet, there is nothing to farm — watch the announcements step instead.', cost: 'no fee to check', time: '15 minutes' };
    }
    if (family === 'rwa') {
      return { text: 'Read ' + p.name + '\'s own eligibility, minimum subscription and redemption terms for its ' + subject + ' on ' + chain + '. If you are not eligible, stop here — do not farm a gated product through a third party.', cost: 'no fee to check', time: '15 minutes' };
    }
    if (family === 'liquid-staking') {
      return { text: 'Read ' + p.name + '\'s own docs for which asset it takes and what receipt token it issues, and confirm the receipt still trades near its redemption value. If the receipt trades at a deep discount, the exit is broken — stop here.', cost: 'no fee to check', time: '15 minutes' };
    }
    if (family === 'restaking') {
      return { text: 'Read ' + p.name + '\'s own slashing conditions and withdrawal queue before you deposit anything. If the slashing terms or the unbonding wait are not published, stop here — restaking without published terms is an unpriced risk.', cost: 'no fee to check', time: '15 minutes' };
    }
    return { text: 'Find the exact ' + subject + ' on ' + p.name + '\'s own site and read its rules — minimum deposit, lock or withdrawal queue, and which asset it takes. If you cannot verify the ' + subject + ' from the protocol\'s own pages, stop here.', cost: 'no fee to check', time: '15 minutes' };
  }
  function actionStep(p, family, chain) {
    var name = p.name;
    var budget = '$50 (illustrative)';
    if (family === 'curator') return { text: 'Deposit ' + budget + ' of USDC into a vault ' + name + ' manages on ' + chain + ' and keep the shares. If the vault\'s minimum is above $50, size up only to an amount you can leave untouched, or skip this protocol.', cost: '$50 of capital and about $4 of gas', time: '15 minutes to set up' };
    if (family === 'lending') return { text: 'Supply ' + budget + ' of USDC to ' + name + '\'s market on ' + chain + ' and keep the position open. If the market\'s minimum is above $50, size up only to an amount you can leave untouched, or skip it.', cost: '$50 of capital and about $4 of gas', time: '15 minutes to set up' };
    if (family === 'dex') return { text: 'Provide ' + budget + ' of liquidity to ' + name + '\'s main pool on ' + chain + ' and keep the position open. Skip the pool if you cannot read its fee tier and range from the protocol\'s own page.', cost: '$50 of capital and about $4 of gas', time: '15 minutes to set up' };
    if (family === 'rwa') return { text: 'Subscribe ' + budget + ' to ' + name + '\'s offering on ' + chain + ' once eligibility is confirmed, and hold the asset. If redemptions are locked for longer than you can wait, skip it.', cost: '$50 of capital and about $4 of gas', time: '15 minutes to set up' };
    if (family === 'basis') return { text: 'Deposit ' + budget + ' of USDC into ' + name + '\'s basis vault on ' + chain + ' and keep the shares. If the vault is closed to new deposits, stop — do not buy a share second-hand.', cost: '$50 of capital and about $4 of gas', time: '15 minutes to set up' };
    if (family === 'yield') return { text: 'Deposit ' + budget + ' of USDC into ' + name + '\'s main vault on ' + chain + ' and keep the shares. If the vault\'s strategy or fees are not published, skip it.', cost: '$50 of capital and about $4 of gas', time: '15 minutes to set up' };
    if (family === 'staking') return { text: 'Stake ' + budget + ' of the chain\'s staking asset through ' + name + ' and keep the receipt. If ' + name + ' issues a receipt token, hold it — do not sell it.', cost: '$50 of capital and about $4 of gas', time: '15 minutes to set up' };
    if (family === 'liquid-staking') return { text: 'Deposit ' + budget + ' of the underlying asset into ' + name + ' on ' + chain + ' and hold the receipt token it issues. The receipt itself accrues the yield — do not sell it. If the receipt trades below its redemption value, hold it instead of paying to exit.', cost: '$50 of capital and about $4 of gas', time: '15 minutes to set up' };
    if (family === 'restaking') return { text: 'Deposit ' + budget + ' of the receipt token into ' + name + '\'s restaking vault on ' + chain + ' and keep the position. If the vault is closed to new deposits or the unbonding wait is longer than you can wait, skip it.', cost: '$50 of capital and about $4 of gas', time: '15 minutes to set up' };
    if (family === 'bridge') return { text: 'Bridge ' + budget + ' of USDC to ' + chain + ' through ' + name + ' and use the bridged funds in one of that chain\'s apps, instead of bridging straight back.', cost: '$50 of capital and about $4 of gas', time: '15 minutes to set up' };
    if (family === 'derivatives') return { text: 'Deposit ' + budget + ' of USDC as margin on ' + name + ' and open one small hedged position. Close it within the week unless the protocol\'s own rules reward holding it.', cost: '$50 of capital and about $4 of gas', time: '15 minutes to set up' };
    if (family === 'insurance') return { text: 'Buy ' + budget + ' of cover from ' + name + ' on ' + chain + ' and keep the policy until it expires. Read what the cover excludes before you pay.', cost: '$50 of capital and about $4 of gas', time: '15 minutes to set up' };
    if (family === 'stable') return { text: 'Mint or deposit ' + budget + ' of the stable asset through ' + name + ' on ' + chain + '. If the peg mechanism is not documented, skip it.', cost: '$50 of capital and about $4 of gas', time: '15 minutes to set up' };
    if (family === 'prediction') return { text: 'Fund ' + budget + ' and place one market position on ' + name + '. A prediction market pays for being right, not for activity — one position is the plan.', cost: '$50 of capital and about $4 of gas', time: '15 minutes to set up' };
    if (family === 'payments') return { text: 'Move ' + budget + ' through ' + name + ' on ' + chain + ' and keep the receipt. A payment rail with no points program is a weak farm — check the rewards step before you spend more.', cost: '$50 of capital and about $4 of gas', time: '15 minutes to set up' };
    if (family === 'governance') return { text: 'Join the governance program ' + name + ' documents — forum, delegation or testnet — and take part once. If it needs a token that does not exist yet, there is nothing to do here.', cost: 'no fee to join', time: '15 minutes to set up' };
    if (family === 'chain') return { text: 'Bridge ' + budget + ' to ' + chain + ' through its official bridge, use one of its native apps, and keep the position. A chain\'s token, if it comes, usually rewards early users of the chain itself.', cost: '$50 of capital and about $4 of gas', time: '15 minutes to set up' };
    if (family === 'cedefi') return { text: 'Deposit ' + budget + ' into ' + name + '\'s product on ' + chain + ' and keep the position. CeDeFi products are custodial — confirm who holds the funds before you deposit.', cost: '$50 of capital and about $4 of gas', time: '15 minutes to set up' };
    return { text: 'Deposit ' + budget + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open. If the minimum is above $50, size up only to an amount you can leave untouched, or skip it.', cost: '$50 of capital and about $4 of gas', time: '15 minutes to set up' };
  }
  function reviewStep(p, family) {
    var name = p.name;
    if (family === 'curator') return { text: 'Once a week, read the curator\'s rebalance or allocation notes for your vault and confirm your shares are still in it. Do not move funds just to generate activity.', cost: 'about $2 of gas a week, only when you act', time: '10 minutes a week' };
    if (family === 'lending') return { text: 'Once a week, check the borrow rate and your position\'s health on ' + name + ', and top up collateral only if it is close to liquidation.', cost: 'about $2 of gas a week, only when you act', time: '10 minutes a week' };
    if (family === 'dex') return { text: 'Once a week, check the pool\'s fees and your share on ' + name + '. If the price moved out of your range, decide once whether to re-range — do not churn it.', cost: 'about $2 of gas a week, only when you act', time: '10 minutes a week' };
    if (family === 'rwa') return { text: 'Once a week, check the redemption window and the asset\'s backing report for ' + name + '. If redemptions are paused, wait — do not exit through a third party.', cost: 'about $2 of gas a week, only when you act', time: '10 minutes a week' };
    if (family === 'staking') return { text: 'Once a week, confirm your stake and its receipt are still in place on ' + name + '. Restaking rewards accrue to the position, not to transactions.', cost: 'about $2 of gas a week, only when you act', time: '10 minutes a week' };
    if (family === 'derivatives') return { text: 'Once a week, check the margin on ' + name + ' and close or roll the position. Do not hold a leveraged position you are not watching.', cost: 'about $2 of gas a week, only when you act', time: '10 minutes a week' };
    if (family === 'liquid-staking') return { text: 'Once a week, check the receipt token\'s price against its redemption value and confirm your balance is still in place on ' + name + '. A receipt that drifts from redemption value is the position telling you something — do not ignore it.', cost: 'about $2 of gas a week, only when you act', time: '10 minutes a week' };
    if (family === 'restaking') return { text: 'Once a week, check the slashing status and the withdrawal queue on ' + name + '. Restaked positions are the ones that get cut when something breaks — a weekly check is the whole job.', cost: 'about $2 of gas a week, only when you act', time: '10 minutes a week' };
    return { text: 'Once a week, open the position on ' + name + ' and confirm it is still active. A review is activity enough — do not transact just to make noise.', cost: 'about $2 of gas a week, only when you act', time: '10 minutes a week' };
  }
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }
  function farmSteps(p) {
    var chain = chainOf(p);
    var family = familyOf(p);
    return [
      verifyStep(p, family, chain),
      actionStep(p, family, chain),
      reviewStep(p, family),
      { text: 'Open ' + p.name + '\'s own points or rewards page. If it documents a points program, confirm your position counts toward it; if it documents none, treat any future reward as unconfirmed and do not farm on a promise the protocol never made.', cost: 'no fee to check', time: '10 minutes' },
      { text: 'Watch ' + p.name + '\'s own announcements for snapshot dates and eligibility rules. Airdrops are announced by the protocol itself, never by a reply, a DM or a lookalike account.', cost: 'nothing', time: '5 minutes a week' },
      { text: 'Verify every contract address from ' + p.name + '\'s own docs before you sign. Never pay anyone to claim, never connect a wallet from a link someone sent you, and revoke the approval when you exit.', cost: 'nothing', time: '5 minutes' },
      { text: 'Write the wallet, the dates, the amounts and every transaction hash in a farm log, so you can prove the position later or unwind it.', cost: 'nothing but the log', time: '5 minutes' }
    ].map(stepText);
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    var params = new URLSearchParams(hash);
    state.q = params.get('q') || '';
    state.selected = params.get('p');
    state.category = params.get('category') || 'all';
    state.chain = params.get('chain') || 'all';
    state.scope = params.get('scope') || 'all';
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.scope !== 'all') params.set('scope', state.scope);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function scopedRows() {
    if (state.scope === 'watchlist') return DATA.rows.filter(function (r) { return r.on_watchlist; });
    if (state.scope === 'early') return DATA.rows.filter(function (r) { return !r.on_watchlist; });
    return DATA.rows;
  }
  function rows() {
    var q = state.q.trim().toLowerCase();
    return scopedRows().filter(function (r) {
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark' }), el('span', { class: 'brand-name', text: 'Token Radar' })),
      el('div', { class: 'top-meta' },
        el('span', { text: 'Snapshot ' + DATA.as_of }),
        el('span', { text: 'DefiLlama protocol index' }),
        el('span', { text: DATA.model_version + ' model' })
      )
    );
  }

  function lede() {
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: DATA.watchlist_size + ' watchlist protocols, ranked by implied value' }),
        el('p', { text: 'The watchlist is the floor: every protocol with at least $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL and no token on record. The early radar adds ' + DATA.early_size + ' pre-token protocols below that floor, scored by the same model. Implied value is a valuation proxy, not a promise of an airdrop.' })
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
        el('div', { class: 'fact' }, el('span', { text: 'Pre-token rows scored' }), el('b', { text: String(DATA.board_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Early rows below the floor' }), el('b', { text: String(DATA.early_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Live-token protocols set aside' }), el('b', { text: String(DATA.live_size) }))
      )
    );
  }

  function scopeButton(scope, label) {
    return el('button', { type: 'button', 'aria-pressed': state.scope === scope ? 'true' : 'false', text: label, onclick: function () { state.scope = scope; writeHash(); render(); } });
  }
  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.reduce(function (acc, r) { return acc.concat(r.chains || []); }, []))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var catSelect = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    catSelect.addEventListener('change', function () { state.category = catSelect.value; writeHash(); render(); });
    var chainSelect = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', text: 'All chains' }),
      chains.map(function (c) { return el('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null }); })
    );
    chainSelect.addEventListener('change', function () { state.chain = chainSelect.value; writeHash(); render(); });
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), catSelect),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chainSelect),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Scope' }),
        el('div', { class: 'tabs' },
          scopeButton('all', 'All pre-token'),
          scopeButton('watchlist', 'Watchlist'),
          scopeButton('early', 'Early discovery'),
          scopeButton('live', 'Live token')
        )),
      el('span', { class: 'count', text: state.scope === 'live' ? DATA.live.length + ' live-token protocols' : rows().length + ' rows shown' })
    );
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  function boardTable() {
    var list = sortedRows(rows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.scope = 'all'; writeHash(); render(); } })
      ));
    }
    var max = list[0].implied_value_usd || 1;
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var nameCell = el('div', { class: 'name' },
        el('div', null,
          el('b', { text: r.name }),
          r.on_watchlist ? el('span', { class: 'tag', text: 'WATCHLIST' }) : null
        ),
        el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') })
      );
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', null, nameCell),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        )),
        el('td', null, el('span', { class: 'status', text: 'no token' }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Select a row for its model and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('implied', 'Implied value'),
            el('th', { scope: 'col', text: 'Token' })
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', { class: 'num', text: 'live' }),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', null, el('span', { class: 'status live', text: 'already trades' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Token' }))),
          tbody
        )
      )
    );
  }

  function modelPanel() {
    var m = DATA.model;
    var formula = 'implied = round( $' + (m.anchor_usd / 1e6) + 'M x (tvl_usd / $' + (m.anchor_tvl_usd / 1e6) + 'M)^' + m.tvl_exponent +
      ' x (1 + ' + m.growth_scale + ' x tanh(change_7d / ' + m.growth_width + ') / (1 + (max(0, change_7d - ' + m.spike_start + ') / 100)^2))' +
      ' x (' + m.age_floor + ' + ' + m.age_range + ' x (1 - 2^(-age_days / ' + m.age_half_life_days + '))) )';
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', { class: 'sub', text: 'Every row is scored by one function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked.' }),
      el('div', { class: 'formula', text: formula }),
      el('ul', null,
        el('li', { text: 'TVL enters sublinearly (power ' + m.tvl_exponent + '): a protocol ten times larger is not worth ten times more. The $' + (m.anchor_usd / 1e6) + 'M anchor keeps the 0.25x reference at $100M of TVL.' }),
        el('li', { text: 'Growth saturates: the bonus flattens past +40% a week and tapers away past +100%, so a +4,448% print counts for less than a +40% one — a one-week jump that large is usually a listing artifact, not durable growth.' }),
        el('li', { text: 'Age is a soft plateau: most of the token overhang accrues in the first year (about 0.88x), and extra years add little (about 0.96x at two years).' }),
        el('li', { text: 'Chain count and category stay out of the formula — the snapshot gives no benchmark for what either is worth. Category decides the farm plan, where it is verifiable. Missing growth scores neutral; missing age scores at the neutral one-year value.' })
      )
    );
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  // A factor bar centred on 1.00x: the fill runs from the centre line to the value.
  function factorBar(label, value) {
    var lo = 0.6, hi = 1.2, mid = (1 - lo) / (hi - lo) * 100;
    var at = Math.min(hi, Math.max(lo, value)) ;
    var pos = (at - lo) / (hi - lo) * 100;
    var left = Math.min(mid, pos), width = Math.abs(pos - mid);
    return el('div', { class: 'factor' },
      el('div', { class: 'factor-head' }, el('span', { text: label }), el('b', { text: fmtMult(value) })),
      el('div', { class: 'factor-track' },
        el('span', { class: 'mid' }),
        el('span', { class: 'fill', style: 'left:' + left.toFixed(1) + '%;width:' + Math.max(0.5, width).toFixed(1) + '%' })
      )
    );
  }

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var steps = farmSteps(row);
    var recomputed = impliedOf(row, DATA.model);
    var growth = growthOf(row, DATA.model);
    var maturity = maturityOf(row, DATA.model);
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size + (row.on_watchlist ? ' · on the watchlist' : ' · early discovery') }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'TVL base' }), el('b', { class: 'num', text: fmtUsd(row.tvl_base_usd) })),
        el('div', null, el('span', { text: 'Seven-day growth' }), el('b', { class: 'num', text: fmtPct(row.change_7d) })),
        el('div', null, el('span', { text: 'Age with no token' }), el('b', { class: 'num', text: fmtAge(row.age_days) })),
        el('div', { class: 'total' }, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) }))
      ),
      factorBar('Growth multiplier', growth),
      factorBar('Maturity multiplier', maturity),
      el('p', { class: 'factor-note', text: 'Bars are centred on 1.00x: a factor above the line lifts the value, below it cuts it. The two factors multiply; they are not shares of the total.' }),
      row.change_7d === null ? el('p', { class: 'factor-note flag', text: 'Seven-day growth not reported — scored neutral (1.00x).' }) : null,
      row.age_days === null ? el('p', { class: 'factor-note flag', text: 'Age unknown — scored at the neutral one-year value.' }) : null,
      el('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': the same function scores every protocol. The page recomputes this row as ' + fmtUsd(recomputed) + (recomputed === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' This is an estimate, not a price.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('ol', { class: 'steps' }, steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      }))
    ));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    shell.appendChild(controls());
    shell.appendChild(state.scope === 'live' ? liveTable() : boardTable());
    if (state.scope !== 'live') shell.appendChild(modelPanel());
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
    else if (dialog.open) dialog.close();
  }

  readHash();
  render();
  window.addEventListener('hashchange', function () { readHash(); render(); });
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
