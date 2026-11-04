# leafy-hrms-api

Node.js + Express + PostgreSQL API for the Leafy Digital HRMS (web app at https://leafydigital.in/hrms and the mobile apps).
Needs an always-on Node host (cron jobs + live chat stream) — use Railway or Render, not Netlify/Vercel.

## Deploy (Railway)
1. New project > Deploy from GitHub > this repo (root directory is the repo root). Start command: `npm start`.
2. Variables (see `.env.example`):
   `DATABASE_URL`, `JWT_SECRET`, `DATABASE_SSL`, `SMTP_*`, `MAIL_FROM`,
   `CORS_ORIGIN=https://leafydigital.in`  (comma-separate more web origins),
   `FRONTEND_URL=https://leafydigital.in/hrms`
3. Settings > Networking > Custom domain `api.leafydigital.in` (add the CNAME at your DNS).
4. Check `https://api.leafydigital.in/api/health` returns `{"ok":true}`.
5. First time only (Railway shell, or locally with the same DATABASE_URL):
   `npm run db:setup && npm run db:migrate && npm run create-admin`

## Local
`cp .env.example .env`, fill it in, `npm install`, `npm run dev` (http://localhost:4000).

## Mobile apps
Base URL `https://api.leafydigital.in/api`. `POST /api/auth/login {email,password}` returns `access_token`;
send `Authorization: Bearer <token>` on every request. Native apps are not subject to CORS; only browser origins
need to be listed in `CORS_ORIGIN`. Live events: `GET /api/chat/stream` (SSE, same Bearer header).
