// Helper to ensure library is available
async function ensureLibraryLoaded() {
    if (typeof MeshBVH !== 'undefined') return true;
    return new Promise((resolve) => {
        const check = setInterval(() => {
            if (typeof MeshBVH !== 'undefined') {
                clearInterval(check);
                resolve(true);
            }
        }, 100); // Check every 0.1s
    });
}

export class LocalClashDetector {
    constructor(viewer) {
        this.viewer = viewer;
        this.clashMarkers = [];
        this.bvhCache = new Map(); // Geometry -> MeshBVH
    }

    /**
     * 1단계: Bounding Box 기반 간섭 필터링 (Broad Phase)
     */
    async calculateBroadPhase(modelA, dbIdsA, modelB, dbIdsB, onProgress) {
        try {
            console.log(`[LocalClash] Starting Broad Phase: ModelA(${dbIdsA.length}) vs ModelB(${dbIdsB.length})`);
            const results = [];

            // 1. 모델 A의 모든 객체 Bounding Box 미리 계산
            const boxesA = [];
            for (let i = 0; i < dbIdsA.length; i++) {
                const dbId = dbIdsA[i];
                const box = this.getWorldBoundingBox(modelA, dbId);
                if (box) boxesA.push({ dbId, box });

                if (i % 100 === 0) {
                    if (onProgress) onProgress(`AABB 계산 중 (Model A): ${Math.round((i / dbIdsA.length) * 100)}%`);
                    await new Promise(r => setTimeout(r, 0));
                }
            }

            // 2. 모델 B의 모든 객체 Bounding Box 미리 계산
            const boxesB = [];
            for (let i = 0; i < dbIdsB.length; i++) {
                const dbId = dbIdsB[i];
                const box = this.getWorldBoundingBox(modelB, dbId);
                if (box) boxesB.push({ dbId, box });

                if (i % 100 === 0) {
                    if (onProgress) onProgress(`AABB 계산 중 (Model B): ${Math.round((i / dbIdsB.length) * 100)}%`);
                    await new Promise(r => setTimeout(r, 0));
                }
            }

            // 3. 이중 루프 간섭 체크 (Asynchronous)
            const totalPairs = boxesA.length * boxesB.length;
            let processed = 0;

            for (let i = 0; i < boxesA.length; i++) {
                const entryA = boxesA[i];

                for (let j = 0; j < boxesB.length; j++) {
                    const entryB = boxesB[j];
                    processed++;

                    // 같은 모델 내에서 같은 객체면 스킵
                    if (modelA === modelB && entryA.dbId === entryB.dbId) continue;

                    if (entryA.box.intersectsBox(entryB.box)) {
                        results.push({
                            modelA,
                            modelB,
                            dbId1: entryA.dbId,
                            dbId2: entryB.dbId,
                            intersection: entryA.box.clone().intersect(entryB.box)
                        });
                    }
                }

                // 성능 유지를 위해 루프 쪼개기
                if (i % 50 === 0) {
                    if (onProgress) onProgress(`Broad Phase 체크 중: ${Math.round((processed / totalPairs) * 100)}%`);
                    await new Promise(r => requestAnimationFrame(r)); // UI 스레드 방해 방지
                }
            }

            console.log(`[LocalClash] Found ${results.length} bounding box intersections.`);
            return results;
        } catch (err) {
            console.error('[LocalClash] Broad Phase Error:', err);
            throw err;
        }
    }

    /**
     * 2단계: 정밀 메쉬 간섭 체크 (Narrow Phase) - 비동기 청크 처리 적용
     */
    async calculateNarrowPhase(candidates, onProgress, onClashFound) {
        try {
            // [강제 실행 패키지 1] 라이브러리 대기
            await ensureLibraryLoaded();

            THREE.BufferGeometry.prototype.computeBoundsTree = MeshBVH.computeBoundsTree;
            THREE.Mesh.prototype.raycast = MeshBVH.acceleratedRaycast;

            console.log(`[LocalClash] Starting Narrow Phase for ${candidates.length} candidates with Chunking...`);
            const results = [];
            const chunkSize = 50;
            let clashCount = 0;

            for (let i = 0; i < candidates.length; i++) {
                const pair = candidates[i];

                const clashPoint = await this._checkTriangleIntersection(
                    pair.modelA, pair.dbId1,
                    pair.modelB, pair.dbId2
                );

                if (clashPoint) {
                    clashCount++;
                    const clashResult = {
                        ...pair,
                        intersectionPoint: clashPoint
                    };
                    results.push(clashResult);

                    // 즉시 렌더링을 위한 콜백 호출
                    if (onClashFound) onClashFound(clashResult, clashCount);
                }

                // 청크 단위 루프 쪼개기 (50건마다 UI 스레드에 제어권 양도)
                if (i > 0 && i % chunkSize === 0) {
                    if (onProgress) {
                        onProgress(`진행률: [${i}/${candidates.length}] (확정 ${clashCount}건)`);
                    }
                    // setTimeout(0)으로 완전히 실행 큐를 비워줌
                    await new Promise(r => setTimeout(r, 0));
                }
            }

            console.log(`[SUCCESS] Library Loaded & UI Layout Fixed. Confirmed Clashes: ${clashCount}`);
            return results;
        } catch (err) {
            console.error('[LocalClash] Narrow Phase Error:', err);
            throw err;
        }
    }

