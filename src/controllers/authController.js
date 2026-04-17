import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const prisma = new PrismaClient();
const JWT_SECRET = process.env.JWT_SECRET || 'abhimail-dev-secret-change-in-prod';
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'abhimail-refresh-secret-change-in-prod';

const makeTokens = (userId, workspaceId) => {
    const accessToken = jwt.sign({ userId, workspaceId }, JWT_SECRET, { expiresIn: '15m' });
    const refreshToken = jwt.sign({ userId }, JWT_REFRESH_SECRET, { expiresIn: '7d' });
    return { accessToken, refreshToken };
};

export const register = async (req, res) => {
    try {
        const { name, email, password, workspaceName } = req.body;
        if (!name || !email || !password) {
            return res.status(400).json({ error: 'name, email and password are required' });
        }

        const existing = await prisma.user.findUnique({ where: { email } });
        if (existing) return res.status(409).json({ error: 'Email already in use' });

        const hashed = await bcrypt.hash(password, 10);
        const user = await prisma.user.create({ data: { name, email, password: hashed } });

        const workspace = await prisma.workspace.create({
            data: {
                name: workspaceName || `${name}'s Workspace`,
                ownerId: user.id,
                members: { create: { userId: user.id, role: 'owner' } },
            },
        });

        const tokens = makeTokens(user.id, workspace.id);
        return res.status(201).json({
            user: { id: user.id, name: user.name, email: user.email },
            workspace: { id: workspace.id, name: workspace.name },
            ...tokens,
        });
    } catch (err) {
        console.error('[register]', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
};

export const login = async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) return res.status(400).json({ error: 'email and password are required' });

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user) return res.status(401).json({ error: 'Invalid credentials' });

        const valid = await bcrypt.compare(password, user.password);
        if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

        // Get user's first workspace
        const membership = await prisma.workspaceMember.findFirst({
            where: { userId: user.id },
            include: { workspace: true },
        });

        const workspaceId = membership?.workspace?.id || null;
        const tokens = makeTokens(user.id, workspaceId);
        return res.json({
            user: { id: user.id, name: user.name, email: user.email },
            workspace: membership?.workspace || null,
            ...tokens,
        });
    } catch (err) {
        console.error('[login]', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
};

export const refresh = async (req, res) => {
    try {
        const { refreshToken } = req.body;
        if (!refreshToken) return res.status(400).json({ error: 'refreshToken required' });

        const payload = jwt.verify(refreshToken, JWT_REFRESH_SECRET);
        const membership = await prisma.workspaceMember.findFirst({
            where: { userId: payload.userId },
        });
        const tokens = makeTokens(payload.userId, membership?.workspaceId || null);
        return res.json(tokens);
    } catch {
        return res.status(401).json({ error: 'Invalid refresh token' });
    }
};

export const me = async (req, res) => {
    try {
        const user = await prisma.user.findUnique({
            where: { id: req.userId },
            select: { id: true, name: true, email: true, role: true, createdAt: true },
        });
        if (!user) return res.status(404).json({ error: 'User not found' });
        return res.json(user);
    } catch (err) {
        return res.status(500).json({ error: 'Internal server error' });
    }
};
