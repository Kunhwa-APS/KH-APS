/**
 * Google Gemini Adapter (with auto fallback on 404/429)
 */
'use strict';

const axios = require('axios');

const FALLBACK_MODELS = ['gemini-2.0-flash', 'gemini-flash-latest', 'gemini-pro-latest'];

module.exports = {
    name: 'gemini',
    isConfigured: () => !!process.env.GEMINI_API_KEY,

    async chat({ messages, systemPrompt, options = {} }, retry = 0) {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) throw new Error('GEMINI_API_KEY not set');

        const model = options.model || FALLBACK_MODELS[retry] || FALLBACK_MODELS[FALLBACK_MODELS.length - 1];
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

        // OpenAI 포맷 → Gemini 포맷
        const contents = messages.map((m) => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: m.content }],
        }));

        const payload = {
            systemInstruction: { parts: [{ text: systemPrompt }] },
            contents,
            generationConfig: {
                maxOutputTokens: options.maxTokens || 2048,
                temperature: options.temperature ?? 0.3,
            },
        };

        try {
            const { data } = await axios.post(url, payload, {
                headers: { 'Content-Type': 'application/json' },
                timeout: 60_000,
            });
            return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
        } catch (err) {
            const status = err.response?.status;
            const retryable = status === 404 || status === 429;
            if (retryable && retry < FALLBACK_MODELS.length - 1) {
                const delay = status === 429 ? 2 ** retry * 1000 : 100;
                console.warn(`[gemini] ${status} → retry #${retry + 1} in ${delay}ms`);
                await new Promise((r) => setTimeout(r, delay));
                return module.exports.chat({ messages, systemPrompt, options }, retry + 1);
            }
            throw err;
        }
    },
};
