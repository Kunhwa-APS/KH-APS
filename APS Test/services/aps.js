'use strict';

const { AuthenticationClient, ResponseType } = require('@aps_sdk/authentication');
const { DataManagementClient } = require('@aps_sdk/data-management');
const {
    APS_CLIENT_ID,
    APS_CLIENT_SECRET,
    APS_CALLBACK_URL,
    INTERNAL_TOKEN_SCOPES,
    PUBLIC_TOKEN_SCOPES
} = require('../config.js');

const crypto = require('crypto');
const axios = require('axios');

const authenticationClient = new AuthenticationClient();
const dataManagementClient = new DataManagementClient();

const service = module.exports = {};

// ── PKCE Helpers ─────────────────────────────────────────────────────────────
function generateCodeVerifier() { return crypto.randomBytes(32).toString('base64url'); }
function generateCodeChallenge(verifier) { return crypto.createHash('sha256').update(verifier).digest('base64url'); }

const pkceStateStore = new Map();

service.getAuthorizationUrl = () => {
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(codeVerifier);
    const state = crypto.randomBytes(16).toString('hex');
    pkceStateStore.set(state, codeVerifier);
    setTimeout(() => pkceStateStore.delete(state), 10 * 60 * 1000);
    return authenticationClient.authorize(
        APS_CLIENT_ID,
        ResponseType.Code,
        APS_CALLBACK_URL,
        INTERNAL_TOKEN_SCOPES,
        { codeChallenge, codeChallengeMethod: 'S256', state }
    );
};

service.authCallbackMiddleware = async (req, res, next) => {
    try {
        const { code, state } = req.query;
        if (!state || !pkceStateStore.has(state)) return res.status(400).json({ error: 'Invalid or expired OAuth state.' });
        const codeVerifier = pkceStateStore.get(state);
        pkceStateStore.delete(state);

        const internalCredentials = await authenticationClient.getThreeLeggedToken(
            APS_CLIENT_ID, code, APS_CALLBACK_URL,
            { clientSecret: APS_CLIENT_SECRET, code_verifier: codeVerifier }
        );

        const publicCredentials = await authenticationClient.refreshToken(
            internalCredentials.refresh_token, APS_CLIENT_ID,
            { clientSecret: APS_CLIENT_SECRET, scopes: PUBLIC_TOKEN_SCOPES }
        );

        req.session.public_token = publicCredentials.access_token;
        req.session.internal_token = internalCredentials.access_token;
        req.session.refresh_token = internalCredentials.refresh_token;
        req.session.expires_at = Date.now() + internalCredentials.expires_in * 1000;
        next();
    } catch (err) { next(err); }
};

service.authRefreshMiddleware = async (req, res, next) => {
    const { refresh_token, expires_at } = req.session;
    if (!refresh_token) return res.status(401).json({ error: 'Not authenticated.' });

    if (expires_at < Date.now()) {
        try {
            const internalCredentials = await authenticationClient.refreshToken(
                refresh_token, APS_CLIENT_ID, { clientSecret: APS_CLIENT_SECRET, scopes: INTERNAL_TOKEN_SCOPES }
            );
            const publicCredentials = await authenticationClient.refreshToken(
                internalCredentials.refresh_token, APS_CLIENT_ID, { clientSecret: APS_CLIENT_SECRET, scopes: PUBLIC_TOKEN_SCOPES }
            );
            req.session.public_token = publicCredentials.access_token;
            req.session.internal_token = internalCredentials.access_token;
            req.session.refresh_token = internalCredentials.refresh_token;
            req.session.expires_at = Date.now() + internalCredentials.expires_in * 1000;
        } catch (err) {
            req.session = null;
            return res.status(401).json({ error: 'Session expired.' });
        }
    }
    req.internalOAuthToken = { access_token: req.session.internal_token };
    req.publicOAuthToken = { access_token: req.session.public_token };
    next();
};

service.getUserProfile = async (accessToken) => {
    return authenticationClient.getUserInfo(accessToken);
};

service.getPublicToken = async () => {
    const resp = await authenticationClient.getTwoLeggedToken(APS_CLIENT_ID, APS_CLIENT_SECRET, PUBLIC_TOKEN_SCOPES);
    return { access_token: resp.access_token, expires_in: resp.expires_in };
};

