import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// 1x1 Transparent GIF pixel
const PIXEL = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

export const trackOpen = async (req, res) => {
    try {
        const { id } = req.params;
        const ipAddress = req.ip || req.headers['x-forwarded-for'];
        const userAgent = req.headers['user-agent'];

        const campaignLead = await prisma.campaignLead.findUnique({
            where: { id },
            include: { campaign: true }
        });

        if (campaignLead) {
            // Log the open
            await prisma.emailOpen.create({
                data: {
                    campaignLeadId: id,
                    ipAddress,
                    userAgent
                }
            });

            // Update stats if it's the first open
            if (campaignLead.status === 'sent') {
                await prisma.$transaction([
                    prisma.campaignLead.update({
                        where: { id },
                        data: { status: 'opened', openedAt: new Date() }
                    }),
                    prisma.campaign.update({
                        where: { id: campaignLead.campaignId },
                        data: { opens: { increment: 1 } }
                    })
                ]);
            }
        }

        res.set({
            'Content-Type': 'image/gif',
            'Content-Length': PIXEL.length,
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Pragma': 'no-cache',
            'Expires': '0'
        });
        res.send(PIXEL);
    } catch (error) {
        console.error('[TrackOpen] Error:', error);
        res.status(500).send('Error');
    }
};

export const trackClick = async (req, res) => {
    try {
        const { id } = req.params;
        const { url } = req.query;
        if (!url) return res.status(400).send('Missing URL');

        const ipAddress = req.ip || req.headers['x-forwarded-for'];
        const userAgent = req.headers['user-agent'];

        const campaignLead = await prisma.campaignLead.findUnique({
            where: { id }
        });

        if (campaignLead) {
            await prisma.emailClick.create({
                data: {
                    campaignLeadId: id,
                    url: decodeURIComponent(url),
                    ipAddress,
                    userAgent
                }
            });

            if (campaignLead.status !== 'clicked' && campaignLead.status !== 'replied' && campaignLead.status !== 'unsubscribed') {
                await prisma.$transaction([
                    prisma.campaignLead.update({
                        where: { id },
                        data: { status: 'clicked', clickedAt: new Date() }
                    }),
                    prisma.campaign.update({
                        where: { id: campaignLead.campaignId },
                        data: { clicks: { increment: 1 } }
                    })
                ]);
            }
        }

        res.redirect(decodeURIComponent(url));
    } catch (error) {
        console.error('[TrackClick] Error:', error);
        res.status(500).send('Error');
    }
};

export const trackUnsubscribe = async (req, res) => {
    try {
        const { id } = req.params;

        const campaignLead = await prisma.campaignLead.findUnique({
            where: { id },
            include: { lead: true, campaign: true }
        });

        if (campaignLead) {
            // Add to suppression list
            await prisma.suppressionList.upsert({
                where: {
                    workspaceId_email: {
                        workspaceId: campaignLead.campaign.workspaceId,
                        email: campaignLead.lead.email
                    }
                },
                update: {},
                create: {
                    workspaceId: campaignLead.campaign.workspaceId,
                    email: campaignLead.lead.email,
                    reason: 'Unsubscribed from campaign: ' + campaignLead.campaign.name
                }
            });

            // Update campaign lead status
            await prisma.$transaction([
                prisma.campaignLead.update({
                    where: { id },
                    data: { status: 'unsubscribed' }
                }),
                prisma.campaign.update({
                    where: { id: campaignLead.campaignId },
                    data: { unsubscribes: { increment: 1 } }
                })
            ]);
        }

        // Simple HTML response for now
        res.send(`
            <html>
                <body style="font-family: sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; background: #f9fafb;">
                    <div style="background: white; padding: 2rem; border-radius: 1rem; box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1); text-align: center;">
                        <h1 style="color: #111827; margin-bottom: 1rem;">Successfully Unsubscribed</h1>
                        <p style="color: #4b5563;">You have been removed from our mailing list and will not receive any further emails from this campaign.</p>
                    </div>
                </body>
            </html>
        `);
    } catch (error) {
        console.error('[Unsubscribe] Error:', error);
        res.status(500).send('Internal Server Error');
    }
};
