/**
 * security
 * --------
 * 경량 보안 헤더 미들웨어 (helmet 미사용 환경용).
 * - X-Content-Type-Options: MIME 스니핑 방지
 * - X-Frame-Options: 클릭재킹 방지 (Forge Viewer 호환을 위해 SAMEORIGIN)
 * - Referrer-Policy: 크로스 오리진 레퍼러 정보 최소화
 * - X-XSS-Protection: 구형 브라우저용
 */
function securityHeaders(req, res, next) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Permissions-Policy', 'geolocation=(self), camera=(), microphone=()');
    next();
}

module.exports = { securityHeaders };
