/**
 * Accessibility menu – shared by every page.
 * Injects a floating button + panel and applies the saved preferences
 * (text size, high contrast, highlighted links, readable font, text spacing,
 * no animations, large cursor). Preferences persist in localStorage.
 */
(function () {
  'use strict';

  const KEY = 'hcf.a11y.v1';
  const DEFAULTS = { font: 100, contrast: false, links: false, readable: false, spacing: false, motion: false, cursor: false };
  const TOGGLES = [
    ['contrast', 'ניגודיות גבוהה'], ['links', 'הדגשת קישורים'], ['readable', 'גופן קריא'],
    ['spacing', 'ריווח טקסט'], ['motion', 'עצירת אנימציות'], ['cursor', 'סמן עכבר גדול'],
  ];

  let prefs = Object.assign({}, DEFAULTS);
  try { prefs = Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) { /* use defaults */ }

  // Apply as early as possible (this script is loaded in <head>) to avoid a flash.
  function apply() {
    const html = document.documentElement;
    html.style.fontSize = prefs.font + '%';
    TOGGLES.forEach(([k]) => html.classList.toggle('a11y-' + k, !!prefs[k]));
    const out = document.getElementById('a11y-font-value');
    if (out) out.textContent = prefs.font + '%';
    document.querySelectorAll('[data-a11y-toggle]').forEach((b) => b.setAttribute('aria-pressed', String(!!prefs[b.dataset.a11yToggle])));
    try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch (e) { /* not persisted */ }
  }
  apply();

  function build() {
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.id = 'a11y-toggle';
    toggle.className = 'a11y-toggle';
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-controls', 'a11y-panel');
    toggle.setAttribute('aria-label', 'תפריט נגישות');
    toggle.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="4" r="2" fill="currentColor"/>
      <path d="M4 8.5c2.6.8 5.3 1.2 8 1.2s5.4-.4 8-1.2M12 9.7V15m0 0-3 6m3-6 3 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

    const panel = document.createElement('section');
    panel.id = 'a11y-panel';
    panel.className = 'a11y-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-labelledby', 'a11y-title');
    panel.hidden = true;
    panel.innerHTML = `
      <div class="a11y-head">
        <h2 id="a11y-title">התאמות נגישות</h2>
        <button type="button" class="icon-btn" data-a11y="close" aria-label="סגירת תפריט הנגישות">✕</button>
      </div>
      <div class="a11y-row">
        <span id="a11y-font-label">גודל טקסט</span>
        <div class="a11y-font" role="group" aria-labelledby="a11y-font-label">
          <button type="button" class="btn btn-secondary btn-sm" data-a11y="font-dec" aria-label="הקטנת הטקסט">א−</button>
          <output id="a11y-font-value" aria-live="polite">${prefs.font}%</output>
          <button type="button" class="btn btn-secondary btn-sm" data-a11y="font-inc" aria-label="הגדלת הטקסט">א+</button>
        </div>
      </div>
      <div class="a11y-toggles">
        ${TOGGLES.map(([k, label]) => `<button type="button" class="a11y-opt" data-a11y-toggle="${k}" aria-pressed="${!!prefs[k]}">${label}</button>`).join('')}
      </div>
      <button type="button" class="btn btn-ghost btn-block" data-a11y="reset">איפוס התאמות הנגישות</button>`;

    document.body.append(toggle, panel);

    const setOpen = (open) => {
      panel.hidden = !open;
      toggle.setAttribute('aria-expanded', String(open));
      if (open) panel.querySelector('.a11y-opt').focus(); else toggle.focus();
    };
    toggle.addEventListener('click', () => setOpen(panel.hidden));
    panel.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } });
    document.addEventListener('click', (e) => {
      if (!panel.hidden && !panel.contains(e.target) && !toggle.contains(e.target)) {
        panel.hidden = true;
        toggle.setAttribute('aria-expanded', 'false');
      }
    });
    panel.addEventListener('click', (e) => {
      const t = e.target.closest('[data-a11y-toggle]');
      if (t) { prefs[t.dataset.a11yToggle] = !prefs[t.dataset.a11yToggle]; apply(); return; }
      const b = e.target.closest('[data-a11y]');
      if (!b) return;
      const a = b.dataset.a11y;
      if (a === 'close') { setOpen(false); return; }
      if (a === 'font-inc') prefs.font = Math.min(160, prefs.font + 10);
      if (a === 'font-dec') prefs.font = Math.max(80, prefs.font - 10);
      if (a === 'reset') prefs = Object.assign({}, DEFAULTS);
      apply();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
  else build();
})();
