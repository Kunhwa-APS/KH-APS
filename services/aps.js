'use strict';

const { AuthenticationClient, ResponseType } = require('@aps_sdk/authentication');
const { DataManagementClient } = require('@aps_sdk/data-management');
const { ModelDerivativeClient } = require('@aps_sdk/model-derivative');
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
const modelDerivativeClient = new ModelDerivativeClient();

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

service.getManifest = async (urn, accessToken) => {
    return modelDerivativeClient.getManifest(urn, { accessToken });
};

service.getHubs = async (accessToken) => {
    console.log('[APS Service] getHubs called.');
    try {
        // Try the SDK client first
        const resp = await dataManagementClient.getHubs({ accessToken });
        return resp.data;
    } catch (err) {
        console.warn('[APS Service] SDK getHubs failed (Breaker might be open). Trying raw fallback...', err.message);

        try {
            // Raw axios fallback to bypass SDK internal circuit breaker
            const response = await axios.get('https://developer.api.autodesk.com/project/v1/hubs', {
                headers: { 'Authorization': `Bearer ${accessToken}` }
            });
            return response.data.data;
        } catch (rawErr) {
            console.error('[APS Service] Raw getHubs fallback also failed:', rawErr.message);
            throw rawErr;
        }
    }
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

// Helper to safely encode URN to Base64 (URL-safe, no padding)
const safeBase64 = (str) => Buffer.from(str).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

service.getItemVersions = async (projectId, itemId, accessToken) => {
    try {
        console.log(`\n[APS SERVICE - DEBUG] getItemVersions START`);
        // RAW 데이터 출력 (사용자 요청)
        console.log(` [RAW DATA] Project ID: ${projectId}`);
        console.log(` [RAW DATA] Item ID:    ${itemId}`);

        // 정제 및 디코딩
        projectId = projectId?.trim();
        itemId = decodeURIComponent(itemId).trim();

        if (!itemId || itemId === 'null' || itemId === 'undefined') {
            throw new Error('ID가 유효하지 않습니다 (null/undefined)');
        }

        // 1단계: Version ID(vf.xxx)인 경우 상위 Item(Lineage) ID 추출
        if (itemId.includes(':dm.version:') || itemId.includes('vf.')) {
            console.log(` - Detected ID Type: VERSION`);
            console.log(` [FINAL URN for getVersion]: ${itemId}`);

            const versionInfo = await dataManagementClient.getVersion(projectId, itemId, { accessToken });
            const resolvedLineageId = versionInfo.data?.relationships?.item?.data?.id;
            console.log(` - Resolved Lineage Item ID: ${resolvedLineageId}`);
            if (!resolvedLineageId) throw new Error('Lineage ID를 찾을 수 없습니다.');

            // 2단계: Lineage ID는 ?version=x가 없어야 함
            itemId = resolvedLineageId.split('?')[0];
        } else {
            console.log(` - Detected ID Type: ITEM (Lineage)`);
            itemId = itemId.split('?')[0];
        }

        console.log(` [FINAL URN for getItemVersions]: ${itemId}`);

        const resp = await dataManagementClient.getItemVersions(projectId, itemId, { accessToken });
        console.log(` - Success! Found ${resp.data?.length || 0} versions.`);
        return resp.data;
    } catch (err) {
        console.error('\n[APS SERVICE - ERROR] getItemVersions FAILED');
        console.error(` - Error Message: ${err.message}`);
        if (err.response) {
            console.error(` - Status: ${err.response.status}`);
            console.error(` - Data:   ${JSON.stringify(err.response.data)}`);
        }
        throw new Error(`유효한 파일 ID를 찾을 수 없습니다. (상세: ${err.message})`);
    }
};

service.updateVersionDescription = async (projectId, versionId, description, accessToken) => {
    try {
        const payload = {
            data: {
                type: 'versions',
                id: versionId,
                attributes: {
                    extension: {
                        data: {
                            description: description
                        }
                    }
                }
            }
        };
        const url = `https://developer.api.autodesk.com/data/v1/projects/${projectId}/versions/${encodeURIComponent(versionId)}`;
        const config = {
            method: 'patch',
            url,
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/vnd.api+json'
            },
            data: payload
        };
        const response = await axios(config);
        return response.data;
    } catch (err) {
        console.error('[APS SERVICE] updateVersionDescription failed:', err.response?.data || err.message);
        throw err;
    }
};
const MODEL_PROPS_API_BASE = 'https://developer.api.autodesk.com/modelproperties/v2';

function getCleanProjectId(projectId) {
    return projectId.startsWith('b.') ? projectId.substring(2) : projectId;
}
function getRawProjectId(projectId) {
    return projectId.startsWith('b.') ? projectId : `b.${projectId}`;
}

