import { useMemo } from 'react';

function stringify(value: unknown): string {
  try {
    const s = JSON.stringify(value, null, 2);
    return s === undefined ? String(value) : s;
  } catch {
    return '[לא ניתן להציג JSON]';
  }
}

/** Raw JSON rendered strictly as text in an LTR, scrollable block. */
export function JsonView({ value, label }: { value: unknown; label: string }) {
  const text = useMemo(() => stringify(value), [value]);
  return (
    <pre className="json-view" dir="ltr" tabIndex={0} aria-label={label}>
      {text}
    </pre>
  );
}

/** Raw line text (for malformed / incomplete lines). */
export function RawTextView({ text, label }: { text: string; label: string }) {
  return (
    <pre className="json-view raw-line" dir="ltr" tabIndex={0} aria-label={label}>
      {text}
    </pre>
  );
}
