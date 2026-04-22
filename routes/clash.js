/**
 * Clash Routes — APS Model Coordination API
 */
'use strict';

const express = require('express');
const {
    authRefreshMiddleware,
    getClashContainers,
    getClashTests,
    getClashResults,
} = require('../services/aps.js');
const { asyncHandler, AppError } = require('../middleware');

const router = express.Router();

function normalizeApsError(err, label) {
    const status = err.response?.status || 500;
    const body = err.response?.data || {};
    const msg = body.error || body.message || err.message || `${label} failed`;
    console.error(`[Clash] ${label} error:`, status, body);
    return new AppError(msg, status, 'APS_API_ERROR', body);
}

// ── GET /api/clash/:projectId/containers ───────────────────────
router.get('/api/clash/:projectId/containers', authRefreshMiddleware, asyncHandler(async (req, res) => {
    try {
        const containers = await getClashContainers(
            req.params.projectId,
            req.internalOAuthToken.access_token,
            req.query.region || 'US'
        );
        res.json(containers);
    } catch (err) {
        throw normalizeApsError(err, 'getClashContainers');
    }
}));

// ── GET /api/clash/:containerId/tests ──────────────────────────
router.get('/api/clash/:containerId/tests', authRefreshMiddleware, asyncHandler(async (req, res) => {
    try {
        const tests = await getClashTests(
            req.params.containerId,
            req.internalOAuthToken.access_token,
            req.query.region || 'US'
        );
        res.json(tests);
    } catch (err) {
        throw normalizeApsError(err, 'getClashTests');
    }
}));

// ── GET /api/clash/:containerId/tests/:testId/results ──────────
router.get('/api/clash/:containerId/tests/:testId/results', authRefreshMiddleware, asyncHandler(async (req, res) => {
    try {
        const results = await getClashResults(
            req.params.containerId,
            req.params.testId,
            req.internalOAuthToken.access_token,
            req.query.region || 'US'
        );
        res.json(results);
    } catch (err) {
        throw normalizeApsError(err, 'getClashResults');
    }
}));

module.exports = router;
