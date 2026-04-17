'use strict';

/**
 * routes/hubs.js
 * APS hubs-browser tutorial — Data Browsing endpoints
 * 
 * NOTE: This router is mounted with app.use(require('./routes/hubs')) in server.js
 * (no prefix stripping), so routes define full paths like '/api/hubs'.
 * authRefreshMiddleware is applied per-route, not via router.use(), to avoid
 * Express prefix-stripping issues.
 */

const express = require('express');
const {
    authRefreshMiddleware,
    getHubs,
    getProjects,
    getProjectContents,
    getItemVersions
} = require('../services/aps.js');

let router = express.Router();

// ── GET /api/hubs ─────────────────────────────────────────────────────────────
router.get('/api/hubs', authRefreshMiddleware, async function (req, res, next) {
    try {
        console.log('[Hubs] getHubs called, token:', req.internalOAuthToken?.access_token?.slice(0, 20) + '...');
        const hubs = await getHubs(req.internalOAuthToken.access_token);
        console.log('[Hubs] getHubs result count:', hubs?.length);

        if (!Array.isArray(hubs)) {
            return res.json([]);
        }

        res.json(hubs.map(hub => ({
            id: hub.id,
            name: hub.attributes?.name || 'Unknown Hub',
            region: hub.attributes?.region || 'US',
            type: hub.attributes?.extension?.type
        })));
    } catch (err) {
        console.error('[Hubs] getHubs error:', err.message);
        next(err);
    }
});

// ── GET /api/hubs/:hub_id/projects ───────────────────────────────────────────
router.get('/api/hubs/:hub_id/projects', authRefreshMiddleware, async function (req, res, next) {
    try {
        const hub = await getHubs(req.internalOAuthToken.access_token);
        const targetHub = hub.find(h => h.id === req.params.hub_id);
        const region = targetHub?.attributes?.region || 'US';

        const projects = await getProjects(req.params.hub_id, req.internalOAuthToken.access_token);
        res.json(projects.map(project => ({
            id: project.id,
            name: project.attributes.name,
            type: project.attributes.extension?.type,
            region: region // Pass region down
        })));
    } catch (err) {
        console.error('[Hubs] getProjects error:', err.message);
        next(err);
    }
});

// ── GET /api/hubs/:hub_id/projects/:project_id/contents ──────────────────────
router.get('/api/hubs/:hub_id/projects/:project_id/contents', authRefreshMiddleware, async function (req, res, next) {
    try {
        const entries = await getProjectContents(
            req.params.hub_id,
            req.params.project_id,
            req.query.folder_id,
            req.internalOAuthToken.access_token
        );
        res.json(entries.map(entry => ({
            id: entry.id,
            name: entry.attributes.displayName,
            folder: entry.type === 'folders',
            type: entry.type,
            extension: entry.attributes.extension?.type,
            urn: entry.type === 'items' && entry.relationships?.tip?.data?.id
                ? Buffer.from(entry.relationships.tip.data.id).toString('base64').replace(/=/g, '')
                : null
        })));
    } catch (err) {
        console.error('[Hubs] getProjectContents error:', err.message);
        next(err);
    }
});

// ── GET /api/hubs/:hub_id/projects/:project_id/contents/:item_id/versions ────
router.get('/api/hubs/:hub_id/projects/:project_id/contents/:item_id/versions', authRefreshMiddleware, async function (req, res, next) {
    try {
        const versions = await getItemVersions(
            req.params.project_id,
            req.params.item_id,
            req.internalOAuthToken.access_token
        );

        res.json(versions.map(version => {
            // Robust version number extraction
            let vNum = version.attributes.versionNumber;
            if (vNum === undefined || vNum === null) {
                // If not in attributes, parse from ID: '...&version=2' or '.../versions/2'
                const match = version.id.match(/[?&]version=(\d+)/i) || version.id.match(/\/versions\/(\d+)$/i);
                vNum = match ? parseInt(match[1]) : 0;
            }

            const result = {
                id: version.id,
                name: version.attributes.createTime,
                displayName: version.attributes.displayName || version.attributes.createTime,
                vNumber: vNum, // Renamed to vNumber to bypass potential cache/collision issues
                createUserName: version.attributes.createUserName,
                urn: version.relationships?.derivatives?.data?.id
                    ? Buffer.from(version.relationships.derivatives.data.id).toString('base64').replace(/=/g, '')
                    : null
            };

            if (vNum === 0 || vNum === '?') {
                console.log(`[Hubs] Warning: vNumber missing for ${version.id}. Attributes:`, Object.keys(version.attributes));
            }
            console.log(`[Hubs] Mapped Version: ${result.vNumber} - ${result.displayName}`);
            return result;
        }));
    } catch (err) {
        console.error('[Hubs] getItemVersions error:', err.message);
        next(err);
    }
});

module.exports = router;
