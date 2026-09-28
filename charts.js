// Small inline SVG chart helpers shared by the dashboard. No chart library.
// Colors come from CSS custom properties in styles.css, so a restyle never
// touches this file.

const Viz = (() => {
  const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function niceStep(range, target) {
    const raw = range / Math.max(1, target);
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const norm = raw / mag;
    const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
    return step * mag;
  }
  function ticks(min, max, target = 5) {
    const step = niceStep(max - min, target);
    const out = [];
    for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-6; v += step) out.push(+v.toFixed(10));
    return out;
  }
  function niceMax(max, target = 5) {
    const step = niceStep(max, target);
    return Math.ceil(max / step) * step;
  }

  // Tooltip layer. Any SVG element with data-tip="i" shows tips[i] on hover or keyboard focus.
  function bindTips(wrap, tips) {
    let tip = wrap.querySelector('.tooltip');
    if (!tip) {
      tip = document.createElement('div');
      tip.className = 'tooltip';
      tip.setAttribute('role', 'status');
      wrap.appendChild(tip);
    }
    const place = (x, y) => {
      const w = wrap.clientWidth, tw = tip.offsetWidth, th = tip.offsetHeight;
      let left = x + 14, top = y - th - 10;
      if (left + tw > w) left = Math.max(0, x - tw - 14);
      if (top < -20) top = y + 16;
      tip.style.left = left + 'px';
      tip.style.top = top + 'px';
    };
    const show = (i, x, y) => {
      if (tips[i] == null) return;
      tip.innerHTML = tips[i];
      tip.classList.add('on');
      place(x, y);
    };
    const hide = () => tip.classList.remove('on');
    wrap.onmousemove = e => {
      const t = e.target.closest('[data-tip]');
      if (!t || !wrap.contains(t)) return hide();
      const r = wrap.getBoundingClientRect();
      show(+t.dataset.tip, e.clientX - r.left, e.clientY - r.top);
    };
    wrap.onmouseleave = hide;
    wrap.onfocusin = e => {
      const t = e.target.closest('[data-tip]');
      if (!t) return;
      const r = wrap.getBoundingClientRect(), b = t.getBoundingClientRect();
      show(+t.dataset.tip, b.left - r.left + b.width / 2, b.top - r.top);
    };
    wrap.onfocusout = hide;
  }

  function tipHtml(title, rows) {
    return `<b>${esc(title)}</b>` + rows.map(([k, v]) => `<div class="row"><span>${esc(k)}</span><span>${esc(v)}</span></div>`).join('');
  }

  // Horizontal bars from a single baseline. Rows: {label, value, color, tip, text, dim}
  function hbar(el, { rows, max, ref, fmt = v => v, width = 560, labelW = 170, barH = 18, gap = 14, axisFmt }) {
    const padR = 62, padT = ref ? 22 : 6, axisH = 22;
    const plotW = width - labelW - padR;
    const top = max ?? niceMax(Math.max(...rows.map(r => r.value), ref ? ref.value : 0) * 1.05);
    const height = padT + rows.length * (barH + gap) - gap + axisH + 6;
    const x = v => labelW + (v / top) * plotW;
    const plotBottom = padT + rows.length * (barH + gap) - gap + 4;
    let s = '';
    ticks(0, top, 4).forEach(t => {
      s += `<line class="gridline" x1="${x(t)}" x2="${x(t)}" y1="${padT - 4}" y2="${plotBottom}"/>`;
      s += `<text class="axis" x="${x(t)}" y="${plotBottom + 14}" text-anchor="middle">${(axisFmt || fmt)(t)}</text>`;
    });
    const tips = [];
    rows.forEach((r, i) => {
      const y = padT + i * (barH + gap);
      const w = Math.max(2, x(r.value) - labelW);
      const rad = Math.min(4, w / 2);
      tips.push(r.tip);
      s += `<g class="mark${r.dim ? ' dim' : ''}" data-tip="${i}" tabindex="0" role="img" aria-label="${esc(r.label)}: ${esc(fmt(r.value))}">
        <rect class="hit" x="0" y="${y - gap / 2}" width="${width}" height="${barH + gap}"/>
        <text class="axis-ink" x="${labelW - 12}" y="${y + barH / 2 + 4}" text-anchor="end">${esc(r.label)}</text>
        <path d="M${labelW},${y} h${w - rad} a${rad},${rad} 0 0 1 ${rad},${rad} v${barH - 2 * rad} a${rad},${rad} 0 0 1 -${rad},${rad} h-${w - rad} z" fill="${r.color}"/>
        <text class="val" x="${labelW + w + 8}" y="${y + barH / 2 + 4}">${esc(r.text ?? fmt(r.value))}</text>
      </g>`;
    });
    s += `<line class="baseline" x1="${labelW}" x2="${labelW}" y1="${padT - 4}" y2="${plotBottom}"/>`;
    if (ref) {
      const rx = x(ref.value);
      s += `<line class="ref-line" x1="${rx}" x2="${rx}" y1="${padT - 8}" y2="${plotBottom}"/>
        <text class="ref-label" x="${rx}" y="${padT - 12}" text-anchor="middle">${esc(ref.label)}</text>`;
    }
    el.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="group">${s}</svg>`;
    bindTips(el, tips);
  }

  // Scatter. Points: {x, y, r, color, label, showLabel, tip, dim}
  function scatter(el, { points, xLabel, yLabel, xFmt = v => v, yFmt = v => v, xMax, yMax, yMin = 0, refY, refX, width = 460, height = 300 }) {
    const pad = { l: 46, r: 18, t: 16, b: 40 };
    const xm = xMax ?? niceMax(Math.max(...points.map(p => p.x)) * 1.08);
    const ym = yMax ?? niceMax(Math.max(...points.map(p => p.y), refY ? refY.value : 0) * 1.1);
    const X = v => pad.l + (v / xm) * (width - pad.l - pad.r);
    const Y = v => height - pad.b - ((v - yMin) / (ym - yMin)) * (height - pad.t - pad.b);
    let s = '';
    ticks(yMin, ym, 4).forEach(t => {
      s += `<line class="gridline" x1="${pad.l}" x2="${width - pad.r}" y1="${Y(t)}" y2="${Y(t)}"/><text class="axis" x="${pad.l - 8}" y="${Y(t) + 3}" text-anchor="end">${yFmt(t)}</text>`;
    });
    ticks(0, xm, 4).forEach(t => {
      s += `<text class="axis" x="${X(t)}" y="${height - pad.b + 16}" text-anchor="middle">${xFmt(t)}</text>`;
    });
    s += `<line class="baseline" x1="${pad.l}" x2="${width - pad.r}" y1="${Y(yMin)}" y2="${Y(yMin)}"/>`;
    s += `<text class="axis" x="${(pad.l + width - pad.r) / 2}" y="${height - 4}" text-anchor="middle">${esc(xLabel)}</text>`;
    s += `<text class="axis" transform="translate(11 ${(pad.t + height - pad.b) / 2}) rotate(-90)" text-anchor="middle">${esc(yLabel)}</text>`;
    if (refY) s += `<line class="ref-line" x1="${pad.l}" x2="${width - pad.r}" y1="${Y(refY.value)}" y2="${Y(refY.value)}"/><text class="ref-label" x="${width - pad.r}" y="${Y(refY.value) - 6}" text-anchor="end">${esc(refY.label)}</text>`;
    if (refX) s += `<line class="ref-line" x1="${X(refX.value)}" x2="${X(refX.value)}" y1="${pad.t}" y2="${height - pad.b}"/><text class="ref-label" x="${X(refX.value) + 6}" y="${pad.t + 8}">${esc(refX.label)}</text>`;
    const tips = [];
    const surface = css('--surface') || '#0E121B';
    const order = points.map((p, i) => i).sort((a, b) => (points[b].r || 5) - (points[a].r || 5));
    order.forEach(i => {
      const p = points[i];
      tips[i] = p.tip;
      const r = p.r || 5;
      s += `<g class="mark${p.dim ? ' dim' : ''}" data-tip="${i}" tabindex="0" role="img" aria-label="${esc(p.label)}">
        <circle class="hit" cx="${X(p.x)}" cy="${Y(p.y)}" r="${Math.max(12, r + 4)}"/>
        <circle cx="${X(p.x)}" cy="${Y(p.y)}" r="${r}" fill="${p.color}" fill-opacity=".85" stroke="${surface}" stroke-width="2"/>
      </g>`;
    });
    points.forEach(p => {
      if (!p.showLabel) return;
      // Label above the bubble, anchored so it never runs past the plot edges
      const lx = X(p.x), anchor = lx < width * 0.22 ? 'start' : lx > width * 0.78 ? 'end' : 'middle';
      const ly = Y(p.y) - (p.r || 5) - 7;
      s += `<text class="axis-ink" style="pointer-events:none;paint-order:stroke;stroke:${surface};stroke-width:3px" x="${anchor === 'start' ? lx - 6 : anchor === 'end' ? lx + 6 : lx}" y="${ly < pad.t + 4 ? Y(p.y) + (p.r || 5) + 14 : ly}" text-anchor="${anchor}">${esc(p.label)}</text>`;
    });
    el.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="group">${s}</svg>`;
    bindTips(el, tips);
  }

  // Single series line with an area wash, a highlighted current point, and a crosshair tooltip.
  function line(el, { points, current, xFmt = v => v, yFmt = v => v, xLabel, tipFor, width = 520, height = 230, color, zero = true }) {
    const pad = { l: 58, r: 20, t: 16, b: 40 };
    const xs = points.map(p => p.x), ys = points.map(p => p.y);
    const xmin = Math.min(...xs), xmax = Math.max(...xs);
    // Line charts may start above zero (zero: false) since position, not length, carries the value
    let y0 = 0, ym = niceMax(Math.max(...ys) * 1.08 || 1);
    if (!zero) {
      const lo = Math.min(...ys), hi = Math.max(...ys), span = (hi - lo) || Math.abs(hi) * 0.1 || 1;
      const step = niceStep(span * 1.6, 4);
      y0 = Math.floor((lo - span * 0.3) / step) * step;
      ym = Math.ceil((hi + span * 0.2) / step) * step;
    }
    const X = v => pad.l + ((v - xmin) / (xmax - xmin || 1)) * (width - pad.l - pad.r);
    const Y = v => height - pad.b - ((v - y0) / (ym - y0)) * (height - pad.t - pad.b);
    const c = color || css('--viz-1');
    let s = '';
    ticks(y0, ym, 4).forEach(t => {
      s += `<line class="gridline" x1="${pad.l}" x2="${width - pad.r}" y1="${Y(t)}" y2="${Y(t)}"/><text class="axis" x="${pad.l - 8}" y="${Y(t) + 3}" text-anchor="end">${yFmt(t)}</text>`;
    });
    points.forEach(p => { s += `<text class="axis" x="${X(p.x)}" y="${height - pad.b + 16}" text-anchor="middle">${xFmt(p.x)}</text>`; });
    s += `<text class="axis" x="${(pad.l + width - pad.r) / 2}" y="${height - 4}" text-anchor="middle">${esc(xLabel)}</text>`;
    s += `<line class="baseline" x1="${pad.l}" x2="${width - pad.r}" y1="${Y(y0)}" y2="${Y(y0)}"/>`;
    const d = points.map((p, i) => `${i ? 'L' : 'M'}${X(p.x)},${Y(p.y)}`).join(' ');
    s += `<path d="${d} L${X(xmax)},${Y(y0)} L${X(xmin)},${Y(y0)} Z" fill="${c}" fill-opacity=".1"/>`;
    s += `<path d="${d}" fill="none" stroke="${c}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
    const surface = css('--surface') || '#0E121B';
    const tips = [];
    const colW = (width - pad.l - pad.r) / Math.max(1, points.length - 1);
    points.forEach((p, i) => {
      tips.push(tipFor ? tipFor(p) : `${xFmt(p.x)}: ${yFmt(p.y)}`);
      const isCur = current != null && p.x === current;
      s += `<g class="mark" data-tip="${i}" tabindex="0" role="img" aria-label="${esc(xFmt(p.x))}: ${esc(yFmt(p.y))}">
        <rect class="hit" x="${X(p.x) - colW / 2}" y="${pad.t}" width="${colW}" height="${height - pad.t - pad.b}"/>
        ${isCur ? `<line class="gridline" x1="${X(p.x)}" x2="${X(p.x)}" y1="${pad.t}" y2="${Y(y0)}" style="stroke:rgba(255,255,255,.25)"/>` : ''}
        <circle cx="${X(p.x)}" cy="${Y(p.y)}" r="${isCur ? 6 : 3.5}" fill="${isCur ? css('--viz-3') : c}" stroke="${surface}" stroke-width="2"/>
      </g>`;
      if (isCur) s += `<text class="val" x="${X(p.x)}" y="${Y(p.y) - 12}" text-anchor="${X(p.x) > width - 80 ? 'end' : 'middle'}">${esc(yFmt(p.y))}</text>`;
    });
    el.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="group">${s}</svg>`;
    bindTips(el, tips);
  }

  // 100 percent stacked horizontal bars. Rows: {label, segs:[{value, color, name}], tip, dim}
  function stack100(el, { rows, width = 560, labelW = 190, barH = 18, gap = 14 }) {
    const padR = 12, axisH = 22, padT = 6;
    const plotW = width - labelW - padR;
    const height = padT + rows.length * (barH + gap) - gap + axisH + 6;
    const plotBottom = padT + rows.length * (barH + gap) - gap + 4;
    const surface = css('--surface') || '#0E121B';
    let s = '';
    [0, 25, 50, 75, 100].forEach(t => {
      const x = labelW + plotW * t / 100;
      s += `<line class="gridline" x1="${x}" x2="${x}" y1="${padT - 4}" y2="${plotBottom}"/><text class="axis" x="${x}" y="${plotBottom + 14}" text-anchor="middle">${t}%</text>`;
    });
    const tips = [];
    rows.forEach((r, i) => {
      const y = padT + i * (barH + gap);
      const total = r.segs.reduce((a, b) => a + b.value, 0);
      tips.push(r.tip);
      let x = labelW, segs = '';
      r.segs.forEach((sg, j) => {
        const w = plotW * sg.value / total;
        if (w <= 0) return;
        segs += `<rect x="${x}" y="${y}" width="${w}" height="${barH}" rx="${j === r.segs.length - 1 || j === 0 ? 4 : 0}" fill="${sg.color}"/>`;
        if (j > 0) segs += `<rect x="${x - 1}" y="${y}" width="2" height="${barH}" fill="${surface}"/>`;
        if (sg.label && w > 44) segs += `<text class="val" x="${x + 8}" y="${y + barH / 2 + 4}">${esc(sg.label)}</text>`;
        x += w;
      });
      s += `<g class="mark${r.dim ? ' dim' : ''}" data-tip="${i}" tabindex="0" role="img" aria-label="${esc(r.label)}">
        <rect class="hit" x="0" y="${y - gap / 2}" width="${width}" height="${barH + gap}"/>
        <text class="axis-ink" x="${labelW - 12}" y="${y + barH / 2 + 4}" text-anchor="end">${esc(r.label)}</text>${segs}</g>`;
    });
    el.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="group">${s}</svg>`;
    bindTips(el, tips);
  }

  // Sortable table header wiring. cols: {key, numeric}
  function sortable(table, state, onChange) {
    table.querySelectorAll('th[data-col]').forEach(th => {
      th.tabIndex = 0;
      const go = () => {
        const col = th.dataset.col;
        if (state.col === col) state.dir *= -1;
        else { state.col = col; state.dir = th.classList.contains('num') ? -1 : 1; }
        onChange();
      };
      th.addEventListener('click', go);
      th.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
    });
  }
  function markSorted(table, state) {
    table.querySelectorAll('th[data-col]').forEach(th => {
      const on = th.dataset.col === state.col;
      th.classList.toggle('sorted', on);
      th.setAttribute('aria-sort', on ? (state.dir === 1 ? 'ascending' : 'descending') : 'none');
      const a = th.querySelector('.arr');
      if (a) a.textContent = on ? (state.dir === 1 ? ' ↑' : ' ↓') : '';
    });
  }
  function sortRows(rows, state) {
    const { col, dir } = state;
    return [...rows].sort((a, b) => {
      const va = a[col], vb = b[col];
      return (typeof va === 'string' ? va.localeCompare(vb) : va - vb) * dir;
    });
  }

  function toggle(el, options, current, onSelect) {
    el.innerHTML = '';
    options.forEach(o => {
      const val = typeof o === 'string' ? o : o.value;
      const lab = typeof o === 'string' ? o : o.label;
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = lab;
      b.setAttribute('aria-pressed', val === current ? 'true' : 'false');
      b.addEventListener('click', () => onSelect(val));
      el.appendChild(b);
    });
  }

  function pearson(xs, ys) {
    const n = xs.length, mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
    let num = 0, dx = 0, dy = 0;
    for (let i = 0; i < n; i++) { num += (xs[i] - mx) * (ys[i] - my); dx += (xs[i] - mx) ** 2; dy += (ys[i] - my) ** 2; }
    return dx && dy ? num / Math.sqrt(dx * dy) : 0;
  }

  const fmt = {
    int: v => Math.round(v).toLocaleString('en-US'),
    k: v => Math.abs(v) >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : Math.abs(v) >= 1e4 ? (v / 1e3).toFixed(0) + 'K' : Math.abs(v) >= 1e3 ? (v / 1e3).toFixed(1) + 'K' : Math.round(v).toString(),
    usd: v => (v < 0 ? '-$' : '$') + (Math.abs(v) >= 1e6 ? (Math.abs(v) / 1e6).toFixed(2) + 'M' : Math.abs(v) >= 1e3 ? (Math.abs(v) / 1e3).toFixed(0) + 'K' : Math.round(Math.abs(v))),
    pct: (v, d = 1) => (v * 100).toFixed(d) + '%',
  };

  return { css, esc, ticks, niceMax, hbar, scatter, line, stack100, tipHtml, sortable, markSorted, sortRows, toggle, pearson, fmt };
})();
