'use strict';

const express = require('express');
const { authRefreshMiddleware } = require('../services/aps.js');
const { saveMemo, getMemo } = require('../services/memos.js');

let router = express.Router();

/**
 * POST /api/version-memo
 * Saves a memo for a specific version.
 */
router.post('/api/version-memo', authRefreshMiddleware, async (req, res) => {
    try {
        const { versionUrn, memoText } = req.body;
        console.log('[Memos] POST /api/version-memo - URN:', versionUrn);

        if (!versionUrn) {
            return res.status(400).json({ error: 'versionUrn is required' });
        }

        const memo = saveMemo(versionUrn, memoText);
        res.json(memo);
    } catch (err) {
        console.error('[Memos] POST Error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

/**
 * GET /api/version-memo/*
 * Retrieves a memo for a specific version.
 */
router.get('/api/version-memo/*', authRefreshMiddleware, async (req, res) => {
    try {
        // req.params[0] captures the wildcard part after /api/version-memo/
        const versionUrn = req.params[0];
        console.log('[Memos] GET /api/version-memo/* - URN:', versionUrn);

        const memo = getMemo(versionUrn);
        res.json(memo);
    } catch (err) {
        console.error('[Memos] GET Error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
