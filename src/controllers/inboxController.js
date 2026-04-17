import { PrismaClient } from '@prisma/client';

import { syncAllAccounts } from '../services/imapService.js';

const prisma = new PrismaClient();

export const getMessages = async (req, res) => {
    try {
        const messages = await prisma.inboxMessage.findMany({
            where: { workspaceId: req.workspaceId },
            include: { lead: true, emailAccount: { select: { email: true } } },
            orderBy: { receivedAt: 'desc' }
        });
        res.json(messages);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch messages' });
    }
};

export const getMessage = async (req, res) => {
    try {
        const { id } = req.params;
        const message = await prisma.inboxMessage.findUnique({
            where: { id, workspaceId: req.workspaceId },
            include: { lead: true, emailAccount: true }
        });
        if (!message) return res.status(404).json({ error: 'Message not found' });

        // Mark as read
        if (!message.isRead) {
            await prisma.inboxMessage.update({
                where: { id },
                data: { isRead: true }
            });
        }

        res.json(message);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch message' });
    }
};

export const deleteMessage = async (req, res) => {
    try {
        const { id } = req.params;
        await prisma.inboxMessage.delete({
            where: { id, workspaceId: req.workspaceId }
        });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Failed to delete message' });
    }
};

export const syncInbox = async (req, res) => {
    try {
        // Trigger background sync
        syncAllAccounts().catch(err => console.error('[IMAPSyncError]', err));
        res.json({ success: true, message: 'Inbox synchronization started' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to start sync' });
    }
};
