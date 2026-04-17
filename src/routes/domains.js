import express from 'express';
import { addDomain, getDomains, verifyDomain } from '../controllers/domainController.js';
import { authMiddleware } from '../middleware/authMiddleware.js';

const router = express.Router();

router.use(authMiddleware);

router.post('/', addDomain);
router.get('/', getDomains);
router.post('/:id/verify', verifyDomain);

export default router;
