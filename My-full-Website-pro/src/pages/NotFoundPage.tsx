import { useEffect } from 'react';
import { Link } from 'react-router';
import { profile } from '@/data/content';

const NotFoundPage = () => {
  useEffect(() => {
    const previous = document.title;
    document.title = `הדף לא נמצא | ${profile.name}`;
    return () => {
      document.title = previous;
    };
  }, []);

  return (
    <section className="error-screen">
      <p className="section__eyebrow">404</p>
      <h1>הדף לא נמצא</h1>
      <p>ייתכן שהקישור שגוי או שהדף הועבר.</p>
      <Link to="/" className="btn btn--primary">
        חזרה לדף הבית
      </Link>
    </section>
  );
};

export default NotFoundPage;
