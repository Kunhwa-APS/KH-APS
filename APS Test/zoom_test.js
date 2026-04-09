// VWorld 위성 타일 줌별 가용 범위 테스트
require('dotenv').config();
const https = require('https');

const API_KEY = (process.env.VWORLD_API_KEY || '').trim();

// 서울 기준 타일 좌표 계산
function getTileCoords(lat, lng, z) {
    const n = Math.pow(2, z);
    const x = Math.floor((lng + 180) / 360 * n);
    const latRad = lat * Math.PI / 180;
    const y = Math.floor((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n);
    return { x, y, z };
}

function fetchTileInfo(layer, z, y, x) {
    return new Promise((resolve) => {
        const ext = layer === 'Satellite' ? 'jpeg' : 'png';
        const url = `https://api.vworld.kr/req/wmts/1.0.0/${API_KEY}/${layer}/${z}/${y}/${x}.${ext}`;
        https.get(url, (r) => {
            let d = Buffer.alloc(0);
            r.on('data', c => d = Buffer.concat([d, c]));
            r.on('end', () => {
                const header = d.slice(0, 4).toString('hex');
                const isXML = header.startsWith('3c3f') || header.startsWith('3c45');
                resolve({
                    z, y, x,
                    status: r.statusCode,
                    bytes: d.length,
                    isValidImage: !isXML,
                    preview: isXML ? d.toString('utf8').substring(0, 100) : '(binary image)'
                });
            });
        }).on('error', e => resolve({ z, y, x, error: e.message }));
    });
}

async function testZoomLevels() {
    // 서울 중심 (37.5667°N, 126.9783°E)
    const lat = 37.5667, lng = 126.9783;
    console.log(`Testing VWorld Satellite tiles for Seoul (${lat}, ${lng})\n`);

    for (let z = 7; z <= 15; z++) {
        const { x, y } = getTileCoords(lat, lng, z);
        const result = await fetchTileInfo('Satellite', z, y, x);
        const status = result.isValidImage ? '✅ OK' : '❌ ERROR';
        console.log(`z=${String(z).padStart(2)} | y=${String(y).padStart(5)} x=${String(x).padStart(5)} | ${status} | ${result.bytes} bytes`);
        if (!result.isValidImage && result.preview) {
            console.log(`       Error: ${result.preview.replace(/\s+/g,' ').substring(0,80)}`);
        }
    }
}

testZoomLevels();