async function adaptiveCall(projectId, method, path, data, accessToken, region = 'US') {
    const inputRegion = (region || 'US').toUpperCase();
    const otherRegion = inputRegion === 'US' ? 'EMEA' : 'US';
    const cleanId = getCleanProjectId(projectId);
    const rawId = getRawProjectId(projectId);

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
            return response.data;
        } catch (err) {
            lastError = err;
            if (err.response?.status !== 404) break;
        }
    }
    throw lastError;
}

service.getIndexStatus = async (projectId, versionUrn, accessToken, region = 'US') => {
    try {
        const path = `/indexes?versionUrn=${encodeURIComponent(versionUrn)}`;
        const data = await adaptiveCall(projectId, 'get', path, null, accessToken, region);
        const indexes = data.indexes || [];
        const finished = indexes.find(idx => idx.state === 'finished' || idx.state === 'done');
        const processing = indexes.find(idx => idx.state === 'processing' || idx.state === 'indexing');
        if (finished) return { state: 'finished', indexId: finished.indexId };
        if (processing) return { state: 'processing', indexId: processing.indexId };
        return { state: 'none' };
    } catch (err) {
        return { state: 'none' };
    }
};

service.requestIndexing = async (projectId, versionUrn, accessToken, region = 'US') => {
    const status = await service.getIndexStatus(projectId, versionUrn, accessToken, region);
    if (status.state === 'finished') return { state: 'finished' };
    if (status.state === 'processing') return { state: 'processing' };
    try {
        const payload = { versions: [versionUrn] };
        return await adaptiveCall(projectId, 'post', '/indexes', payload, accessToken, region);
    } catch (err) {
        throw err;
    }
};

service.requestVersionDiff = async (projectId, prevVersionUrn, curVersionUrn, accessToken, region = 'US') => {
    try {
        await service.requestIndexing(projectId, prevVersionUrn, accessToken, region);
        await service.requestIndexing(projectId, curVersionUrn, accessToken, region);
        const payload = {
            prevVersion: { urn: prevVersionUrn },
            curVersion: { urn: curVersionUrn }
        };
        return await adaptiveCall(projectId, 'post', '/diffs', payload, accessToken, region);
    } catch (err) {
        throw err;
    }
};

service.getDiffStatus = async (projectId, diffId, accessToken, region = 'US') => {
    return await adaptiveCall(projectId, 'get', `/diffs/${diffId}`, null, accessToken, region);
};

service.getDiffResults = async (projectId, diffId, accessToken, region = 'US') => {
    return await adaptiveCall(projectId, 'get', `/diffs/${diffId}/properties`, null, accessToken, region);
};

// ── Model Coordination & ModelSet API ───────────────────────────────────────
const COORDINATION_API_BASE = 'https://developer.api.autodesk.com/modelcoordination/v1';
const MODELSET_API_BASE = 'https://developer.api.autodesk.com/modelset/v1';

service.getClashContainers = async (projectId, accessToken, region = 'US') => {
    const cleanProjectId = getCleanProjectId(projectId);
    const rawProjectId = getRawProjectId(projectId);
    const idsToTry = [cleanProjectId, rawProjectId];
    let lastErr = null;
    for (const pid of idsToTry) {
        try {
            const response = await axios.get(`${COORDINATION_API_BASE}/projects/${pid}/containers`, {
                headers: { 'Authorization': `Bearer ${accessToken}`, 'x-ads-region': (region || 'US').toUpperCase() }
            });
            return response.data;
        } catch (err) {
            lastErr = err;
            if (err.response?.status !== 404) break;
        }
    }
    throw lastErr;
};
service.getClashTests = async (containerId, accessToken, region = 'US') => {
    try {
        const response = await axios.get(`${MODELSET_API_BASE}/containers/${containerId}/modelsets`, {
            headers: { 'Authorization': `Bearer ${accessToken}`, 'x-ads-region': (region || 'US').toUpperCase() }
        });
        return { results: response.data.modelSets || [] };
    } catch (e) {
        if (e.response?.status === 404) return { results: [] };
        throw e;
    }
};
service.getClashResults = async (containerId, testId, accessToken, region = 'US') => {
    const paths = [
        `/containers/${containerId}/modelsets/${testId}/clash-results`,
        `/containers/${containerId}/clash-tests/${testId}/clash-results`
    ];
    let lastErr = null;
    for (const path of paths) {
        try {
            const response = await axios.get(`${COORDINATION_API_BASE}${path}`, {
                headers: { 'Authorization': `Bearer ${accessToken}`, 'x-ads-region': (region || 'US').toUpperCase() }
            });
            return response.data;
        } catch (err) {
            lastErr = err;
            if (err.response?.status !== 404) break;
        }
    }
    throw lastErr;
};

service.generateCodeVerifier = generateCodeVerifier;
service.generateCodeChallenge = generateCodeChallenge;
