import { useEffect, useState } from 'react';
import { useLocation } from 'react-router';
import { onElementsReady } from '@/utils/onElementsReady';

/**
 * Tracks whether the element with the given id is on screen.
 * Reports `true` until the element has been seen (and on pages without it),
 * so UI that depends on "scrolled past it" stays hidden on first paint.
 */
export const useElementInView = (elementId: string): boolean => {
  const { pathname } = useLocation();
  // Remember which page the value belongs to, so a stale value never leaks onto another page.
  const [state, setState] = useState<{ pathname: string; inView: boolean }>({ pathname, inView: true });

  useEffect(() => {
    let intersectionObserver: IntersectionObserver | null = null;
    // The element may be on a lazy-loaded page, so wait for it instead of assuming it exists.
    const stopWaiting = onElementsReady([elementId], ([el]) => {
      if (!el) return;
      const observer = new IntersectionObserver(([entry]) =>
        setState({ pathname, inView: entry?.isIntersecting ?? false }),
      );
      observer.observe(el);
      intersectionObserver = observer;
    });
    return () => {
      stopWaiting();
      intersectionObserver?.disconnect();
    };
  }, [elementId, pathname]);

  return state.pathname === pathname ? state.inView : true;
};
