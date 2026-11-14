import { SectionBoundary } from '@/components/layout/SectionBoundary';
import { About } from '@/components/sections/About';
import { Contact } from '@/components/sections/Contact';
import { Hero } from '@/components/sections/Hero';
import { Portfolio } from '@/components/sections/Portfolio';
import { Services } from '@/components/sections/Services';
import { Testimonials } from '@/components/sections/Testimonials';
import { useScrollToHash } from '@/hooks/useScrollToHash';

/** The one-page site. Each section has its own error boundary, so one failure doesn't take down the others. */
const HomePage = () => {
  useScrollToHash();

  return (
  <>
    <SectionBoundary name="hero">
      <Hero />
    </SectionBoundary>
    <SectionBoundary name="about">
      <About />
    </SectionBoundary>
    <SectionBoundary name="services">
      <Services />
    </SectionBoundary>
    <SectionBoundary name="portfolio">
      <Portfolio />
    </SectionBoundary>
    <SectionBoundary name="testimonials">
      <Testimonials />
    </SectionBoundary>
    <SectionBoundary name="contact">
      <Contact />
    </SectionBoundary>
  </>
  );
};

export default HomePage;
