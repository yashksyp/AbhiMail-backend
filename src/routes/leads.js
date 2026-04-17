import { Router } from 'express';
import {
    getLeads,
    createLead,
    updateLead,
    deleteLead,
    importCsv,
    getLists,
    createList,
    deleteList,
} from '../controllers/leadController.js';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();

router.use(authMiddleware);

// Lead Lists
router.get('/lists', getLists);
router.post('/lists', createList);
router.delete('/lists/:id', deleteList);

// Leads
router.get('/', getLeads);
router.post('/', createLead);
router.put('/:id', updateLead);
router.delete('/:id', deleteLead);

// CSV Import
router.post('/import', importCsv);

export default router;
