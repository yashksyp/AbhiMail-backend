import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { PrismaClient } from '@prisma/client';
import nodemailer from 'nodemailer';
import shuffle from 'array-shuffle';

const prisma = new PrismaClient();

// Connect to Redis for Queue handling
const redisConnection = new IORedis(process.env.REDIS_URL || 'redis://127.0.0.1:6379', {
    maxRetriesPerRequest: null,
});
redisConnection.on('error', (err) => console.warn('[Redis] Warmup Queue offline. Add REDIS_URL to enable.', err.message));

export const warmupQueue = new Queue('email-warmup', { connection: redisConnection });

/**
 * 1. THE SCHEDULER: Builds the daily ramp strategy based on account health and day count.
 * Calculates exact volumes per account. Runs once a day via cron.
 */
export const scheduleDailyWarmup = async () => {
    const activeAccounts = await prisma.warmupAccount.findMany({
        where: { isActive: true, healthScore: { gt: 50 } }, // Pause if health < 50
        include: { emailAccount: true }
    });

    for (const account of activeAccounts) {
        // Logc for Ramp: day * growthFactor, capping roughly around 100-150 depending on baseline
        let targetVolume = 0;
        if (account.warmupStage === 1) targetVolume = 10;
        else if (account.warmupStage <= 5) targetVolume = 10 + (account.warmupStage * 5); // Rampts to 30
        else if (account.warmupStage <= 10) targetVolume = 30 + ((account.warmupStage - 5) * 4); // Ramps to 50
        else targetVolume = Math.min(100, 50 + ((account.warmupStage - 10) * 5)); // Rampts to 100 max for general safety

        // Provider strict limits
        if (account.email.includes('@gmail.com') && targetVolume > 80) targetVolume = 80;
        if (account.email.includes('@outlook.com') && targetVolume > 100) targetVolume = 100;

        await prisma.warmupSchedule.create({
            data: {
                accountId: account.id,
                plannedSends: targetVolume,
                actualSends: 0,
                date: new Date()
            }
        });

        // Stage advances daily
        await prisma.warmupAccount.update({
            where: { id: account.id },
            data: {
                warmupStage: { increment: 1 },
                dailyLimit: targetVolume,
                currentVolume: 0 // Reset daily volume counter
            }
        });
    }

    // Now, schedule the specific jobs spread throughout the day
    await distributeWarmupJobs();
};

/**
 * 2. DISTRIBUTION LOGIC: Spreads the planned emails unpredictably across 9 AM - 6 PM
 */
async function distributeWarmupJobs() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const schedules = await prisma.warmupSchedule.findMany({
        where: { date: { gte: today } },
        include: { account: { include: { emailAccount: true } } }
    });

    const activeWarmupAccounts = schedules.map(s => s.account);

    for (const schedule of schedules) {
        let sendsToSchedule = schedule.plannedSends;

        for (let i = 0; i < sendsToSchedule; i++) {
            // Find a random recipient other than self
            const possibleRecipients = activeWarmupAccounts.filter(acc => acc.id !== schedule.accountId);
            if (possibleRecipients.length === 0) continue; // Need at least 2 accounts globally to warmup

            const receiver = shuffle(possibleRecipients)[0];

            // Random delay between 9 AM and 6 PM today (working hours simulation)
            // That's 9 hours * 60 mins * 60 secs * 1000 ms
            const randomOffsetMs = Math.floor(Math.random() * (9 * 60 * 60 * 1000));
            const baseNineAm = new Date();
            baseNineAm.setHours(9, 0, 0, 0);
            const executionTime = new Date(baseNineAm.getTime() + randomOffsetMs);

            // Add to BullMQ with delay
            const delayUntilExecution = executionTime.getTime() - Date.now();
            if (delayUntilExecution <= 0) continue;

            await warmupQueue.add('send-warmup', {
                senderId: schedule.account.id,
                receiverId: receiver.id,
                scheduleId: schedule.id
            }, {
                delay: delayUntilExecution,
                jobId: `warmup-${schedule.account.id}-${Date.now()}-${i}`
            });
        }
    }
}

/**
 * 3. THE WORKER: Pulls the job, sends the email, tracks interactions
 */
