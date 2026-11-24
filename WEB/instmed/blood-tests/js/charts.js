// Plain-SVG trend chart: one test (one unit) per chart.
// The reference band is drawn per report slot, so a range change shows as a step.
import { fmtNum, fmtDate, fmtDateShort, fmtUnit, flagOf, parseRange, rangeTextOf, sameRange, names } from './domain.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

function el(name, attrs = {}, text) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (text != null) node.textContent = text;
  return node;
}

function niceScale(lo, hi, count = 4) {
  if (hi === lo) { lo -= 1; hi += 1; }
  const raw = (hi - lo) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
  const start = Math.floor(lo / step) * step;
  const end = Math.ceil(hi / step) * step;
  const ticks = [];
  for (let v = start; v <= end + step / 1e6; v += step) ticks.push(+v.toFixed(10));
  return { lo: start, hi: end, ticks };
}

/**
 * @param box   container element (size is read from it)
 * @param recs  records of ONE series (same test, same unit), sorted by date
 * @param key   unique id for SVG defs
 * @param tip   { show(rec, x, y), move(x, y), hide() }
 */
export function drawChart(box, recs, key, tip) {
  const W = box.clientWidth;
  const H = box.clientHeight;
  if (!W || !H) return;
  box.innerHTML = '';

  const m = { top: 24, right: 46, bottom: 28, left: 10 };
  const pw = W - m.left - m.right;
  const ph = H - m.top - m.bottom;
  const n = recs.length;
  const slot = pw / n;
  // RTL: earliest date on the right, latest on the left.
  const xc = (i) => m.left + pw - slot * (i + 0.5);
  const bounds = recs.map((r) => parseRange(rangeTextOf(r)));

  // Y domain: measured values + printed range bounds only.
  const nums = [];
  recs.forEach((r, i) => {
    if (r.value != null) nums.push(r.value);
    if (bounds[i]?.low != null) nums.push(bounds[i].low);
    if (bounds[i]?.high != null) nums.push(bounds[i].high);
  });
  if (!nums.length) nums.push(0, 1);
  let min = Math.min(...nums), max = Math.max(...nums);
  const pad = (max - min || Math.abs(max) || 1) * 0.12;
  min -= pad; max += pad;
  if (Math.min(...nums) >= 0) min = Math.max(0, min);
  const sc = niceScale(min, max);
  const y = (v) => m.top + ph - ((v - sc.lo) / (sc.hi - sc.lo)) * ph;
  const top = m.top, bottom = m.top + ph;

  const name = names(recs[0]).primary;
  // direction="ltr" so text-anchor values mean what they say; Hebrew glyphs still shape correctly.
  const svg = el('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, direction: 'ltr', role: 'img',
    'aria-label': `גרף מגמה: ${name}, ${n} מדידות, יחידה ${fmtUnit(recs[0].unit) || 'לא ידועה'}` });

  const defs = el('defs');
  const pat = el('pattern', { id: `hatch-${key}`, width: 6, height: 6, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' });
  pat.appendChild(el('line', { x1: 0, y1: 0, x2: 0, y2: 6, stroke: '#cbd5e1', 'stroke-width': 2 }));
  defs.appendChild(pat);
  svg.appendChild(defs);

  sc.ticks.forEach((t) => {
    svg.appendChild(el('line', { x1: m.left, x2: m.left + pw, y1: y(t), y2: y(t), stroke: '#edf0f6', 'stroke-width': 1, 'stroke-dasharray': '3 4' }));
    svg.appendChild(el('text', { x: m.left + pw + 6, y: y(t) + 4, 'font-size': 11, fill: '#7a839c', 'text-anchor': 'start' }, fmtNum(t)));
  });

  // Reference band per report slot
  recs.forEach((r, i) => {
    const x0 = xc(i) - slot / 2;
    const b = bounds[i];
    if (!b) {
      svg.appendChild(el('rect', { x: x0, y: top, width: slot, height: ph, fill: `url(#hatch-${key})`, opacity: 0.6 }));
      svg.appendChild(el('text', { x: xc(i), y: top + 14, 'font-size': 10.5, fill: '#475569', 'text-anchor': 'middle' },
        rangeTextOf(r) == null ? 'טווח לא ידוע' : 'טווח לא מספרי'));
      return;
    }
    const yHi = b.high != null ? Math.max(top, y(b.high)) : top;
    const yLo = b.low != null ? Math.min(bottom, y(b.low)) : bottom;
    svg.appendChild(el('rect', { x: x0, y: yHi, width: slot, height: Math.max(0, yLo - yHi), fill: '#e9efff' }));
    if (b.high != null) svg.appendChild(el('line', { x1: x0, x2: x0 + slot, y1: yHi, y2: yHi, stroke: '#a8bcfb', 'stroke-width': 1.5 }));
    if (b.low != null) svg.appendChild(el('line', { x1: x0, x2: x0 + slot, y1: yLo, y2: yLo, stroke: '#a8bcfb', 'stroke-width': 1.5 }));
  });

  // Range change markers
  for (let i = 1; i < n; i++) {
    if (sameRange(recs[i - 1], recs[i])) continue;
    const xb = xc(i) + slot / 2;
    svg.appendChild(el('line', { class: 'range-change', x1: xb, x2: xb, y1: top - 4, y2: bottom, stroke: '#7c8aa0', 'stroke-width': 1.5, 'stroke-dasharray': '4 3' }));
    svg.appendChild(el('text', { x: xb, y: top - 9, 'font-size': 10.5, fill: '#334155', 'text-anchor': 'middle', 'font-weight': 600 }, 'שינוי טווח'));
  }

  recs.forEach((r, i) => {
    svg.appendChild(el('text', { x: xc(i), y: H - 8, 'font-size': 11, fill: '#7a839c', 'text-anchor': 'middle' }, fmtDateShort(r.date)));
  });

  // Line, broken at missing/unclear values (no interpolation across gaps)
  let d = '', pen = false;
  recs.forEach((r, i) => {
    if (r.value == null) { pen = false; return; }
    d += `${pen ? 'L' : 'M'}${xc(i).toFixed(1)},${y(r.value).toFixed(1)}`;
    pen = true;
  });
  if (d) svg.appendChild(el('path', { d, fill: 'none', stroke: '#3757f5', 'stroke-width': 2.5, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));

  recs.forEach((r, i) => {
    const x = xc(i);
    const f = flagOf(r);
    if (f === 'missing' || f === 'unclear') {
      const yy = bottom - 14;
      const label = f === 'missing' ? 'חסר' : 'לא ברור';
      const w = f === 'missing' ? 36 : 50;
      svg.appendChild(el('rect', { class: `pill-${f}`, x: x - w / 2, y: yy - 10, width: w, height: 20, rx: 6, fill: '#f0f2f7', stroke: '#9aa3ba', 'stroke-dasharray': '3 2' }));
      svg.appendChild(el('text', { x, y: yy + 4, 'font-size': 11.5, fill: '#334155', 'text-anchor': 'middle', 'font-weight': 600 }, label));
      return;
    }
    const yy = y(r.value);
    if (f === 'high') {
      svg.appendChild(el('path', { d: `M${x},${yy - 7} L${x + 7},${yy + 5} L${x - 7},${yy + 5} Z`, fill: '#d92f36', stroke: '#fff', 'stroke-width': 2 }));
    } else if (f === 'low') {
      svg.appendChild(el('path', { d: `M${x},${yy + 7} L${x + 7},${yy - 5} L${x - 7},${yy - 5} Z`, fill: '#dc8a00', stroke: '#fff', 'stroke-width': 2 }));
    } else {
      svg.appendChild(el('circle', { cx: x, cy: yy, r: 4.5, fill: '#fff', stroke: '#3757f5', 'stroke-width': 2.5 }));
    }
  });

  for (let i = n - 1; i >= 0; i--) {
    if (recs[i].value == null) continue;
    const yy = y(recs[i].value);
    const above = yy - 12 > top + 4;
    svg.appendChild(el('text', { x: xc(i), y: above ? yy - 11 : yy + 20, 'font-size': 12, 'font-weight': 700, fill: '#0f172a', 'text-anchor': 'middle' }, fmtNum(recs[i].value)));
    break;
  }

  recs.forEach((r, i) => {
    const label = r.value != null ? `${fmtNum(r.value)} ${fmtUnit(r.unit)}` : r.valueText ? 'לא ברור' : 'חסר';
    const hit = el('rect', { x: xc(i) - slot / 2, y: top, width: slot, height: ph, fill: 'transparent', tabindex: 0,
      'aria-label': `${fmtDate(r.date)}: ${label}` });
    hit.addEventListener('pointerenter', (e) => tip.show(r, e.clientX, e.clientY));
    hit.addEventListener('pointermove', (e) => tip.move(e.clientX, e.clientY));
    hit.addEventListener('pointerleave', tip.hide);
    hit.addEventListener('focus', () => { const b = hit.getBoundingClientRect(); tip.show(r, b.left + b.width / 2, b.top + 30); });
    hit.addEventListener('blur', tip.hide);
    svg.appendChild(hit);
  });

  box.appendChild(svg);
}
