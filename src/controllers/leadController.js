import { PrismaClient } from '@prisma/client';
import { parse } from 'csv-parse/sync';

const prisma = new PrismaClient();

export const getLeads = async (req, res) => {
    try {
        const { listId, status, search, page = 1, limit = 50 } = req.query;
        const where = { workspaceId: req.workspaceId };

        if (listId) where.listId = listId;
        if (status) where.status = status;
        if (search) {
            where.OR = [
                { email: { contains: search } },
                { firstName: { contains: search } },
                { lastName: { contains: search } },
                { company: { contains: search } },
            ];
        }

        const [leads, total] = await Promise.all([
            prisma.lead.findMany({
                where,
                skip: (parseInt(page) - 1) * parseInt(limit),
                take: parseInt(limit),
                orderBy: { createdAt: 'desc' },
                include: { list: { select: { name: true } } },
            }),
            prisma.lead.count({ where }),
        ]);

        return res.json({ leads, total, page: parseInt(page), limit: parseInt(limit) });
    } catch (err) {
        console.error('[getLeads]', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
};

export const createLead = async (req, res) => {
    try {
        const { email, firstName, lastName, name, company, phone, status, listId } = req.body;
        if (!email) return res.status(400).json({ error: 'email is required' });

        const lead = await prisma.lead.upsert({
            where: { email_workspaceId: { email, workspaceId: req.workspaceId } },
            create: {
                email,
                firstName,
                lastName,
                name: name || [firstName, lastName].filter(Boolean).join(' ') || undefined,
                company,
                phone,
                status: status || 'new',
                listId: listId || null,
                workspaceId: req.workspaceId,
            },
            update: {
                firstName,
                lastName,
                name: name || [firstName, lastName].filter(Boolean).join(' ') || undefined,
                company,
                phone,
                status: status || undefined,
                listId: listId || undefined,
            },
        });
        return res.status(201).json(lead);
    } catch (err) {
        console.error('[createLead]', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
};

export const updateLead = async (req, res) => {
    try {
        const existing = await prisma.lead.findFirst({ where: { id: req.params.id, workspaceId: req.workspaceId } });
        if (!existing) return res.status(404).json({ error: 'Lead not found' });

        const lead = await prisma.lead.update({ where: { id: req.params.id }, data: req.body });
        return res.json(lead);
    } catch (err) {
        return res.status(500).json({ error: 'Internal server error' });
    }
};

export const deleteLead = async (req, res) => {
    try {
        const existing = await prisma.lead.findFirst({ where: { id: req.params.id, workspaceId: req.workspaceId } });
        if (!existing) return res.status(404).json({ error: 'Lead not found' });

        await prisma.lead.delete({ where: { id: req.params.id } });
        return res.json({ success: true });
    } catch (err) {
        return res.status(500).json({ error: 'Internal server error' });
    }
};

export const importCsv = async (req, res) => {
    try {
        let csvText, mapping, listId;

        // Handle multipart/form-data (file upload from frontend)
        if (req.headers['content-type']?.includes('multipart/form-data') || req.file) {
            // If using multer, we'd have req.file.buffer
            // But since we don't have multer, fall through to JSON body
        }

        // Handle JSON body (csvData as string, or base64 file content)
        if (req.body.file) {
            // File sent as base64 data
            csvText = Buffer.from(req.body.file, 'base64').toString('utf-8');
        } else if (req.body.csvData) {
            csvText = req.body.csvData;
        } else if (req.body.csvText) {
            csvText = req.body.csvText;
        } else {
            return res.status(400).json({ error: 'CSV data is required. Send as csvData (string) or file (base64).' });
        }

        mapping = typeof req.body.mapping === 'string' ? JSON.parse(req.body.mapping) : req.body.mapping || {};
        listId = req.body.listId || null;

        // Parse CSV
        const rows = parse(csvText, { columns: true, skip_empty_lines: true, trim: true });
        if (rows.length === 0) return res.status(400).json({ error: 'CSV is empty or has no valid rows' });

        let created = 0, updated = 0, failed = 0;

        for (const row of rows) {
            // Use the mapping to extract fields
            let email, firstName, lastName, company, phone, jobTitle, linkedinUrl;

            if (Object.keys(mapping).length > 0) {
                // Use user-specified mapping
                for (const [csvCol, field] of Object.entries(mapping)) {
                    const value = row[csvCol];
                    if (!value) continue;
                    switch (field) {
                        case 'email': email = value; break;
                        case 'firstName': firstName = value; break;
                        case 'lastName': lastName = value; break;
                        case 'company': company = value; break;
                        case 'phone': phone = value; break;
                        case 'jobTitle': jobTitle = value; break;
                        case 'linkedinUrl': linkedinUrl = value; break;
                    }
                }
            } else {
                // Flexible auto-detect
                email = row.email || row.Email || row.EMAIL || row['Email Address'];
                firstName = row.firstName || row.first_name || row['First Name'] || row.firstname || '';
                lastName = row.lastName || row.last_name || row['Last Name'] || row.lastname || '';
                company = row.company || row.Company || row.organization || '';
                phone = row.phone || row.Phone || row.mobile || '';
                jobTitle = row.jobTitle || row.job_title || row['Job Title'] || row.title || '';
            }

            if (!email || !email.includes('@')) { failed++; continue; }

            const name = [firstName, lastName].filter(Boolean).join(' ') || '';

            try {
                const existing = await prisma.lead.findUnique({
                    where: { email_workspaceId: { email, workspaceId: req.workspaceId } },
                });
                if (existing) {
                    await prisma.lead.update({
                        where: { id: existing.id },
                        data: { firstName, lastName, name, company, phone, listId: listId || existing.listId },
                    });
                    updated++;
                } else {
                    await prisma.lead.create({
                        data: { email, firstName, lastName, name, company, phone, workspaceId: req.workspaceId, listId },
                    });
                    created++;
                }
            } catch (e) {
                failed++;
            }
        }

        return res.json({
            processed: rows.length,
            upserted: created + updated,
            created,
            updated,
            failed,
            total: rows.length,
            listId,
        });
    } catch (err) {
        console.error('[importCsv]', err);
        return res.status(500).json({ error: 'CSV parsing failed: ' + err.message });
    }
};

// --- Lead Lists ---
export const getLists = async (req, res) => {
    try {
        const lists = await prisma.leadList.findMany({
            where: { workspaceId: req.workspaceId },
            include: { _count: { select: { leads: true } } },
            orderBy: { createdAt: 'desc' },
        });
        // Flatten _count into leadCount for frontend compatibility
        const formatted = lists.map(l => ({
            ...l,
            leadCount: l._count?.leads || 0,
        }));
        return res.json(formatted);
    } catch (err) {
        return res.status(500).json({ error: 'Internal server error' });
    }
};

export const createList = async (req, res) => {
    try {
        const { name } = req.body;
        if (!name) return res.status(400).json({ error: 'List name is required' });
        const list = await prisma.leadList.create({ data: { name, workspaceId: req.workspaceId } });
        return res.status(201).json(list);
    } catch (err) {
        return res.status(500).json({ error: 'Internal server error' });
    }
};

export const deleteList = async (req, res) => {
    try {
        const existing = await prisma.leadList.findFirst({ where: { id: req.params.id, workspaceId: req.workspaceId } });
        if (!existing) return res.status(404).json({ error: 'List not found' });
        await prisma.leadList.delete({ where: { id: req.params.id } });
        return res.json({ success: true });
    } catch (err) {
        return res.status(500).json({ error: 'Internal server error' });
    }
};
