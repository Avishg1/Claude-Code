import { ArrowIcon } from '@/components/ui/Icons';
import { profile } from '@/data/content';
import { useReveal } from '@/hooks/useReveal';

export const Hero = () => {
  const eyebrow = useReveal<HTMLParagraphElement>('hero__eyebrow');
  const title = useReveal<HTMLHeadingElement>('hero__title');
  const tagline = useReveal<HTMLParagraphElement>('hero__tagline');
  const cta = useReveal<HTMLAnchorElement>('btn btn--ghost');

  return (
    <section className="hero" id="hero">
      <div className="hero__glow" aria-hidden="true"></div>
      <div className="hero__grid" aria-hidden="true"></div>
      <div className="container hero__content">
        <p {...eyebrow}>שלום, אני</p>
        <h1 {...title}>{profile.name}</h1>
        <p {...tagline}>{profile.tagline}</p>
        <a href="#contact" {...cta}>
          בואו נדבר
          <ArrowIcon />
        </a>
      </div>
      <a href="#about" className="hero__scroll" aria-label="גלילה לאודות">
        <span></span>
      </a>
    </section>
  );
};
