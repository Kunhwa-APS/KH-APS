const express = require('express');
const { getAuthorizationUrl, authCallbackMiddleware, authRefreshMiddleware, getUserProfile } = require('../services/aps.js');

let router = express.Router();

/**
 * 요청 정보에서 동적으로 콜백 URL을 생성합니다.
 * ngrok / localhost 환경 모두 자동 대응합니다.
 */
function getDynamicCallbackUrl(req) {
    // ngrok이나 다른 프록시 헤더가 있으면 원본 호스트를 사용
    const forwardedHost = req.headers['x-forwarded-host'] || req.headers['x-original-host'];
    const forwardedProto = req.headers['x-forwarded-proto'] || 'http';

    if (forwardedHost) {
        return `${forwardedProto}://${forwardedHost}/api/auth/callback`;
    }

    // 일반 요청인 경우 host 헤더 사용
    const protocol = req.secure ? 'https' : req.headers['x-forwarded-proto'] || 'http';
    const host = req.headers.host; // e.g. localhost:8080 or blushingly-esoteric-rosette.ngrok-free.dev
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
 * Google Maps/VWorld API 키를 프론트엔드에 제공
 */
router.get('/api/config/maps', function (req, res) {
    const key = process.env.VWORLD_API_KEY || process.env.GOOGLE_MAPS_API_KEY || '';
    // Placeholder checks removed to avoid 503 errors and breaking frontend UI
    res.json({ apiKey: key });
});

/**
 * GET /api/debug
 * 현재 OAuth 설정 진단 정보 (개발용)
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
 * 세션 삭제 후 메인 페이지로 리다이렉트
 */
router.get('/api/auth/logout', function (req, res) {
    req.session.destroy((err) => {
        if (err) console.error('Session destroy error:', err);
        res.redirect('/');
    });
});

/**
 * GET /api/auth/callback
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
 * Viewer용 공개 액세스 토큰 반환
 */
router.get('/api/auth/token', authRefreshMiddleware, function (req, res) {
    res.json(req.publicOAuthToken);
});

/**
 * GET /api/auth/profile
 * 로그인한 사용자 프로필 정보 반환
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
