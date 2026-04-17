import express from 'express';
import { getMessages, getMessage, deleteMessage, syncInbox } from '../controllers/inboxController.js';
import { authMiddleware } from '../middleware/auth.js';

const router = express.Router();

router.use(authMiddleware);

router.get('/', getMessages);
router.get('/:id', getMessage);
router.delete('/:id', deleteMessage);
router.post('/sync', syncInbox);

export default router;
