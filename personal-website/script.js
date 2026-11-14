document.documentElement.classList.remove('no-js');

// שנה נוכחית בפוטר
document.getElementById('year').textContent = new Date().toLocaleDateString('he-IL', { year: 'numeric' });

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

// ===== ניווט: רקע אחרי גלילה =====
const nav = document.getElementById('nav');
const onScroll = () => nav.classList.toggle('is-scrolled', window.scrollY > 40);
window.addEventListener('scroll', onScroll, { passive: true });
onScroll();

// ===== תפריט מובייל =====
const toggle = document.getElementById('navToggle');
const menu = document.getElementById('navMenu');
const setMenu = (open) => {
  menu.classList.toggle('is-open', open);
  toggle.setAttribute('aria-expanded', String(open));
  toggle.setAttribute('aria-label', open ? 'סגירת תפריט' : 'פתיחת תפריט');
  document.body.style.overflow = open ? 'hidden' : '';
};
toggle.addEventListener('click', () => setMenu(!menu.classList.contains('is-open')));
menu.querySelectorAll('a').forEach((a) => a.addEventListener('click', () => setMenu(false)));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setMenu(false); });

// ===== אנימציות כניסה =====
// אלמנטים שנכנסים למסך יחד מופיעים בזה אחר זה, לפי הסדר שלהם בעמוד.
const STAGGER_MS = 120;
const MAX_DELAY_MS = 720;
const revealEls = document.querySelectorAll('.reveal');

if (reducedMotion.matches || !('IntersectionObserver' in window)) {
  revealEls.forEach((el) => el.classList.add('is-visible'));
} else {
  const revealObserver = new IntersectionObserver((entries) => {
    const entering = entries
      .filter((entry) => entry.isIntersecting)
      .map((entry) => entry.target)
      .sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));

    entering.forEach((el, i) => {
      revealObserver.unobserve(el);
      el.style.setProperty('--reveal-delay', `${Math.min(i * STAGGER_MS, MAX_DELAY_MS)}ms`);
      el.classList.add('is-visible');
      // אחרי ההופעה מסירים את ההשהיה, כדי שאפקטי ה־hover של הכרטיסים יגיבו מיד
      el.addEventListener('transitionend', function done(e) {
        if (e.target !== el || e.propertyName !== 'transform') return;
        el.removeEventListener('transitionend', done);
        el.classList.remove('reveal', 'is-visible');
        el.style.removeProperty('--reveal-delay');
      });
    });
  }, { threshold: 0.15, rootMargin: '0px 0px -40px 0px' });

  revealEls.forEach((el) => revealObserver.observe(el));
}

// ===== הדגשת הקישור של הסקשן הפעיל =====
const links = [...document.querySelectorAll('.nav__menu a')];
const sectionObserver = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (!entry.isIntersecting) return;
    links.forEach((l) => l.classList.toggle('is-active', l.getAttribute('href') === `#${entry.target.id}`));
  });
}, { rootMargin: '-45% 0px -50% 0px' });
document.querySelectorAll('main section[id]').forEach((s) => sectionObserver.observe(s));

// ===== טופס יצירת קשר =====
// כדי שההודעות יגיעו אליכם, חברו שירות שליחה (למשל Web3Forms או Formspree)
// ושימו כאן את כתובת ה־API שלו. כל עוד הכתובת ריקה, הטופס בודק את השדות ומציג הודעה שאינו מחובר.
const FORM_ENDPOINT = '';

const form = document.getElementById('contactForm');
const statusEl = document.getElementById('formStatus');
const submitBtn = form.querySelector('button[type="submit"]');
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const MESSAGES = {
  name: 'נא למלא שם מלא.',
  email: 'נא למלא כתובת אימייל.',
  emailInvalid: 'כתובת האימייל אינה תקינה.',
  subject: 'נא למלא נושא.',
  message: 'נא לכתוב הודעה.',
};

const fieldError = (field) => {
  const value = field.value.trim();
  if (!value) return MESSAGES[field.name];
  if (field.name === 'email' && !EMAIL_PATTERN.test(value)) return MESSAGES.emailInvalid;
  return '';
};

const showFieldError = (field, message) => {
  const errorEl = document.getElementById(`${field.id}-error`);
  field.classList.toggle('is-invalid', Boolean(message));
  if (message) {
    field.setAttribute('aria-invalid', 'true');
    field.setAttribute('aria-describedby', errorEl.id);
  } else {
    field.removeAttribute('aria-invalid');
    field.removeAttribute('aria-describedby');
  }
  errorEl.textContent = message;
};

const setStatus = (text, type = '') => {
  statusEl.textContent = text;
  statusEl.className = `form__status${type ? ` is-${type}` : ''}`;
};

form.addEventListener('submit', async (e) => {
  e.preventDefault();

  const fields = [...form.querySelectorAll('[required]')];
  let firstInvalid = null;
  fields.forEach((field) => {
    const message = fieldError(field);
    showFieldError(field, message);
    if (message && !firstInvalid) firstInvalid = field;
  });

  if (firstInvalid) {
    setStatus('נא לתקן את השדות המסומנים.', 'error');
    firstInvalid.focus();
    return;
  }

  if (!FORM_ENDPOINT) {
    setStatus('הטופס עדיין לא מחובר לשירות שליחה, ולכן ההודעה לא נשלחה.', 'info');
    return;
  }

  submitBtn.disabled = true;
  setStatus('שולח…');
  try {
    const res = await fetch(FORM_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(Object.fromEntries(new FormData(form))),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    setStatus('תודה! ההודעה נשלחה בהצלחה, אחזור אליכם בקרוב.', 'success');
    form.reset();
  } catch (err) {
    console.error('Contact form failed:', err);
    setStatus('אירעה שגיאה בשליחה. נסו שוב מאוחר יותר.', 'error');
  } finally {
    submitBtn.disabled = false;
  }
});

// מסירים את סימון השגיאה ברגע שהשדה תוקן
form.addEventListener('input', (e) => {
  if (e.target.classList.contains('is-invalid') && !fieldError(e.target)) showFieldError(e.target, '');
});
