import { profile, navLinks } from '@/data/content';
import { useActiveSection } from '@/hooks/useActiveSection';
import { useMobileMenu } from '@/hooks/useMobileMenu';
import { useScrolled } from '@/hooks/useScrolled';

const SECTION_IDS = navLinks.map((l) => l.id);

export const Navbar = () => {
  const scrolled = useScrolled();
  const activeId = useActiveSection(SECTION_IDS);
  const menu = useMobileMenu();
  const [first, last] = profile.initials;

  return (
    <header className={`nav${scrolled ? ' is-scrolled' : ''}`} id="nav">
      <div className="container nav__inner">
        {/* Links start with "/" so they also work from other pages, such as the 404 page. */}
        <a href="/#hero" className="nav__logo" aria-label="חזרה לראש העמוד">
          {first}
          <span>.</span>
          {last}
        </a>
        <button
          type="button"
          className="nav__toggle"
          aria-label={menu.isOpen ? 'סגירת תפריט' : 'פתיחת תפריט'}
          aria-expanded={menu.isOpen}
          aria-controls="navMenu"
          onClick={menu.toggle}
        >
          <span></span>
          <span></span>
          <span></span>
        </button>
        <nav aria-label="ניווט ראשי">
          <ul className={`nav__menu${menu.isOpen ? ' is-open' : ''}`} id="navMenu">
            {navLinks.map((link) => {
              const classes = [link.isCta && 'nav__cta', activeId === link.id && 'is-active'].filter(Boolean).join(' ');
              return (
                <li key={link.id}>
                  <a href={`/#${link.id}`} className={classes || undefined} onClick={menu.close}>
                    {link.label}
                  </a>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>
    </header>
  );
};
