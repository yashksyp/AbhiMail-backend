import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export const getWorkspace = async (req, res) => {
    try {
        const workspace = await prisma.workspace.findUnique({
            where: { id: req.workspaceId },
            include: { members: { include: { user: { select: { id: true, name: true, email: true, role: true } } } } },
        });
        if (!workspace) return res.status(404).json({ error: 'Workspace not found' });
        return res.json(workspace);
    } catch (err) {
        return res.status(500).json({ error: 'Internal server error' });
    }
};

export const updateWorkspace = async (req, res) => {
    try {
        const { name, smtpHost, smtpPort, smtpUser, smtpPass, dailyLimit } = req.body;
        const workspace = await prisma.workspace.update({
            where: { id: req.workspaceId },
            data: { name, smtpHost, smtpPort: smtpPort ? parseInt(smtpPort) : undefined, smtpUser, smtpPass, dailyLimit: dailyLimit ? parseInt(dailyLimit) : undefined },
        });
        return res.json(workspace);
    } catch (err) {
        return res.status(500).json({ error: 'Internal server error' });
    }
};

export const getMembers = async (req, res) => {
    try {
        const members = await prisma.workspaceMember.findMany({
            where: { workspaceId: req.workspaceId },
            include: { user: { select: { id: true, name: true, email: true } } },
        });
        return res.json(members.map(m => ({
            id: m.user.id,
            name: m.user.name,
            email: m.user.email,
            role: m.role,
            memberId: m.id,
            status: 'ACTIVE' // Default for now
        })));
    } catch (err) {
        return res.status(500).json({ error: 'Internal server error' });
    }
};

export const inviteMember = async (req, res) => {
    try {
        const { email, role } = req.body;
        const userToInvite = await prisma.user.findUnique({ where: { email } });

        if (!userToInvite) {
            return res.status(404).json({ error: 'User with this email not found. Please ask them to register first.' });
        }

        const existing = await prisma.workspaceMember.findUnique({
            where: { userId_workspaceId: { userId: userToInvite.id, workspaceId: req.workspaceId } }
        });

        if (existing) return res.status(400).json({ error: 'User is already a member of this workspace.' });

        const member = await prisma.workspaceMember.create({
            data: { userId: userToInvite.id, workspaceId: req.workspaceId, role: role || 'member' }
        });

        return res.json(member);
    } catch (err) {
        return res.status(500).json({ error: 'Internal server error' });
    }
};

export const removeMember = async (req, res) => {
    try {
        const { id } = req.params; // This is workspaceMember.id
        await prisma.workspaceMember.delete({
            where: { id, workspaceId: req.workspaceId }
        });
        return res.json({ success: true });
    } catch (err) {
        return res.status(500).json({ error: 'Internal server error' });
    }
};

export const connectSmtp = async (req, res) => {
    try {
        const { smtpHost, smtpPort, smtpUser, smtpPass } = req.body;
        if (!smtpHost || !smtpPort || !smtpUser || !smtpPass) {
            return res.status(400).json({ error: 'All SMTP fields are required' });
        }
        await prisma.workspace.update({
            where: { id: req.workspaceId },
            data: { smtpHost, smtpPort: parseInt(smtpPort), smtpUser, smtpPass },
        });
        return res.json({ success: true, message: 'SMTP settings saved' });
    } catch (err) {
        return res.status(500).json({ error: 'Internal server error' });
    }
};
