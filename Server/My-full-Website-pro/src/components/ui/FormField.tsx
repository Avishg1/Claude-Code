import type { ChangeEvent, HTMLInputTypeAttribute } from 'react';

interface FormFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
  error?: string;
  type?: HTMLInputTypeAttribute;
  placeholder?: string;
  autoComplete?: string;
  dir?: 'ltr' | 'rtl';
  multiline?: boolean;
}

/** Labelled input or textarea with an accessible inline error message. */
export const FormField = ({ id, label, error, multiline, type = 'text', ...rest }: FormFieldProps) => {
  const errorId = `${id}-error`;
  const shared = {
    id,
    name: id,
    required: true,
    className: error ? 'is-invalid' : undefined,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': error ? errorId : undefined,
    ...rest,
  };

  return (
    <div className="form__field">
      <label htmlFor={id}>{label}</label>
      {multiline ? <textarea rows={5} {...shared} /> : <input type={type} {...shared} />}
      {error && (
        <span className="form__error" id={errorId}>
          {error}
        </span>
      )}
    </div>
  );
};
