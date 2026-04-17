import { PrismaClient } from '@prisma/client';
import nodemailer from 'nodemailer';

const prisma = new PrismaClient();

export const getAccounts = async (req, res) => {
    try {
        const accounts = await prisma.emailAccount.findMany({
            where: { workspaceId: req.workspaceId }
        });
        res.json(accounts);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch accounts' });
    }
};

export const createAccount = async (req, res) => {
    try {
        const { email, firstName, lastName, smtpHost, smtpPort, smtpUser, smtpPass, imapHost, imapPort, imapUser, imapPass } = req.body;

        // Verify SMTP connection before saving
        const transporter = nodemailer.createTransport({
            host: smtpHost,
            port: parseInt(smtpPort),
            secure: parseInt(smtpPort) === 465,
            auth: { user: smtpUser, pass: smtpPass }
        });

        try {
            await transporter.verify();
        } catch (verifyError) {
            return res.status(400).json({ error: 'SMTP connection failed: ' + verifyError.message });
        }

        const account = await prisma.emailAccount.create({
            data: {
                workspaceId: req.workspaceId,
                email,
                firstName,
                lastName,
                smtpHost,
                smtpPort: parseInt(smtpPort),
                smtpUser,
                smtpPass,
                imapHost,
                imapPort: imapPort ? parseInt(imapPort) : null,
                imapUser,
                imapPass,
                status: 'ACTIVATE'
            }
        });
        res.json(account);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to create account' });
    }
};

export const updateAccount = async (req, res) => {
    try {
        const { id } = req.params;
        const updates = req.body;

        if (updates.smtpPort) updates.smtpPort = parseInt(updates.smtpPort);
        if (updates.imapPort) updates.imapPort = parseInt(updates.imapPort);

        const account = await prisma.emailAccount.update({
            where: { id, workspaceId: req.workspaceId },
            data: updates
        });
        res.json(account);
    } catch (error) {
        res.status(500).json({ error: 'Failed to update account' });
    }
};

export const deleteAccount = async (req, res) => {
    try {
        const { id } = req.params;
        await prisma.emailAccount.delete({
            where: { id, workspaceId: req.workspaceId }
        });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Failed to delete account' });
    }
};

export const testConnection = async (req, res) => {
    try {
        const { smtpHost, smtpPort, smtpUser, smtpPass } = req.body;
        const transporter = nodemailer.createTransport({
            host: smtpHost,
            port: parseInt(smtpPort),
            secure: parseInt(smtpPort) === 465,
            auth: { user: smtpUser, pass: smtpPass }
        });
        await transporter.verify();
        res.json({ success: true, message: 'Connection successful' });
    } catch (error) {
        res.status(400).json({ error: 'Connection failed: ' + error.message });
    }
};
