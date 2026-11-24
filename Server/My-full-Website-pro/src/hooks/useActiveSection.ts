import { useEffect, useState } from 'react';
import { useLocation } from 'react-router';
import { onElementsReady } from '@/utils/onElementsReady';

/** Returns the id of the section currently in the middle of the viewport, for nav highlighting. */
export const useActiveSection = (sectionIds: readonly string[]): string | null => {
  const { pathname } = useLocation();
  // Remember which page the value belongs to, so a stale id never leaks onto another page.
  const [active, setActive] = useState<{ pathname: string; id: string | null }>({ pathname, id: null });
  const key = sectionIds.join('|');

  useEffect(() => {
    let intersectionObserver: IntersectionObserver | null = null;
    // The sections are on a lazy-loaded page, so wait for them instead of assuming they exist.
    const stopWaiting = onElementsReady(key.split('|'), (elements) => {
      const observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) setActive({ pathname, id: entry.target.id });
          });
        },
        { rootMargin: '-45% 0px -50% 0px' },
      );
      elements.forEach((el) => observer.observe(el));
      intersectionObserver = observer;
    });
    return () => {
      stopWaiting();
      intersectionObserver?.disconnect();
    };
  }, [key, pathname]);

  return active.pathname === pathname ? active.id : null;
};
