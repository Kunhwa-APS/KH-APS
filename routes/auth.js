/**
 * Auth Routes
 * -----------
 *  · Autodesk 3-Legged OAuth 로그인/콜백/로그아웃
 *  · 세션 토큰 자동 갱신
 *  · 사용자 프로필, Maps API 키, 디버그 진단
 */
const express = require('express');
const config = require('../config.js');
const {
    getAuthorizationUrl,
    authCallbackMiddleware,
    authRefreshMiddleware,
    getUserProfile,
} = require('../services/aps.js');
const { asyncHandler } = require('../middleware');

const router = express.Router();

// ── 유틸: 동적 콜백 URL ────────────────────────────────────────
/**
 * ngrok / localhost / 프록시 환경을 자동 감지해 콜백 URL을 생성합니다.
 */
function buildDynamicCallbackUrl(req) {
    const forwardedHost = req.headers['x-forwarded-host'] || req.headers['x-original-host'];
    const forwardedProto = req.headers['x-forwarded-proto'] || 'http';
    if (forwardedHost) {
        return `${forwardedProto}://${forwardedHost}/api/auth/callback`;
    }
    const protocol = req.secure ? 'https' : (req.headers['x-forwarded-proto'] || 'http');
    const host = req.headers.host;
    return `${protocol}://${host}/api/auth/callback`;
}

// ── GET /api/auth/login ────────────────────────────────────────
router.get('/api/auth/login', (req, res) => {
    const callbackUrl = buildDynamicCallbackUrl(req);
    const url = getAuthorizationUrl(callbackUrl);
    res.redirect(url);
});

// ── GET /api/auth/callback ─────────────────────────────────────
router.get('/api/auth/callback',
    (req, res, next) => authCallbackMiddleware(req, res, next, buildDynamicCallbackUrl(req)),
    (req, res) => res.redirect('/')
);

// ── GET /api/auth/logout ───────────────────────────────────────
router.get('/api/auth/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) console.error('[auth] session destroy error:', err);
        res.redirect('/');
    });
});

// ── GET /api/auth/token ────────────────────────────────────────
router.get('/api/auth/token', authRefreshMiddleware, (req, res) => {
    res.json(req.publicOAuthToken);
});

// ── GET /api/auth/profile ──────────────────────────────────────
router.get('/api/auth/profile', authRefreshMiddleware, asyncHandler(async (req, res) => {
    const profile = await getUserProfile(req.internalOAuthToken.access_token);
    res.json({ name: profile.name });
}));

// ── GET /api/config/maps ───────────────────────────────────────
router.get('/api/config/maps', (req, res) => {
    const apiKey = config.maps.vworldKey || config.maps.googleKey || '';
    res.json({ apiKey });
});

// ── GET /api/debug (개발용 OAuth 진단) ─────────────────────────
router.get('/api/debug', (req, res) => {
    if (config.env === 'production') {
        return res.status(404).json({ error: { message: 'Not Found', code: 'NOT_FOUND' } });
    }
    const authUrl = getAuthorizationUrl();
    const parsed = new URL(authUrl);
    res.json({
        client_id: config.aps.clientId,
        callback_url_configured: config.aps.callbackUrl,
        authorize_url: authUrl,
        params: {
            response_type: parsed.searchParams.get('response_type'),
            redirect_uri: parsed.searchParams.get('redirect_uri'),
            scope: parsed.searchParams.get('scope'),
            client_id: parsed.searchParams.get('client_id'),
        },
        checklist: {
            step1: 'Go to https://aps.autodesk.com/myapps',
            step2: `Find app with client_id: ${config.aps.clientId}`,
            step3: `In "General Settings", add Callback URL: ${config.aps.callbackUrl}`,
            step4: 'App must be "Traditional Web Application" type',
        },
    });
});

module.exports = router;
