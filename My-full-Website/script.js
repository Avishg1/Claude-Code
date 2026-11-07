// שנה נוכחית בפוטר
document.getElementById('year').textContent = new Date().toLocaleDateString('he-IL', { year: 'numeric' });

// רקע לניווט בעת גלילה
const nav = document.getElementById('nav');
const onScroll = () => nav.classList.toggle('is-scrolled', window.scrollY > 40);
window.addEventListener('scroll', onScroll, { passive: true });
onScroll();

// כפתור חזרה לראש העמוד – מופיע אחרי שגוללים מעבר לאזור הגיבור
const toTop = document.getElementById('toTop');
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const setToTopVisible = (visible) => {
  toTop.classList.toggle('is-visible', visible);
  toTop.setAttribute('aria-hidden', String(!visible));
  toTop.tabIndex = visible ? 0 : -1;
};
new IntersectionObserver(([entry]) => setToTopVisible(!entry.isIntersecting))
  .observe(document.getElementById('hero'));
toTop.addEventListener('click', () => {
  window.scrollTo({ top: 0, behavior: prefersReducedMotion.matches ? 'auto' : 'smooth' });
  // העברת הפוקוס לראש העמוד, למשתמשי מקלדת וקוראי מסך
  document.querySelector('.nav__logo').focus({ preventScroll: true });
});

// תפריט מובייל
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

// אנימציות כניסה: הופעה מלמטה, בהדרגה.
// אלמנטים שנכנסים למסך יחד מקבלים השהיה מדורגת לפי הסדר שלהם,
// וכרטיסי השירותים והעבודות מופיעים אחד אחרי השני.
const STAGGER_DEFAULT = 110; // מ"ש בין אלמנטים רגילים
const STAGGER_CARDS = 140;   // מ"ש בין כרטיסים
const MAX_DELAY = 840;      // תקרה, כדי שגלילה מהירה לא תיצור המתנה ארוכה

const finishReveal = (el) => {
  // מסירים את מחלקות האנימציה כדי שאפקטי ה־hover של הכרטיס יחזרו לפעול בלי השהיה
  el.classList.remove('reveal', 'is-visible');
  el.style.removeProperty('--reveal-delay');
};

const revealObserver = new IntersectionObserver((entries) => {
  // כל האלמנטים שנכנסו למסך יחד, לפי הסדר במסמך (כותרת הסקשן ואז הכרטיסים)
  const items = entries
    .filter((entry) => entry.isIntersecting)
    .map((entry) => entry.target)
    .sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));

  let delay = 0;
  items.forEach((el) => {
    revealObserver.unobserve(el);
    el.style.setProperty('--reveal-delay', `${Math.min(delay, MAX_DELAY)}ms`);
    delay += el.classList.contains('card') ? STAGGER_CARDS : STAGGER_DEFAULT;
    el.addEventListener('transitionend', function onEnd(e) {
      if (e.target !== el || e.propertyName !== 'transform') return;
      el.removeEventListener('transitionend', onEnd);
      finishReveal(el);
    });
    el.classList.add('is-visible');
  });
}, { threshold: 0.15, rootMargin: '0px 0px -40px 0px' });

if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
  document.querySelectorAll('.reveal').forEach(finishReveal);
} else {
  document.querySelectorAll('.reveal').forEach((el) => revealObserver.observe(el));
}

// הדגשת קישור הניווט של הסקשן הפעיל
const links = [...document.querySelectorAll('.nav__menu a')];
const sectionObserver = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (!entry.isIntersecting) return;
    links.forEach((l) => l.classList.toggle('is-active', l.getAttribute('href') === `#${entry.target.id}`));
  });
}, { rootMargin: '-45% 0px -50% 0px' });
document.querySelectorAll('main section[id]').forEach((s) => sectionObserver.observe(s));

// טופס יצירת קשר — נשלח למייל דרך FormSubmit (https://formsubmit.co)
const FORM_ENDPOINT = 'https://formsubmit.co/ajax/avishay.greenberg@gmail.com';
const form = document.getElementById('contactForm');
const status = document.getElementById('formStatus');
const submitBtn = form.querySelector('button[type="submit"]');
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  let valid = true;
  form.querySelectorAll('[required]').forEach((field) => {
    const ok = field.value.trim() !== '' && field.checkValidity();
    field.classList.toggle('is-invalid', !ok);
    field.setAttribute('aria-invalid', String(!ok));
    if (!ok) valid = false;
  });

  status.className = 'form__status';
  if (!valid) {
    status.textContent = 'נא למלא את כל השדות בצורה תקינה.';
    status.classList.add('is-error');
    form.querySelector('.is-invalid')?.focus();
    return;
  }
  const data = Object.fromEntries(new FormData(form));
  data._subject = `הודעה חדשה מהאתר מאת ${data.name || ''}`.trim();
  data._replyto = data.email;
  data._template = 'table';
  data._captcha = 'false';

  submitBtn.disabled = true;
  status.textContent = 'שולח...';
  try {
    const res = await fetch(FORM_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(data),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || String(json.success) !== 'true') throw new Error(json.message || res.status);
    status.textContent = 'תודה! ההודעה נשלחה בהצלחה, אחזור אליך בקרוב.';
    status.classList.add('is-success');
    form.reset();
  } catch (err) {
    console.error('Form submit failed:', err);
    status.textContent = 'אירעה שגיאה בשליחה. נסו שוב מאוחר יותר.';
    status.classList.add('is-error');
  } finally {
    submitBtn.disabled = false;
  }
});
form.addEventListener('input', (e) => {
  if (e.target.classList.contains('is-invalid') && e.target.checkValidity() && e.target.value.trim()) {
    e.target.classList.remove('is-invalid');
    e.target.removeAttribute('aria-invalid');
  }
});
