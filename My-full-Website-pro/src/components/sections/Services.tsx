import { ServiceIcon } from '@/components/ui/Icons';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { services } from '@/data/content';
import { useReveal } from '@/hooks/useReveal';
import type { Service } from '@/types/content';

const ServiceCard = ({ service }: { service: Service }) => {
  const reveal = useReveal<HTMLElement>('card service', { isCard: true });
  return (
    <article {...reveal}>
      <div className="service__icon" aria-hidden="true">
        <ServiceIcon name={service.icon} />
      </div>
      <h3>{service.title}</h3>
      <p>{service.description}</p>
    </article>
  );
};

export const Services = () => (
  <section className="section section--alt" id="services">
    <div className="container">
      <SectionHeader eyebrow="שירותים" title="במה אני יכול לעזור" />
      <div className="services">
        {services.map((service) => (
          <ServiceCard key={service.id} service={service} />
        ))}
      </div>
    </div>
  </section>
);
