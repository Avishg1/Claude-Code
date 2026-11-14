import { useEffect, useState } from 'react';

/** Returns the id of the section currently in the middle of the viewport, for nav highlighting. */
export const useActiveSection = (sectionIds: readonly string[]): string | null => {
  const [active, setActive] = useState<string | null>(null);
  const key = sectionIds.join('|');

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) setActive(entry.target.id);
        });
      },
      { rootMargin: '-45% 0px -50% 0px' },
    );
    key.split('|').forEach((id) => {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, [key]);

  return active;
};
