const { AuthenticationClient, ResponseType } = require('@aps_sdk/authentication');
const { DataManagementClient } = require('@aps_sdk/data-management');
const {
    APS_CLIENT_ID,
    APS_CLIENT_SECRET,
    APS_CALLBACK_URL,
    INTERNAL_TOKEN_SCOPES,
    PUBLIC_TOKEN_SCOPES
} = require('../config.js');

const authenticationClient = new AuthenticationClient();
const dataManagementClient = new DataManagementClient();

const service = module.exports = {};

// ───────────────────────────────────────────────
// 2-Legged OAuth (Server-to-Server)
//   · 액세스 토큰을 프로세스 메모리에 캐시 — 만료 60초 전까지 재사용
//   · 동시 요청시 토큰 발급 API가 1회만 호출되도록 inflight 공유
// ───────────────────────────────────────────────
let _twoLeggedCache = null;       // { token, expiresAt }
let _twoLeggedInflight = null;    // Promise<string>
const _SKEW_MS = 60 * 1000;

service.getInternalTwoLeggedToken = async () => {
    const now = Date.now();
    if (_twoLeggedCache && _twoLeggedCache.expiresAt - _SKEW_MS > now) {
        return _twoLeggedCache.token;
    }
    if (_twoLeggedInflight) return _twoLeggedInflight;

    _twoLeggedInflight = authenticationClient
        .getTwoLeggedToken(APS_CLIENT_ID, APS_CLIENT_SECRET, INTERNAL_TOKEN_SCOPES)
        .then((credentials) => {
            _twoLeggedCache = {
                token: credentials.access_token,
                expiresAt: Date.now() + credentials.expires_in * 1000,
            };
            return credentials.access_token;
        })
        .finally(() => { _twoLeggedInflight = null; });

    return _twoLeggedInflight;
};

// ───────────────────────────────────────────────
// 3-Legged OAuth
// ───────────────────────────────────────────────

/**
 * Autodesk 로그인 페이지로 리다이렉트할 URL 생성
 * @param {string} [callbackUrl] - 동적으로 결정된 콜백 URL (없으면 .env 값 사용)
 */
service.getAuthorizationUrl = (callbackUrl) => {
    const redirectUri = callbackUrl || APS_CALLBACK_URL;
    const url = authenticationClient.authorize(
        APS_CLIENT_ID,
        ResponseType.Code,
        redirectUri,
        INTERNAL_TOKEN_SCOPES
    );
    console.log('[APS] Authorization URL generated with callback:', redirectUri);
    return url;
};

/**
 * OAuth 콜백 처리 - 인증 코드로 토큰 교환
 * @param {string} [callbackUrl] - 로그인 시에 사용한 콜백 URL
 */
service.authCallbackMiddleware = async (req, res, next, callbackUrl) => {
    const redirectUri = callbackUrl || APS_CALLBACK_URL;
    console.log('[APS] OAuth callback - using redirect_uri:', redirectUri);
    console.log('[APS] OAuth callback - query params:', JSON.stringify(req.query));

    // Autodesk가 에러를 반환한 경우
    if (req.query.error) {
        console.error('[APS] OAuth error from Autodesk:', req.query.error, '-', req.query.error_description);
        return next(new Error(`Autodesk OAuth error: ${req.query.error} - ${req.query.error_description || ''}`));
    }

    // code 파라미터 누락
    if (!req.query.code) {
        console.error('[APS] OAuth callback missing code. Full URL:', req.originalUrl);
        return next(new Error('Authorization code not received. Please try logging in again.'));
    }

    try {
        console.log('[APS] Exchanging code for tokens with redirect_uri:', redirectUri);
        const internalCredentials = await authenticationClient.getThreeLeggedToken(
            APS_CLIENT_ID,
            req.query.code,
            redirectUri,  // 로그인 시와 동일한 URI 필수
            { clientSecret: APS_CLIENT_SECRET }
        );
        console.log('[APS] Got internal token. Fetching public token...');
        const publicCredentials = await authenticationClient.refreshToken(
            internalCredentials.refresh_token,
            APS_CLIENT_ID,
            { clientSecret: APS_CLIENT_SECRET, scopes: PUBLIC_TOKEN_SCOPES }
        );
        req.session.public_token = publicCredentials.access_token;
        req.session.internal_token = internalCredentials.access_token;
        req.session.refresh_token = publicCredentials.refresh_token;
        req.session.expires_at = Date.now() + internalCredentials.expires_in * 1000;
        console.log('[APS] Login successful. Session stored.');
        next();
    } catch (err) {
        console.error('[APS] Token exchange failed:', err.message || err);
        next(err);
    }
};

