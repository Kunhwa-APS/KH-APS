'use strict';

const axios = require('axios');

const PROVIDER = () => process.env.AI_PROVIDER || 'gemini';

// ── System Prompt ────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are an expert AEC (Architecture, Engineering, and Construction) AI assistant 
integrated with Autodesk Platform Services (APS). You help users analyze BIM models, interpret 
model metadata, extract valuable insights from 3D designs, and answer questions about building 
components, materials, structural elements, and model properties.

When analyzing model data:
- Be concise and technically accurate
- Present data in a structured, readable format
- Highlight important findings or anomalies
- Use AEC industry terminology appropriately
- Provide actionable insights when possible`;

// ── OpenAI (GPT) ─────────────────────────────────────────────────────────────
async function callOpenAI(messages, systemPrompt) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('OPENAI_API_KEY not set in .env');

    const payload = {
        model: 'gpt-4o-mini',
        messages: [
            { role: 'system', content: systemPrompt || SYSTEM_PROMPT },
            ...messages
        ],
        max_tokens: 2048,
        temperature: 0.3
    };

    const response = await axios.post(
        'https://api.openai.com/v1/chat/completions',
        payload,
        { headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' } }
    );
    return response.data.choices[0].message.content;
}

// ── Google Gemini ─────────────────────────────────────────────────────────────
async function callGemini(messages, systemPrompt, retryCount = 0) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('GEMINI_API_KEY not set in .env');

    // Try available models in order of efficiency and likelihood of quota availability
    const availableModels = ['gemini-2.0-flash', 'gemini-flash-latest', 'gemini-pro-latest'];
    const model = availableModels[retryCount] || 'gemini-pro-latest';

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    console.log(`[AI] Calling Gemini: ${model} (Attempt: ${retryCount + 1})`);

    // Convert OpenAI-style messages to Gemini format
    const contents = messages.map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }]
    }));

    const payload = {
        systemInstruction: { parts: [{ text: systemPrompt || SYSTEM_PROMPT }] },
        contents,
        generationConfig: { maxOutputTokens: 2048, temperature: 0.3 }
    };

    try {
        const response = await axios.post(url, payload, {
            headers: { 'Content-Type': 'application/json' }
        });

        const resultText = response.data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!resultText) {
            console.error('[AI] Gemini response missing content:', JSON.stringify(response.data, null, 2));
            return 'Gemini response was empty or blocked.';
        }
        return resultText;
    } catch (err) {
        // Detailed error logging
        if (err.response) {
            console.error(`[AI] Gemini API Error (${err.response.status}):`, JSON.stringify(err.response.data, null, 2));
        } else {
            console.error('[AI] Gemini Request Error:', err.message);
        }

        // Handle 404 (Model not found) or 429 (Rate Limit) by retrying with fallback
        const isRetryable = err.response?.status === 404 || err.response?.status === 429;
        if (isRetryable && retryCount < 2) {
            const delay = err.response?.status === 429 ? (Math.pow(2, retryCount) * 1000) : 100;
            console.warn(`[AI] Error ${err.response?.status}. Retrying with fallback in ${delay}ms...`);
            await new Promise(resolve => setTimeout(resolve, delay));
            return callGemini(messages, systemPrompt, retryCount + 1);
        }

        throw err;
    }
}

// ── Dispatcher ────────────────────────────────────────────────────────────────
async function callAI(messages, systemPrompt) {
    const provider = PROVIDER();
    console.log(`[AI] Using provider: ${provider}`);
    if (provider === 'openai') return callOpenAI(messages, systemPrompt);
    if (provider === 'gemini') return callGemini(messages, systemPrompt);
    throw new Error(`Unknown AI provider: ${provider}. Set AI_PROVIDER=openai or AI_PROVIDER=gemini`);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Analyze model metadata and answer a question
 */
async function analyzeModel({ modelData, question, context }) {
    const userMessage = `
## BIM Model Data
${modelData ? JSON.stringify(modelData, null, 2) : 'No model data provided'}

## Additional Context
${context || 'None'}

## Question
${question}
`.trim();

    return callAI([{ role: 'user', content: userMessage }]);
}

/**
 * Summarize selected BIM elements
 */
async function summarizeElements({ elements, urn }) {
    const userMessage = `
Please analyze and summarize the following BIM model elements.
Model URN: ${urn || 'unknown'}

Selected Elements:
${JSON.stringify(elements, null, 2)}

Provide:
1. A brief summary of the selection
2. Key properties and their values
3. Any notable observations
`.trim();

    return callAI([{ role: 'user', content: userMessage }]);
}

/**
 * Multi-turn chat with optional system context
 */
async function chat({ messages, systemContext }) {
    const systemPrompt = systemContext
        ? `${SYSTEM_PROMPT}\n\n## Current Model Context\n${systemContext}`
        : SYSTEM_PROMPT;
    return callAI(messages, systemPrompt);
}

module.exports = { analyzeModel, summarizeElements, chat };
