'use strict';

(() => {
  const form = document.getElementById('auth-form');
  const email = document.getElementById('email');
  const password = document.getElementById('password');
  const confirm = document.getElementById('confirm');
  const confirmField = document.getElementById('confirm-field');
  const passwordHint = document.getElementById('password-hint');
  const errorBox = document.getElementById('form-error');
  const submitBtn = document.getElementById('submit-btn');
  const title = document.getElementById('auth-title');
  const subtitle = document.getElementById('auth-subtitle');
  const tabs = document.querySelectorAll('.segmented__btn');

  const COPY = {
    login: {
      title: 'ברוכים השבים',
      subtitle: 'התחברו כדי לראות את המשימות שלכם',
      submit: 'התחברות',
      busy: 'מתחברים…',
    },
    signup: {
      title: 'יצירת חשבון',
      subtitle: 'נרשמים בחינם ומתחילים לנהל משימות',
      submit: 'הרשמה',
      busy: 'יוצרים חשבון…',
    },
  };

  let mode = 'login';

  function setMode(next) {
    mode = next;
    tabs.forEach((tab) => {
      const active = tab.dataset.mode === mode;
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-selected', String(active));
    });
    const isSignup = mode === 'signup';
    confirmField.hidden = !isSignup;
    passwordHint.hidden = !isSignup;
    password.autocomplete = isSignup ? 'new-password' : 'current-password';
    title.textContent = COPY[mode].title;
    subtitle.textContent = COPY[mode].subtitle;
    submitBtn.textContent = COPY[mode].submit;
    showError('');
  }

  function showError(message) {
    errorBox.textContent = message;
    errorBox.hidden = !message;
  }

  tabs.forEach((tab) => tab.addEventListener('click', () => setMode(tab.dataset.mode)));

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    showError('');

    const payload = { email: email.value.trim(), password: password.value };

    if (!payload.email || !email.checkValidity()) return showError('יש להזין כתובת אימייל תקינה');
    if (!payload.password) return showError('יש להזין סיסמה');
    if (mode === 'signup') {
      if (payload.password.length < 8) return showError('הסיסמה חייבת להכיל לפחות 8 תווים');
      if (payload.password !== confirm.value) return showError('הסיסמאות אינן תואמות');
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
