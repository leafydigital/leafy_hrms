# leafy-digital (website + HRMS web app, one project)

Same idea as the Wander Breeze project: one Vite + React app, each app lazy-loaded by URL.

| URL | Code | Notes |
|---|---|---|
| `/` | `src/website/` | marketing site (ported from the old static site; markup `website.body.html`, styles `website.css`, behaviour `scripts/`) |
| `/hrms/*` | `src/hrms/` | HRMS React app (React Router, basename `/hrms`), `noindex` |

```
index.html            SEO head for the website (title, meta, JSON-LD, analytics)
src/main.jsx          picks website or HRMS by path
public/               site static files: robots.txt, sitemap.xml, og-image.png, 404.html, privacy-policy.html, images/
public/hrms/          HRMS static files: logos, icons, manifest.webmanifest, sw.js
docs/                 HRMS notes/changelogs
netlify.toml          build + /hrms SPA redirect
```

## Run
`npm install` then `npm run dev` → http://localhost:5173/ (site) and http://localhost:5173/hrms/ (HRMS).
In dev, `/api` is proxied to `http://localhost:4000` (run the API project there).

## Deploy (Netlify)
Connect the repo; `netlify.toml` sets build `npm run build`, publish `dist`.
Env var: `VITE_API_URL=https://api.leafydigital.in` (the deployed API — see the `leafy-hrms-api` project).

## Notes
- Moving between `/` and `/hrms` is a normal page load (separate apps, separate CSS), so use plain `<a href="/hrms/">` links.
- The HRMS base path is the constant `__HRMS_BASE__` in `vite.config.js`.
- Converting the website into React components can be done section by section; `Website.jsx` is the only place to change.
