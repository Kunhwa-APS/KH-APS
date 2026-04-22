/**
 * APS AI Platform — HTTP entry point
 * ----------------------------------
 *  · 설정 로드 및 검증 (./config.js)
 *  · 보안 헤더, 요청 로거 적용
 *  · 라우트 마운트
 *  · 표준화된 404 / 에러 응답
 */
const express = require('express');
const session = require('express-session');
const path = require('path');

const config = require('./config.js');
const {
    errorHandler,
    notFoundHandler,
    securityHeaders,
    requestLogger,
} = require('./middleware');

const app = express();
app.disable('x-powered-by');

// ── 전역 미들웨어 ──────────────────────────────────────────────
app.use(securityHeaders);
app.use(requestLogger);
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// 정적 자산 (캐시 정책 포함)
app.use(express.static(path.join(__dirname, 'public'), {
    maxAge: config.env === 'production' ? '1d' : 0,
    etag: true,
}));

// 세션
app.use(session({
    secret: config.session.secret,
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: config.env === 'production',
        maxAge: config.session.maxAge,
    },
}));

// ── 헬스체크 ───────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({
    status: 'ok',
    env: config.env,
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
}));

// ── API 라우트 ─────────────────────────────────────────────────
app.use(require('./routes/auth.js'));
app.use(require('./routes/hubs.js'));
app.use(require('./routes/diff.js'));
app.use(require('./routes/clash.js'));
app.use(require('./routes/issues.js'));
app.use('/api/models', require('./routes/models.js'));
app.use('/api/ai', require('./routes/ai.js'));
app.use(require('./routes/memos.js'));

const { geocodeRouter } = require('./routes/tiles.js');
app.use(require('./routes/tiles.js'));
app.use(geocodeRouter);

// ── 404 및 에러 처리 ───────────────────────────────────────────
// API 경로에만 JSON 404 반환 — 그 외는 SPA로 넘깁니다.
app.use('/api', notFoundHandler);
app.use(errorHandler);

// ── 서버 기동 ──────────────────────────────────────────────────
const server = app.listen(config.port, () => {
    console.log('');
    console.log('  ╭────────────────────────────────────────────╮');
    console.log(`  │  APS AI Platform — ${String(config.env).padEnd(22)}│`);
    console.log(`  │  http://localhost:${String(config.port).padEnd(24)}│`);
    console.log('  ╰────────────────────────────────────────────╯');
    console.log('');
});

// 안전한 종료
['SIGTERM', 'SIGINT'].forEach((sig) => {
    process.on(sig, () => {
        console.log(`\n[${sig}] Graceful shutdown…`);
        server.close(() => process.exit(0));
        setTimeout(() => process.exit(1), 10_000).unref();
    });
});

process.on('unhandledRejection', (reason) => {
    console.error('[unhandledRejection]', reason);
});
process.on('uncaughtException', (err) => {
    console.error('[uncaughtException]', err);
});

module.exports = app;
