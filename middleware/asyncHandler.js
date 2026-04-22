/**
 * asyncHandler
 * ------------
 * async 라우트 핸들러의 예외를 자동으로 next(err)로 전달합니다.
 * 매 라우트마다 try/catch를 반복 작성하지 않아도 됩니다.
 *
 *   router.get('/x', asyncHandler(async (req, res) => { ... }));
 */
module.exports = function asyncHandler(fn) {
    return function wrappedAsyncHandler(req, res, next) {
        Promise.resolve(fn(req, res, next)).catch(next);
    };
};
