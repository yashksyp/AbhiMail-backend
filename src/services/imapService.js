import { ImapFlow } from 'imapflow';
import { PrismaClient } from '@prisma/client';
import { simpleParser } from 'mailparser';

const prisma = new PrismaClient();

export const syncAllAccounts = async () => {
    // console.log('[IMAP] Starting sync for all accounts...');

    try {
        const accounts = await prisma.emailAccount.findMany({
            where: {
                imapHost: { not: null },
                status: 'ACTIVATE'
            }
        });

        for (const account of accounts) {
            await syncAccount(account);
        }
    } catch (error) {
        console.error('[IMAP] Fatal sync error:', error);
    }
};

const syncAccount = async (account) => {
    const client = new ImapFlow({
        host: account.imapHost,
        port: account.imapPort || 993,
        secure: true,
        auth: {
            user: account.imapUser || account.email,
            pass: account.imapPass
        },
        logger: false
    });

    try {
        await client.connect();

        // Select INBOX
        let lock = await client.getMailboxLock('INBOX');
        try {
            // High-water mark search: search by UID > lastUid
            const searchCriteria = account.lastUid > 0
                ? { uid: `${account.lastUid + 1}:*` }
                : { since: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000) }; // Fallback to last 3 days for new accounts

            const messages = await client.search(searchCriteria);

            let highestUid = account.lastUid;

            for (const seq of messages) {
                let message = await client.fetchOne(seq, {
                    uid: true,
                    source: true,
                    envelope: true
                });

                if (message.uid > highestUid) {
                    highestUid = message.uid;
                }

                const fromEmail = message.envelope.from[0]?.address;
                const subject = message.envelope.subject;
                const receivedAt = message.envelope.date;

                if (!fromEmail) continue;

                // Parse the raw MIME source into readable text/HTML
                const parsedEmail = await simpleParser(message.source);
                const bodyText = parsedEmail.text || parsedEmail.textAsHtml || parsedEmail.html || '';

                // --- Bounce Detection Logic ---
                const isBounce = fromEmail.toLowerCase().includes('mailer-daemon') ||
                    fromEmail.toLowerCase().includes('postmaster') ||
                    (subject && (subject.toLowerCase().includes('delivery failure') ||
                        subject.toLowerCase().includes('undeliverable') ||
                        subject.toLowerCase().includes('returned to sender')));

                if (isBounce) {
                    // Try to extract original email addressing using regex common in bounce reports
                    const emailMatch = bodyText.match(/[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,6}/);
                    if (emailMatch) {
                        const bouncedEmail = emailMatch[0].toLowerCase();
                        console.log(`[Anti-Spam] Detected bounce for ${bouncedEmail}. Updating suppressions.`);

                        await prisma.$transaction([
                            prisma.suppressionList.upsert({
                                where: { workspaceId_email: { workspaceId: account.workspaceId, email: bouncedEmail } },
                                update: {},
                                create: { workspaceId: account.workspaceId, email: bouncedEmail, reason: 'hard_bounce' }
                            }),
                            prisma.emailAccount.update({
                                where: { id: account.id },
                                data: { bounces: { increment: 1 }, health: { decrement: 2 } } // Drop health scale 
                            }),
                            prisma.emailBounce.create({
                                data: {
                                    workspaceId: account.workspaceId,
                                    emailAccountId: account.id,
                                    email: bouncedEmail,
                                    reason: subject || 'Delivery Failure',
                                    type: 'hard'
                                }
                            }),
                            // Mark campaign lead as bounced
                            prisma.campaignLead.updateMany({
                                where: { lead: { email: bouncedEmail, workspaceId: account.workspaceId }, status: { not: 'completed' } },
                                data: { status: 'bounced' }
                            })
                        ]);
                    }
                    continue; // Skip normal lead processing
                }

                // --- Normal Lead Processing ---
                // 1. Find lead in this workspace
                const lead = await prisma.lead.findFirst({
                    where: {
                        email: { equals: fromEmail },
                        workspaceId: account.workspaceId
                    }
                });

                if (lead) {
                    // 2. Find associated campaign lead
                    const campaignLead = await prisma.campaignLead.findFirst({
                        where: {
                            leadId: lead.id,
                            status: { notIn: ['replied', 'unsubscribed', 'completed'] }
                        },
                        orderBy: { sentAt: 'desc' }
                    });

                    // 3. Store in InboxMessage using parsed text body
                    await prisma.inboxMessage.create({
                        data: {
                            workspaceId: account.workspaceId,
                            emailAccountId: account.id,
                            leadId: lead.id,
                            subject: subject || 'No Subject',
                            body: bodyText,
                            snippet: bodyText.slice(0, 100), // Clean string snippet
                            receivedAt: receivedAt || new Date()
                        }
                    });

                    if (campaignLead) {
                        // 4. Update Campaign & CampaignLead
                        await prisma.$transaction([
                            prisma.campaignLead.update({
                                where: { id: campaignLead.id },
                                data: { status: 'replied', repliedAt: new Date() }
                            }),
                            prisma.campaign.update({
                                where: { id: campaignLead.campaignId },
                                data: { replies: { increment: 1 } }
                            })
                        ]);
                        console.log(`[IMAP] Detected reply from ${fromEmail} for campaign ${campaignLead.campaignId}`);
                    }
                }
            }

            // Update highest UID in database to prevent re-processing
            if (highestUid > account.lastUid) {
                await prisma.emailAccount.update({
                    where: { id: account.id },
                    data: { lastUid: highestUid }
                });
            }

        } finally {
            lock.release();
        }

        await client.logout();
    } catch (error) {
        console.error(`[IMAP] Error syncing account ${account.email}:`, error.message);
    }
};
