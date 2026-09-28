// Bobyard takeoff ops review. Synthetic, deterministic data: one row per
// project type and trade for the last quarter (90 days). Everything on the
// page is computed from CELLS, nothing downstream is hardcoded.

const TRADES = ['Landscaping', 'Concrete', 'Drywall and framing', 'Electrical'];
// Trade effects: landscaping is the most mature takeoff surface, electrical
// symbol counts on dense sheets are the hardest.
const TRADE_FX = {
  'Landscaping':         { acc: +1.4, review: 0.80, cycle: 0.85 },
  'Concrete':            { acc: +0.5, review: 0.92, cycle: 0.95 },
  'Drywall and framing': { acc: -0.5, review: 1.08, cycle: 1.05 },
  'Electrical':          { acc: -2.6, review: 1.34, cycle: 1.20 },
};

// Per type: projects in quarter, base accuracy, base review hours, base cycle days, trade mix
const TYPES = [
  { name: 'Single family residential', projects: 412, acc: 96.0, review: 1.6, cycle: 1.4, mix: [.45, .25, .20, .10] },
  { name: 'Multi family',              projects: 186, acc: 92.6, review: 4.8, cycle: 3.1, mix: [.15, .25, .35, .25] },
  { name: 'Commercial office',         projects: 158, acc: 91.4, review: 5.6, cycle: 3.6, mix: [.10, .25, .35, .30] },
  { name: 'Retail and tenant fit out', projects: 224, acc: 93.9, review: 3.1, cycle: 2.2, mix: [.05, .15, .45, .35] },
  { name: 'Healthcare',                projects:  64, acc: 87.4, review: 9.4, cycle: 5.8, mix: [.05, .20, .35, .40] },
  { name: 'Industrial and warehouse',  projects: 132, acc: 95.1, review: 2.7, cycle: 1.9, mix: [.15, .50, .15, .20] },
  { name: 'Renovation and remodel',    projects: 268, acc: 88.6, review: 4.2, cycle: 2.9, mix: [.20, .15, .40, .25] },
  { name: 'K 12 education',            projects:  71, acc: 90.6, review: 6.3, cycle: 4.2, mix: [.20, .25, .30, .25] },
];

const jitter = (i, j, k) => (((i * 7 + j * 13 + k * 5) % 11) - 5) / 5; // deterministic, in [-1, 1]

const CELLS = [];
TYPES.forEach((t, i) => {
  // Largest remainder allocation so trade counts sum exactly to the type total
  const raw = t.mix.map(m => m * t.projects);
  const counts = raw.map(Math.floor);
  let left = t.projects - counts.reduce((a, b) => a + b, 0);
  raw.map((r, j) => [r - Math.floor(r), j]).sort((a, b) => b[0] - a[0]).slice(0, left).forEach(([, j]) => counts[j]++);
  TRADES.forEach((tr, j) => {
    const fx = TRADE_FX[tr];
    CELLS.push({
      type: t.name, trade: tr, projects: counts[j],
      acc: Math.min(99, t.acc + fx.acc + jitter(i, j, 1) * 0.8),
      review: t.review * fx.review * (1 + jitter(i, j, 2) * 0.06),
      cycle: t.cycle * fx.cycle * (1 + jitter(i, j, 3) * 0.05),
    });
  });
});

// Share of estimator review time that goes to correcting takeoff errors,
// as opposed to scope review and pricing judgement. Grows with error rate.
const errShare = acc => Math.min(0.8, Math.max(0.1, (100 - acc) * 0.07));
const lowConfShare = acc => Math.min(0.6, (100 - acc) * 0.019); // line items the model scores low confidence

const state = { trade: 'All trades', metric: 'err', target: 92, n: 3, cut: 50, rate: 85, sort: { col: 'rank', dir: 1 } };

