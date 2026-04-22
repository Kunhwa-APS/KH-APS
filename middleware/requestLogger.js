/**
 * requestLogger
 * -------------
 * 요청 시작/완료를 구조화된 형태로 로그합니다.
 * 정적 자산과 헬스체크는 기본 제외해 노이즈를 줄입니다.
 */
const SKIP_PREFIX = ['/css/', '/js/', '/images/', '/assets/', '/favicon'];
const SKIP_EXACT = new Set(['/health']);

function shouldSkip(url) {
    if (SKIP_EXACT.has(url)) return true;
    return SKIP_PREFIX.some((p) => url.startsWith(p));
}

function requestLogger(req, res, next) {
    if (shouldSkip(req.originalUrl || req.url)) return next();

    const startedAt = Date.now();
    res.on('finish', () => {
        const ms = Date.now() - startedAt;
        const color = res.statusCode >= 500 ? '\x1b[31m' : res.statusCode >= 400 ? '\x1b[33m' : '\x1b[32m';
        const reset = '\x1b[0m';
        console.log(`${color}${res.statusCode}${reset} ${req.method.padEnd(5)} ${req.originalUrl} — ${ms}ms`);
    });
    next();
}

module.exports = requestLogger;
