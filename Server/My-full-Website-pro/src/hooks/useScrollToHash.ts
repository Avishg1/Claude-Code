import { useEffect } from 'react';
import { useLocation } from 'react-router';

/**
 * Scrolls to the section in the URL hash (e.g. /#contact) once the page has rendered.
 * The browser tries to do this itself on load, but the page is lazy-loaded,
 * so the target section doesn't exist yet at that moment.
 */
export const useScrollToHash = (): void => {
  const { hash } = useLocation();

  useEffect(() => {
    if (!hash) return;
    const target = document.getElementById(decodeURIComponent(hash.slice(1)));
    target?.scrollIntoView({ block: 'start' });
  }, [hash]);
};
