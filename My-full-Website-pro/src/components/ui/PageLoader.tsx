import { Spinner } from './Spinner';

/** Full-screen loading state while a lazily loaded page downloads. */
export const PageLoader = () => (
  <div className="page-loader">
    <Spinner size="lg" label="טוען…" />
  </div>
);
