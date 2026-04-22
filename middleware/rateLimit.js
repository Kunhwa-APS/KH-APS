/**
 * Rate Limiter (fixed-window, in-memory)
 * ---------------------------------------
 *  - IP 기준 요청 카운트
 *  - 남용 가능성이 높은 엔드포인트 (AI, PDF export 등) 보호용
 *  - 멀티 인스턴스 환경에서는 Redis 기반 구현 권장
 *
 *  사용 예:
 *    router.post('/expensive', rateLimit({ windowMs: 60_000, max: 20 }), handler);
 */
'use strict';

function rateLimit({ windowMs = 60_000, max = 60, message = 'Too many requests, please slow down.' } = {}) {
    const hits = new Map(); // ip -> { count, expiresAt }

    // 주기적 청소
    const sweep = setInterval(() => {
        const now = Date.now();
        for (const [ip, rec] of hits) if (rec.expiresAt <= now) hits.delete(ip);
    }, Math.max(windowMs, 30_000));
    sweep.unref?.();

    return function rateLimitMiddleware(req, res, next) {
        const ip = req.ip
            || req.headers['x-forwarded-for']?.split(',')[0].trim()
            || req.connection?.remoteAddress
            || 'unknown';

        const now = Date.now();
        const rec = hits.get(ip);

        if (!rec || rec.expiresAt <= now) {
            hits.set(ip, { count: 1, expiresAt: now + windowMs });
            res.setHeader('X-RateLimit-Limit', max);
            res.setHeader('X-RateLimit-Remaining', max - 1);
            return next();
        }

        rec.count += 1;
        res.setHeader('X-RateLimit-Limit', max);
        res.setHeader('X-RateLimit-Remaining', Math.max(0, max - rec.count));

        if (rec.count > max) {
            const retryAfter = Math.ceil((rec.expiresAt - now) / 1000);
            res.setHeader('Retry-After', retryAfter);
            return res.status(429).json({
                error: { message, code: 'RATE_LIMITED', retryAfter },
            });
        }
        next();
    };
}

module.exports = rateLimit;
