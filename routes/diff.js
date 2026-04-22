/**
 * Diff Routes — APS Model Version Diff API
 */
'use strict';

const express = require('express');
const {
    authRefreshMiddleware,
    requestVersionDiff,
    getDiffStatus,
    getDiffResults,
} = require('../services/aps.js');
const { asyncHandler, AppError } = require('../middleware');

const router = express.Router();

// URN이 base64로 인코딩된 경우 디코딩
function ensureRawUrn(urn) {
    if (!urn) return urn;
    if (urn.startsWith('urn:')) return urn;
    try {
        const decoded = Buffer.from(urn, 'base64').toString('utf8');
        return decoded.startsWith('urn:') ? decoded : urn;
    } catch {
        return urn;
    }
}

// 외부 APS 에러를 AppError로 정규화
function normalizeApsError(err) {
    const status = err.response?.status || 500;
    const body = err.response?.data || {};
    const message = body.error || body.message || err.message || 'APS API error';
    return new AppError(message, status, 'APS_API_ERROR', body);
}

// ── POST /api/diffs ────────────────────────────────────────────
router.post('/api/diffs', authRefreshMiddleware, asyncHandler(async (req, res) => {
    const { projectId, prevUrn, curUrn, region } = req.body;
    if (!projectId || !prevUrn || !curUrn) {
        throw new AppError('Missing projectId, prevUrn, or curUrn.', 400, 'VALIDATION_ERROR');
    }
    try {
        const result = await requestVersionDiff(
            projectId,
            ensureRawUrn(prevUrn),
            ensureRawUrn(curUrn),
            req.internalOAuthToken.access_token,
            region || 'US'
        );
        res.json(result);
    } catch (err) {
        throw normalizeApsError(err);
    }
}));

// ── GET /api/diffs/:projectId/:diffId ──────────────────────────
router.get('/api/diffs/:projectId/:diffId', authRefreshMiddleware, asyncHandler(async (req, res) => {
    try {
        const status = await getDiffStatus(
            req.params.projectId,
            req.params.diffId,
            req.internalOAuthToken.access_token,
            req.query.region || 'US'
        );
        res.json(status);
    } catch (err) {
        throw normalizeApsError(err);
    }
}));

// ── GET /api/diffs/:projectId/:diffId/results ──────────────────
router.get('/api/diffs/:projectId/:diffId/results', authRefreshMiddleware, asyncHandler(async (req, res) => {
    try {
        const results = await getDiffResults(
            req.params.projectId,
            req.params.diffId,
            req.internalOAuthToken.access_token,
            req.query.region || 'US'
        );

        const pickFields = (obj) => ({ dbId: obj.lmvId, name: obj.name, category: obj.category });
        const isType = (obj, n, label) => obj.changeType === n || obj.changeType === label;

        res.json({
            added:   (results || []).filter((o) => isType(o, 1, 'added')).map(pickFields),
            removed: (results || []).filter((o) => isType(o, 2, 'removed')).map(pickFields),
            changed: (results || []).filter((o) => isType(o, 3, 'changed')).map(pickFields),
        });
    } catch (err) {
        throw normalizeApsError(err);
    }
}));

module.exports = router;
