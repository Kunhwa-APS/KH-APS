/**
 * Hubs Routes
 * -----------
 *  · ACC / BIM 360 허브 · 프로젝트 · 폴더 · 버전 조회
 *  · ACC Admin HQ API 병렬 조회로 프로젝트 주소 보강
 *  · 프로젝트 Issues 조회
 */
const express = require('express');
const {
    authRefreshMiddleware,
    getHubs,
    getProjects,
    getProjectContents,
    getItemVersions,
    getInternalTwoLeggedToken,
    getIssueContainerInfo,
    getProjectIssues,
} = require('../services/aps.js');
const { asyncHandler, AppError } = require('../middleware');
const { cache } = require('../utils/cache');

const router = express.Router();
router.use('/api/hubs', authRefreshMiddleware);

// ── 유틸 ───────────────────────────────────────────────────────
/** Item ID(URN)에서 버전 번호를 추출 */
function extractVersionNumber(id) {
    const m = id.match(/[?&]version=(\d+)/i)
           || id.match(/:v(\d+)$/i)
           || id.match(/\.vf\..+v(\d+)$/i);
    return m ? parseInt(m[1], 10) : 1;
}
/** Buffer → base64url (padding 제거) */
function toUrnBase64(id) {
    return Buffer.from(id).toString('base64').replace(/=/g, '');
}

// ── GET /api/hubs ──────────────────────────────────────────────
router.get('/api/hubs', asyncHandler(async (req, res) => {
    const hubs = await getHubs(req.internalOAuthToken.access_token);
    res.json(hubs.map((h) => ({ id: h.id, name: h.attributes.name })));
}));

// ── GET /api/hubs/:hub_id/projects (ACC 주소 병렬 보강) ────────
router.get('/api/hubs/:hub_id/projects', asyncHandler(async (req, res) => {
    const { hub_id } = req.params;
    const token = req.internalOAuthToken.access_token;

    // 기본 프로젝트 목록 (60초 캐시). ?refresh=1 이면 캐시 무효화 후 재조회.
    const cacheKey = `projects:${hub_id}`;
    if (req.query.refresh === '1') cache.del(cacheKey);
    const projects = await cache.wrap(cacheKey, 60, () => getProjects(hub_id, token));

    const mapped = projects.map((p) => {
        const ext = p.attributes.extension?.data || {};
        return {
            id: p.id,
            name: p.attributes.name,
            addressLine1: ext.addressLine1 || '',
            addressLine2: ext.addressLine2 || '',
            city: ext.city || '',
            stateOrProvince: ext.stateOrProvince || '',
            postalCode: ext.postalCode || '',
            country: ext.country || '',
            latitude: ext.latitude || null,
            longitude: ext.longitude || null,
            // ACC HQ fields (enriched below)
            projectType: '',
            projectStatus: '',
            startDate: '',
            endDate: '',
            constructionType: '',
            classification: '',
            jobNumber: '',
            createdAt: p.attributes.createTime || '',
        };
    });

    // 2-Legged token (HQ Admin API용) — services/aps.js 내부에서 자동 캐시됨
    let twoLeggedToken = null;
    try {
        twoLeggedToken = await getInternalTwoLeggedToken();
    } catch (e) {
        console.warn('[hubs] 2-legged token 획득 실패:', e.message);
    }

    const accountId = hub_id.replace(/^b\./, '');
    const enhanced = await Promise.all(mapped.map(async (p) => {
        if (!twoLeggedToken) return p;
        try {
            const projectId = p.id.replace(/^b\./, '');
            const authHeaders = { Authorization: `Bearer ${twoLeggedToken}` };

            // (1) HQ v1 — 주소/일정/job_number 등 레거시 필드
            const hqResp = await fetch(
                `https://developer.api.autodesk.com/hq/v1/accounts/${accountId}/projects/${projectId}`,
                { headers: authHeaders }
            );
            const hq = hqResp.ok ? await hqResp.json() : {};

            // (2) Construction Admin v1 — ACC UI에 표시되는 "유형(type)" 필드
            //     HQ v1은 최신 ACC 유형 값을 반환하지 않으므로 신규 엔드포인트를 사용.
            let acc = {};
            try {
                const accResp = await fetch(
                    `https://developer.api.autodesk.com/construction/admin/v1/projects/${projectId}`,
                    { headers: authHeaders }
                );
                if (accResp.ok) acc = await accResp.json();
            } catch (e) {
                console.warn(`[hubs] Admin v1 API failed for "${p.name}":`, e.message);
            }

            // Address fields (HQ 우선)
            p.addressLine1 = hq.address_line_1 || p.addressLine1;
            p.addressLine2 = hq.address_line_2 || p.addressLine2;
            p.city = hq.city || p.city;
            p.stateOrProvince = hq.state_or_province || p.stateOrProvince;
            p.postalCode = hq.postal_code || p.postalCode;
            p.country = hq.country || p.country;

            // Project metadata — ACC Admin v1의 `type`을 최우선, HQ 값은 fallback
            p.projectType = acc.type || hq.type || hq.construction_type || '';
            p.projectStatus = acc.status || hq.status || '';
            p.startDate = acc.startDate || hq.start_date || '';
            p.endDate = acc.endDate || hq.end_date || '';
            p.constructionType = hq.construction_type || '';
            p.classification = acc.classification || hq.classification || '';
            p.jobNumber = acc.jobNumber || hq.job_number || '';
        } catch (e) {
            console.warn(`[hubs] HQ API failed for "${p.name}":`, e.message);
        }
        return p;
    }));

    res.json(enhanced);
}));