service.getHubs = async (accessToken) => {
    const resp = await dataManagementClient.getHubs({ accessToken });
    return resp.data;
};

service.getProjects = async (hubId, accessToken) => {
    const resp = await dataManagementClient.getHubProjects(hubId, { accessToken });
    return resp.data;
};

service.getProjectContents = async (hubId, projectId, folderId, accessToken) => {
    if (!folderId) {
        const resp = await dataManagementClient.getProjectTopFolders(hubId, projectId, { accessToken });
        return resp.data;
    } else {
        const resp = await dataManagementClient.getFolderContents(projectId, folderId, { accessToken });
        return resp.data;
    }
};

service.getItemVersions = async (projectId, itemId, accessToken) => {
    const resp = await dataManagementClient.getItemVersions(projectId, itemId, { accessToken });
    return resp.data;
};

// ── Model Properties API v2 Logic with ROBUST ERROR HANDLING ────────────────
const MODEL_PROPS_API_BASE = 'https://developer.api.autodesk.com/modelproperties/v2';

/**
 * Normalizes Project ID. Model Properties v2 USUALLY wants the GUID only (no 'b.' prefix).
 * But we will provide an adaptive mechanism to try both if one fails with 404.
 */
function getCleanProjectId(projectId) {
    return projectId.startsWith('b.') ? projectId.substring(2) : projectId;
}
function getRawProjectId(projectId) {
    return projectId.startsWith('b.') ? projectId : `b.${projectId}`;
}

/**
 * Adaptive API caller that handles BIM360/ACC project ID prefix ambiguity AND region mismatch.
 */
async function adaptiveCall(projectId, method, path, data, accessToken, region = 'US') {
    const inputRegion = (region || 'US').toUpperCase();
    const otherRegion = inputRegion === 'US' ? 'EMEA' : 'US';
    const cleanId = getCleanProjectId(projectId);
    const rawId = getRawProjectId(projectId);

    // Matrix of combinations to try on 404: [PID FORMAT] x [REGION]
    const attempts = [
        { pid: cleanId, reg: inputRegion },
        { pid: rawId, reg: inputRegion },
        { pid: cleanId, reg: otherRegion },
        { pid: rawId, reg: otherRegion }
    ];

    let lastError = null;
    for (let i = 0; i < attempts.length; i++) {
        const attempt = attempts[i];
        const url = `${MODEL_PROPS_API_BASE}/projects/${attempt.pid}${path}`;

        console.log(`\n[DEBUG] API ATTEMPT ${i + 1}/${attempts.length}: ${method.toUpperCase()} ${url}`);
        console.log(`[DEBUG] x-ads-region: ${attempt.reg}`);

        try {
            const config = {
                method,
                url,
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json',
                    'x-ads-region': attempt.reg
                }
            };
            if (data) config.data = data;

            const response = await axios(config);
            console.log(`[DEBUG] SUCCESS on Attempt ${i + 1} (Status ${response.status})`);
            return response.data;
        } catch (err) {
            lastError = err;
            const status = err.response?.status;
            const body = err.response?.data;
            console.warn(`[DEBUG] FAILED Attempt ${i + 1} (Status ${status || '???'})`);

            if (status !== 404) {
                console.error(`[DEBUG] Non-404 error received. Aborting attempts.`);
                console.error(`[DEBUG] Response Body: ${JSON.stringify(body || err.message, null, 2)}`);
                break;
            }
            console.log(`[DEBUG] 404 Resource Not Found. Trying next combination...`);
        }
    }
    throw lastError;
}

/**
 * Checks if a specific version is already indexed.
 */
