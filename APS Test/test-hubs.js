/**
 * test-hubs.js — APS Data Management API 직접 테스트
 * 실행: node test-hubs.js
 * 
 * .env의 CLIENT_ID/SECRET로 2-legged 토큰을 받아 getHubs를 호출한다.
 * 그러나 getHubs는 3-legged 전용이므로 결과는 빈 배열이 예상됨.
 * 주목적: SDK 응답 구조 확인
 */
'use strict';
require('dotenv').config();

const { AuthenticationClient, Scopes } = require('@aps_sdk/authentication');
const { DataManagementClient } = require('@aps_sdk/data-management');
const https = require('https');

const CLIENT_ID = process.env.APS_CLIENT_ID;
const CLIENT_SECRET = process.env.APS_CLIENT_SECRET;

async function main() {
    console.log('=== APS Data Management Test ===\n');
    console.log('CLIENT_ID:', CLIENT_ID ? CLIENT_ID.slice(0, 8) + '...' : 'MISSING');

    const authClient = new AuthenticationClient();
    const dmClient = new DataManagementClient();

    // ─── 2-legged token (Note: getHubs requires 3-legged) ─────────────────
    console.log('\n[1] Getting 2-legged token...');
    const token2L = await authClient.getTwoLeggedToken(
        CLIENT_ID, CLIENT_SECRET,
        [Scopes.DataRead, Scopes.ViewablesRead]
    );
    console.log('  ✅ 2-legged token OK, expires_in:', token2L.expires_in);

    // ─── getHubs with 2-legged (will return [] or personal hubs) ──────────
    console.log('\n[2] Testing getHubs with 2-legged token...');
    try {
        const hubs2L = await dmClient.getHubs({ accessToken: token2L.access_token });
        console.log('  Response keys:', Object.keys(hubs2L));
        console.log('  hub count (data):', hubs2L?.data?.length);
        if (hubs2L?.data?.length > 0) {
            console.log('  First hub:', JSON.stringify(hubs2L.data[0], null, 2));
        }
    } catch (err) {
        console.log('  ❌ Error:', err.message);
    }

    // ─── Raw REST call to verify endpoint ─────────────────────────────────
    console.log('\n[3] Raw REST GET /project/v1/hubs with 2-legged token...');
    const raw = await new Promise((resolve) => {
        const req = https.request({
            hostname: 'developer.api.autodesk.com',
            path: '/project/v1/hubs',
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token2L.access_token}`,
                'Content-Type': 'application/json'
            }
        }, (res) => {
            let data = '';
            res.on('data', d => data += d);
            res.on('end', () => resolve({ status: res.statusCode, body: data }));
        });
        req.on('error', err => resolve({ error: err.message }));
        req.end();
    });
    console.log('  Status:', raw.status);
    try {
        const parsed = JSON.parse(raw.body);
        console.log('  hub count:', parsed?.data?.length ?? 'N/A');
        if (parsed?.errors) console.log('  Errors:', JSON.stringify(parsed.errors));
        if (parsed?.data?.length > 0) {
            console.log('  First hub ID:', parsed.data[0].id);
            console.log('  First hub name:', parsed.data[0].attributes?.name);
        }
        if (parsed?.data?.length === 0) {
            console.log('\n  ℹ️  Empty hub list with 2-legged token is EXPECTED.');
            console.log('  ℹ️  ACC hubs require 3-legged token. This confirms the SDK client is working.');
        }
    } catch (e) {
        console.log('  Raw body:', raw.body?.slice(0, 200));
    }

    console.log('\n=== Test Complete ===');
    console.log('\n※ 확인사항:');
    console.log('  - 2-legged 토큰으로 getHubs → 빈 배열 = 정상 (ACC는 3-legged 필수)');
    console.log('  - 3-legged 로그인 후 /api/debug/hubs 를 브라우저에서 열어 결과 확인 필요');
}

main().catch(console.error);
