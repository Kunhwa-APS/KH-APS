'use strict';

const express = require('express');
const router = express.Router();
const aiService = require('../services/ai');

// ── POST /api/ai/analyze  → Analyze model metadata ─────────────────────────
// Body: { modelData: {...}, question: "..." }
router.post('/analyze', async (req, res, next) => {
    try {
        const { modelData, question, context } = req.body;
        if (!question) {
            return next({ status: 400, message: 'question is required' });
        }
        const result = await aiService.analyzeModel({ modelData, question, context });
        res.json({ answer: result, timestamp: new Date().toISOString() });
    } catch (err) {
        console.error('[AI] analyze error:', err.message);
        next({ status: 500, message: 'AI analysis failed: ' + err.message });
    }
});

// ── POST /api/ai/summarize  → Summarize selected elements ──────────────────
// Body: { elements: [...], urn: "..." }
router.post('/summarize', async (req, res, next) => {
    try {
        const { elements, urn } = req.body;
        if (!elements || !elements.length) {
            return next({ status: 400, message: 'elements array is required' });
        }
        const summary = await aiService.summarizeElements({ elements, urn });
        res.json({ summary, timestamp: new Date().toISOString() });
    } catch (err) {
        console.error('[AI] summarize error:', err.message);
        next({ status: 500, message: 'AI summarization failed: ' + err.message });
    }
});

// ── POST /api/ai/chat  → Multi-turn conversation ────────────────────────────
// Body: { messages: [{role, content}], systemContext: "..." }
router.post('/chat', async (req, res, next) => {
    try {
        const { messages, systemContext } = req.body;
        if (!messages || !messages.length) {
            return next({ status: 400, message: 'messages array is required' });
        }
        const reply = await aiService.chat({ messages, systemContext });
        res.json({ reply, timestamp: new Date().toISOString() });
    } catch (err) {
        console.error('[AI] chat error:', err.message);
        next({ status: 500, message: 'AI chat failed: ' + err.message });
    }
});

// ── GET /api/ai/provider  → currently configured provider ──────────────────
router.get('/provider', (req, res) => {
    res.json({
        provider: process.env.AI_PROVIDER || 'not configured',
        hasOpenAI: !!process.env.OPENAI_API_KEY,
        hasGemini: !!process.env.GEMINI_API_KEY,
        ollama: {
            configured: !!process.env.OLLAMA_HOST,
            host: process.env.OLLAMA_HOST || 'http://localhost:11434',
            model: process.env.OLLAMA_MODEL || 'llama3'
        }
    });
});

module.exports = router;
