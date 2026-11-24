import type { ServiceIconName, SocialIconName } from '@/types/content';

const SERVICE_ICONS: Record<ServiceIconName, React.JSX.Element> = {
  strategy: <path d="M12 2l3 7h7l-5.5 4.5L18 21l-6-4-6 4 1.5-7.5L2 9h7z" />,
  design: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <path d="M3 9h18M9 21V9" />
    </>
  ),
  code: <path d="M8 6l-6 6 6 6M16 6l6 6-6 6M14 4l-4 16" />,
  growth: (
    <>
      <path d="M3 3v18h18" />
      <path d="M7 15l4-4 3 3 6-6" />
    </>
  ),
};

const SOCIAL_ICONS: Record<SocialIconName, string> = {
  linkedin:
    'M4.98 3.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5zM3 9h4v12H3zM9 9h3.8v1.7h.05c.53-1 1.83-2.05 3.77-2.05 4.03 0 4.78 2.65 4.78 6.1V21h-4v-5.5c0-1.3-.02-3-1.83-3-1.83 0-2.1 1.43-2.1 2.9V21H9z',
  github:
    'M12 .5a11.5 11.5 0 0 0-3.64 22.4c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.52-1.33-1.28-1.69-1.28-1.69-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.84 1.19 3.1 0 4.42-2.7 5.4-5.26 5.68.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5z',
  instagram:
    'M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10zm0 8.2a3.2 3.2 0 1 1 0-6.4 3.2 3.2 0 0 1 0 6.4zM17.3 5.5a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4zM12 2c-2.7 0-3 0-4.1.06C4.3 2.2 2.2 4.3 2.06 7.9 2 9 2 9.3 2 12s0 3 .06 4.1c.15 3.6 2.24 5.7 5.84 5.84C9 22 9.3 22 12 22s3 0 4.1-.06c3.6-.15 5.7-2.24 5.84-5.84C22 15 22 14.7 22 12s0-3-.06-4.1C21.8 4.3 19.7 2.2 16.1 2.06 15 2 14.7 2 12 2zm0 1.8c2.67 0 3 0 4 .06 2.7.12 3.97 1.4 4.1 4.1.05 1.05.06 1.36.06 4.04s0 3-.06 4.04c-.13 2.7-1.4 3.97-4.1 4.1-1.05.05-1.36.06-4.04.06s-3 0-4.04-.06c-2.7-.13-3.97-1.4-4.1-4.1C3.8 15 3.8 14.68 3.8 12s0-3 .06-4.04c.13-2.7 1.4-3.97 4.1-4.1C9 3.8 9.33 3.8 12 3.8z',
  x: 'M17.75 3h3.07l-6.7 7.66L22 21h-6.17l-4.83-6.32L5.47 21H2.4l7.17-8.2L2 3h6.33l4.37 5.77zm-1.08 16.2h1.7L7.4 4.73H5.58z',
};

export const ServiceIcon = ({ name }: { name: ServiceIconName }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    {SERVICE_ICONS[name]}
  </svg>
);

export const SocialIcon = ({ name }: { name: SocialIconName }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d={SOCIAL_ICONS[name]} />
  </svg>
);

export const ArrowIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M19 12H5M11 6l-6 6 6 6" />
  </svg>
);

export const ArrowUpIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 19V5M6 11l6-6 6 6" />
  </svg>
);

export const PersonIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8" />
  </svg>
);