    async _checkTriangleIntersection(model1, dbId1, model2, dbId2) {
        const it1 = model1.getInstanceTree();
        const it2 = model2.getInstanceTree();
        const frags1 = [];
        it1.enumNodeFragments(dbId1, (f) => frags1.push(f), true);
        const frags2 = [];
        it2.enumNodeFragments(dbId2, (f) => frags2.push(f), true);

        const fragList1 = model1.getFragmentList();
        const fragList2 = model2.getFragmentList();

        for (const fragId1 of frags1) {
            const geo1 = fragList1.getGeometry(fragId1);
            if (!geo1) continue;
            const bvh1 = this._getOrBuildBVH(geo1);

            // Matrix for Model 1 (Model to World)
            const m1 = new THREE.Matrix4();
            fragList1.getWorldMatrix(fragId1, m1);

            for (const fragId2 of frags2) {
                const geo2 = fragList2.getGeometry(fragId2);
                if (!geo2) continue;
                const bvh2 = this._getOrBuildBVH(geo2);

                const m2 = new THREE.Matrix4();
                fragList2.getWorldMatrix(fragId2, m2);

                try {
                    // Coordinates Alignment:
                    // THREE.Matrix4.invert() is safer for modern versions
                    const m2Inv = new THREE.Matrix4().copy(m2).invert();
                    const m1To2 = new THREE.Matrix4().multiplyMatrices(m2Inv, m1);

                    // Check intersection in m2's local space
                    bvh1.intersectsBVH(bvh2, m1To2, (tri1, tri2) => {
                        intersected = true;
                        // Calculate global intersection point
                        const localPointA = new THREE.Vector3().copy(tri1.a);
                        point = localPointA.applyMatrix4(m1); // Convert to world (Viewer coords)
                        return true; // stop search
                    });
                } catch (e) {
                    console.warn('[LocalClash] BVH Intersection failed for frag pair:', e);
                }

                if (intersected) return point;
            }
        }
        return null;
    }

    _getOrBuildBVH(geometry) {
        const cacheKey = geometry;
        if (!this.bvhCache.has(cacheKey)) {
            // Ensure bounds tree is computed
            if (!geometry.boundsTree) {
                geometry.computeBoundsTree();
            }
            this.bvhCache.set(cacheKey, geometry.boundsTree);
        }
        return this.bvhCache.get(cacheKey);
    }

    /**
     * 특정 객체(dbId)의 실제 3D 공간상 크기인 World Bounding Box를 계산 (모든 Fragment 합산)
     */
    getWorldBoundingBox(model, dbId) {
        const it = model.getInstanceTree();
        const fragList = model.getFragmentList();
        const box = new THREE.Box3();
        let hasGeometry = false;

        it.enumNodeFragments(dbId, (fragId) => {
            const fragBox = new THREE.Box3();
            fragList.getWorldBounds(fragId, fragBox);
            box.union(fragBox);
            hasGeometry = true;
        }, true);

        return hasGeometry ? box : null;
    }

    /**
     * 시각화 및 고스트 모드 적용
     */
    visualize(clashes) {
        this.clear();

        // 1. Ghosting 모드 활성화 (주변 반투명)
        this.viewer.setGhosting(true);

        // 2. 간섭 주체 하이라이트 (Blue & Red)
        const colorA = new THREE.Vector4(0, 0, 1, 0.7); // 파랑
        const colorB = new THREE.Vector4(1, 0, 0, 0.7); // 빨강

        clashes.forEach(clash => {
            this.viewer.setThemingColor(clash.dbId1, colorA, clash.modelA, true);
            this.viewer.setThemingColor(clash.dbId2, colorB, clash.modelB, true);

            const point = clash.intersectionPoint || (clash.intersection ? clash.intersection.getCenter(new THREE.Vector3()) : null);
            if (point) this._addClashMarker(point);
        });
    }

    /**
     * 특정 쌍만 강조 (테이블 클릭 시 사용)
     */
    focusClash(clash) {
        this.viewer.clearThemingColors();
        const colorA = new THREE.Vector4(0, 0, 1, 0.9);
        const colorB = new THREE.Vector4(1, 0, 0, 0.9);

        this.viewer.setThemingColor(clash.dbId1, colorA, clash.modelA, true);
        this.viewer.setThemingColor(clash.dbId2, colorB, clash.modelB, true);
        this.viewer.select([clash.dbId1], clash.modelA);
    }

    _addClashMarker(point) {
        const geom = new THREE.SphereGeometry(0.12, 16, 16);
        const mat = new THREE.MeshBasicMaterial({ color: 0xffff00, depthTest: false, transparent: true, opacity: 0.9 });
        const sphere = new THREE.Mesh(geom, mat);
        sphere.position.copy(point);

        if (!this.viewer.impl.overlayScenes['clash-markers']) {
            this.viewer.impl.createOverlayScene('clash-markers');
        }
        this.viewer.impl.overlayScenes['clash-markers'].add(sphere);
        this.clashMarkers.push(sphere);
        this.viewer.impl.invalidate(true);
    }

    initOverlays() {
        if (!this.viewer.impl.overlayScenes['clash-markers']) {
            this.viewer.impl.createOverlayScene('clash-markers');
        }
    }

    resetState() {
        this.clear();
        this.viewer.setGhosting(false);
        this.viewer.clearSelection();
        this.viewer.clearThemingColors(); // Clear theming colors here
    }

    clear() {
        if (this.viewer.impl.overlayScenes['clash-markers']) {
            this.viewer.impl.clearOverlay('clash-markers');
        }
        this.clashMarkers = [];
        this.viewer.clearThemingColors();
        this.viewer.impl.invalidate(true);
    }
}
