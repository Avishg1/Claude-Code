import { useEffect, useState } from 'react';

/**
 * Tracks whether the element with the given id is on screen.
 * Starts as `true` so UI that depends on "scrolled past it" stays hidden on first paint.
 */
export const useElementInView = (elementId: string): boolean => {
  const [inView, setInView] = useState(true);

  useEffect(() => {
    const el = document.getElementById(elementId);
    if (!el) return;
    const observer = new IntersectionObserver(([entry]) => setInView(entry?.isIntersecting ?? false));
    observer.observe(el);
    return () => observer.disconnect();
  }, [elementId]);

  return inView;
};
