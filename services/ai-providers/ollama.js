/**
 * Ollama (Local LLM) Adapter
 */
'use strict';

module.exports = {
    name: 'ollama',
    isConfigured: () => true, // 로컬 실행이므로 항상 시도 가능

    async chat({ messages, systemPrompt, options = {} }) {
        const host = process.env.OLLAMA_HOST || 'http://localhost:11434';
        const model = options.model || process.env.OLLAMA_MODEL || 'llama3';

        const { Ollama } = require('ollama');
        const ollama = new Ollama({ host });

        try {
            const resp = await ollama.chat({
                model,
                messages: [{ role: 'system', content: systemPrompt }, ...messages],
                stream: false,
                options: {
                    temperature: options.temperature ?? 0.3,
                    num_predict: options.maxTokens || 2048,
                },
            });
            return resp.message?.content || '';
        } catch (err) {
            if (String(err.message).includes('ECONNREFUSED')) {
                throw new Error(`Ollama connection failed at ${host}. Run 'ollama serve' first.`);
            }
            throw err;
        }
    },
};