function aggregate() {
  const cells = state.trade === 'All trades' ? CELLS : CELLS.filter(c => c.trade === state.trade);
  const rows = TYPES.map(t => {
    const cs = cells.filter(c => c.type === t.name && c.projects > 0);
    const projects = cs.reduce((a, c) => a + c.projects, 0);
    const w = f => cs.reduce((a, c) => a + f(c) * c.projects, 0) / (projects || 1);
    const acc = w(c => c.acc), review = w(c => c.review), cycle = w(c => c.cycle);
    const reviewHrs = cs.reduce((a, c) => a + c.review * c.projects, 0);
    const stake = cs.reduce((a, c) => a + c.review * c.projects * errShare(c.acc), 0);
    return { name: t.name, projects, acc, err: 100 - acc, review, cycle, reviewHrs, stake };
  }).filter(r => r.projects > 0);
  const ranked = [...rows].sort((a, b) => b.stake - a.stake);
  ranked.forEach((r, i) => { r.rank = i + 1; });
  rows.forEach(r => {
    const gap = state.target - r.acc;
    r.flag = gap > 0;
    r.action = gap > 3 ? 'Retrain, senior review' : gap > 0 ? 'Confidence gate' : 'Monitor';
  });
  return { rows, ranked, cells };
}

const $ = id => document.getElementById(id);
const F = Viz.fmt;
const METRICS = [
  { value: 'err', label: 'Error rate', title: 'Takeoff error rate by project type', fmt: v => v.toFixed(1) + '%', sub: 'Line items outside quantity tolerance, project weighted' },
  { value: 'review', label: 'Review hours', title: 'Estimator review hours per project', fmt: v => v.toFixed(1) + 'h', sub: 'Human review after AI takeoff, per project' },
  { value: 'cycle', label: 'Cycle time', title: 'Takeoff to bid cycle time', fmt: v => v.toFixed(1) + 'd', sub: 'Business days from plan upload to estimate sent' },
];

function impact(ranked) {
  const cut = state.cut / 100;
  const savedAt = n => ranked.slice(0, n).reduce((a, r) => a + r.stake * cut, 0);
  const saved = savedAt(state.n);
  const totalProjects = ranked.reduce((a, r) => a + r.projects, 0);
  const avgHrsPerBid = ranked.reduce((a, r) => a + (r.review + 1.2) * r.projects, 0) / totalProjects; // review plus setup
  const improved = ranked.slice(0, state.n);
  const cycleDaysSaved = improved.reduce((a, r) => a + r.cycle * errShare(r.acc) * cut * 0.6 * r.projects, 0);
  const projImproved = improved.reduce((a, r) => a + r.projects, 0);
  return {
    saved, savedAt, improved,
    fte: saved / 520,
    bids: saved / avgHrsPerBid,
    annual: saved * 4 * state.rate,
    cycleCut: projImproved ? cycleDaysSaved / projImproved : 0,
    projImproved, avgHrsPerBid,
  };
}

