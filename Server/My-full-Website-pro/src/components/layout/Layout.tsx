import { Suspense } from 'react';
import { Outlet } from 'react-router';
import { PageLoader } from '@/components/ui/PageLoader';
import { Footer } from './Footer';
import { Navbar } from './Navbar';
import { ScrollToTopButton } from './ScrollToTopButton';

/** Shared page frame. The nav and footer stay visible while a page is still loading. */
export const Layout = () => (
  <>
    <Navbar />
    <main>
      <Suspense fallback={<PageLoader />}>
        <Outlet />
      </Suspense>
    </main>
    <Footer />
    <ScrollToTopButton />
  </>
);
