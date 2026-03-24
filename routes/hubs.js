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
const axios = require('axios');
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
        console.log('[Hubs] getHubs called. Token prefix:', req.internalOAuthToken?.access_token?.slice(0, 10));
        const hubs = await getHubs(req.internalOAuthToken.access_token);
        console.log('[Hubs] getHubs raw response type:', typeof hubs, 'isArray:', Array.isArray(hubs));
        console.log('[Hubs] getHubs count:', hubs?.length);

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
        console.log(`[Hubs] Fetching projects for hub: ${req.params.hub_id}`);
        const hub = await getHubs(req.internalOAuthToken.access_token);
        const targetHub = hub.find(h => h.id === req.params.hub_id);
        const region = targetHub?.attributes?.region || 'US';

        const projects = await getProjects(req.params.hub_id, req.internalOAuthToken.access_token);
        console.log(`[Hubs] Found ${projects?.length || 0} projects in hub.`);
        if (projects && projects.length > 0) {
            projects.forEach(p => console.log(` - Project: ${p.attributes.name} (${p.id})`));
        }

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

        // Group items by displayRef (Logic to show only latest version in tree)
        const groups = {};
        const folders = [];

        entries.forEach(entry => {
            if (entry.type === 'folders') {
                folders.push({
                    id: entry.id,
                    name: entry.attributes.displayName,
                    folder: true,
                    type: entry.type
                });
            } else if (entry.type === 'items') {
                // Try to find displayRef for grouping. Fallback to displayName if not present.
                const displayRef = entry.attributes.extension?.data?.displayRef || entry.attributes.displayName;

                if (!groups[displayRef] || (new Date(entry.attributes.lastModifiedTime) > new Date(groups[displayRef].attributes.lastModifiedTime))) {
                    groups[displayRef] = entry;
                }
            }
        });

        const items = Object.values(groups).map(entry => {
            const tipId = entry.relationships?.tip?.data?.id;
            let vNum = null;
            let finalUrn = null;

            if (tipId) {
                const match = tipId.match(/[?&]version=(\d+)/i);
                vNum = match ? parseInt(match[1]) : (entry.attributes.versionNumber || null);

                // Prevent double encoding if tipId is already base64
                if (tipId.startsWith('dXJu')) {
                    finalUrn = tipId.replace(/=/g, '');
                } else if (tipId.startsWith('urn:dXJu')) {
                    finalUrn = tipId.replace('urn:', '').replace(/=/g, '');
                } else {
                    finalUrn = Buffer.from(tipId).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
                }
            }

            return {
                id: entry.id,
                name: entry.attributes.displayName,
                folder: false,
                type: entry.type,
                extension: entry.attributes.extension?.type,
                vNumber: vNum,
                urn: finalUrn,
                lastModifiedTime: entry.attributes.lastModifiedTime,
                lastModifiedUserName: entry.attributes.lastModifiedUserName || 'Unknown'
            };
        });


        res.json([...folders, ...items]);
    } catch (err) {
        console.error('[Hubs] getProjectContents error:', err.message);
        next(err);
    }
});

const { getMemo } = require('../services/memos.js');
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
                const match = version.id.match(/[?&]version=(\d+)/i) || version.id.match(/\/versions\/(\d+)$/i);
                vNum = match ? parseInt(match[1]) : 0;
            }

            // APS Description extraction from typical APS paths
            const apsDescription = version.attributes?.extension?.data?.description
                || version.attributes?.description
                || '-';

            // Local Memo Priority
            const localMemo = getMemo(version.id);
            const finalDescription = (localMemo && localMemo.text) ? localMemo.text : apsDescription;

            let derivativeId = version.relationships?.derivatives?.data?.id;
            let finalUrn = null;
            if (derivativeId) {
                // IMPORTANT: APS API sometimes returns relationships.derivatives.data.id as ALREADY Base64 encoded.
                if (derivativeId.startsWith('dXJu')) {
                    finalUrn = derivativeId.replace(/=/g, '');
                } else if (derivativeId.startsWith('urn:dXJu')) {
                    finalUrn = derivativeId.replace('urn:', '').replace(/=/g, '');
                } else {
                    finalUrn = Buffer.from(derivativeId).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
                }
            }

            return {
                id: version.id,
                name: version.attributes.createTime,
                displayName: version.attributes.displayName || version.attributes.createTime,
                vNumber: vNum,
                createUserName: version.attributes.createUserName,
                description: finalDescription,
                urn: finalUrn
            };
        }));

    } catch (err) {
        console.error('[Hubs] getItemVersions error:', err.message);
        next(err);
    }
});


// ── GET /api/aps/model/:urn/status ────
const { getManifest } = require('../services/aps.js');
router.get('/api/aps/model/:urn/status', authRefreshMiddleware, async (req, res) => {
    try {
        const manifest = await getManifest(req.params.urn, req.internalOAuthToken.access_token);
        res.json({
            status: manifest.status,
            progress: manifest.progress,
            messages: manifest.messages
        });
    } catch (err) {
        // If manifest doesn't exist yet, it's basically "n/a" or "failed"
        res.json({ status: 'n/a', progress: '0%', error: err.message });
    }
});


// ── PATCH /api/hubs/:hub_id/projects/:project_id/contents/:item_id/versions/:version_id ────
const { updateVersionDescription } = require('../services/aps.js');
router.patch('/api/hubs/:hub_id/projects/:project_id/contents/:item_id/versions/:version_id', authRefreshMiddleware, async (req, res, next) => {
    try {
        const { description } = req.body;
        const result = await updateVersionDescription(
            req.params.project_id,
            req.params.version_id,
            description,
            req.internalOAuthToken.access_token
        );
        res.json(result);
    } catch (err) {
        console.error('[Hubs] updateVersionDescription error:', err.message);
        next(err);
    }
});
// Custom route to resolve Item Lineage from a specific Version URN
router.get('/api/projects/:projectId/versions/:versionId', authRefreshMiddleware, async (req, res) => {
    try {
        const { projectId, versionId } = req.params;
        const token = req.internalOAuthToken.access_token;

        // [수정] 버전 정보(vf.)가 포함된 원본 URN을 그대로 사용 (split하지 않음)
        let rawUrn = decodeURIComponent(versionId).trim();

        console.log(`[Hubs Route] Requesting versions for project: ${projectId}, ID: ${rawUrn}`);

        // service.getItemVersions에 구현된 2단계 로직 활용
        const versions = await getItemVersions(projectId, rawUrn, token);
        res.json(versions);
    } catch (err) {
        console.error('[Hubs Route Error]', err.message);
        res.status(400).json({
            error: "Version retrieval failed",
            detail: err.message
        });
    }
});

module.exports = router;
