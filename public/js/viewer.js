/* ============================================================
   viewer.js — APS Viewer (ES6 Module)
   ============================================================ */

async function getAccessToken(callback) {
    try {
        const resp = await fetch('/api/auth/token');
        if (!resp.ok) throw new Error(await resp.text());
        const { access_token, expires_in } = await resp.json();
        callback(access_token, expires_in);
    } catch (err) {
        console.error('Could not obtain access token:', err);
    }
}

let _initializerPromise = null;

function ensureInitialized() {
    if (!_initializerPromise) {
        _initializerPromise = new Promise((resolve) => {
            Autodesk.Viewing.Initializer({ env: 'AutodeskProduction', getAccessToken }, () => {
                resolve();
            });
        });
    }
    return _initializerPromise;
}

export async function initViewer(container) {
    await ensureInitialized();
    const config = {
        extensions: [
            'Autodesk.DocumentBrowser',
            'NavisClashExtension'
        ],
        preserveDrawingBuffer: true
    };
    const viewer = new Autodesk.Viewing.GuiViewer3D(container, config);
    viewer.start();
    viewer.setTheme('dark-theme');
    return viewer;
}

/**
 * 1. URN 인코딩 전용 유틸리티 함수 (사용자 요청 강제 적용)
 * @param {string} rawUrn 
 */
export function getSafeUrn(rawUrn) {
    if (!rawUrn) return null;

    let cleanUrn = rawUrn.trim();
    if (cleanUrn.startsWith('urn:')) {
        cleanUrn = cleanUrn.substring(4);
    }

    console.log("[DEBUG] Raw ID before safe process:", cleanUrn);

    // 1. 이미 인코딩된 형식이면 (-)와 (_)로 안전한 Base64 형식을 유지함
    if (cleanUrn.startsWith('dXJu') || cleanUrn.startsWith('ZFhKd')) {
        // 이미 인코딩된 경우 패딩(=)만 제거
        return 'urn:' + cleanUrn.replace(/=/g, '');
    }

    // 2. 인코딩되지 않은 경우, URL-safe Base64로 인코딩 수행
    const rawToEncode = cleanUrn.startsWith('urn:') ? cleanUrn : ('urn:' + cleanUrn);
    const encoded = btoa(rawToEncode)
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=/g, '');
    return 'urn:' + encoded;
}

/**
 * Loads a model into the viewer.
 * @param {Autodesk.Viewing.Viewer3D} viewer 
 * @param {string} rawId Base64 encoded URN or raw URN
 */
