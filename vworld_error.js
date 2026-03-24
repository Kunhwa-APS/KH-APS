require('dotenv').config();
const https = require('https');

const k = (process.env.VWORLD_API_KEY || '').trim();
const url = `https://api.vworld.kr/req/wmts/1.0.0/${k}/Satellite/13/3256/6903.jpeg`;
console.log('Requesting:', url.replace(k, k.substring(0,8) + '...'));

https.get(url, (r) => {
    let d = '';
    r.on('data', c => d += c);
    r.on('end', () => console.log('VWorld response (first 800):\n', d.substring(0, 800)));
}).on('error', e => console.error('Error:', e.message));
