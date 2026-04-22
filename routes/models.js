/**
 * Models Routes — OSS 버킷 모델 목록 · 업로드 · 변환
 * (server.js에서 /api/models prefix 로 마운트됨)
 */
const express = require('express');
const formidable = require('express-formidable');
const {
    listObjects,
    uploadObject,
    translateObject,
    getManifest,
    urnify,
} = require('../services/aps.js');
const { asyncHandler, AppError } = require('../middleware');

const router = express.Router();

// ── GET /api/models ────────────────────────────────────────────
router.get('/', asyncHandler(async (req, res) => {
    const objects = await listObjects();
    res.json(objects.map((o) => ({ name: o.objectKey, urn: urnify(o.objectId) })));
}));

// ── GET /api/models/:urn/status ───────────────────────────────
router.get('/:urn/status', asyncHandler(async (req, res) => {
    const manifest = await getManifest(req.params.urn);
    if (!manifest) return res.json({ status: 'n/a' });

    const messages = (manifest.derivatives || []).flatMap((d) => [
        ...(d.messages || []),
        ...((d.children || []).flatMap((c) => c.messages || [])),
    ]);
    res.json({ status: manifest.status, progress: manifest.progress, messages });
}));

// ── POST /api/models ──────────────────────────────────────────
router.post('/', formidable({ maxFileSize: Infinity }), asyncHandler(async (req, res) => {
    const file = req.files?.['model-file'];
    if (!file) throw new AppError('필수 필드 "model-file" 이 누락되었습니다.', 400, 'VALIDATION_ERROR');

    const obj = await uploadObject(file.name, file.path);
    await translateObject(urnify(obj.objectId), req.fields?.['model-zip-entrypoint']);
    res.json({ name: obj.objectKey, urn: urnify(obj.objectId) });
}));

module.exports = router;