function render() {
  const { rows, ranked } = aggregate();
  const imp = impact(ranked);
  const c1 = Viz.css('--viz-1'), c2 = Viz.css('--viz-2');
  const m = METRICS.find(x => x.value === state.metric);
  const totalProjects = rows.reduce((a, r) => a + r.projects, 0);
  const avgAcc = rows.reduce((a, r) => a + r.acc * r.projects, 0) / totalProjects;
  const flagged = rows.filter(r => r.flag);
  const totalStake = rows.reduce((a, r) => a + r.stake, 0);
  const totalReview = rows.reduce((a, r) => a + r.reviewHrs, 0);

  // Tiles
  $('kpis').innerHTML = `
    <div class="stat"><div class="label">Projects processed</div><div class="num">${F.int(totalProjects)}</div><div class="desc">Last 90 days, ${state.trade.toLowerCase()}</div></div>
    <div class="stat"><div class="label">Avg takeoff accuracy</div><div class="num">${avgAcc.toFixed(1)}%</div><div class="desc">Project weighted, target ${state.target.toFixed(1)}%</div></div>
    <div class="stat"><div class="label">Types below target</div><div class="num">${flagged.length} of ${rows.length}</div><div class="desc">${F.int(flagged.reduce((a, r) => a + r.projects, 0))} projects carry the flag</div></div>
    <div class="stat"><div class="label">Review hours saved</div><div class="num">${F.int(imp.saved)}</div><div class="desc">Per quarter at the plan below, ${(imp.saved / totalReview * 100).toFixed(0)}% of all review time</div></div>`;

  // Primary bar chart, ordered by the chosen metric (worst first)
  $('barTitle').textContent = m.title;
  $('barSub').textContent = m.sub + ', ' + state.trade.toLowerCase();
  const byMetric = [...rows].sort((a, b) => b[state.metric] - a[state.metric]);
  Viz.hbar($('barChart'), {
    rows: byMetric.map(r => ({
      label: r.name, value: r[state.metric], color: r.flag ? c2 : c1,
      text: m.fmt(r[state.metric]) + (r.flag ? '  ▲' : ''),
      tip: Viz.tipHtml(r.name, [['Accuracy', r.acc.toFixed(1) + '%'], ['Review / project', r.review.toFixed(1) + 'h'], ['Cycle time', r.cycle.toFixed(1) + 'd'], ['Projects', F.int(r.projects)], ['Status', r.flag ? 'Below target' : 'On target']]),
    })),
    ref: state.metric === 'err' ? { value: 100 - state.target, label: 'limit ' + (100 - state.target).toFixed(1) + '%' } : undefined,
    fmt: m.fmt, axisFmt: state.metric === 'err' ? v => v + '%' : m.fmt,
  });

  // Scatter: volume vs error rate, sized by review hours
  const maxRev = Math.max(...rows.map(r => r.reviewHrs));
  Viz.scatter($('scatter'), {
    points: rows.map(r => ({
      x: r.projects, y: 100 - r.acc, r: 5 + 13 * Math.sqrt(r.reviewHrs / maxRev), color: r.flag ? c2 : c1,
      label: r.name, showLabel: r.rank <= 2 || r.err === Math.max(...rows.map(x => x.err)),
      tip: Viz.tipHtml(r.name, [['Projects', F.int(r.projects)], ['Error rate', (100 - r.acc).toFixed(1) + '%'], ['Review hours', F.int(r.reviewHrs)], ['Hrs at stake', F.int(r.stake)], ['Opportunity rank', '#' + r.rank]]),
    })),
    xLabel: 'Projects this quarter', yLabel: 'Takeoff error rate', yFmt: v => v + '%',
    refY: { value: 100 - state.target, label: 'error limit' },
  });

  renderTable(rows);
  renderFindings(rows, ranked, totalStake);
  renderActions(ranked, flagged);
  renderImpact(ranked, imp);
}

function renderTable(rows) {
  const sorted = Viz.sortRows(rows, state.sort);
  const maxStake = Math.max(...rows.map(r => r.stake));
  const topN = new Set(impact(rows.slice().sort((a, b) => b.stake - a.stake)).improved.map(r => r.name));
  $('rankBody').innerHTML = sorted.map(r => `
    <tr class="${topN.has(r.name) ? 'selected' : ''}">
      <td class="num rank">${r.rank}</td>
      <td class="name">${r.name}</td>
      <td class="num">${F.int(r.projects)}</td>
      <td class="num">${r.acc.toFixed(1)}%</td>
      <td class="num">${r.review.toFixed(1)}</td>
      <td class="num">${r.cycle.toFixed(1)}</td>
      <td class="num"><span class="bar-cell" style="width:${(r.stake / maxStake * 60).toFixed(0)}px"></span>${F.int(r.stake)}</td>
      <td><span class="tag ${r.action === 'Monitor' ? 'good' : 'flag'}">${r.action === 'Monitor' ? '' : '&#9650; '}${r.action}</span></td>
    </tr>`).join('');
  Viz.markSorted($('rankTable'), state.sort);
}

