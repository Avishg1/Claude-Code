import { CopyButton } from './CopyButton';

/** A fenced code block. Always LTR, horizontally scrollable inside its own box. */
export function CodeBlock({ code, lang }: { code: string; lang?: string }) {
  const label = lang && /^[\w#+.-]{1,32}$/.test(lang) ? lang : '';
  return (
    <div className="code-block">
      <div className="code-block-header">
        <span className="code-lang" dir="ltr">
          {label || 'קוד'}
        </span>
        <CopyButton getText={() => code} label={`העתקת בלוק קוד${label ? ` (${label})` : ''}`} />
      </div>
      <pre dir="ltr" tabIndex={0} aria-label={`בלוק קוד${label ? ` בשפת ${label}` : ''}`}>
        <code>{code}</code>
      </pre>
    </div>
  );
}
