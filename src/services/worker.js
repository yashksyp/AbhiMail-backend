import { PrismaClient } from '@prisma/client';
import nodemailer from 'nodemailer';
import * as cheerio from 'cheerio';

const prisma = new PrismaClient();
const APP_URL = process.env.APP_URL || 'http://localhost:4000';

/**
 * Spintax parser: replaces {Hello|Hi|Hey} with a random variation
 */
function parseSpintax(text) {
    const spintaxRegex = /{([^{}]+)}/g;
    return text.replace(spintaxRegex, (match, contents) => {
        const choices = contents.split('|');
        return choices[Math.floor(Math.random() * choices.length)];
    });
}

/**
 * Main worker function to process campaign emails
 */
export const processEmails = async () => {
    try {
        const activeCampaigns = await prisma.campaign.findMany({
            where: { status: 'ACTIVE' },
            include: {
                steps: { orderBy: { stepNumber: 'asc' } },
                workspace: {
                    include: {
                        emailAccounts: { where: { status: 'ACTIVATE', health: { gt: 50 } } },
                        suppressionList: true,
                        domains: { where: { dkimVerified: true } } // Fetch authenticated domains
                    }
                }
            }
        });

        for (const campaign of activeCampaigns) {
            const leadsToProcess = await prisma.campaignLead.findMany({
                where: {
                    campaignId: campaign.id,
                    status: { in: ['pending', 'sent', 'opened', 'clicked'] },
                    OR: [{ nextSendAt: null }, { nextSendAt: { lte: new Date() } }],
                    retryCount: { lt: 5 }
                },
                include: { lead: true },
                take: 20
            });

            if (leadsToProcess.length === 0) continue;

            const accounts = campaign.workspace.emailAccounts;
            const verifiedDomains = campaign.workspace.domains;

            if (accounts.length === 0) {
                console.warn(`[Worker] No healthy/active accounts for campaign ${campaign.name}`);
                continue;
            }

            // Authentication Enforcement: Block sending if there are no verified domains on the workspace
            if (verifiedDomains.length === 0) {
                console.warn(`[Worker - ANTI-SPAM] Campaign ${campaign.name} blocked: No verified domains (DKIM/SPF) found for workspace.`);
                continue;
            }

            const suppressedEmails = new Set(campaign.workspace.suppressionList.map(s => s.email.toLowerCase()));

            for (const campaignLead of leadsToProcess) {
                // Skip if suppressed
                if (suppressedEmails.has(campaignLead.lead.email.toLowerCase())) {
                    await prisma.campaignLead.update({
                        where: { id: campaignLead.id },
                        data: { status: 'unsubscribed' }
                    });
                    continue;
                }

                const stepNumberToSend = campaignLead.lastStep + 1;
                const stepToSend = campaign.steps.find(s => s.stepNumber === stepNumberToSend);

                if (!stepToSend) {
                    if (campaignLead.status !== 'completed') {
                        await prisma.campaignLead.update({ where: { id: campaignLead.id }, data: { status: 'completed' } });
                    }
                    continue;
                }

                if (stepNumberToSend > 1 && campaignLead.sentAt) {
                    const waitTimeMs = stepToSend.delayHours * 60 * 60 * 1000;
                    if (new Date().getTime() - new Date(campaignLead.sentAt).getTime() < waitTimeMs) continue;
                }

                // Domain & Account Rotation (Round Robin / Random)
                const account = accounts[Math.floor(Math.random() * accounts.length)];

                // Enforce Warmup Limit vs Daily Limit
                const activeLimit = account.warmupEnabled ? account.warmupLimit : account.dailyLimit;
                if (account.sentToday >= activeLimit) {
                    continue;
                }

                // Match Account to a Verified Domain
                const domainPart = account.email.split('@')[1];
                const dkimDomain = verifiedDomains.find(d => d.domainName === domainPart.toLowerCase());

                // Strict enforcement: Drop individual account if its specific domain isn't authenticated
                if (!dkimDomain) {
                    console.warn(`[Anti-Spam] Filtering out account ${account.email} - its specific domain is not DKIM authenticated.`);
                    continue;
                }

                // --- CRAFTING THE EMAIL ---

                // 1. Spintax & Personalization
                let baseHtml = parseSpintax(stepToSend.content);
                let bodyHtml = baseHtml
                    .replace(/{{firstName}}/g, campaignLead.lead.firstName || '')
                    .replace(/{{lastName}}/g, campaignLead.lead.lastName || '')
                    .replace(/{{company}}/g, campaignLead.lead.company || '')
                    .replace(/{{email}}/g, campaignLead.lead.email);

                const subject = parseSpintax(stepToSend.subject)
                    .replace(/{{firstName}}/g, campaignLead.lead.firstName || '')
                    .replace(/{{lastName}}/g, campaignLead.lead.lastName || '');

                const $ = cheerio.load(bodyHtml, { xmlMode: false });
                $('a').each((i, el) => {
                    const url = $(el).attr('href');
                    if (url && url.startsWith('http')) {
                        const trackedUrl = `${APP_URL}/api/track/click/${campaignLead.id}?url=${encodeURIComponent(url)}`;
                        $(el).attr('href', trackedUrl);
                    }
                });
                bodyHtml = $.html();

                const cacheBuster = Date.now();
                const trackingPixel = `<img src="${APP_URL}/api/track/open/${campaignLead.id}?t=${cacheBuster}" width="1" height="1" style="display:none" />`;
                const unsubscribeUrl = `${APP_URL}/api/track/unsubscribe/${campaignLead.id}`;
                const unsubscribeHtml = `<br/><br/><div style="font-size:12px;color:#999;">Don't want to hear from us again? <a href="${unsubscribeUrl}">Unsubscribe</a></div>`;

                const finalHtmlBody = `<html><body>${bodyHtml}${trackingPixel}${unsubscribeHtml}</body></html>`;

                // --- SENDING ---

                const dkimOptions = {
                    dkim: {
                        domainName: dkimDomain.domainName,
                        keySelector: dkimDomain.dkimSelector,
                        privateKey: dkimDomain.dkimPrivateKey
                    }
                };

                const transporter = nodemailer.createTransport({
                    host: account.smtpHost,
                    port: account.smtpPort,
                    secure: account.smtpPort === 465,
                    auth: { user: account.smtpUser, pass: account.smtpPass }
                }, dkimOptions);

                try {
                    await transporter.sendMail({
                        from: `"${account.firstName || ''} ${account.lastName || ''}" <${account.email}>`,
                        to: campaignLead.lead.email,
                        subject: subject,
                        html: finalHtmlBody,
                        headers: {
                            'List-Unsubscribe': `<${unsubscribeUrl}>`
                        }
                    });

                    // Success - Update DB
                    await prisma.$transaction([
                        prisma.campaignLead.update({
                            where: { id: campaignLead.id },
                            data: {
                                status: 'sent',
                                sentAt: new Date(),
                                lastStep: stepNumberToSend,
                                retryCount: 0,
                                lastError: null
                            }
                        }),
                        prisma.emailAccount.update({
                            where: { id: account.id },
                            data: { sentToday: { increment: 1 } }
                        }),
                        prisma.campaign.update({
                            where: { id: campaign.id },
                            data: { sent: { increment: 1 } }
                        }),
                        prisma.emailLog.create({
                            data: {
                                workspaceId: campaign.workspaceId,
                                campaignId: campaign.id,
                                leadId: campaignLead.leadId,
                                subject: subject,
                                status: 'sent'
                            }
                        })
                    ]);

                    console.log(`[Worker] Sent Step ${stepNumberToSend} to ${campaignLead.lead.email} via ${account.email}`);

                    // Provider Specific Throttling Logic
                    let sleepTime = 1000 + Math.random() * 2000; // Base: 1-3 seconds randomized
                    if (campaignLead.lead.email.endsWith('@gmail.com') || campaignLead.lead.email.endsWith('@yahoo.com')) {
                        sleepTime += 3000; // Extra penalty for strict B2C providers
                    }
                    await new Promise(r => setTimeout(r, sleepTime));

                } catch (sendError) {
                    console.error(`[Worker] Send error to ${campaignLead.lead.email}:`, sendError.message);

                    // Exponential backoff: 15 mins * 2^retryCount
                    const backoffMins = 15 * Math.pow(2, campaignLead.retryCount);

                    await prisma.campaignLead.update({
                        where: { id: campaignLead.id },
                        data: {
                            retryCount: { increment: 1 },
                            lastError: sendError.message,
                            nextSendAt: new Date(Date.now() + backoffMins * 60 * 1000)
                        }
                    });

                    await prisma.emailLog.create({
                        data: {
                            workspaceId: campaign.workspaceId,
                            campaignId: campaign.id,
                            leadId: campaignLead.leadId,
                            subject: subject,
                            status: 'failed',
                            errorMessage: sendError.message
                        }
                    });
                }
            }
        }
    } catch (error) {
        console.error('[Worker] Fatal error:', error);
    }
};
