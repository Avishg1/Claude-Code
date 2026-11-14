# My Full Website

Personal one-page site (Hebrew, RTL), built with React 19, TypeScript and Vite.

## Commands

| Command             | What it does                                       |
| ------------------- | -------------------------------------------------- |
| `npm install`       | Install dependencies (once, after cloning)         |
| `npm run dev`       | Local dev server with hot reload                   |
| `npm run build`     | Typecheck, then build the production site to `dist/` |
| `npm run preview`   | Serve the built `dist/` folder locally             |
| `npm test`          | Run unit tests                                     |
| `npm run lint`      | Run ESLint                                         |

## Structure

```
src/
  pages/           One component per route (lazy-loaded): HomePage, NotFoundPage
  components/
    layout/        Page frame: Navbar, Footer, Layout, ScrollToTopButton, SectionBoundary
    sections/      The home page sections: Hero, About, Services, Portfolio, Testimonials, Contact
    ui/            Reusable pieces: ErrorBoundary, Spinner, PageLoader, FormField, Icons…
  hooks/           Behaviour as hooks: useContactForm, useReveal, useActiveSection, useScrolled…
  services/        Talking to the outside world (contactService → Web3Forms)
  utils/           Pure helpers: validation, errors, logger, date
  data/content.ts  All site text — edit copy here, not in components
  config/env.ts    Typed access to environment variables
  types/           Shared TypeScript types
  styles/          Global CSS
```

## Error handling and loading states

- **Whole app:** an error boundary shows a "something went wrong, reload" screen instead of a blank page.
- **Each section:** has its own boundary, so a crash in one section shows a small "try again" message and the rest of the page keeps working.
- **Pages:** code-split and loaded with a spinner (`PageLoader`) while they download.
- **Contact form:** validates each field with inline messages, shows a spinner and disables the button while sending, times out after 15 s, and gives a specific Hebrew message for network, timeout, server and missing-config errors.
- **Logging:** every error goes through `utils/logger.ts`, the one place to plug in a monitoring service.

## Configuration

`VITE_WEB3FORMS_ACCESS_KEY` in `.env` is the Web3Forms key for the contact form. It's a public key, so it's safe in client code. To override it locally without committing, put it in `.env.local`.

## Deploying

Run `npm run build` and upload the contents of `dist/`. The site uses real URLs (not `#/` routes), so for the 404 page to work on unknown paths, the host must serve `index.html` for any path. On Netlify, add a `_redirects` file with `/* /index.html 200`; Vercel and Cloudflare Pages do this automatically. On GitHub Pages, copy `dist/index.html` to `dist/404.html` before uploading.
