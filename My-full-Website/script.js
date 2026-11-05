// שנה נוכחית בפוטר
document.getElementById('year').textContent = new Date().toLocaleDateString('he-IL', { year: 'numeric' });

// רקע לניווט בעת גלילה
const nav = document.getElementById('nav');
const onScroll = () => nav.classList.toggle('is-scrolled', window.scrollY > 40);
window.addEventListener('scroll', onScroll, { passive: true });
onScroll();

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

// אנימציות כניסה עם השהיה מדורגת לכרטיסים באותה שורה
const revealObserver = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (!entry.isIntersecting) return;
    const el = entry.target;
    const siblings = [...el.parentElement.children].filter((c) => c.classList.contains('reveal'));
    el.style.transitionDelay = `${Math.min(siblings.indexOf(el), 5) * 90}ms`;
    el.classList.add('is-visible');
    revealObserver.unobserve(el);
  });
}, { threshold: 0.15, rootMargin: '0px 0px -40px 0px' });
document.querySelectorAll('.reveal').forEach((el) => revealObserver.observe(el));

// הדגשת קישור הניווט של הסקשן הפעיל
const links = [...document.querySelectorAll('.nav__menu a')];
const sectionObserver = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (!entry.isIntersecting) return;
    links.forEach((l) => l.classList.toggle('is-active', l.getAttribute('href') === `#${entry.target.id}`));
  });
}, { rootMargin: '-45% 0px -50% 0px' });
document.querySelectorAll('main section[id]').forEach((s) => sectionObserver.observe(s));

// טופס יצירת קשר (אימות בצד הלקוח בלבד — אין שרת)
const form = document.getElementById('contactForm');
const status = document.getElementById('formStatus');
form.addEventListener('submit', (e) => {
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
  status.textContent = 'תודה! ההודעה נשלחה בהצלחה, אחזור אליך בקרוב.';
  status.classList.add('is-success');
  form.reset();
});
form.addEventListener('input', (e) => {
  if (e.target.classList.contains('is-invalid') && e.target.checkValidity() && e.target.value.trim()) {
    e.target.classList.remove('is-invalid');
    e.target.removeAttribute('aria-invalid');
  }
});
