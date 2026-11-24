interface SpinnerProps {
  size?: 'sm' | 'lg';
  /** Read by screen readers. Omit when the surrounding text already says what's loading. */
  label?: string;
}

export const Spinner = ({ size = 'sm', label }: SpinnerProps) => (
  <span className={`spinner spinner--${size}`} role={label ? 'status' : undefined} aria-label={label} aria-hidden={label ? undefined : true} />
);