service.getIndexStatus = async (projectId, versionUrn, accessToken, region = 'US') => {
    console.log(`\n[DEBUG] --- Checking Index Status for ${versionUrn} ---`);
    try {
        // Query indexes for this specific version URN
        const path = `/indexes?versionUrn=${encodeURIComponent(versionUrn)}`;
        const data = await adaptiveCall(projectId, 'get', path, null, accessToken, region);

        // v2 returns a list of indexes. Return the most recent 'finished' one if exists.
        const indexes = data.indexes || [];
        const finished = indexes.find(idx => idx.state === 'finished' || idx.state === 'done');
        const processing = indexes.find(idx => idx.state === 'processing' || idx.state === 'indexing');

        if (finished) return { state: 'finished', indexId: finished.indexId };
        if (processing) return { state: 'processing', indexId: processing.indexId };
        return { state: 'none' };
    } catch (err) {
        console.error(`[DEBUG] Error checking index status:`, err.message);
        return { state: 'none' };
    }
};

service.requestIndexing = async (projectId, versionUrn, accessToken, region = 'US') => {
    console.log(`\n[DEBUG] --- requestIndexing ---`);

    // Step 1: Check status first
    const status = await service.getIndexStatus(projectId, versionUrn, accessToken, region);
    if (status.state === 'finished') {
        console.log(`[DEBUG] Already indexed. Skipping POST.`);
        return { state: 'finished' };
    }
    if (status.state === 'processing') {
        console.log(`[DEBUG] Already processing. Skipping POST.`);
        return { state: 'processing' };
    }

    // Step 2: Start indexing
    try {
        const payload = { versions: [versionUrn] };
        return await adaptiveCall(projectId, 'post', '/indexes', payload, accessToken, region);
    } catch (err) {
        console.error(`[DEBUG] requestIndexing failed after all attempts.`);
        throw err;
    }
};

service.requestVersionDiff = async (projectId, prevVersionUrn, curVersionUrn, accessToken, region = 'US') => {
    console.log(`\n[DEBUG] --- requestVersionDiff ---`);

    try {
        // Ensure both are indexed or indexing
        console.log(`[DEBUG] Step 1: Ensuring versions are indexed...`);
        await service.requestIndexing(projectId, prevVersionUrn, accessToken, region);
        await service.requestIndexing(projectId, curVersionUrn, accessToken, region);

        // Step 2: Start Diff
        const payload = {
            prevVersion: { urn: prevVersionUrn },
            curVersion: { urn: curVersionUrn }
        };
        return await adaptiveCall(projectId, 'post', '/diffs', payload, accessToken, region);
    } catch (err) {
        console.error(`[DEBUG] requestVersionDiff failed.`);
        throw err;
    }
};

service.getDiffStatus = async (projectId, diffId, accessToken, region = 'US') => {
    return await adaptiveCall(projectId, 'get', `/diffs/${diffId}`, null, accessToken, region);
};

service.getDiffResults = async (projectId, diffId, accessToken, region = 'US') => {
    return await adaptiveCall(projectId, 'get', `/diffs/${diffId}/properties`, null, accessToken, region);
};

// ── Model Coordination API ──────────────────────────────────────────────────
const COORDINATION_API_BASE = 'https://developer.api.autodesk.com/bim360/modelcoordination/v1';

service.getClashContainers = async (projectId, accessToken, region = 'US') => {
    const cleanProjectId = getCleanProjectId(projectId);
    const response = await axios.get(`${COORDINATION_API_BASE}/projects/${cleanProjectId}/containers`, {
        headers: { 'Authorization': `Bearer ${accessToken}`, 'x-ads-region': (region || 'US').toUpperCase() }
    });
    return response.data;
};
service.getClashTests = async (containerId, accessToken, region = 'US') => {
    try {
        const response = await axios.get(`${COORDINATION_API_BASE}/containers/${containerId}/clash-tests`, {
            headers: { 'Authorization': `Bearer ${accessToken}`, 'x-ads-region': (region || 'US').toUpperCase() }
        });
        return response.data;
    } catch (e) { if (e.response?.status === 404) return { results: [] }; throw e; }
};
service.getClashResults = async (containerId, testId, accessToken, region = 'US') => {
    const response = await axios.get(`${COORDINATION_API_BASE}/containers/${containerId}/clash-tests/${testId}/clash-results`, {
        headers: { 'Authorization': `Bearer ${accessToken}`, 'x-ads-region': (region || 'US').toUpperCase() }
    });
    return response.data;
};

service.generateCodeVerifier = generateCodeVerifier;
service.generateCodeChallenge = generateCodeChallenge;
