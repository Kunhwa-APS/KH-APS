require('dotenv').config();
const { AuthenticationClient, Scopes, ResponseType } = require('@aps_sdk/authentication');
const https = require('https');

const CLIENT_ID = process.env.APS_CLIENT_ID;
const CLIENT_SECRET = process.env.APS_CLIENT_SECRET;
const CALLBACK_URL = (process.env.APS_CALLBACK_URL || '').replace(/"/g, '');

console.log('=== APS OAuth Diagnostics ===');
console.log('Client ID:', CLIENT_ID);
console.log('Callback URL:', CALLBACK_URL);

const ac = new AuthenticationClient();

// Test 1: 2-legged token
console.log('\n[Test 1] Testing 2-legged token...');
ac.getTwoLeggedToken(CLIENT_ID, CLIENT_SECRET, [Scopes.DataRead])
    .then(t => {
        console.log('  OK - token_type:', t.token_type, '| expires_in:', t.expires_in);
    })
    .catch(e => {
        const err = e.axiosError && e.axiosError.response ? e.axiosError.response.data : e.message;
        console.error('  FAILED:', JSON.stringify(err));
    });

// Test 2: Build and trace authorize URL
const authUrl = ac.authorize(CLIENT_ID, ResponseType.Code, CALLBACK_URL, [Scopes.DataRead, Scopes.ViewablesRead]);
console.log('\n[Test 2] Authorization URL:');
console.log(' ', authUrl);

// Test 3: Follow redirect
console.log('\n[Test 3] Following Autodesk authorize redirect...');
const urlObj = new URL(authUrl);
const options = {
    hostname: urlObj.hostname,
    path: urlObj.pathname + urlObj.search,
    method: 'GET',
    headers: { 'User-Agent': 'Node.js/22 APS-Diagnostic' }
};

const req = https.request(options, (res) => {
    const loc = res.headers.location || '';
    console.log('  HTTP Status:', res.statusCode);
    console.log('  Location:', loc || '(no redirect)');
    if (loc.includes('request-error')) {
        console.log('\n  DIAGNOSIS: Autodesk REJECTED - redirect_uri not registered or client_id invalid');
    } else if (loc.includes('signin.autodesk.com') || loc.includes('accounts.autodesk.com')) {
        console.log('\n  DIAGNOSIS: Autodesk ACCEPTED - OAuth should work! Now add Callback URL if not done.');
    } else {
        console.log('\n  DIAGNOSIS: Unexpected response - check the location header above');
    }
});
req.on('error', e => console.error('  Request error:', e.message));
req.end();
