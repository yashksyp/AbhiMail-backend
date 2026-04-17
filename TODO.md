# AbhiMail Project - Completion TODO

## Status: Frontend 85% | Backend 0% | Goal: 100% MVP

### 1. Frontend Polish (15% remaining - Target: 100%)
- [ ] Replace all mock data with real API responses (PERFORMANCE_DATA → /analytics, CAMPAIGNS → /campaigns)
- [ ] Implement full CampaignsView.tsx (list, create, edit, start/pause campaigns)
- [ ] Implement full LeadsView.tsx (list, search, CSV import execution)
- [ ] Implement ActivityFeed.tsx (real activity log)
- [ ] Integrate real Gemini AI for reply generation (@google/genai)
- [ ] Add form validation (Zod + React Hook Form)
- [ ] Add loading/error states everywhere
- [ ] Add unit tests (Vitest + React Testing Library)
- [ ] Optimize ThreeBackground performance

### 2. Backend (100% remaining - Node/Express MVP)
```
backend/
├── server.js (Express app)
├── prisma/schema.prisma (Postgres models)
├── routes/ (auth, campaigns, leads, workspace, analytics)
├── services/ (smtp/nodemailer, campaign scheduler)
├── middleware/ (auth, rate-limit)
├── controllers/
└── utils/ (cron jobs, CSV parser)
```
- [ ] Setup backend/ dir + package.json (Express, Prisma, Nodemailer, JWT, bcrypt, cors, helmet)
- [ ] Database: Prisma + Postgres (users, workspaces, campaigns, leads, emails, analytics)
- [ ] Auth: /auth/register, /login, /refresh, /logout (JWT)
- [ ] Campaigns: CRUD + start/pause + scheduler (node-cron)
- [ ] Leads: CRUD + CSV import (csv-parse)
- [ ] SMTP: Connect/test sending (nodemailer)
- [ ] Analytics: Aggregate stats (sent/opens/replies)
- [ ] Workspace: Multi-tenant isolation
- [ ] Rate limiting + email warmup logic
- [ ] API docs (Swagger)

### 3. Integration & Deployment
- [ ] Update VITE_API_URL=backend:4000
- [ ] Docker compose (frontend + backend + postgres)
- [ ] CI/CD (GitHub Actions)
- [ ] Env vars + secrets
- [ ] Monitoring (Sentry)

### Priority Order:
1. [x] Backend auth + basic models ← **IN PROGRESS**
2. Frontend real data integration
3. SMTP + campaigns
4. Full polish + deploy

**Current Step**: Backend setup (package.json, server.js, Prisma)

**Estimated**: 20-30 hours for MVP.