function renderFindings(rows, ranked, totalStake) {
  const totalProjects = rows.reduce((a, r) => a + r.projects, 0);
  const top2 = ranked.slice(0, 2);
  const top2Stake = top2.reduce((a, r) => a + r.stake, 0) / totalStake;
  const top2Proj = top2.reduce((a, r) => a + r.projects, 0) / totalProjects;
  const byVol = [...rows].sort((a, b) => b.projects - a.projects)[0];
  const r = Viz.pearson(rows.map(x => 100 - x.acc), rows.map(x => x.review));

  // Trade comparison: which trade is weakest inside the top opportunity type
  const topType = ranked[0].name;
  const tradeCells = CELLS.filter(c => c.type === topType && c.projects > 0).sort((a, b) => a.acc - b.acc);
  const worstTrade = tradeCells[0], bestTrade = tradeCells[tradeCells.length - 1];

  $('findings').innerHTML = `
    <div class="finding"><strong>Error cost is concentrated</strong><em>${top2[0].name}</em> and <em>${top2[1].name}</em> hold ${(top2Stake * 100).toFixed(0)}% of the review hours spent fixing takeoff errors while making up only ${(top2Proj * 100).toFixed(0)}% of projects. Two retraining targets, not eight, cover ${top2Stake >= 0.5 ? 'most of the problem' : 'the largest share of it'}.</div>
    <div class="finding"><strong>Volume is not opportunity</strong>The busiest type, <em>${byVol.name}</em> (${F.int(byVol.projects)} projects), ranks #${byVol.rank} on hours at stake because its takeoffs already land at ${byVol.acc.toFixed(1)}% and need about ${byVol.review.toFixed(1)} review hours each. Prioritizing by project count would point retraining at the wrong place.</div>
    <div class="finding"><strong>Errors drive review time</strong>Across project types, error rate and review hours per project move together (correlation r = ${r.toFixed(2)}). That is the case for treating accuracy as an operations lever: each point of accuracy on dense sheets shows up directly as estimator hours.</div>
    <div class="finding"><strong>Trade inside the top type</strong>Within ${topType}, ${worstTrade.trade.toLowerCase()} takeoffs land at ${worstTrade.acc.toFixed(1)}% against ${bestTrade.acc.toFixed(1)}% for ${bestTrade.trade.toLowerCase()}. The retraining set should oversample ${worstTrade.trade.toLowerCase()} sheets for that type rather than the type as a whole.</div>`;
}

