'use strict';

const express = require('express');
const router = express.Router();
const {
    getHubs,
    getProjects,
    getProjectContents,
    getItemVersions,
    authRefreshMiddleware
} = require('../services/aps');

// ── GET /api/models/hubs ─────────────────────────────────────────────────────
router.get('/hubs', authRefreshMiddleware, async (req, res, next) => {
    try {
        const hubs = await getHubs(req.internalOAuthToken.access_token);
        res.json(hubs.map(h => ({
            id: h.id,
            name: h.attributes?.name,
            region: h.attributes?.region,
            type: h.attributes?.extension?.type
        })));
    } catch (err) {
        console.error('[Models] getHubs error:', err.message);
        next({ status: 500, message: err.message });
    }
});

// ── GET /api/models/hubs/:hubId/projects ─────────────────────────────────────
router.get('/hubs/:hubId/projects', authRefreshMiddleware, async (req, res, next) => {
    try {
        const projects = await getProjects(req.params.hubId, req.internalOAuthToken.access_token);
        res.json(projects.map(p => ({
            id: p.id,
            name: p.attributes?.name,
            type: p.attributes?.extension?.type
        })));
    } catch (err) {
        console.error('[Models] getProjects error:', err.message);
        next({ status: 500, message: err.message });
    }
});

// ── GET /api/models/hubs/:hubId/projects/:projectId/contents ─────────────────
// Optional query: ?folderId=...
router.get('/hubs/:hubId/projects/:projectId/contents', authRefreshMiddleware, async (req, res, next) => {
    try {
        const { folderId } = req.query;
        const items = await getProjectContents(
            req.params.hubId,
            req.params.projectId,
            folderId,
            req.internalOAuthToken.access_token
        );
        res.json(items.map(i => ({
            id: i.id,
            name: i.attributes?.displayName || i.attributes?.name,
            type: i.type,           // 'folders' or 'items'
            extension: i.attributes?.extension?.type,
            urn: i.type === 'items' && i.relationships?.tip?.data?.id
                ? Buffer.from(i.relationships.tip.data.id).toString('base64').replace(/=/g, '')
                : null
        })));
    } catch (err) {
        console.error('[Models] getProjectContents error:', err.message);
        next({ status: 500, message: err.message });
    }
});

// ── GET /api/models/.../items/:itemId/versions ────────────────────────────────
router.get('/hubs/:hubId/projects/:projectId/items/:itemId/versions', authRefreshMiddleware, async (req, res, next) => {
    try {
        const versions = await getItemVersions(
            req.params.projectId,
            req.params.itemId,
            req.internalOAuthToken.access_token
        );
        res.json(versions.map(v => ({
            id: v.id,
            name: v.attributes?.displayName || v.attributes?.name,
            createTime: v.attributes?.createTime,
            createUserName: v.attributes?.createUserName,
            urn: v.relationships?.derivatives?.data?.id
                ? Buffer.from(v.relationships.derivatives.data.id).toString('base64').replace(/=/g, '')
                : null
        })));
    } catch (err) {
        console.error('[Models] getItemVersions error:', err.message);
        next({ status: 500, message: err.message });
    }
});

module.exports = router;
