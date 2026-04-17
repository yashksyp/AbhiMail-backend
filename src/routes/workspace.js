import { getWorkspace, updateWorkspace, getMembers, connectSmtp, inviteMember, removeMember } from '../controllers/workspaceController.js';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();

router.use(authMiddleware);
router.get('/', getWorkspace);
router.put('/', updateWorkspace);
router.get('/members', getMembers);
router.post('/members', inviteMember);
router.delete('/members/:id', removeMember);
router.post('/smtp', connectSmtp);

export default router;
