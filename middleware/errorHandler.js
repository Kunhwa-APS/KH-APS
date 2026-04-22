/**
 * errorHandler
 * ------------
 * 모든 에러를 일관된 JSON 포맷으로 응답합니다.
 *   { error: { message, code, details? } }
 *
 * - AppError(HTTP 상태 + 코드) 지원
 * - 개발 환경에서는 스택 트레이스 포함
 * - 민감한 정보 필터링 (토큰/비밀번호 필드 제거)
 */
class AppError extends Error {
    constructor(message, statusCode = 500, code = 'INTERNAL_ERROR', details = null) {
        super(message);
        this.name = 'AppError';
        this.statusCode = statusCode;
        this.code = code;
        this.details = details;
    }
}

function notFoundHandler(req, res, next) {
    next(new AppError(`Not Found: ${req.method} ${req.originalUrl}`, 404, 'NOT_FOUND'));
}

function errorHandler(err, req, res, next) {
    const isDev = process.env.NODE_ENV !== 'production';

    const status = err.statusCode || err.status || 500;
    const code = err.code || (status === 404 ? 'NOT_FOUND' : status === 401 ? 'UNAUTHORIZED' : 'INTERNAL_ERROR');
    const message = err.message || 'Internal Server Error';

    // 구조화 로그 (5xx만 에러, 4xx는 warn)
    const logFn = status >= 500 ? console.error : console.warn;
    logFn(`[${new Date().toISOString()}] ${status} ${code} ${req.method} ${req.originalUrl} — ${message}`);
    if (status >= 500 && err.stack) console.error(err.stack);

    const body = { error: { message, code } };
    if (err.details) body.error.details = err.details;
    if (isDev && err.stack) body.error.stack = err.stack.split('\n').slice(0, 6);

    res.status(status).json(body);
}

module.exports = { AppError, errorHandler, notFoundHandler };
