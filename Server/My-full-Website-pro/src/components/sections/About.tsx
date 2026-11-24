import { PersonIcon } from '@/components/ui/Icons';
import { about } from '@/data/content';
import { useReveal } from '@/hooks/useReveal';

export const About = () => {
  const photo = useReveal<HTMLDivElement>('about__photo');
  const text = useReveal<HTMLDivElement>('about__text');

  return (
    <section className="section" id="about">
      <div className="container about">
        <div {...photo}>
          <div className="photo-placeholder" role="img" aria-label="מקום לתמונה אישית">
            <PersonIcon />
          </div>
        </div>
        <div {...text}>
          <p className="section__eyebrow">אודות</p>
          <h2 className="section__title">{about.title}</h2>
          {about.paragraphs.map((p) => (
            <p key={p}>{p}</p>
          ))}
          <ul className="about__stats">
            {about.stats.map((stat) => (
              <li key={stat.label}>
                <strong>{stat.value}</strong>
                <span>{stat.label}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
};
