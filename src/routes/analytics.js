import { Router } from 'express';
import { getOverview, getTimeline, getCampaignAnalytics, getCampaignStats, getActivityFeed } from '../controllers/analyticsController.js';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();

router.use(authMiddleware);
router.get('/overview', getOverview);
router.get('/timeline', getTimeline);
router.get('/campaigns', getCampaignAnalytics);
router.get('/campaigns/:id', getCampaignStats);
router.get('/feed', getActivityFeed);

export default router;
