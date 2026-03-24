'use strict';

const express = require('express');
const session = require('cookie-session');
const path = require('path');
const { PORT, SERVER_SESSION_SECRET } = require('./config.js');

const authRouter = require('./routes/auth');
const modelsRouter = require('./routes/models');
const aiRouter = require('./routes/ai');

const app = express();

// ── Middleware ───────────────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(session({
    name: 'aps_session',
    secret: SERVER_SESSION_SECRET,
    maxAge: 24 * 60 * 60 * 1000  // 24 hours
}));

// ── Static Files ─────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// ── API Routes ───────────────────────────────────────────────────────────────
app.use(require('./routes/auth'));
app.use(require('./routes/hubs'));       // Tutorial hubs-browser endpoints
app.use(require('./routes/diff'));
app.use(require('./routes/clash'));
app.use(require('./routes/memos'));
app.use(require('./routes/issues'));
app.use('/api/models', modelsRouter);
app.use('/api/ai', aiRouter);

// ── DEBUG: Raw Hub Response ───────────────────────────────────────────────────
// Remove this after diagnosis is complete
const { authRefreshMiddleware } = require('./services/aps.js');
const { DataManagementClient } = require('@aps_sdk/data-management');
const _dmClient = new DataManagementClient();
app.get('/api/debug/hubs', authRefreshMiddleware, async (req, res) => {
    try {
        const raw = await _dmClient.getHubs({ accessToken: req.internalOAuthToken.access_token });
        res.json({ content_keys: Object.keys(raw || {}), data: raw?.data, full: raw });
    } catch (err) {
        res.status(500).json({ error: err.message, stack: err.stack });
    }
});


// ── Health Check ──────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        env: {
            hasApsId: !!process.env.APS_CLIENT_ID,
            hasApsSecret: !!process.env.APS_CLIENT_SECRET,
            aiProvider: process.env.AI_PROVIDER || 'not set'
        }
    });
});

// ── SPA Fallback ──────────────────────────────────────────────────────────────
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Error Handler ─────────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
    console.error('[Error]', err);
    res.status(err.status || 500).json({ error: err.message || 'Internal Server Error' });
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
    console.log('');
    console.log('╔════════════════════════════════════════════╗');
    console.log('║       APS AI Platform - Server Ready       ║');
    console.log('╠════════════════════════════════════════════╣');
    console.log(`║  🌐 URL:    http://localhost:${PORT}          ║`);
    console.log(`║  🤖 AI:     ${(process.env.AI_PROVIDER || 'not set').padEnd(32)}║`);
    console.log(`║  🔑 APS ID: ${process.env.APS_CLIENT_ID ? '✅ Set' : '❌ Not set - check .env'}         ║`);
    console.log('╚════════════════════════════════════════════╝');
    console.log('');
});

module.exports = app;
