const express = require('express');
const router = express.Router();

/**
 * VWorld WMTS 타일 프록시
 * GET /api/tiles/vworld/:layer/:z/:y/:x
 * - 브라우저 → 우리 서버 → VWorld API (CORS 우회)
 */
router.get('/api/tiles/vworld/:layer/:z/:y/:x', async (req, res) => {
    const { layer, z, y, x } = req.params;
    const apiKey = (process.env.VWORLD_API_KEY || '').trim();

    if (!apiKey || apiKey.includes('입력') || apiKey.includes('여기')) {
        return res.status(503).send('VWORLD_API_KEY not configured');
    }

    // 레이어별 포맷 결정
    const isSatellite = layer === 'Satellite';
    const ext = isSatellite ? 'jpeg' : 'png';
    const format = isSatellite ? 'image/jpeg' : 'image/png';

    const url = `https://api.vworld.kr/req/wmts/1.0.0/${apiKey}/${layer}/${z}/${y}/${x}.${ext}`;

    try {
        const response = await fetch(url, {
            headers: {
                'Referer': 'https://www.vworld.kr',
                'User-Agent': 'Mozilla/5.0',
            },
        });

        if (!response.ok) {
            return res.status(response.status).send(`VWorld error: ${response.statusText}`);
        }

        const buffer = Buffer.from(await response.arrayBuffer());
        res.set('Content-Type', format);
        res.set('Cache-Control', 'public, max-age=86400'); // 1일 캐시
        res.send(buffer);
    } catch (err) {
        console.error('[Tile Proxy] Error:', err.message);
        res.status(502).send('Tile proxy error');
    }
});

module.exports = router;

/**
 * GET /api/geocode?address=경기도 남양주시 고산로&postalCode=12245
 * 지오코딩 - 4단계 폴백 체인:
 *   1. VWorld 도로명주소
 *   2. VWorld 지번주소
 *   3. Nominatim (OpenStreetMap) - API 키 불필요
 *   4. NOT_FOUND
 */
const geocodeRouter = express.Router();
geocodeRouter.get('/api/geocode', async (req, res) => {
    const address = req.query.address;
    const postalCode = req.query.postalCode;
    if (!address && !postalCode) return res.status(400).json({ error: 'address or postalCode required' });

    const apiKey = (process.env.VWORLD_API_KEY || '').trim();

    // ── 1,2단계: VWorld 지오코딩 ──────────────────────────────────────
    async function tryVWorld(query, type) {
        if (!apiKey || !query) return null;
        try {
            const url = `https://api.vworld.kr/req/address?service=address&request=getcoord&version=2.0&crs=EPSG:4326&address=${encodeURIComponent(query)}&refine=true&simple=false&format=json&type=${type}&apiKey=${apiKey}`;
            const json = await fetch(url).then(r => r.json());
            if (json.response?.status === 'OK') {
                const { x, y } = json.response.result.point;
                return { lat: parseFloat(y), lng: parseFloat(x), source: `vworld-${type}` };
            }
        } catch (e) { /* 무시 */ }
        return null;
    }

    // ── 3단계: Nominatim (OpenStreetMap) ──────────────────────────────
    async function tryNominatim(query) {
        if (!query) return null;
        try {
            const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&countrycodes=kr&limit=1&accept-language=ko`;
            const json = await fetch(url, { headers: { 'User-Agent': 'APSPlatform/1.0 (internal)' } }).then(r => r.json());
            if (json?.length > 0) {
                const { lat, lon } = json[0];
                return { lat: parseFloat(lat), lng: parseFloat(lon), source: 'nominatim' };
            }
        } catch (e) { /* 무시 */ }
        return null;
    }

    const query = address || postalCode;

    // 시도 순서: VWorld 도로명 → VWorld 지번 → Nominatim
    const result =
        await tryVWorld(query, 'road') ||
        await tryVWorld(query, 'parcel') ||
        await tryNominatim(query);

    if (result) {
        console.log(`[Geocode] "${query}" → (${result.lat}, ${result.lng}) via ${result.source}`);
        return res.json({ lat: result.lat, lng: result.lng, address: query, source: result.source });
    }

    console.warn(`[Geocode] NOT_FOUND: "${query}"`);
    return res.json({ lat: null, lng: null, address: query, reason: 'NOT_FOUND' });
});

module.exports.geocodeRouter = geocodeRouter;