function renderActions(ranked, flagged) {
  const a = ranked[0], b = ranked[1];
  const gated = flagged.filter(r => r.action === 'Confidence gate');
  const senior = flagged.filter(r => r.action === 'Retrain, senior review');
  const gateItems = flagged.reduce((s, r) => s + lowConfShare(r.acc) * r.projects, 0) / Math.max(1, flagged.reduce((s, r) => s + r.projects, 0));
  $('actions').innerHTML = `
    <li><div><h3>Retrain on ${a.name} first, then ${b.name}</h3><p>${a.name} is at ${a.acc.toFixed(1)}% accuracy and costs ${F.int(a.stake)} error correction hours a quarter, the largest single pool. Build the retraining set from this quarter's corrected takeoffs for that type.</p><div class="meta"><span class="tag flag">${F.int(a.stake + b.stake)} hrs at stake</span><span class="tag info">Model team</span></div></div></li>
    <li><div><h3>Add a confidence gate on flagged types</h3><p>${flagged.length ? `For ${flagged.map(r => r.name).join(', ')}, hold line items below the model's confidence cutoff for review instead of passing them straight to the estimate. At current accuracy that is roughly ${(gateItems * 100).toFixed(0)}% of line items, a small review load that catches errors before pricing.` : 'No project type is below target at this setting. Keep the gate ready but off.'}</p><div class="meta"><span class="tag flag">${flagged.length} types</span><span class="tag info">Product</span></div></div></li>
    <li><div><h3>Route the worst types to senior estimators</h3><p>${senior.length ? `${senior.map(r => r.name).join(' and ')} ${senior.length > 1 ? 'are' : 'is'} more than 3 points under target. Until retraining lands, send those takeoffs to a senior reviewer rather than the general queue so misses do not reach the bid.` : `No type is more than 3 points under target${gated.length ? `; the confidence gate covers ${gated.length} marginal type${gated.length > 1 ? 's' : ''}` : ''}. Senior routing is not needed at this setting.`}</p><div class="meta"><span class="tag alt">Estimating ops</span></div></div></li>
    <li><div><h3>Instrument corrections per sheet</h3><p>Log each estimator correction with project type, trade, and sheet ID. It turns this quarterly view into a weekly one and gives retraining a measured before and after instead of a projection.</p><div class="meta"><span class="tag good">Data, week one</span></div></div></li>`;
}

function renderImpact(ranked, imp) {
  $('nTypes').max = ranked.length;
  $('nTypesVal').textContent = state.n;
  $('cutVal').textContent = state.cut + '%';
  $('rateVal').textContent = '$' + state.rate;
  $('nTypesList').textContent = state.n ? 'Improving: ' + imp.improved.map(r => r.name).join(', ') : 'No types improved yet';
  $('impactOut').innerHTML = `
    <div class="big hero"><div class="label">Review hours returned per quarter</div><div class="num">${F.int(imp.saved)}</div><div class="desc">${imp.fte.toFixed(1)} estimator FTE of capacity, on ${F.int(imp.projImproved)} projects a quarter</div></div>
    <div class="big"><div class="label">Extra bids possible</div><div class="num">${F.int(imp.bids)}</div><div class="desc">Per quarter at ${imp.avgHrsPerBid.toFixed(1)} estimator hours per bid</div></div>
    <div class="big"><div class="label">Annual value</div><div class="num">${F.usd(imp.annual)}</div><div class="desc">Estimator time at $${state.rate} per hour</div></div>`;
  const pts = [];
  for (let n = 0; n <= ranked.length; n++) pts.push({ x: n, y: imp.savedAt(n) });
  Viz.line($('curve'), {
    points: pts, current: state.n, xLabel: 'Project types improved, in ranked order', xFmt: v => v, yFmt: v => F.k(v) + 'h',
    tipFor: p => Viz.tipHtml(p.x ? `Top ${p.x} type${p.x > 1 ? 's' : ''}` : 'No types', [['Hours saved', F.int(p.y)], ['Share of max', (p.y / (pts[pts.length - 1].y || 1) * 100).toFixed(0) + '%'], ['Added by this type', p.x ? F.int(p.y - pts[p.x - 1].y) : '0']]),
  });
  const share3 = pts[Math.min(3, pts.length - 1)].y / (pts[pts.length - 1].y || 1);
  $('assume').textContent = `The curve flattens fast: the top three types deliver ${(share3 * 100).toFixed(0)}% of what improving all ${ranked.length} would. Assumptions: savings come only from error correction time (not scope review), an FTE is 520 hours a quarter, and a bid takes review time plus 1.2 hours of setup. Cycle time on improved projects drops by about ${imp.cycleCut.toFixed(2)} days on average.`;
}

// Controls
function renderToggles() {
  Viz.toggle($('tradeToggle'), ['All trades', ...TRADES], state.trade, v => { state.trade = v; renderToggles(); render(); });
  Viz.toggle($('metricToggle'), METRICS, state.metric, v => { state.metric = v; renderToggles(); render(); });
}
$('target').addEventListener('input', e => { state.target = +e.target.value; $('targetVal').textContent = state.target.toFixed(1) + '%'; render(); });
$('nTypes').addEventListener('input', e => { state.n = +e.target.value; render(); });
$('cut').addEventListener('input', e => { state.cut = +e.target.value; render(); });
$('rate').addEventListener('input', e => { state.rate = +e.target.value; render(); });
Viz.sortable($('rankTable'), state.sort, render);

renderToggles();
render();
