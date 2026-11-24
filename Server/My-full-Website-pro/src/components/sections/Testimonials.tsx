import { SectionHeader } from '@/components/ui/SectionHeader';
import { testimonials } from '@/data/content';
import { useReveal } from '@/hooks/useReveal';
import type { Testimonial } from '@/types/content';

const TestimonialCard = ({ testimonial }: { testimonial: Testimonial }) => {
  const reveal = useReveal<HTMLElement>('card testimonial', { isCard: true });
  return (
    <figure {...reveal}>
      <blockquote>"{testimonial.quote}"</blockquote>
      <figcaption>
        <span className="avatar" aria-hidden="true">
          {testimonial.initials}
        </span>
        <span>
          <strong>{testimonial.name}</strong>
          <small>{testimonial.role}</small>
        </span>
      </figcaption>
    </figure>
  );
};

export const Testimonials = () => (
  <section className="section section--alt" id="testimonials">
    <div className="container">
      <SectionHeader eyebrow="המלצות" title="מה הלקוחות אומרים" />
      <div className="testimonials">
        {testimonials.map((t) => (
          <TestimonialCard key={t.id} testimonial={t} />
        ))}
      </div>
    </div>
  </section>
);
