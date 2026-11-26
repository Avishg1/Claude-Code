'use strict';

// Login / sign-up page.
(() => {
  const $ = (id) => document.getElementById(id);
  const form = $('auth-form');
  const errorBox = $('form-error');
  const submitBtn = $('submit-btn');
  const tabs = document.querySelectorAll('.segmented-btn');

  const COPY = {
    login: { title: 'ברוכים השבים', subtitle: 'התחברו כדי לראות את התקלות בבניין', submit: 'התחברות', busy: 'מתחברים…' },
    signup: { title: 'יצירת חשבון', subtitle: 'חברי ועד נרשמים, ואז מצטרפים לבניין או יוצרים בניין חדש', submit: 'הרשמה', busy: 'יוצרים חשבון…' },
  };

  let mode = 'login';

  function showError(message) {
    errorBox.textContent = message;
    errorBox.hidden = !message;
  }

  function setMode(next) {
    mode = next;
    const isSignup = mode === 'signup';
    tabs.forEach((tab) => {
      const active = tab.dataset.mode === mode;
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-selected', String(active));
    });
    ['name-field', 'phone-field', 'confirm-field', 'password-hint'].forEach((id) => { $(id).hidden = !isSignup; });
    $('password').autocomplete = isSignup ? 'new-password' : 'current-password';
    $('auth-title').textContent = COPY[mode].title;
    $('auth-subtitle').textContent = COPY[mode].subtitle;
    submitBtn.textContent = COPY[mode].submit;
    showError('');
  }

  tabs.forEach((tab) => tab.addEventListener('click', () => setMode(tab.dataset.mode)));

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    showError('');
    const email = $('email');
    const payload = { email: email.value.trim(), password: $('password').value };

    if (!payload.email || !email.checkValidity()) { email.focus(); return showError('יש להזין כתובת אימייל תקינה'); }
    if (!payload.password) { $('password').focus(); return showError('יש להזין סיסמה'); }
    if (mode === 'signup') {
      payload.name = $('name').value.trim();
      payload.phone = $('phone').value.trim();
      if (!payload.name) { $('name').focus(); return showError('יש להזין שם'); }
      if (payload.phone && !/^[0-9+\-\s()]{7,20}$/.test(payload.phone)) { $('phone').focus(); return showError('מספר הטלפון אינו תקין'); }
      if (payload.password.length < 8) { $('password').focus(); return showError('הסיסמה חייבת להכיל לפחות 8 תווים'); }
      if (payload.password !== $('confirm').value) { $('confirm').focus(); return showError('הסיסמאות אינן תואמות'); }
    }

    submitBtn.disabled = true;
    submitBtn.textContent = COPY[mode].busy;
    try {
      const res = await fetch(`/api/auth/${mode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'אירעה שגיאה, נסו שוב');
      window.location.replace('/dashboard');
    } catch (err) {
      showError(err.message === 'Failed to fetch' ? 'אין חיבור לשרת' : err.message);
      submitBtn.disabled = false;
      submitBtn.textContent = COPY[mode].submit;
    }
  });
})();
