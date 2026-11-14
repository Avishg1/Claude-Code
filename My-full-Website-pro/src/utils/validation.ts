export interface ContactFormValues {
  name: string;
  email: string;
  subject: string;
  message: string;
}

export type ContactFormErrors = Partial<Record<keyof ContactFormValues, string>>;

// Deliberately simple: one "@", a dot in the domain, no spaces. The server is the real check.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const isValidEmail = (value: string): boolean => EMAIL_PATTERN.test(value.trim());

export const validateContactForm = (values: ContactFormValues): ContactFormErrors => {
  const errors: ContactFormErrors = {};

  if (!values.name.trim()) errors.name = 'נא למלא שם מלא.';

  if (!values.email.trim()) errors.email = 'נא למלא כתובת אימייל.';
  else if (!isValidEmail(values.email)) errors.email = 'כתובת האימייל אינה תקינה.';

  if (!values.subject.trim()) errors.subject = 'נא למלא נושא.';
  if (!values.message.trim()) errors.message = 'נא לכתוב הודעה.';

  return errors;
};

export const hasErrors = (errors: ContactFormErrors): boolean => Object.keys(errors).length > 0;
