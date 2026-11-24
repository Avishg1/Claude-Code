import { describe, expect, it } from 'vitest';
import { hasErrors, isValidEmail, validateContactForm } from './validation';

const valid = { name: 'דנה', email: 'dana@example.com', subject: 'שאלה', message: 'שלום' };

describe('isValidEmail', () => {
  it.each(['a@b.co', 'first.last@domain.org', '  padded@site.io  '])('accepts %s', (email) => {
    expect(isValidEmail(email)).toBe(true);
  });

  it.each(['', 'plain', 'no@dot', '@missing.user', 'two@@signs.com', 'has space@x.com'])('rejects %s', (email) => {
    expect(isValidEmail(email)).toBe(false);
  });
});

describe('validateContactForm', () => {
  it('returns no errors for a complete form', () => {
    expect(hasErrors(validateContactForm(valid))).toBe(false);
  });

  it('flags every empty or whitespace-only field', () => {
    const errors = validateContactForm({ name: ' ', email: '', subject: '', message: '\n' });
    expect(Object.keys(errors).sort()).toEqual(['email', 'message', 'name', 'subject']);
  });

  it('gives a specific message for a malformed email', () => {
    expect(validateContactForm({ ...valid, email: 'nope' }).email).toBe('כתובת האימייל אינה תקינה.');
  });
});
