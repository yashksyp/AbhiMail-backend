import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export const getOverview = async (req, res) => {
    try {
        const workspaceId = req.workspaceId;

        const [totalLeads, totalCampaigns, activeCampaigns, campaignLeads] = await Promise.all([
            prisma.lead.count({ where: { workspaceId } }),
            prisma.campaign.count({ where: { workspaceId } }),
            prisma.campaign.count({ where: { workspaceId, status: 'ACTIVE' } }),
            prisma.campaignLead.findMany({
                where: { campaign: { workspaceId } },
            }),
        ]);

        const totalSent = campaignLeads.filter(l => l.sentAt).length;
        const totalOpened = campaignLeads.filter(l => l.openedAt).length;
        const totalReplied = campaignLeads.filter(l => l.repliedAt).length;

        const openRate = totalSent > 0 ? `${((totalOpened / totalSent) * 100).toFixed(1)}%` : '0%';
        const replyRate = totalSent > 0 ? `${((totalReplied / totalSent) * 100).toFixed(1)}%` : '0%';

        return res.json({
            totalLeads,
            totalCampaigns,
            activeCampaigns,
            totalSent,
            totalOpened,
            totalReplied,
            openRate,
            replyRate,
        });
    } catch (err) {
        console.error('[getOverview]', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
};

export const getTimeline = async (req, res) => {
    try {
        // Return 7-day timeline data
        const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
        const now = new Date();
        const timeline = [];

        for (let i = 6; i >= 0; i--) {
            const date = new Date(now);
            date.setDate(date.getDate() - i);
            const dayStart = new Date(date.setHours(0, 0, 0, 0));
            const dayEnd = new Date(date.setHours(23, 59, 59, 999));

            const [sent, opened, replied] = await Promise.all([
                prisma.campaignLead.count({
                    where: {
                        campaign: { workspaceId: req.workspaceId },
                        sentAt: { gte: dayStart, lte: dayEnd },
                    },
                }),
                prisma.campaignLead.count({
                    where: {
                        campaign: { workspaceId: req.workspaceId },
                        openedAt: { gte: dayStart, lte: dayEnd },
                    },
                }),
                prisma.campaignLead.count({
                    where: {
                        campaign: { workspaceId: req.workspaceId },
                        repliedAt: { gte: dayStart, lte: dayEnd },
                    },
                }),
            ]);

            timeline.push({
                day: days[new Date(dayStart).getDay() === 0 ? 6 : new Date(dayStart).getDay() - 1],
                date: dayStart.toISOString().split('T')[0],
                sent,
                opens: opened,
                replies: replied,
            });
        }

        return res.json(timeline);
    } catch (err) {
        console.error('[getTimeline]', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
};

export const getCampaignAnalytics = async (req, res) => {
    try {
        const campaigns = await prisma.campaign.findMany({
            where: { workspaceId: req.workspaceId },
            include: {
                _count: { select: { leads: true } },
                leads: { select: { status: true, sentAt: true, openedAt: true, repliedAt: true } },
            },
            orderBy: { createdAt: 'desc' },
        });

        const result = campaigns.map(c => ({
            id: c.id,
            name: c.name,
            status: c.status,
            strategy: 'HIGH_VOLUME',
            leadCount: c._count.leads,
            emailCount: c.leads.filter(l => l.sentAt).length,
            openCount: c.leads.filter(l => l.openedAt).length,
            replyCount: c.leads.filter(l => l.repliedAt).length,
        }));

        return res.json(result);
    } catch (err) {
        console.error('[getCampaignAnalytics]', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
};

export const getCampaignStats = async (req, res) => {
    try {
        const campaign = await prisma.campaign.findFirst({
            where: { id: req.params.id, workspaceId: req.workspaceId },
            include: {
                _count: { select: { leads: true } },
                leads: { select: { status: true } },
            },
        });
        if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

        const stats = {
            total: campaign._count.leads,
            pending: campaign.leads.filter(l => l.status === 'pending').length,
            sent: campaign.leads.filter(l => l.status === 'sent').length,
            opened: campaign.leads.filter(l => l.status === 'opened').length,
            replied: campaign.leads.filter(l => l.status === 'replied').length,
        };

        return res.json({ ...campaign, stats });
    } catch (err) {
        return res.status(500).json({ error: 'Internal server error' });
    }
};

export const getActivityFeed = async (req, res) => {
    try {
        // Pull the latest campaign lead activity
        const recentActivity = await prisma.campaignLead.findMany({
            where: { campaign: { workspaceId: req.workspaceId } },
            include: {
                lead: { select: { id: true, email: true, firstName: true, lastName: true } },
                campaign: { select: { id: true, name: true } },
            },
            orderBy: { sentAt: 'desc' },
            take: 50,
        });

        const feed = recentActivity
            .filter(a => a.sentAt || a.openedAt || a.repliedAt)
            .map(a => {
                let status = 'PENDING';
                let time = a.sentAt;
                if (a.repliedAt) { status = 'REPLIED'; time = a.repliedAt; }
                else if (a.openedAt) { status = 'OPENED'; time = a.openedAt; }
                else if (a.sentAt) { status = 'SENT'; time = a.sentAt; }

                return {
                    id: a.id,
                    _id: a.id,
                    status,
                    createdAt: time,
                    leadId: a.lead,
                    campaignId: a.campaign,
                };
            });

        return res.json(feed);
    } catch (err) {
        console.error('[getActivityFeed]', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
};
