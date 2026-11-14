import type { ErrorFallbackProps } from './ErrorBoundary';

/** Whole-app fallback: shown only if something outside a section crashes. */
export const AppErrorFallback = () => (
  <div className="error-screen" role="alert">
    <h1>משהו השתבש</h1>
    <p>אירעה שגיאה בטעינת האתר. נסו לרענן את הדף.</p>
    <button type="button" className="btn btn--primary" onClick={() => window.location.reload()}>
      רענון הדף
    </button>
  </div>
);

/** Section-level fallback: the rest of the page keeps working. */
export const SectionErrorFallback = ({ reset }: ErrorFallbackProps) => (
  <div className="container section-error" role="alert">
    <p>לא הצלחנו להציג את החלק הזה של העמוד.</p>
    <button type="button" className="btn btn--ghost" onClick={reset}>
      נסו שוב
    </button>
  </div>
);
