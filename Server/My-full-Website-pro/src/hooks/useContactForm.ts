import { useCallback, useState, type ChangeEvent, type FormEvent } from 'react';
import { sendContactMessage } from '@/services/contactService';
import { toUserMessage } from '@/utils/errors';
import { logError } from '@/utils/logger';
import { hasErrors, validateContactForm, type ContactFormErrors, type ContactFormValues } from '@/utils/validation';

export type SubmitStatus = 'idle' | 'submitting' | 'success' | 'error';

const EMPTY_VALUES: ContactFormValues = { name: '', email: '', subject: '', message: '' };

/**
 * All contact-form state: values, per-field validation, and the submit lifecycle
 * (idle → submitting → success | error). The component only renders.
 */
export const useContactForm = () => {
  const [values, setValues] = useState<ContactFormValues>(EMPTY_VALUES);
  const [errors, setErrors] = useState<ContactFormErrors>({});
  const [status, setStatus] = useState<SubmitStatus>('idle');
  const [statusMessage, setStatusMessage] = useState('');

  const handleChange = useCallback((e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const field = e.target.name as keyof ContactFormValues;
    const next = e.target.value;
    setValues((prev) => ({ ...prev, [field]: next }));
    // Clear a field's error as soon as it becomes valid, but don't nag while typing.
    setErrors((prev) => {
      if (!prev[field]) return prev;
      const fieldError = validateContactForm({ ...EMPTY_VALUES, [field]: next })[field];
      if (fieldError) return prev;
      const rest = { ...prev };
      delete rest[field];
      return rest;
    });
  }, []);

  const handleSubmit = useCallback(
    async (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      if (status === 'submitting') return;

      const validation = validateContactForm(values);
      setErrors(validation);
      if (hasErrors(validation)) {
        setStatus('error');
        setStatusMessage('נא למלא את כל השדות בצורה תקינה.');
        const firstInvalid = Object.keys(validation)[0];
        // Field ids match their names (see FormField).
        if (firstInvalid) document.getElementById(firstInvalid)?.focus();
        return;
      }

      setStatus('submitting');
      setStatusMessage('שולח…');
      try {
        await sendContactMessage(values);
        setStatus('success');
        setStatusMessage('תודה! ההודעה נשלחה בהצלחה, אחזור אליך בקרוב.');
        setValues(EMPTY_VALUES);
      } catch (err) {
        logError(err, { where: 'contact form submit' });
        setStatus('error');
        setStatusMessage(toUserMessage(err));
      }
    },
    [status, values],
  );

  return { values, errors, status, statusMessage, handleChange, handleSubmit };
};
