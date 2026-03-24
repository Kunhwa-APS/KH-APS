'use strict';

const express = require('express');
const {
    authRefreshMiddleware,
    requestVersionDiff,
    getDiffStatus,
    getDiffResults
} = require('../services/aps.js');

let router = express.Router();

router.post('/api/diffs', authRefreshMiddleware, async (req, res, next) => {
    try {
        const { projectId, prevUrn, curUrn, region } = req.body;
        console.log(`\n[ROUTE] POST /api/diffs`);
        console.log(`[ROUTE] ProjectID: ${projectId}`);
        console.log(`[ROUTE] Prev URN (Raw): ${prevUrn}`);
        console.log(`[ROUTE] Cur URN (Raw): ${curUrn}`);

        if (!projectId || !prevUrn || !curUrn) {
            return res.status(400).json({ error: 'Missing projectId, prevUrn, or curUrn.' });
        }

        // Standardize URN - ensure it's not base64 encoded by mistake
        const ensureRawUrn = (urn) => {
            if (urn.startsWith('urn:')) return urn;
            try {
                // If it looks like base64-encoded URN
                const decoded = Buffer.from(urn, 'base64').toString('utf8');
                return decoded.startsWith('urn:') ? decoded : urn;
            } catch (e) {
                return urn;
            }
        };

        const result = await requestVersionDiff(
            projectId,
            ensureRawUrn(prevUrn),
            ensureRawUrn(curUrn),
            req.internalOAuthToken.access_token,
            region || 'US'
        );
        res.json(result);
    } catch (err) {
        console.error('[ROUTE] Error in POST /api/diffs:', err.response?.data || err.message);
        res.status(err.response?.status || 500).json(err.response?.data || { error: err.message });
    }
});

router.get('/api/diffs/:projectId/:diffId', authRefreshMiddleware, async (req, res, next) => {
    try {
        const { projectId, diffId } = req.params;
        const { region } = req.query;
        const status = await getDiffStatus(projectId, diffId, req.internalOAuthToken.access_token, region || 'US');
        res.json(status);
    } catch (err) {
        res.status(err.response?.status || 500).json(err.response?.data || { error: err.message });
    }
});

router.get('/api/diffs/:projectId/:diffId/results', authRefreshMiddleware, async (req, res, next) => {
    try {
        const { projectId, diffId } = req.params;
        const { region } = req.query;
        const results = await getDiffResults(projectId, diffId, req.internalOAuthToken.access_token, region || 'US');

        // Grouping logic
        const grouped = {
            added: (results || []).filter(obj => obj.changeType === 1 || obj.changeType === 'added').map(obj => ({
                dbId: obj.lmvId,
                name: obj.name,
                category: obj.category
            })),
            removed: (results || []).filter(obj => obj.changeType === 2 || obj.changeType === 'removed').map(obj => ({
                dbId: obj.lmvId,
                name: obj.name,
                category: obj.category
            })),
            changed: (results || []).filter(obj => obj.changeType === 3 || obj.changeType === 'changed').map(obj => ({
                dbId: obj.lmvId,
                name: obj.name,
                category: obj.category
            }))
        };
        res.json(grouped);
    } catch (err) {
        res.status(err.response?.status || 500).json(err.response?.data || { error: err.message });
    }
});

module.exports = router;
