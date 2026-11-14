import { ArrowUpIcon } from '@/components/ui/Icons';
import { useElementInView } from '@/hooks/useElementInView';
import { prefersReducedMotion } from '@/hooks/usePrefersReducedMotion';

/** Appears once the hero section has scrolled out of view. */
export const ScrollToTopButton = () => {
  const heroVisible = useElementInView('hero');
  const visible = !heroVisible;

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    // Move focus to the top too, for keyboard and screen-reader users.
    document.querySelector<HTMLElement>('.nav__logo')?.focus({ preventScroll: true });
  };

  return (
    <button
      type="button"
      className={`to-top${visible ? ' is-visible' : ''}`}
      aria-label="חזרה לראש העמוד"
      title="חזרה לראש העמוד"
      tabIndex={visible ? 0 : -1}
      aria-hidden={!visible}
      onClick={scrollToTop}
    >
      <ArrowUpIcon />
    </button>
  );
};
