import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export const getCampaigns = async (req, res) => {
    try {
        const campaigns = await prisma.campaign.findMany({
            where: { workspaceId: req.workspaceId },
            include: { steps: true, _count: { select: { leads: true } } },
            orderBy: { createdAt: 'desc' },
        });
        return res.json(campaigns);
    } catch (err) {
        console.error('[getCampaigns]', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
};

export const getCampaign = async (req, res) => {
    try {
        const campaign = await prisma.campaign.findFirst({
            where: { id: req.params.id, workspaceId: req.workspaceId },
            include: { steps: { orderBy: { stepNumber: 'asc' } }, leads: { include: { lead: true } } },
        });
        if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
        return res.json(campaign);
    } catch (err) {
        return res.status(500).json({ error: 'Internal server error' });
    }
};

export const createCampaign = async (req, res) => {
    try {
        const { name, strategy, aiOptimized, steps = [] } = req.body;
        if (!name) return res.status(400).json({ error: 'Campaign name is required' });

        const campaign = await prisma.campaign.create({
            data: {
                name,
                workspaceId: req.workspaceId,
                steps: {
                    create: steps.map((s, i) => ({
                        stepNumber: i + 1,
                        subject: s.subject || '',
                        content: s.body || s.content || '',
                        delayHours: s.delayDays ? s.delayDays * 24 : (s.delayHours || 24),
                    })),
                },
            },
            include: { steps: true },
        });
        return res.status(201).json(campaign);
    } catch (err) {
        console.error('[createCampaign]', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
};

export const updateCampaign = async (req, res) => {
    try {
        const { name, status, strategy, steps } = req.body;

        const existing = await prisma.campaign.findFirst({
            where: { id: req.params.id, workspaceId: req.workspaceId },
        });
        if (!existing) return res.status(404).json({ error: 'Campaign not found' });

        const updateData = {};
        if (name) updateData.name = name;
        if (status) updateData.status = status;

        if (steps) {
            await prisma.campaignStep.deleteMany({ where: { campaignId: req.params.id } });
            updateData.steps = {
                create: steps.map((s, i) => ({
                    stepNumber: i + 1,
                    subject: s.subject || '',
                    content: s.body || s.content || '',
                    delayHours: s.delayDays ? s.delayDays * 24 : (s.delayHours || 24),
                })),
            };
        }

        const campaign = await prisma.campaign.update({
            where: { id: req.params.id },
            data: updateData,
            include: { steps: true },
        });
        return res.json(campaign);
    } catch (err) {
        console.error('[updateCampaign]', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
};

export const deleteCampaign = async (req, res) => {
    try {
        const existing = await prisma.campaign.findFirst({
            where: { id: req.params.id, workspaceId: req.workspaceId },
        });
        if (!existing) return res.status(404).json({ error: 'Campaign not found' });

        await prisma.campaign.delete({ where: { id: req.params.id } });
        return res.json({ success: true });
    } catch (err) {
        return res.status(500).json({ error: 'Internal server error' });
    }
};

// --- Campaign Step CRUD ---

export const addStep = async (req, res) => {
    try {
        const campaign = await prisma.campaign.findFirst({
            where: { id: req.params.id, workspaceId: req.workspaceId },
            include: { steps: true },
        });
        if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

        const nextStepNumber = (campaign.steps.length || 0) + 1;
        const step = await prisma.campaignStep.create({
            data: {
                campaignId: req.params.id,
                stepNumber: nextStepNumber,
                subject: req.body.subject || 'New Follow-up',
                content: req.body.body || req.body.content || '',
                delayHours: req.body.delayDays ? req.body.delayDays * 24 : (req.body.delayHours || 48),
            },
        });
        // Return with frontend-friendly shape
        return res.status(201).json({
            ...step,
            body: step.content,
            delayDays: Math.round(step.delayHours / 24),
        });
    } catch (err) {
        console.error('[addStep]', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
};

export const updateStep = async (req, res) => {
    try {
        const campaign = await prisma.campaign.findFirst({
            where: { id: req.params.id, workspaceId: req.workspaceId },
        });
        if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

        const updateData = {};
        if (req.body.subject !== undefined) updateData.subject = req.body.subject;
        if (req.body.body !== undefined) updateData.content = req.body.body;
        if (req.body.content !== undefined) updateData.content = req.body.content;
        if (req.body.delayDays !== undefined) updateData.delayHours = req.body.delayDays * 24;
        if (req.body.delayHours !== undefined) updateData.delayHours = req.body.delayHours;

        const step = await prisma.campaignStep.update({
            where: { id: req.params.stepId },
            data: updateData,
        });
        return res.json({ ...step, body: step.content, delayDays: Math.round(step.delayHours / 24) });
    } catch (err) {
        console.error('[updateStep]', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
};

export const deleteStep = async (req, res) => {
    try {
        const campaign = await prisma.campaign.findFirst({
            where: { id: req.params.id, workspaceId: req.workspaceId },
        });
        if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

        await prisma.campaignStep.delete({ where: { id: req.params.stepId } });
        return res.json({ success: true });
    } catch (err) {
        console.error('[deleteStep]', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
};

// --- Campaign Actions ---

export const startCampaign = async (req, res) => {
    try {
        const campaign = await prisma.campaign.findFirst({
            where: { id: req.params.id, workspaceId: req.workspaceId },
        });
        if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

        const updated = await prisma.campaign.update({
            where: { id: req.params.id },
            data: { status: 'ACTIVE' },
            include: { steps: true },
        });
        return res.json(updated);
    } catch (err) {
        return res.status(500).json({ error: 'Internal server error' });
    }
};

export const pauseCampaign = async (req, res) => {
    try {
        const campaign = await prisma.campaign.findFirst({
            where: { id: req.params.id, workspaceId: req.workspaceId },
        });
        if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

        const updated = await prisma.campaign.update({
            where: { id: req.params.id },
            data: { status: 'PAUSED' },
            include: { steps: true },
        });
        return res.json(updated);
    } catch (err) {
        return res.status(500).json({ error: 'Internal server error' });
    }
};

export const enrollLeads = async (req, res) => {
    try {
        const { leadIds } = req.body;
        if (!leadIds || !Array.isArray(leadIds)) {
            return res.status(400).json({ error: 'leadIds array is required' });
        }

        const campaign = await prisma.campaign.findFirst({
            where: { id: req.params.id, workspaceId: req.workspaceId },
        });
        if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

        const results = await Promise.allSettled(
            leadIds.map(leadId =>
                prisma.campaignLead.upsert({
                    where: { campaignId_leadId: { campaignId: req.params.id, leadId } },
                    create: { campaignId: req.params.id, leadId, status: 'pending' },
                    update: {},
                })
            )
        );

        const enrolled = results.filter(r => r.status === 'fulfilled').length;
        return res.json({ enrolled, total: leadIds.length });
    } catch (err) {
        console.error('[enrollLeads]', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
};

export const enrollList = async (req, res) => {
    try {
        const { listId } = req.body;
        if (!listId) return res.status(400).json({ error: 'listId is required' });

        const campaign = await prisma.campaign.findFirst({
            where: { id: req.params.id, workspaceId: req.workspaceId },
        });
        if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

        // Get all leads from the list
        const leads = await prisma.lead.findMany({
            where: { listId, workspaceId: req.workspaceId },
            select: { id: true },
        });

        if (leads.length === 0) return res.json({ enrolled: 0, total: 0, message: 'No leads in this list' });

        const results = await Promise.allSettled(
            leads.map(lead =>
                prisma.campaignLead.upsert({
                    where: { campaignId_leadId: { campaignId: req.params.id, leadId: lead.id } },
                    create: { campaignId: req.params.id, leadId: lead.id, status: 'pending' },
                    update: {},
                })
            )
        );

        const enrolled = results.filter(r => r.status === 'fulfilled').length;
        return res.json({ enrolled, total: leads.length });
    } catch (err) {
        console.error('[enrollList]', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
};
