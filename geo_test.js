// 주소 형식별 지오코딩 테스트
const http = require('http');

const addresses = [
    '경기도 남양주시 고산로 171',
    '경기도 남양주시 고산로',
    '남양주시 고산로',
    '경기도 남양주시',
    '남양주시',
    '경기도 남양주시 고산로 171번길',
];

async function test(addr) {
    return new Promise((resolve) => {
        http.get('http://localhost:8080/api/geocode?address=' + encodeURIComponent(addr), (r) => {
            let d = '';
            r.on('data', c => d += c);
            r.on('end', () => {
                const j = JSON.parse(d);
                const result = (j.lat && j.lng) ? `(${j.lat}, ${j.lng})` : `NOT_FOUND(${j.reason})`;
                console.log(`"${addr}" → ${result}`);
                resolve();
            });
        });
    });
}

(async () => {
    for (const a of addresses) await test(a);
})();
