import { useEffect, useRef, useState, type CSSProperties, type RefObject, type TransitionEvent } from 'react';
import { usePrefersReducedMotion } from './usePrefersReducedMotion';

/*
 * Scroll-in animation: elements fade up as they enter the screen.
 * Elements that enter together get staggered delays in document order,
 * so a section title appears first and its cards follow one by one.
 *
 * One IntersectionObserver is shared by every element so that elements entering
 * in the same frame arrive in the same callback and can be staggered together.
 */
const STAGGER_DEFAULT_MS = 110;
const STAGGER_CARDS_MS = 140;
const MAX_DELAY_MS = 840; // cap, so fast scrolling never leaves a long wait

type RevealCallback = (delayMs: number) => void;

const callbacks = new Map<Element, { onReveal: RevealCallback; isCard: boolean }>();
let sharedObserver: IntersectionObserver | null = null;

const getObserver = (): IntersectionObserver => {
  sharedObserver ??= new IntersectionObserver(
    (entries) => {
      const entering = entries
        .filter((e) => e.isIntersecting)
        .map((e) => e.target)
        .sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));

      let delay = 0;
      for (const el of entering) {
        const entry = callbacks.get(el);
        sharedObserver?.unobserve(el);
        callbacks.delete(el);
        if (!entry) continue;
        entry.onReveal(Math.min(delay, MAX_DELAY_MS));
        delay += entry.isCard ? STAGGER_CARDS_MS : STAGGER_DEFAULT_MS;
      }
    },
    { threshold: 0.15, rootMargin: '0px 0px -40px 0px' },
  );
  return sharedObserver;
};

type Phase = 'hidden' | 'visible' | 'done';

interface RevealProps<T extends HTMLElement> {
  ref: RefObject<T | null>;
  className: string;
  style: CSSProperties | undefined;
  onTransitionEnd: (e: TransitionEvent<T>) => void;
}

/**
 * Spread the result onto the element to animate.
 * `baseClassName` is the element's own classes; reveal classes are added around it.
 * After the animation the reveal classes are dropped so hover transitions run without delay.
 */
export const useReveal = <T extends HTMLElement>(baseClassName = '', { isCard = false } = {}): RevealProps<T> => {
  const ref = useRef<T>(null);
  const reducedMotion = usePrefersReducedMotion();
  const [phase, setPhase] = useState<Phase>('hidden');
  const [delay, setDelay] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el || reducedMotion) return;
    callbacks.set(el, {
      isCard,
      onReveal: (ms) => {
        setDelay(ms);
        setPhase('visible');
      },
    });
    const observer = getObserver();
    observer.observe(el);
    return () => {
      observer.unobserve(el);
      callbacks.delete(el);
    };
  }, [isCard, reducedMotion]);

  const effectivePhase: Phase = reducedMotion ? 'done' : phase;
  const revealClass = effectivePhase === 'hidden' ? 'reveal' : effectivePhase === 'visible' ? 'reveal is-visible' : '';

  return {
    ref,
    className: [baseClassName, revealClass].filter(Boolean).join(' '),
    style: effectivePhase === 'visible' ? ({ '--reveal-delay': `${delay}ms` } as CSSProperties) : undefined,
    onTransitionEnd: (e) => {
      if (e.target === e.currentTarget && e.propertyName === 'transform' && phase === 'visible') setPhase('done');
    },
  };
};
