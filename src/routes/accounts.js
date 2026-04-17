import express from 'express';
import { getAccounts, createAccount, updateAccount, deleteAccount, testConnection } from '../controllers/accountController.js';
import { authMiddleware } from '../middleware/auth.js';

const router = express.Router();

router.use(authMiddleware);

router.get('/', getAccounts);
router.post('/', createAccount);
router.put('/:id', updateAccount);
router.delete('/:id', deleteAccount);
router.post('/test', testConnection);

export default router;