export const warmupWorker = new Worker('email-warmup', async (job) => {
    const { senderId, receiverId, scheduleId } = job.data;

    const sender = await prisma.warmupAccount.findUnique({ where: { id: senderId }, include: { emailAccount: true } });
    const receiver = await prisma.warmupAccount.findUnique({ where: { id: receiverId } });

    if (!sender || !receiver || !sender.isActive) return;

    // Fast fail if over limit or bounced too much
    if (sender.currentVolume >= sender.dailyLimit) return;
    if (sender.healthScore < 40) return;

    const htmlTemplate = generateNaturalEmail(sender, receiver);

    // Transport
    const transporter = nodemailer.createTransport({
        host: sender.emailAccount.smtpHost,
        port: sender.emailAccount.smtpPort,
        secure: sender.emailAccount.smtpPort === 465,
        auth: { user: sender.emailAccount.smtpUser, pass: sender.emailAccount.smtpPass }
    });

    try {
        await transporter.sendMail({
            from: `"${sender.emailAccount.firstName || ''} ${sender.emailAccount.lastName || ''}" <${sender.email}>`,
            to: receiver.email,
            subject: generateNaturalSubject(),
            html: htmlTemplate
        });

        // Update successful send
        await prisma.$transaction([
            prisma.warmupAccount.update({
                where: { id: sender.id },
                data: { currentVolume: { increment: 1 }, lastSentAt: new Date() }
            }),
            prisma.warmupSchedule.update({
                where: { id: scheduleId },
                data: { actualSends: { increment: 1 } }
            }),
            prisma.warmupInteraction.create({
                data: { senderId: sender.id, receiverId: receiver.id, type: 'send' }
            })
        ]);

        // Simulating the remote opening and replying based on percentages
        // We know the receiver is also part of our system! So we can simulate their interaction
        scheduleSimulatedInteractions(sender.id, receiver.id);

    } catch (e) {
        console.error(`[Warmup] Send failed for ${sender.email}`, e);

        // Penalize bounce / connection error
        await prisma.warmupAccount.update({
            where: { id: sender.id },
            data: { healthScore: { decrement: 3 } }
        });
    }
}, { connection: redisConnection, concurrency: 10 });


/**
 * 4. SIMULATION ENGINE
 * Receiver opens the email 100% of the time (after a delay)
 * Receiver replies 35% of the time
 */
async function scheduleSimulatedInteractions(originalSenderId, receiverId) {
    // 1. Simulate Open
    // Add an 'open-simulate' job to the queue running 5-30 minutes from now
    const openDelayMs = (5 + Math.random() * 25) * 60 * 1000;
    setTimeout(async () => {
        await prisma.warmupInteraction.create({ data: { senderId: originalSenderId, receiverId: receiverId, type: 'open' } });
        // Award health to sender
        await prisma.warmupAccount.update({ where: { id: originalSenderId }, data: { healthScore: { increment: 1 } } });
    }, openDelayMs);

    // 2. Simulate Reply (35% probability)
    if (Math.random() < 0.35) {
        const replyDelayMs = openDelayMs + (10 + Math.random() * 50) * 60 * 1000; // 10-60 mins after open

        // Normally, you would use BullMQ here. Used setTimeout for pseudo-code brevity
        setTimeout(async () => {
            await prisma.warmupInteraction.create({ data: { senderId: receiverId, receiverId: originalSenderId, type: 'reply' } });
            // Excellent! Sender gets a huge reputation boost
            await prisma.warmupAccount.update({ where: { id: originalSenderId }, data: { healthScore: { increment: 2 } } });
        }, replyDelayMs);
    }
}

function generateNaturalEmail() {
    const phrases = [
        "Hey, just touching base regarding the project metrics from last week.",
        "Could you forward me that PDF when you have a minute?",
        "Are we still on for the 2 PM sync tomorrow? Let me know.",
        "Thanks for getting back to me so quickly. I'll review and follow up.",
        "Just checking in to see if you got my previous email?",
        "Attached are the revisions. Thoughts?"
    ];
    return `<div>${shuffle(phrases)[0]}<br><br>Best regards,<br></div>`;
}

function generateNaturalSubject() {
    const subjects = ["Following up", "Quick question", "Meeting tomorrow?", "Revisions", "Update requested"];
    return shuffle(subjects)[0];
}
