export interface NavLink {
  id: string;
  label: string;
  isCta?: boolean;
}

export interface Stat {
  value: string;
  label: string;
}

export type ServiceIconName = 'strategy' | 'design' | 'code' | 'growth';

export interface Service {
  id: string;
  icon: ServiceIconName;
  title: string;
  description: string;
}

export interface Project {
  id: string;
  title: string;
  description: string;
}

export interface Testimonial {
  id: string;
  quote: string;
  name: string;
  role: string;
  initials: string;
}

export type SocialIconName = 'linkedin' | 'github' | 'instagram' | 'x';

export interface SocialLink {
  icon: SocialIconName;
  label: string;
  href: string;
}
