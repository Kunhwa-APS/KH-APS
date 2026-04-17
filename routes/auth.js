const express = require('express');
const { getAuthorizationUrl, authCallbackMiddleware, authRefreshMiddleware, getUserProfile } = require('../services/aps.js');

let router = express.Router();

/**
 * 요청 정보에서 동적으로 콜백 URL을 생성합니다.
 * ngrok / localhost 환경 모두 자동 대응합니다.
 */
function getDynamicCallbackUrl(req) {
    const forwardedHost = req.headers['x-forwarded-host'] || req.headers['x-original-host'];
    const forwardedProto = req.headers['x-forwarded-proto'] || 'http';

    if (forwardedHost) {
        return `${forwardedProto}://${forwardedHost}/api/auth/callback`;
    }

    const protocol = req.secure ? 'https' : req.headers['x-forwarded-proto'] || 'http';
    const host = req.headers.host;
    return `${protocol}://${host}/api/auth/callback`;
}

/**
 * GET /api/auth/login
 * Autodesk 로그인 페이지로 리다이렉트 (동적 콜백 URL 사용)
 */
router.get('/api/auth/login', function (req, res) {
    const callbackUrl = getDynamicCallbackUrl(req);
    console.log('[Auth] Dynamic callback URL for login:', callbackUrl);
    const url = getAuthorizationUrl(callbackUrl);
    res.redirect(url);
});

/**
 * GET /api/config/maps
 */
router.get('/api/config/maps', function (req, res) {
    const key = process.env.VWORLD_API_KEY || process.env.GOOGLE_MAPS_API_KEY || '';
    res.json({ apiKey: key });
});

/**
 * GET /api/debug
 */
router.get('/api/debug', function (req, res) {
    const { APS_CLIENT_ID, APS_CALLBACK_URL } = require('../config.js');
    const authUrl = getAuthorizationUrl();
    const parsed = new URL(authUrl);
    res.json({
        client_id: APS_CLIENT_ID,
        callback_url_configured: APS_CALLBACK_URL,
        authorize_url: authUrl,
        params: {
            response_type: parsed.searchParams.get('response_type'),
            redirect_uri: parsed.searchParams.get('redirect_uri'),
            scope: parsed.searchParams.get('scope'),
            client_id: parsed.searchParams.get('client_id'),
        },
        checklist: {
            step1: `Go to https://aps.autodesk.com/myapps`,
            step2: `Find app with client_id: ${APS_CLIENT_ID}`,
            step3: `In "General Settings", add Callback URL: ${APS_CALLBACK_URL}`,
            step4: `App must be "Traditional Web Application" type`,
        }
    });
});

/**
 * GET /api/auth/logout
 */
router.get('/api/auth/logout', function (req, res) {
    req.session.destroy((err) => {
        if (err) console.error('Session destroy error:', err);
        res.redirect('/');
    });
});

/**
 * Autodesk 인증 후 콜백 처리 (동적 콜백 URL 사용)
 */
router.get('/api/auth/callback', function (req, res, next) {
    const callbackUrl = getDynamicCallbackUrl(req);
    console.log('[Auth] Dynamic callback URL for token exchange:', callbackUrl);
    authCallbackMiddleware(req, res, next, callbackUrl);
}, function (req, res) {
    res.redirect('/');
});

/**
 * GET /api/auth/token
 */
router.get('/api/auth/token', authRefreshMiddleware, function (req, res) {
    res.json(req.publicOAuthToken);
});

/**
 * GET /api/auth/profile
 */
router.get('/api/auth/profile', authRefreshMiddleware, async function (req, res, next) {
    try {
        const profile = await getUserProfile(req.internalOAuthToken.access_token);
        res.json({ name: `${profile.name}` });
    } catch (err) {
        next(err);
    }
});

module.exports = router;