export function loadModel(viewer, rawId) {
    return new Promise((resolve, reject) => {
        // 4. URN 전달 안됨 에러 로그 보완
        if (!rawId) {
            console.error(`[Viewer Error] loadModel 호출 에러: 전달된 URN 값이 비어있습니다. (받은 값: ${rawId})`);
            return reject(new Error(`유효한 URN 파라미터가 없습니다. (받은 값: ${rawId})`));
        }

        // 사용자 요청에 따른 최종 URN 생성
        const finalUrn = getSafeUrn(rawId);

        // [CRITICAL CHECK] 중복 여부 확인용 로그
        console.log("[CRITICAL CHECK] Final URN to Load:", finalUrn);

        if (!finalUrn) {
            console.error(`[Viewer Error] URN 정제 실패: getSafeUrn 결과가 유효하지 않습니다. (원본: ${rawId})`);
            return reject(new Error(`정제된 최종 URN이 없습니다. (원본: ${rawId})`));
        }

        Autodesk.Viewing.Document.load(finalUrn, (doc) => {
            const root = doc.getRoot();
            const viewables = root.getDefaultGeometry();
            if (!viewables) {
                return reject(new Error('Document contains no viewable geometry.'));
            }

            // [추가] 모델 이름 및 버전 정보 UI 업데이트 (에러 방지를 위한 try-catch 및 안전한 접근 방식 사용)
            try {
                let modelName = 'Unknown Model';
                if (root) {
                    // 1. 최신 규격 시도
                    if (typeof root.name === 'function') modelName = root.name();
                    else if (root.data && root.data.name) modelName = root.data.name;
                    else if (typeof root.getName === 'function') modelName = root.getName();
                }

                // [추가] 만약 root에서 이름을 못 찾았다면 뷰어 현재 모델 데이터에서 시도 (방어 코드)
                if ((!modelName || modelName === 'Unknown Model') && viewer.model) {
                    const modelData = viewer.model.getData();
                    if (modelData && modelData.name) modelName = modelData.name;
                    else if (viewer.model.getDocumentNode() && viewer.model.getDocumentNode().data) {
                        modelName = viewer.model.getDocumentNode().data.name;
                    }
                }

                // 파일명에서 버전 정보 추출 시도 (예: ..._V2.rvt)
                let versionSuffix = '';
                const vMatch = modelName.match(/_V(\d+)/i) || modelName.match(/ver\.?\s?(\d+)/i);
                if (vMatch) {
                    versionSuffix = ` (Ver. ${vMatch[1]})`;
                }

                const fullDisplayName = modelName + versionSuffix;
                console.log(`[Viewer] Updating UI title to: ${fullDisplayName}`);

                // [Updated] Use centralized sync utility if available
                if (window.syncUIState) {
                    window.syncUIState(fullDisplayName, { urn: finalUrn });
                } else {
                    const topBarTitle = document.getElementById('viewer-model-name');
                    if (topBarTitle) topBarTitle.textContent = fullDisplayName;

                    const infoBarLabel = document.getElementById('model-name-label');
                    if (infoBarLabel) infoBarLabel.textContent = fullDisplayName;
                }
            } catch (titleErr) {
                console.warn('[Viewer] 제목 업데이트 중 오류 발생 (무시하고 로드 진행):', titleErr);
            }

            const onTreeCreated = () => {
                viewer.removeEventListener(Autodesk.Viewing.OBJECT_TREE_CREATED_EVENT, onTreeCreated);
                console.log(`[Viewer] Model successfully loaded: ${finalUrn}`);
                resolve(doc);
            };
            viewer.addEventListener(Autodesk.Viewing.OBJECT_TREE_CREATED_EVENT, onTreeCreated);

            // [Harness-Context] 모델 로드 완료 시 상태 인식 하네스 가동
            viewer.addEventListener(Autodesk.Viewing.GEOMETRY_LOADED_EVENT, () => {
                console.log('[Viewer] GEOMETRY_LOADED - Harness-Context 가동');
                try {
                    if (window.ContextHarness) {
                        window.ContextHarness.extract(viewer);
                    }
                    if (window.syncUIState) {
                        const metadataName = viewer.model.getData().metadata?.name || viewer.model.getDocumentNode()?.data.name;
                        window.syncUIState(metadataName, { urn: finalUrn });
                    }
                } catch (loadErr) {
                    console.error('[Viewer] Context extraction failed:', loadErr);
                }
            }, { once: true });

            viewer.loadDocumentNode(doc, viewables);
        }, async (code, msg) => {
            console.error('Load Failed:', code, msg);

            // 400 에러 발생 시 Translation(변환) 상태 체크 (사용자 요청)
            try {
                const statusUrl = `/api/aps/model/${finalUrn.replace('urn:', '')}/status`;
                const statusResp = await fetch(statusUrl, {
                    headers: { 'Accept': 'application/json' }
                });

                const contentType = statusResp.headers.get("content-type");
                if (!statusResp.ok || !contentType || !contentType.includes("application/json")) {
                    const errText = await statusResp.text();
                    reject(new Error(`Load Error ${code}: ${msg} (상태 확인 API 비정상 응답: ${statusResp.status} - ${errText})`));
                    return;
                }

                const statusData = await statusResp.json();
                console.warn('[Viewer] Loader Error Fallback - Translation Status:', statusData);

                const statusMsg = statusData.status === 'success' ? '성공(데이터 형식 대조 필요)' : (statusData.status || '변환 데이터 없음');
                reject(new Error(`Load Error ${code}: ${msg} (변환 상태: ${statusMsg}, 진행률: ${statusData.progress || '0%'})`));
            } catch (err) {
                reject(new Error(`Load Error ${code}: ${msg} (상태 확인 실패)`));
            }
        });
    });
}

/**
 * Wrapper for loadModel that can be used for tracking or extended UI logic.
 */
export async function loadModelWithTracking(viewer, rawId, modelName = 'Model') {
    console.log(`[Viewer] Loading model with tracking: ${modelName}`);
    try {
        await loadModel(viewer, rawId);
        console.log(`[Viewer] Successfully loaded: ${modelName}`);
    } catch (err) {
        console.error(`[Viewer] Failed to load ${modelName}:`, err);
        throw err;
    }
}

/**
 * ── Version Comparison Feature ──
 * 두 개의 버전을 화면을 분할하여 비교하는 로직
 */
