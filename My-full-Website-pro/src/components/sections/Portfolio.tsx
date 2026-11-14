import { SectionHeader } from '@/components/ui/SectionHeader';
import { projects } from '@/data/content';
import { useReveal } from '@/hooks/useReveal';
import type { Project } from '@/types/content';

const ProjectCard = ({ project, index }: { project: Project; index: number }) => {
  const reveal = useReveal<HTMLElement>('card project', { isCard: true });
  return (
    <article {...reveal}>
      <div className="project__img" role="img" aria-label="תמונת פרויקט לדוגמה">
        <span>{String(index + 1).padStart(2, '0')}</span>
      </div>
      <div className="project__body">
        <h3>{project.title}</h3>
        <p>{project.description}</p>
      </div>
    </article>
  );
};

export const Portfolio = () => (
  <section className="section" id="portfolio">
    <div className="container">
      <SectionHeader eyebrow="עבודות נבחרות" title="פרויקטים שאני גאה בהם" />
      <div className="portfolio">
        {projects.map((project, i) => (
          <ProjectCard key={project.id} project={project} index={i} />
        ))}
      </div>
    </div>
  </section>
);
