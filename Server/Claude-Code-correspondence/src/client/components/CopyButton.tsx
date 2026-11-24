import { useEffect, useRef, useState } from 'react';

export function CopyButton({ getText, label, className }: { getText: () => string; label: string; className?: string }) {
  const [state, setState] = useState<'idle' | 'ok' | 'fail'>('idle');
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const onClick = async () => {
    try {
      await navigator.clipboard.writeText(getText());
      setState('ok');
    } catch {
      setState('fail');
    }
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setState('idle'), 1800);
  };
  return (
    <button type="button" className={`btn btn-small ${className ?? ''}`} onClick={onClick} aria-label={label} title={label}>
      <span aria-hidden="true">⧉</span> {state === 'ok' ? 'הועתק ✓' : state === 'fail' ? 'ההעתקה נכשלה' : 'העתקה'}
      <span className="visually-hidden" role="status">
        {state === 'ok' ? 'הטקסט הועתק ללוח' : state === 'fail' ? 'ההעתקה נכשלה' : ''}
      </span>
    </button>
  );
}
