/**
 * Memos Routes — 버전별 메모 저장 · 조회
 */
'use strict';

const express = require('express');
const { authRefreshMiddleware } = require('../services/aps.js');
const { saveMemo, getMemo } = require('../services/memos.js');
const { asyncHandler, AppError } = require('../middleware');

const router = express.Router();

// ── POST /api/version-memo ─────────────────────────────────────
router.post('/api/version-memo', authRefreshMiddleware, asyncHandler(async (req, res) => {
    const { versionUrn, memoText } = req.body || {};
    if (!versionUrn) throw new AppError('versionUrn is required', 400, 'VALIDATION_ERROR');
    res.json(saveMemo(versionUrn, memoText));
}));

// ── GET /api/version-memo/:urn ────────────────────────────────
router.get('/api/version-memo/:urn', authRefreshMiddleware, asyncHandler(async (req, res) => {
    res.json(getMemo(req.params.urn));
}));

module.exports = router;
