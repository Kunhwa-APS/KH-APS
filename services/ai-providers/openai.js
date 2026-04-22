/**
 * OpenAI Chat Completions Adapter
 */
'use strict';

const axios = require('axios');

module.exports = {
    name: 'openai',
    isConfigured: () => !!process.env.OPENAI_API_KEY,

    async chat({ messages, systemPrompt, options = {} }) {
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) throw new Error('OPENAI_API_KEY not set');

        const payload = {
            model: options.model || process.env.OPENAI_MODEL || 'gpt-4o-mini',
            messages: [
                { role: 'system', content: systemPrompt },
                ...messages,
            ],
            max_tokens: options.maxTokens || 2048,
            temperature: options.temperature ?? 0.3,
        };

        const { data } = await axios.post(
            'https://api.openai.com/v1/chat/completions',
            payload,
            {
                headers: {
                    // ⚠ Bearer 뒤에 trailing space 금지
                    Authorization: `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                },
                timeout: 60_000,
            }
        );
        return data.choices?.[0]?.message?.content ?? '';
    },
};
