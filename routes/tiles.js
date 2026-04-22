/**
 * Tiles & Geocoding Routes
 * -------------------------
 *  · VWorld WMTS 타일 프록시 (CORS 우회)
 *  · 지오코딩: VWorld 도로명 → VWorld 지번 → Nominatim 폴백
 */
'use strict';

const express = require('express');
const config = require('../config.js');
const { asyncHandler, AppError } = require('../middleware');

const router = express.Router();

// ── GET /api/tiles/vworld/:layer/:z/:y/:x ──────────────────────
router.get('/api/tiles/vworld/:layer/:z/:y/:x', asyncHandler(async (req, res) => {
    const { layer, z, y, x } = req.params;
    const apiKey = (config.maps.vworldKey || '').trim();

    if (!apiKey || apiKey.includes('입력') || apiKey.includes('여기')) {
        throw new AppError('VWORLD_API_KEY not configured', 503, 'CONFIG_ERROR');
    }

    const isSatellite = layer === 'Satellite';
    const ext = isSatellite ? 'jpeg' : 'png';
    const contentType = isSatellite ? 'image/jpeg' : 'image/png';
    const url = `https://api.vworld.kr/req/wmts/1.0.0/${apiKey}/${layer}/${z}/${y}/${x}.${ext}`;

    const resp = await fetch(url, {
        headers: { Referer: 'https://www.vworld.kr', 'User-Agent': 'Mozilla/5.0' },
    });
    if (!resp.ok) {
        return res.status(resp.status).send(`VWorld error: ${resp.statusText}`);
    }
    const buffer = Buffer.from(await resp.arrayBuffer());
    res.set('Content-Type', contentType);
    res.set('Cache-Control', 'public, max-age=86400');
    res.send(buffer);
}));

module.exports = router;

// ──────────────────────────────────────────────────────────────
// Geocoding (분리된 라우터)
// ──────────────────────────────────────────────────────────────
const geocodeRouter = express.Router();

async function tryVWorld(query, type, apiKey) {
    if (!apiKey || !query) return null;
    try {
        const url = `https://api.vworld.kr/req/address?service=address&request=getcoord&version=2.0&crs=EPSG:4326&address=${encodeURIComponent(query)}&refine=true&simple=false&format=json&type=${type}&apiKey=${apiKey}`;
        const json = await fetch(url).then((r) => r.json());
        if (json.response?.status === 'OK') {
            const { x, y } = json.response.result.point;
            return { lat: parseFloat(y), lng: parseFloat(x), source: `vworld-${type}` };
        }
    } catch { /* noop */ }
    return null;
}

async function tryNominatim(query) {
    if (!query) return null;
    try {
        const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&countrycodes=kr&limit=1&accept-language=ko`;
        const json = await fetch(url, {
            headers: { 'User-Agent': 'APSPlatform/1.0 (internal)' },
        }).then((r) => r.json());
        if (json?.length > 0) {
            const { lat, lon } = json[0];
            return { lat: parseFloat(lat), lng: parseFloat(lon), source: 'nominatim' };
        }
    } catch { /* noop */ }
    return null;
}

geocodeRouter.get('/api/geocode', asyncHandler(async (req, res) => {
    const address = req.query.address;
    const postalCode = req.query.postalCode;
    if (!address && !postalCode) {
        throw new AppError('address or postalCode required', 400, 'VALIDATION_ERROR');
    }

    const query = address || postalCode;
    const apiKey = (config.maps.vworldKey || '').trim();

    const result =
        (await tryVWorld(query, 'road', apiKey)) ||
        (await tryVWorld(query, 'parcel', apiKey)) ||
        (await tryNominatim(query));

    if (result) {
        return res.json({ lat: result.lat, lng: result.lng, address: query, source: result.source });
    }
    res.json({ lat: null, lng: null, address: query, reason: 'NOT_FOUND' });
}));

module.exports.geocodeRouter = geocodeRouter;