// ── GET /api/hubs/:hub_id/projects/:project_id/contents ────────
router.get('/api/hubs/:hub_id/projects/:project_id/contents', asyncHandler(async (req, res) => {
    const entries = await getProjectContents(
        req.params.hub_id,
        req.params.project_id,
        req.query.folder_id,
        req.internalOAuthToken.access_token
    );
    res.json(entries.map((entry) => {
        const isFolder = entry.type === 'folders';
        let vNumber = 1;
        let urn = null;
        if (!isFolder && entry.relationships?.tip) {
            const tipId = entry.relationships.tip.data.id;
            vNumber = extractVersionNumber(tipId);
            urn = toUrnBase64(tipId);
        }
        return {
            id: entry.id,
            name: entry.attributes.displayName,
            folder: isFolder,
            vNumber,
            urn,
        };
    }));
}));

// ── GET /api/hubs/:hub_id/projects/:project_id/contents/:item_id/versions ──
router.get('/api/hubs/:hub_id/projects/:project_id/contents/:item_id/versions', asyncHandler(async (req, res) => {
    const versions = await getItemVersions(
        req.params.project_id,
        req.params.item_id,
        req.internalOAuthToken.access_token
    );
    res.json(versions.map((v) => {
        let vNumber = v.attributes.versionNumber;
        if (vNumber == null) vNumber = extractVersionNumber(v.id);
        return {
            id: v.id,
            name: v.attributes.createTime,
            displayName: v.attributes.displayName || v.attributes.createTime,
            vNumber,
            createUserName: v.attributes.createUserName,
            urn: toUrnBase64(v.id),
        };
    }));
}));

// ── GET /api/hubs/:hub_id/projects/:project_id/issues (ACC Issues) ──
router.get('/api/hubs/:hub_id/projects/:project_id/issues', asyncHandler(async (req, res) => {
    const { hub_id, project_id } = req.params;
    const token = req.internalOAuthToken.access_token;

    const containerId = await getIssueContainerInfo(hub_id, project_id, token);
    if (!containerId) return res.json([]);

    const issues = await getProjectIssues(containerId, token);

    const findAttr = (attrs, ...titles) =>
        attrs?.find?.((a) => titles.includes(a.title))?.value || '-';

    res.json(issues.map((i) => ({
        id: i.id,
        title: i.title || i.attributes?.title || 'No Title',
        status: i.attributes?.status || 'Open',
        description: i.attributes?.description || '',
        structure_name: findAttr(i.attributes?.customAttributes, 'Structure', '건물명'),
        work_type: findAttr(i.attributes?.customAttributes, '공종', 'Work Type'),
        raw: i,
    })));
}));

module.exports = router;
