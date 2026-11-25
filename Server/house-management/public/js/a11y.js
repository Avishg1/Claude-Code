'use strict';

/*
 * Accessibility menu (תפריט נגישות), shared by every page.
 * Load it in <head> so saved settings apply before the page paints.
 * Settings are kept per browser in localStorage.
 */
(() => {
  const STORAGE_KEY = 'tm_a11y';
  const TEXT_SIZES = [1, 1.15, 1.3, 1.5];

  const TOGGLES = [
    { key: 'contrast', label: 'ניגודיות גבוהה', icon: '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5v17" /><path d="M12 3.5a8.5 8.5 0 010 17z" fill="currentColor"/>' },
    { key: 'links', label: 'הדגשת קישורים וכפתורים', icon: '<path d="M10 14a4 4 0 005.66 0l3-3a4 4 0 00-5.66-5.66l-1 1"/><path d="M14 10a4 4 0 00-5.66 0l-3 3a4 4 0 005.66 5.66l1-1"/>' },
    { key: 'font', label: 'גופן קריא', icon: '<path d="M5 19l5-14h1l5 14"/><path d="M7 14h7"/><path d="M17 19h3"/>' },
    { key: 'spacing', label: 'ריווח טקסט מוגדל', icon: '<path d="M4 6h16M4 12h16M4 18h16"/><path d="M20 3v3M20 18v3"/>' },
    { key: 'focus', label: 'סימון פוקוס בולט', icon: '<rect x="4" y="4" width="16" height="16" rx="3"/><rect x="8" y="8" width="8" height="8" rx="1.5"/>' },
    { key: 'motion', label: 'עצירת אנימציות', icon: '<circle cx="12" cy="12" r="8.5"/><path d="M10 9v6M14 9v6"/>' },
    { key: 'cursor', label: 'סמן עכבר גדול', icon: '<path d="M6 3l12 9-5.5 1.2L15 19l-2.5 1.2-2.6-5.8L6 18z"/>' },
  ];

  const DEFAULTS = { size: 0, contrast: false, links: false, font: false, spacing: false, focus: false, motion: false, cursor: false };

  function load() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      return { ...DEFAULTS, ...(saved && typeof saved === 'object' ? saved : {}) };
    } catch {
      return { ...DEFAULTS };
    }
  }

  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); } catch { /* storage unavailable */ }
  }

  let settings = load();
  if (!Number.isInteger(settings.size) || settings.size < 0 || settings.size >= TEXT_SIZES.length) settings.size = 0;

  // Apply as classes on <html>, so styles take effect even before <body> exists.
  function apply() {
    const root = document.documentElement;
    for (const { key } of TOGGLES) root.classList.toggle(`a11y-${key}`, Boolean(settings[key]));
    const zoom = TEXT_SIZES[settings.size];
    root.classList.toggle('a11y-zoomed', zoom !== 1);
    root.style.setProperty('--a11y-zoom', String(zoom));
  }
  apply();

  /* ---------------------------------------------------------------- */
  /* Menu                                                             */
  /* ---------------------------------------------------------------- */

  const svg = (inner, size = 20) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
  const ICON_A11Y = '<circle cx="12" cy="4.5" r="1.8" fill="currentColor" stroke="none"/><path d="M5 8.5l7 1.5 7-1.5"/><path d="M12 10v4.5l-3 6M12 14.5l3 6"/>';

  function build() {
    const wrap = document.createElement('div');
    wrap.className = 'a11y';

    const fab = document.createElement('button');
    fab.type = 'button';
    fab.className = 'a11y__fab';
    fab.id = 'a11y-toggle';
    fab.innerHTML = svg(ICON_A11Y, 26);
    fab.setAttribute('aria-label', 'תפריט נגישות');
    fab.setAttribute('aria-expanded', 'false');
    fab.setAttribute('aria-controls', 'a11y-panel');
    fab.title = 'תפריט נגישות (Alt+A)';

    const panel = document.createElement('div');
    panel.className = 'a11y__panel';
    panel.id = 'a11y-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-labelledby', 'a11y-title');
    panel.hidden = true;

    panel.innerHTML = `
      <div class="a11y__header">
        <h2 class="a11y__title" id="a11y-title">${svg(ICON_A11Y, 22)} תפריט נגישות</h2>
        <button type="button" class="a11y__close" aria-label="סגירת תפריט הנגישות">${svg('<path d="M6 6l12 12M18 6L6 18"/>', 18)}</button>
      </div>
      <div class="a11y__size" role="group" aria-labelledby="a11y-size-label">
        <span id="a11y-size-label" class="a11y__size-label">גודל טקסט</span>
        <div class="a11y__size-controls">
          <button type="button" class="a11y__size-btn" data-step="-1" aria-label="הקטנת טקסט">א-</button>
          <output class="a11y__size-value" aria-live="polite"></output>
          <button type="button" class="a11y__size-btn" data-step="1" aria-label="הגדלת טקסט">א+</button>
        </div>
      </div>
      <div class="a11y__grid"></div>
      <button type="button" class="a11y__reset">${svg('<path d="M4 12a8 8 0 108-8 8 8 0 00-6 2.7"/><path d="M4 4v4h4"/>', 18)} איפוס הגדרות</button>
      <p class="a11y__note">ההגדרות נשמרות בדפדפן הזה.</p>
    `;

    const grid = panel.querySelector('.a11y__grid');
    for (const t of TOGGLES) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'a11y__option';
      btn.dataset.key = t.key;
      btn.innerHTML = `${svg(t.icon, 22)}<span>${t.label}</span>`;
      btn.addEventListener('click', () => {
        settings[t.key] = !settings[t.key];
        update();
      });
      grid.append(btn);
    }

    const sizeValue = panel.querySelector('.a11y__size-value');
    const sizeButtons = panel.querySelectorAll('.a11y__size-btn');
    sizeButtons.forEach((btn) => btn.addEventListener('click', () => {
      settings.size = Math.min(TEXT_SIZES.length - 1, Math.max(0, settings.size + Number(btn.dataset.step)));
      update();
    }));

    panel.querySelector('.a11y__reset').addEventListener('click', () => {
      settings = { ...DEFAULTS };
      update();
    });

    function render() {
      for (const btn of grid.children) btn.setAttribute('aria-pressed', String(Boolean(settings[btn.dataset.key])));
      sizeValue.textContent = `${Math.round(TEXT_SIZES[settings.size] * 100)}%`;
      sizeButtons[0].disabled = settings.size === 0;
      sizeButtons[1].disabled = settings.size === TEXT_SIZES.length - 1;
      const active = TOGGLES.some((t) => settings[t.key]) || settings.size > 0;
      fab.classList.toggle('is-active', active);
    }

    function update() {
      apply();
      save();
      render();
    }

    function open() {
      panel.hidden = false;
      fab.setAttribute('aria-expanded', 'true');
      panel.querySelector('.a11y__close').focus();
    }

    function close({ returnFocus = true } = {}) {
      if (panel.hidden) return;
      panel.hidden = true;
      fab.setAttribute('aria-expanded', 'false');
      if (returnFocus) fab.focus();
    }

    fab.addEventListener('click', () => (panel.hidden ? open() : close()));
    panel.querySelector('.a11y__close').addEventListener('click', () => close());

    // Escape closes the menu (before any page handler sees it).
    panel.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    });

    // Clicking outside closes it.
    document.addEventListener('pointerdown', (e) => {
      if (!panel.hidden && !wrap.contains(e.target)) close({ returnFocus: false });
    });

    // Alt+A opens / closes the menu from anywhere (physical key, works in Hebrew layout).
    document.addEventListener('keydown', (e) => {
      if (e.altKey && !e.ctrlKey && !e.metaKey && e.code === 'KeyA') {
        e.preventDefault();
        if (panel.hidden) open(); else close();
      }
    });

    wrap.append(panel, fab);
    document.body.append(wrap);
    render();
  }

  // Keep tabs in sync if settings change in another tab.
  window.addEventListener('storage', (e) => {
    if (e.key !== STORAGE_KEY) return;
    settings = load();
    apply();
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
  else build();
})();
