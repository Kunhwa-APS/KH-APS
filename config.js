/**
 * Application Configuration
 * -------------------------
 * 환경 변수 로드·검증·구조화된 내보내기.
 * 필수 값이 없으면 즉시 프로세스를 종료해 잘못된 런타임을 예방합니다.
 */
const { Scopes } = require('@aps_sdk/authentication');
require('dotenv').config();

// ── 필수 환경 변수 목록 ─────────────────────────────────────────
const REQUIRED_ENV = ['APS_CLIENT_ID', 'APS_CLIENT_SECRET', 'APS_CALLBACK_URL', 'SERVER_SESSION_SECRET'];

const missing = REQUIRED_ENV.filter((key) => !process.env[key]);
if (missing.length) {
    console.error('\n[config] ❌ Missing required environment variables:');
    missing.forEach((k) => console.error(`   - ${k}`));
    console.error('\n→ .env 파일 혹은 시스템 환경 변수를 확인해 주세요.\n');
    process.exit(1);
}

// ── 구조화된 설정 ──────────────────────────────────────────────
const config = {
    env: process.env.NODE_ENV || 'development',
    port: parseInt(process.env.PORT, 10) || 8080,

    // APS (Autodesk Platform Services)
    aps: {
        clientId: process.env.APS_CLIENT_ID,
        clientSecret: process.env.APS_CLIENT_SECRET,
        callbackUrl: process.env.APS_CALLBACK_URL,
        internalScopes: [Scopes.DataRead, Scopes.ViewablesRead, Scopes.AccountRead],
        publicScopes: [Scopes.ViewablesRead],
    },

    // 세션
    session: {
        secret: process.env.SERVER_SESSION_SECRET,
        maxAge: 24 * 60 * 60 * 1000, // 24시간
    },

    // 외부 서비스 (선택)
    maps: {
        vworldKey: process.env.VWORLD_API_KEY || '',
        googleKey: process.env.GOOGLE_MAPS_API_KEY || '',
    },
    ai: {
        openaiKey: process.env.OPENAI_API_KEY || '',
        geminiKey: process.env.GEMINI_API_KEY || '',
        ollamaHost: process.env.OLLAMA_HOST || 'http://localhost:11434',
    },
};

// ── 이전 코드 호환용 평면 내보내기 (legacy) ──────────────────────
module.exports = {
    ...config,

    // legacy 호환 (기존 require 형태 유지)
    APS_CLIENT_ID: config.aps.clientId,
    APS_CLIENT_SECRET: config.aps.clientSecret,
    APS_CALLBACK_URL: config.aps.callbackUrl,
    SERVER_SESSION_SECRET: config.session.secret,
    INTERNAL_TOKEN_SCOPES: config.aps.internalScopes,
    PUBLIC_TOKEN_SCOPES: config.aps.publicScopes,
    PORT: config.port,
};
