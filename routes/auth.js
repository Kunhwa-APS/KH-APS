'use strict';

const express = require('express');
const {
    getAuthorizationParams,
    getAuthorizationUrl,
    authCallbackMiddleware,
    authRefreshMiddleware,
    getUserProfile
} = require('../services/aps.js');

let router = express.Router();

// ── GET /api/auth/login ───────────────────────────────────────────────────────
// Uses session-based PKCE to survive server restarts and browser pre-fetches
router.get('/api/auth/login', function (req, res) {
    const authData = getAuthorizationParams();
    req.session.oauth_state = authData.state;
    req.session.oauth_verifier = authData.codeVerifier;
    res.redirect(authData.url);
});

// ── GET /api/auth/logout ──────────────────────────────────────────────────────
router.get('/api/auth/logout', function (req, res) {
    req.session = null;
    res.redirect('/');
});

// ── GET /api/auth/callback ────────────────────────────────────────────────────
// authCallbackMiddleware reads state param → looks up codeVerifier in server Map
router.get('/api/auth/callback', authCallbackMiddleware, function (req, res) {
    res.redirect('/');
});

// ── GET /api/auth/token ───────────────────────────────────────────────────────
router.get('/api/auth/token', authRefreshMiddleware, function (req, res) {
    res.json(req.publicOAuthToken);
});

// ── GET /api/auth/profile ─────────────────────────────────────────────────────
router.get('/api/auth/profile', authRefreshMiddleware, async function (req, res, next) {
    try {
        const profile = await getUserProfile(req.internalOAuthToken.access_token);
        res.json({ name: `${profile.name}` });
    } catch (err) {
        next(err);
    }
});

module.exports = router;
