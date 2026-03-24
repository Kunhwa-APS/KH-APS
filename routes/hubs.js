const express = require('express');
const { authRefreshMiddleware, getHubs, getProjects, getProjectContents, getItemVersions, getInternalTwoLeggedToken } = require('../services/aps.js');

let router = express.Router();

// 모든 /api/hubs 요청에 인증 확인 미들웨어 적용
router.use('/api/hubs', authRefreshMiddleware);

/**
 * GET /api/hubs
 * 사용자 허브 목록 (ACC, BIM360 등)
 */
router.get('/api/hubs', async function (req, res, next) {
    try {
        const hubs = await getHubs(req.internalOAuthToken.access_token);
        console.log(`[Hubs] Found ${hubs.length} hub(s):`, hubs.map(h => h.id));
        res.json(hubs.map(hub => ({
            id: hub.id,
            name: hub.attributes.name
        })));
    } catch (err) {
        console.error('[Hubs] Error fetching hubs:', err.message || err);
        next(err);
    }
});

/**
 * GET /api/hubs/:hub_id/projects
 * 허브 내 프로젝트 목록
 */
router.get('/api/hubs/:hub_id/projects', async function (req, res, next) {
    try {
        const projects = await getProjects(req.params.hub_id, req.internalOAuthToken.access_token);
        console.log(`[Projects] Hub ${req.params.hub_id}: ${projects.length} projects`);
        const mappedProjects = projects.map(project => {
            const ext = project.attributes.extension?.data || {};
            // 주소 필드 디버깅 로그
            console.log(`  [Project] "${project.attributes.name}" | extension.data:`, JSON.stringify({
                addressLine1: ext.addressLine1,
                addressLine2: ext.addressLine2,
                city: ext.city,
                stateOrProvince: ext.stateOrProvince,
                postalCode: ext.postalCode,
                country: ext.country,
                latitude: ext.latitude,
                longitude: ext.longitude,
            }));
            return {
                id: project.id,
                name: project.attributes.name,
                addressLine1:    ext.addressLine1    || '',
                addressLine2:    ext.addressLine2    || '',
                city:            ext.city            || '',
                stateOrProvince: ext.stateOrProvince || '',
                postalCode:      ext.postalCode      || '',
                country:         ext.country         || '',
                // 일부 ACC 프로젝트는 직접 위경도 제공
                latitude:        ext.latitude        || null,
                longitude:       ext.longitude       || null,
            };
        });

        // 비동기로 모든 프로젝트의 상세 주소 정보를 ACC Admin API에서 병렬로 시도
        // ACC Admin API는 2-legged 토큰(서버 간 인증)을 요구합니다.
        let twoLeggedToken = null;
        try {
            twoLeggedToken = await getInternalTwoLeggedToken();
        } catch (e) {
            console.error('[ACC HQ API] Failed to get 2-legged token:', e.message);
        }

        const EnhancedProjects = await Promise.all(mappedProjects.map(async p => {
            // 이미 주소가 있으면 건너뜀
            if (p.addressLine1 || p.city) return p;

            if (!twoLeggedToken) return p;

            try {
                // 허브 ID에서 'b.' 접두어 제거 -> accountId
                const accountId = req.params.hub_id.replace(/^b\./, '');
                // 프로젝트 ID에서 'b.' 접두어 제거 -> projectId
                const projectId = p.id.replace(/^b\./, '');
                
                // ACC Admin API로 프로젝트 상세 조회 시도
                const response = await fetch(`https://developer.api.autodesk.com/hq/v1/accounts/${accountId}/projects/${projectId}`, {
                    headers: {
                        'Authorization': `Bearer ${twoLeggedToken}`
                    }
                });
                
                if (response.ok) {
                    const hqData = await response.json();
                    if (hqData.address_line_1 || hqData.city) {
                        console.log(`[ACC HQ API] Fetched address for "${p.name}": ${hqData.address_line_1}, ${hqData.city}`);
                        p.addressLine1 = hqData.address_line_1 || p.addressLine1;
                        p.addressLine2 = hqData.address_line_2 || p.addressLine2;
                        p.city = hqData.city || p.city;
                        p.stateOrProvince = hqData.state_or_province || p.stateOrProvince;
                        p.postalCode = hqData.postal_code || p.postalCode;
                        p.country = hqData.country || p.country;
                    } else {
                        console.log(`[ACC HQ API] "${p.name}" has NO address in ACC settings.`);
                    }
                } else {
                    const errText = await response.text();
                    console.warn(`[ACC HQ API] Failed for "${p.name}": ${response.status} ${response.statusText}`, errText);
                }
            } catch (e) { 
                console.error(`[ACC HQ API] Error fetching "${p.name}":`, e.message);
            }
            return p;
        }));

        res.json(EnhancedProjects);
    } catch (err) {
        next(err);
    }
});

/**
 * GET /api/hubs/:hub_id/projects/:project_id/contents
 * 프로젝트/폴더 내 콘텐츠 (폴더 및 파일)
 */
router.get('/api/hubs/:hub_id/projects/:project_id/contents', async function (req, res, next) {
    try {
        const entries = await getProjectContents(
            req.params.hub_id,
            req.params.project_id,
            req.query.folder_id,
            req.internalOAuthToken.access_token
        );
        res.json(entries.map(entry => ({
            id: entry.id,
            name: entry.attributes.displayName,
            folder: entry.type === 'folders'
        })));
    } catch (err) {
        next(err);
    }
});

/**
 * GET /api/hubs/:hub_id/projects/:project_id/contents/:item_id/versions
 * 파일의 버전 이력
 */
router.get('/api/hubs/:hub_id/projects/:project_id/contents/:item_id/versions', async function (req, res, next) {
    try {
        const versions = await getItemVersions(
            req.params.project_id,
            req.params.item_id,
            req.internalOAuthToken.access_token
        );
        res.json(versions.map(version => ({
            id: version.id,
            name: version.attributes.createTime
        })));
    } catch (err) {
        next(err);
    }
});

module.exports = router;
