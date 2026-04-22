/**
 * AI Routes — OpenAI / Gemini / Ollama 통합 엔드포인트
 */
'use strict';

const express = require('express');
const aiService = require('../services/ai');
const config = require('../config.js');
const { asyncHandler, AppError, rateLimit } = require('../middleware');

const router = express.Router();

// AI 엔드포인트는 비용이 높으므로 IP 당 분당 30회로 제한
router.use(rateLimit({ windowMs: 60_000, max: 30, message: 'AI 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.' }));

// ── POST /api/ai/analyze ───────────────────────────────────────
router.post('/analyze', asyncHandler(async (req, res) => {
    const { modelData, question, context } = req.body || {};
    if (!question) throw new AppError('question is required', 400, 'VALIDATION_ERROR');
    const answer = await aiService.analyzeModel({ modelData, question, context });
    res.json({ answer, timestamp: new Date().toISOString() });
}));

// ── POST /api/ai/summarize ─────────────────────────────────────
router.post('/summarize', asyncHandler(async (req, res) => {
    const { elements, urn } = req.body || {};
    if (!Array.isArray(elements) || elements.length === 0) {
        throw new AppError('elements array is required', 400, 'VALIDATION_ERROR');
    }
    const summary = await aiService.summarizeElements({ elements, urn });
    res.json({ summary, timestamp: new Date().toISOString() });
}));

// ── POST /api/ai/chat ──────────────────────────────────────────
router.post('/chat', asyncHandler(async (req, res) => {
    const { messages, systemContext } = req.body || {};
    if (!Array.isArray(messages) || messages.length === 0) {
        throw new AppError('messages array is required', 400, 'VALIDATION_ERROR');
    }
    const reply = await aiService.chat({ messages, systemContext });
    res.json({ reply, timestamp: new Date().toISOString() });
}));

// ── GET /api/ai/provider ───────────────────────────────────────
router.get('/provider', (req, res) => {
    res.json({
        provider: process.env.AI_PROVIDER || 'not configured',
        hasOpenAI: !!config.ai.openaiKey,
        hasGemini: !!config.ai.geminiKey,
        ollama: {
            configured: !!process.env.OLLAMA_HOST,
            host: config.ai.ollamaHost,
            model: process.env.OLLAMA_MODEL || 'llama3',
        },
    });
});

module.exports = router;
