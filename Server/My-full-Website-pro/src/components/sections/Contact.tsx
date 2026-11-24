import { FormField } from '@/components/ui/FormField';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { Spinner } from '@/components/ui/Spinner';
import { contact } from '@/data/content';
import { useContactForm } from '@/hooks/useContactForm';
import { useReveal } from '@/hooks/useReveal';

export const Contact = () => {
  const { values, errors, status, statusMessage, handleChange, handleSubmit } = useContactForm();
  const reveal = useReveal<HTMLFormElement>('form card');
  const submitting = status === 'submitting';
  const statusClass = status === 'success' ? ' is-success' : status === 'error' ? ' is-error' : '';

  return (
    <section className="section" id="contact">
      <div className="container contact">
        <SectionHeader eyebrow="צור קשר" title={contact.title} lead={contact.lead} />
        <form
          {...reveal}
          noValidate
          aria-busy={submitting}
          onSubmit={handleSubmit}
        >
          <div className="form__row">
            <FormField
              id="name"
              label="שם מלא"
              value={values.name}
              error={errors.name}
              onChange={handleChange}
              placeholder="איך קוראים לך?"
              autoComplete="name"
            />
            <FormField
              id="email"
              label="אימייל"
              type="email"
              value={values.email}
              error={errors.email}
              onChange={handleChange}
              placeholder="name@example.com"
              dir="ltr"
              autoComplete="email"
            />
          </div>
          <FormField
            id="subject"
            label="נושא"
            value={values.subject}
            error={errors.subject}
            onChange={handleChange}
            placeholder="במה מדובר?"
          />
          <FormField
            id="message"
            label="הודעה"
            multiline
            value={values.message}
            error={errors.message}
            onChange={handleChange}
            placeholder="ספרו לי קצת על הפרויקט..."
          />
          <button type="submit" className="btn btn--primary" disabled={submitting}>
            {submitting && <Spinner />}
            שליחת הודעה
          </button>
          <p className={`form__status${statusClass}`} role="status" aria-live="polite">
            {statusMessage}
          </p>
        </form>
      </div>
    </section>
  );
};