/**
 * 세션 토큰 자동 갱신 미들웨어
 */
service.authRefreshMiddleware = async (req, res, next) => {
    const { refresh_token, expires_at } = req.session || {};
    if (!refresh_token) {
        return res.status(401).json({ error: 'Not authenticated. Please login first.' });
    }

    try {
        if (expires_at < Date.now()) {
            console.log('[APS] Token expired, refreshing...');
            const internalCredentials = await authenticationClient.refreshToken(
                refresh_token, APS_CLIENT_ID,
                { clientSecret: APS_CLIENT_SECRET, scopes: INTERNAL_TOKEN_SCOPES }
            );
            const publicCredentials = await authenticationClient.refreshToken(
                internalCredentials.refresh_token, APS_CLIENT_ID,
                { clientSecret: APS_CLIENT_SECRET, scopes: PUBLIC_TOKEN_SCOPES }
            );
            req.session.public_token = publicCredentials.access_token;
            req.session.internal_token = internalCredentials.access_token;
            req.session.refresh_token = publicCredentials.refresh_token;
            req.session.expires_at = Date.now() + internalCredentials.expires_in * 1000;
            console.log('[APS] Token refreshed.');
        }
        req.internalOAuthToken = {
            access_token: req.session.internal_token,
            expires_in: Math.round((req.session.expires_at - Date.now()) / 1000),
        };
        req.publicOAuthToken = {
            access_token: req.session.public_token,
            expires_in: Math.round((req.session.expires_at - Date.now()) / 1000),
        };
        next();
    } catch (err) {
        console.error('[APS] Token refresh failed:', err.message || err);
        req.session.destroy();
        return res.status(401).json({ error: 'Session expired. Please login again.' });
    }
};

/**
 * 로그인한 사용자 프로필 정보 조회
 */
service.getUserProfile = async (accessToken) => {
    const resp = await authenticationClient.getUserInfo(accessToken);
    return resp;
};

// ───────────────────────────────────────────────
// Data Management
// ───────────────────────────────────────────────

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

// ───────────────────────────────────────────────
// ACC Issues API (BIM 360 / ACC)
// ───────────────────────────────────────────────

/**
 * 프로젝트의 Issue Container ID를 가져옵니다.
 */
service.getIssueContainerInfo = async (hubId, projectId, accessToken) => {
    const response = await fetch(`https://developer.api.autodesk.com/project/v1/hubs/${hubId}/projects/${projectId}`, {
        headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    if (!response.ok) {
        throw new Error(`Failed to get project info: ${response.statusText}`);
    }
    const data = await response.json();
    const issuesRel = data.data?.relationships?.issues;
    if (issuesRel && issuesRel.data && issuesRel.data.id) {
        return issuesRel.data.id;
    }
    return null;
};

/**
 * Container ID를 사용하여 해당 프로젝트의 전체 이슈를 조회합니다.
 */
service.getProjectIssues = async (containerId, accessToken) => {
    const response = await fetch(`https://developer.api.autodesk.com/issues/v1/containers/${containerId}/issues`, {
        headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    if (!response.ok) {
        throw new Error(`Failed to get issues: ${response.statusText}`);
    }
    const data = await response.json();
    return data.results || data.data || [];
};
