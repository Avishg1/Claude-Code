import { useReveal } from '@/hooks/useReveal';

interface SectionHeaderProps {
  eyebrow: string;
  title: string;
  lead?: string;
}

export const SectionHeader = ({ eyebrow, title, lead }: SectionHeaderProps) => {
  const reveal = useReveal<HTMLElement>('section__header');
  return (
    <header {...reveal}>
      <p className="section__eyebrow">{eyebrow}</p>
      <h2 className="section__title">{title}</h2>
      {lead && <p className="section__lead">{lead}</p>}
    </header>
  );
};
