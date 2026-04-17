import { PrismaClient } from '@prisma/client';
import forge from 'node-forge';
import dns from 'dns';
import util from 'util';

const resolveTxt = util.promisify(dns.resolveTxt);
const prisma = new PrismaClient();

// Helper to generate DKIM RSA Key Pair
const generateDKIMKeys = () => {
    return new Promise((resolve, reject) => {
        forge.pki.rsa.generateKeyPair({ bits: 1024, workers: 2 }, (err, keypair) => {
            if (err) return reject(err);
            const privateKey = forge.pki.privateKeyToPem(keypair.privateKey);
            let publicKey = forge.pki.publicKeyToRSAPublicKeyPem(keypair.publicKey);

            // Format public key for DNS (remove headers and newlines)
            publicKey = publicKey
                .replace(/-----BEGIN RSA PUBLIC KEY-----/g, '')
                .replace(/-----END RSA PUBLIC KEY-----/g, '')
                .replace(/\n/g, '')
                .replace(/\r/g, '');

            resolve({ privateKey, publicKey });
        });
    });
};

export const addDomain = async (req, res) => {
    try {
        const { domainName } = req.body;
        const workspaceId = req.workspaceId;

        if (!domainName) {
            return res.status(400).json({ error: 'Domain name is required' });
        }

        const existing = await prisma.domain.findUnique({
            where: { workspaceId_domainName: { workspaceId, domainName } }
        });

        if (existing) {
            return res.status(400).json({ error: 'Domain already exists in this workspace' });
        }

        const { privateKey, publicKey } = await generateDKIMKeys();

        const domain = await prisma.domain.create({
            data: {
                workspaceId,
                domainName: domainName.toLowerCase(),
                dkimPrivateKey: privateKey,
                dkimPublicKey: publicKey,
                dkimSelector: 'abhimail'
            }
        });

        // Hide private key from response
        const { dkimPrivateKey, ...safeDomain } = domain;
        res.status(201).json(safeDomain);
    } catch (err) {
        console.error('[AddDomain Error]', err);
        res.status(500).json({ error: 'Failed to add domain' });
    }
};

export const getDomains = async (req, res) => {
    try {
        const domains = await prisma.domain.findMany({
            where: { workspaceId: req.workspaceId },
            select: {
                id: true,
                domainName: true,
                dkimSelector: true,
                dkimPublicKey: true,
                dkimVerified: true,
                spfVerified: true,
                dmarcVerified: true,
                status: true,
                createdAt: true
            }
        });
        res.json(domains);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch domains' });
    }
};

export const verifyDomain = async (req, res) => {
    try {
        const { id } = req.params;
        const domain = await prisma.domain.findUnique({
            where: { id, workspaceId: req.workspaceId }
        });

        if (!domain) {
            return res.status(404).json({ error: 'Domain not found' });
        }

        let spfVerified = false;
        let dkimVerified = false;
        let dmarcVerified = false;

        // 1. Verify SPF
        try {
            const spfRecords = await resolveTxt(domain.domainName);
            const flatSpf = spfRecords.map(r => r.join('')).join('');
            if (flatSpf.includes('v=spf1') && flatSpf.includes('~all') || flatSpf.includes('-all')) {
                spfVerified = true;
            }
        } catch (e) { /* Ignore DNS errors */ }

        // 2. Verify DKIM
        try {
            const dkimHostname = `${domain.dkimSelector}._domainkey.${domain.domainName}`;
            const dkimRecords = await resolveTxt(dkimHostname);
            const flatDkim = dkimRecords.map(r => r.join('')).join('');

            // Check if public key matches our generated one
            if (flatDkim.includes('v=DKIM1') && flatDkim.includes(domain.dkimPublicKey.substring(0, 50))) {
                dkimVerified = true;
            }
        } catch (e) { }

        // 3. Verify DMARC
        try {
            const dmarcHostname = `_dmarc.${domain.domainName}`;
            const dmarcRecords = await resolveTxt(dmarcHostname);
            const flatDmarc = dmarcRecords.map(r => r.join('')).join('');
            if (flatDmarc.includes('v=DMARC1')) {
                dmarcVerified = true;
            }
        } catch (e) { }

        const isFullyVerified = spfVerified && dkimVerified && dmarcVerified;
        const status = isFullyVerified ? 'verified' : 'pending';

        const updatedDomain = await prisma.domain.update({
            where: { id },
            data: {
                spfVerified,
                dkimVerified,
                dmarcVerified,
                status
            },
            select: {
                id: true,
                domainName: true,
                dkimSelector: true,
                dkimPublicKey: true,
                dkimVerified: true,
                spfVerified: true,
                dmarcVerified: true,
                status: true
            }
        });

        res.json(updatedDomain);
    } catch (err) {
        console.error('[VerifyDomain Error]', err);
        res.status(500).json({ error: 'Failed to verify domain' });
    }
};
