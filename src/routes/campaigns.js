import { Router } from 'express';
import {
    getCampaigns,
    getCampaign,
    createCampaign,
    updateCampaign,
    deleteCampaign,
    enrollLeads,
    enrollList,
    startCampaign,
    pauseCampaign,
    addStep,
    updateStep,
    deleteStep,
} from '../controllers/campaignController.js';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();

router.use(authMiddleware);
router.get('/', getCampaigns);
router.get('/:id', getCampaign);
router.post('/', createCampaign);
router.put('/:id', updateCampaign);
router.delete('/:id', deleteCampaign);

// Campaign actions
router.post('/:id/start', startCampaign);
router.post('/:id/pause', pauseCampaign);
router.post('/:id/enroll', enrollLeads);
router.post('/:id/enroll-list', enrollList);

// Campaign step CRUD
router.post('/:id/steps', addStep);
router.put('/:id/steps/:stepId', updateStep);
router.delete('/:id/steps/:stepId', deleteStep);

export default router;
