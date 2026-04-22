/**
 * AI Provider Registry
 */
'use strict';

const providers = {
    openai: require('./openai'),
    gemini: require('./gemini'),
    ollama: require('./ollama'),
};

function getProvider(name) {
    const key = (name || process.env.AI_PROVIDER || 'gemini').toLowerCase();
    const provider = providers[key];
    if (!provider) {
        const valid = Object.keys(providers).join(', ');
        throw new Error(`Unknown AI provider: "${key}". Valid: ${valid}`);
    }
    return provider;
}

module.exports = { providers, getProvider };
