// ACC 프로젝트 주소 필드 진단 스크립트
const http = require('http');

function apiGet(path) {
    return new Promise((resolve, reject) => {
        http.get(`http://localhost:8080${path}`, (res) => {
            let d = '';
            res.on('data', c => d += c);
            res.on('end', () => {
                try { resolve(JSON.parse(d)); }
                catch(e) { resolve({ raw: d }); }
            });
        }).on('error', reject);
    });
}

async function diagnose() {
    console.log('ACC 프로젝트 주소 필드 진단\n' + '='.repeat(50));

    let hubs;
    try {
        hubs = await apiGet('/api/hubs');
        if (!Array.isArray(hubs) || hubs.length === 0) {
            console.log('허브 없음 또는 로그인 필요:', JSON.stringify(hubs));
            return;
        }
    } catch (e) {
        console.error('허브 조회 실패 (서버 실행 중 & 로그인 필요):', e.message);
        return;
    }

    for (const hub of hubs) {
        console.log(`\n허브: ${hub.name} (${hub.id})`);
        const projects = await apiGet(`/api/hubs/${hub.id}/projects`);

        for (const p of projects) {
            const addr = [p.addressLine1, p.addressLine2, p.city, p.stateOrProvince, p.postalCode, p.country]
                .filter(Boolean).join(' | ');
            console.log(`  프로젝트: ${p.name}`);
            console.log(`    addressLine1: ${JSON.stringify(p.addressLine1)}`);
            console.log(`    city:         ${JSON.stringify(p.city)}`);
            console.log(`    stateOrProv:  ${JSON.stringify(p.stateOrProvince)}`);
            console.log(`    postalCode:   ${JSON.stringify(p.postalCode)}`);
            console.log(`    country:      ${JSON.stringify(p.country)}`);
            console.log(`    → 조합 주소: "${addr || '(없음)'}"`);

            if (addr) {
                const geo = await apiGet(`/api/geocode?address=${encodeURIComponent(addr)}`);
                console.log(`    → 지오코딩: lat=${geo.lat}, lng=${geo.lng}, reason=${geo.reason||'OK'}`);
            }
            console.log();
        }
    }
}

diagnose().catch(console.error);
