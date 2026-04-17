import express from 'express';
import { trackOpen, trackClick, trackUnsubscribe } from '../controllers/trackingController.js';

const router = express.Router();

router.get('/open/:id', trackOpen);
router.get('/click/:id', trackClick);
router.get('/unsubscribe/:id', trackUnsubscribe);

export default router;
