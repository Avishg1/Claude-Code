import { SocialIcon } from '@/components/ui/Icons';
import { profile, socialLinks } from '@/data/content';
import { formatYear } from '@/utils/date';

export const Footer = () => (
  <footer className="footer">
    <div className="container footer__inner">
      <p>
        © {formatYear()} {profile.name}. כל הזכויות שמורות.
      </p>
      <ul className="footer__social">
        {socialLinks.map((link) => (
          <li key={link.icon}>
            <a href={link.href} aria-label={link.label}>
              <SocialIcon name={link.icon} />
            </a>
          </li>
        ))}
      </ul>
    </div>
  </footer>
);
