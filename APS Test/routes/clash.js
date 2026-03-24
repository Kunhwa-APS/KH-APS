'use strict';

const express = require('express');
const {
    authRefreshMiddleware,
    getClashContainers,
    getClashTests,
    getClashResults
} = require('../services/aps.js');

let router = express.Router();

/**
 * GET /api/clash/:projectId/containers
 * Fetches the Model Coordination container for a project.
 */
router.get('/api/clash/:projectId/containers', authRefreshMiddleware, async (req, res) => {
    try {
        const { projectId } = req.params;
        const { region } = req.query;
        const containers = await getClashContainers(projectId, req.internalOAuthToken.access_token, region || 'US');
        res.json(containers);
    } catch (err) {
        console.error('[Clash] getClashContainers error:', err.response?.data || err.message);
        res.status(err.response?.status || 500).json(err.response?.data || { error: err.message });
    }
});

/**
 * GET /api/clash/:containerId/tests
 * Lists clash tests in a coordination container.
 */
router.get('/api/clash/:containerId/tests', authRefreshMiddleware, async (req, res) => {
    try {
        const { containerId } = req.params;
        const { region } = req.query;
        const tests = await getClashTests(containerId, req.internalOAuthToken.access_token, region || 'US');
        res.json(tests);
    } catch (err) {
        console.error('[Clash] getClashTests error:', err.response?.data || err.message);
        res.status(err.response?.status || 500).json(err.response?.data || { error: err.message });
    }
});

/**
 * GET /api/clash/:containerId/tests/:testId/results
 * Fetches detailed clash results for a test.
 */
router.get('/api/clash/:containerId/tests/:testId/results', authRefreshMiddleware, async (req, res) => {
    try {
        const { containerId, testId } = req.params;
        const { region } = req.query;
        const results = await getClashResults(containerId, testId, req.internalOAuthToken.access_token, region || 'US');
        res.json(results);
    } catch (err) {
        console.error('[Clash] getClashResults error:', err.response?.data || err.message);
        res.status(err.response?.status || 500).json(err.response?.data || { error: err.message });
    }
});

module.exports = router;
