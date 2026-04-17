import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { PrismaClient } from '@prisma/client';

import authRoutes from './routes/auth.js';
import workspaceRoutes from './routes/workspace.js';
import campaignRoutes from './routes/campaigns.js';
import leadRoutes from './routes/leads.js';
import analyticsRoutes from './routes/analytics.js';
import accountRoutes from './routes/accounts.js';
import inboxRoutes from './routes/inbox.js';
import trackingRoutes from './routes/tracking.js';
import domainRoutes from './routes/domains.js';

import cron from 'node-cron';
import { processEmails } from './services/worker.js';
import { syncAllAccounts } from './services/imapService.js';

const app = express();
const prisma = new PrismaClient();

// --- Background Job: Reset Daily Limits at Midnight ---
cron.schedule('0 0 * * *', async () => {
  console.log('[Cron] Resetting daily sent limits...');
  await prisma.emailAccount.updateMany({ data: { sentToday: 0 } });
});

// --- Background Job: Process Emails every 5 minutes ---
cron.schedule('*/5 * * * *', async () => {
  await processEmails();
});

// --- Background Job: Sync Replies every 10 minutes ---
cron.schedule('*/10 * * * *', async () => {
  await syncAllAccounts();
});

import rateLimit from 'express-rate-limit';

// --- Rate Limiting ---
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per 15 minutes
  standardHeaders: true,
  legacyHeaders: false,
});

const trackingLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 300, // Higher limit for tracking, but prevents extreme DDoS
  standardHeaders: true,
  legacyHeaders: false,
});

// --- Middleware ---
app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
}));
app.use(express.json({ limit: '25mb' }));

// --- Routes ---
app.use('/api/auth', apiLimiter, authRoutes);
app.use('/api/workspace', workspaceRoutes);
app.use('/api/campaigns', campaignRoutes);
app.use('/api/accounts', accountRoutes);
app.use('/api/leads', leadRoutes);
app.use('/api/lists', leadRoutes); // alias for list endpoints
app.use('/api/analytics', analyticsRoutes);
app.use('/api/inbox', inboxRoutes);
app.use('/api/track', trackingLimiter, trackingRoutes);
app.use('/api/domains', domainRoutes);

// --- Health Check ---
app.get('/health', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ok', db: 'connected', timestamp: new Date().toISOString() });
  } catch {
    res.status(500).json({ status: 'error', db: 'disconnected' });
  }
});

// --- 404 ---
app.use((req, res) => {
  res.status(404).json({ error: `Route ${req.method} ${req.path} not found` });
});

// --- Global Error Handler ---
app.use((err, req, res, next) => {
  console.error('[UnhandledError]', err);
  res.status(500).json({ error: 'Internal server error' });
});

// --- Start ---
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`🚀 AbhiMail Backend running on http://localhost:${PORT}`);
  console.log(`   Health check: http://localhost:${PORT}/health`);
});

// Graceful shutdown
process.on('SIGINT', async () => {
  await prisma.$disconnect();
  process.exit(0);
});
