// 동일 좌표의 Satellite vs Base 타일 비교 테스트
const http = require('http');

function fetchTile(layer, z, y, x) {
    return new Promise((resolve) => {
        http.get(`http://localhost:8080/api/tiles/vworld/${layer}/${z}/${y}/${x}`, (res) => {
            let size = 0;
            const chunks = [];
            res.on('data', c => { size += c.length; chunks.push(c); });
            res.on('end', () => resolve({ 
                status: res.statusCode, 
                type: res.headers['content-type'], 
                bytes: size,
                // 첫 20바이트로 JPEG 시그니처 확인 (FF D8 FF)
                header: Buffer.concat(chunks).slice(0, 4).toString('hex')
            }));
        }).on('error', e => resolve({ error: e.message }));
    });
}

async function test() {
    // 줌 13 레벨 한국 특정 타일 (수원 인근)
    const z = 13, y = 3256, x = 6903;
    
    console.log(`\nTest tile: z=${z} y=${y} x=${x}`);
    
    const sat = await fetchTile('Satellite', z, y, x);
    console.log('Satellite:', sat);
    
    const base = await fetchTile('Base', z, y, x);
    console.log('Base:     ', base);
    
    if (sat.bytes === base.bytes) {
        console.log('\n⚠️  SAME SIZE → VWorld is returning Base map for Satellite (API key issue or subscription)');
    } else {
        console.log('\n✅ DIFFERENT SIZES → Satellite tiles are real satellite imagery');
    }
}

test();