window.compareModels = async (urn1, urn2) => {
    console.log('--- [CompareModels] Custom Dual-Viewer START ---');

    // Step 1: 팝업 즉시 제거
    const modal = document.getElementById('version-modal');
    if (modal) modal.style.display = 'none';
    const genericModal = document.querySelector('.modal');
    if (genericModal) genericModal.style.display = 'none';

    const finalUrn1 = getSafeUrn(urn1);
    const finalUrn2 = getSafeUrn(urn2);

    const mainViewer = window._viewer;
    const comparisonContainer = document.getElementById('comparison-container');
    const previewElem = document.getElementById('preview');

    // Step 2: UI 전환
    if (mainViewer) mainViewer.tearDown();
    if (previewElem) previewElem.style.display = 'none';
    if (comparisonContainer) {
        comparisonContainer.style.display = 'flex';
        // Force Reflow & Resize
        window.dispatchEvent(new Event('resize'));
    }

    // Step 3: 뷰어 인스턴스 생성
    const containerL = document.getElementById('viewer-left');
    const containerR = document.getElementById('viewer-right');
    containerL.innerHTML = '';
    containerR.innerHTML = '';

    await ensureInitialized();

    window.viewerLeft = new Autodesk.Viewing.GuiViewer3D(containerL, { preserveDrawingBuffer: true });
    window.viewerRight = new Autodesk.Viewing.GuiViewer3D(containerR, { preserveDrawingBuffer: true });

    window.viewerLeft.start();
    window.viewerRight.start();
    window.viewerLeft.setTheme('dark-theme');
    window.viewerRight.setTheme('dark-theme');

    // [Fix 1] Disable "bounce" (Home View Animation)
    window.viewerLeft.prefs.set('disableHomeViewAnimation', true);
    window.viewerRight.prefs.set('disableHomeViewAnimation', true);

    // Step 4: 모델 로드
    const loadDoc = (v, urn) => new Promise((resolve, reject) => {
        Autodesk.Viewing.Document.load(urn, (doc) => {
            const viewables = doc.getRoot().getDefaultGeometry();
            v.loadDocumentNode(doc, viewables).then(resolve).catch(reject);
        }, reject);
    });

    try {
        await Promise.all([
            loadDoc(window.viewerLeft, finalUrn1),
            loadDoc(window.viewerRight, finalUrn2)
        ]);

        // [Fix 3] Automate Data Connection (Run Diff immediately)
        const { setCompareViewers, runDiff, visualizeDiff, initCameraSync, cleanupCameraSync } = await import('./diff-viewer.js');
        setCompareViewers(window.viewerLeft, window.viewerRight);

        // Run client-side diff
        console.log('[CompareModels] Triggering automated runDiff...');
        const diffResults = await runDiff(null, urn1, urn2); // IDs not strictly needed for client-side diff
        visualizeDiff(diffResults);

        // Ensure the results columns are visible
        const columnsPanel = document.getElementById('diff-results-three-columns');
        if (columnsPanel) columnsPanel.style.display = 'flex';

        // Step 5: 카메라 동기화 (Centralized Event-Lock logic)
        initCameraSync(window.viewerLeft, window.viewerRight);

        window.viewerLeft.fitToView();
        window.viewerRight.fitToView();

        // Step 6: 종료 버튼
        const btnExit = document.getElementById('exit-compare-btn');
        if (btnExit) {
            btnExit.onclick = () => {
                console.log('Exiting Compare Mode...');
                // Cleanup dual viewers
                if (window.viewerLeft && window.viewerRight) {
                    cleanupCameraSync(window.viewerLeft, window.viewerRight);
                }
                if (window.viewerLeft) { window.viewerLeft.finish(); window.viewerLeft = null; }
                if (window.viewerRight) { window.viewerRight.finish(); window.viewerRight = null; }

                // Hide comparison UI
                if (comparisonContainer) comparisonContainer.style.display = 'none';

                // Restore main viewer
                if (previewElem) previewElem.style.display = 'block';
                if (window._viewer) {
                    window._viewer.start();
                    loadModel(window._viewer, finalUrn1);
                }

                // Clear any leftover diff results (imported from diff-viewer.js)
                if (window.exitCompareMode) window.exitCompareMode();

                window.dispatchEvent(new Event('resize'));
            };
        }

        console.log('--- [CompareModels] Custom Dual-Viewer SUCCESS ---');
        window.dispatchEvent(new Event('resize'));

    } catch (err) {
        console.error('--- [CompareModels] FAILED ---', err);
        alert('모델 비교 로드 중 오류가 발생했습니다.');
    }
};
/**
 * 모델 데이터에서 통계와 요약 정보를 추출합니다.
 */
async function extractModelSummary(viewer, model) {
    if (!model) return null;
    const summary = {
        name: model.getData()?.loadOptions?.bubbleNode?.name() || 'Unknown Model',
        urn: model.getUrn() || 'Unknown URN', // [추가] 모델 고유 URN 추출
        totalElements: 0,
        categories: {}
    };

    const targetCategories = ['Walls', 'Floors', 'Windows', 'Doors', 'Structural Columns', 'Stairs', 'Pipes', 'Ducts', 'Ceilings'];

    const getCount = (cat) => new Promise(res => {
        viewer.search(cat, (ids) => res(ids.length), (err) => res(0), ['Category']);
    });

    for (const cat of targetCategories) {
        const count = await getCount(cat);
        if (count > 0) {
            summary.categories[cat] = count;
            summary.totalElements += count;
        }
    }
    console.log('[Viewer] Final Summary:', summary);
    return summary;
}
