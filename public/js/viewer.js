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
            'NavisClashExtension',
            'Autodesk.Viewing.MarkupsCore'
        ],
        preserveDrawingBuffer: true
    };
    const viewer = new Autodesk.Viewing.GuiViewer3D(container, config);
    viewer.start();
    viewer.setTheme('dark-theme');
    return viewer;
}

/**
 * 1. URN 인코딩 전용 유틸리티 함수
 */
export function getSafeUrn(rawUrn) {
    if (!rawUrn) return null;

    let cleanUrn = rawUrn.trim();
    if (cleanUrn.startsWith('urn:')) {
        cleanUrn = cleanUrn.substring(4);
    }

    // 1. 이미 인코딩된 형식이면 (-)와 (_)로 안전한 Base64 형식을 유지함
    if (cleanUrn.startsWith('dXJu') || cleanUrn.startsWith('ZFhKd')) {
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
 */
export function loadModel(viewer, rawId) {
    return new Promise((resolve, reject) => {
        if (!rawId) {
            console.error(`[Viewer Error] loadModel 호출 에러: URN이 없습니다.`);
            return reject(new Error(`유효한 URN 파라미터가 없습니다.`));
        }

        const finalUrn = getSafeUrn(rawId);
        console.log("[CRITICAL CHECK] Final URN to Load:", finalUrn);

        Autodesk.Viewing.Document.load(finalUrn, (doc) => {
            const root = doc.getRoot();
            const viewables = root.getDefaultGeometry();
            if (!viewables) {
                return reject(new Error('Document contains no viewable geometry.'));
            }

            // 모델 이름 및 버전 정보 UI 업데이트
            try {
                let modelName = 'Unknown Model';
                if (root) {
                    if (typeof root.name === 'function') modelName = root.name();
                    else if (root.data && root.data.name) modelName = root.data.name;
                    else if (typeof root.getName === 'function') modelName = root.getName();
                }

                if ((!modelName || modelName === 'Unknown Model') && viewer.model) {
                    const modelData = viewer.model.getData();
                    if (modelData && modelData.name) modelName = modelData.name;
                    else if (viewer.model.getDocumentNode() && viewer.model.getDocumentNode().data) {
                        modelName = viewer.model.getDocumentNode().data.name;
                    }
                }

                // 파일명에서 버전 정보 추출 시도
                let versionSuffix = '';
                const vMatch = modelName.match(/_V(\d+)/i) || modelName.match(/ver\.?\s?(\d+)/i);
                if (vMatch) {
                    versionSuffix = ` (Ver. ${vMatch[1]})`;
                }

                const fullDisplayName = modelName + versionSuffix;
                console.log(`[Viewer] Updating UI title to: ${fullDisplayName}`);

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
                resolve(doc);
            };
            viewer.addEventListener(Autodesk.Viewing.OBJECT_TREE_CREATED_EVENT, onTreeCreated);

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
            reject(new Error(`Load Error ${code}: ${msg}`));
        });
    });
}

export async function loadModelWithTracking(viewer, rawId, modelName = 'Model') {
    try {
        await loadModel(viewer, rawId);
    } catch (err) {
        console.error(`[Viewer] Failed to load ${modelName}:`, err);
        throw err;
    }
}

window.compareModels = async (urn1, urn2) => {
    const modal = document.getElementById('version-modal');
    if (modal) modal.style.display = 'none';

    const finalUrn1 = getSafeUrn(urn1);
    const finalUrn2 = getSafeUrn(urn2);

    const mainViewer = window._viewer;
    const comparisonContainer = document.getElementById('comparison-container');
    const previewElem = document.getElementById('preview');

    if (mainViewer) mainViewer.tearDown();
    if (previewElem) previewElem.style.display = 'none';
    if (comparisonContainer) comparisonContainer.style.display = 'flex';

    window.dispatchEvent(new Event('resize'));

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

    window.viewerLeft.prefs.set('disableHomeViewAnimation', true);
    window.viewerRight.prefs.set('disableHomeViewAnimation', true);

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

        const { setCompareViewers, runDiff, visualizeDiff, initCameraSync, cleanupCameraSync } = await import('./diff-viewer.js');
        setCompareViewers(window.viewerLeft, window.viewerRight);

        const diffResults = await runDiff(null, urn1, urn2);
        visualizeDiff(diffResults);

        const columnsPanel = document.getElementById('diff-results-three-columns');
        if (columnsPanel) columnsPanel.style.display = 'flex';

        initCameraSync(window.viewerLeft, window.viewerRight);

        window.viewerLeft.fitToView();
        window.viewerRight.fitToView();

        const btnExit = document.getElementById('exit-compare-btn');
        if (btnExit) {
            btnExit.onclick = () => {
                if (window.viewerLeft && window.viewerRight) cleanupCameraSync(window.viewerLeft, window.viewerRight);
                if (window.viewerLeft) { window.viewerLeft.finish(); window.viewerLeft = null; }
                if (window.viewerRight) { window.viewerRight.finish(); window.viewerRight = null; }
                if (comparisonContainer) comparisonContainer.style.display = 'none';
                if (previewElem) previewElem.style.display = 'block';
                if (window._viewer) {
                    window._viewer.start();
                    loadModel(window._viewer, finalUrn1);
                }
                if (window.exitCompareMode) window.exitCompareMode();
                window.dispatchEvent(new Event('resize'));
            };
        }
    } catch (err) {
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
        urn: model.getUrn() || 'Unknown URN',
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
