/**
 * public/js/diff-viewer.js
 * Handles the Split Viewer logic and local client-side model comparison.
 */

import { initViewer, loadModel } from './viewer.js';
import { addCustomButtons } from './toolbar-utils.js';

let viewers = []; // [viewers[0]: Old, viewers[1]: New]
export function setCompareViewers(vA, vB) {
    viewers = [vA, vB];
}
export function getCompareViewers() {
    return viewers;
}

let currentDiffData = null;
let isSyncing = false;
let rAF = null;

// Revit elements to exclude from diff (centerlines, axes, separators, etc.)
const REVIT_EXCLUDE_KEYWORDS = [
    'centerline', 'center line', 'centre line',
    '<room separation>', '<area boundary>', '<stair path>',
    'grid', 'level', 'scopebox', 'scope box'
];

function isCenterlineObject(data) {
    const name = (data.name || '').toLowerCase();
    const cat = (data.category || '').toLowerCase();
    return REVIT_EXCLUDE_KEYWORDS.some(kw => name.includes(kw) || cat.includes(kw));
}

const COLORS = {
    added: new THREE.Vector4(0, 1, 0, 0.7),    // Green
    removed: new THREE.Vector4(1, 0, 0, 0.7),  // Red
    changed: new THREE.Vector4(1, 1, 0, 0.7),  // Yellow
    ghost: new THREE.Vector4(0.5, 0.5, 0.5, 0.1) // Subtle Transparent Grey
};

// ── Camera Sync Event Listeners Storage ─────────────────────────────
const syncHandlers = new Map();

/**
 * Initializes synchronized camera movement between two viewers.
 * @param {Autodesk.Viewing.GuiViewer3D} vA 
 * @param {Autodesk.Viewing.GuiViewer3D} vB 
 */
export function initCameraSync(vA, vB) {
    if (!vA || !vB) return;

    // Clean up any existing listeners first to be safe
    cleanupCameraSync(vA, vB);

    let activeMaster = null;
    let lastPos = { x: 0, y: 0, z: 0 };
    let lastTgt = { x: 0, y: 0, z: 0 };

    const onCameraChange = (src, dst, label) => {
        if (isSyncing) return;
        if (src !== activeMaster) return;

        const nav = src.navigation;
        const pos = nav.getPosition();
        const tgt = nav.getTarget();

        // 0.0001 Threshold Check
        const dP = Math.abs(pos.x - lastPos.x) + Math.abs(pos.y - lastPos.y) + Math.abs(pos.z - lastPos.z);
        const dT = Math.abs(tgt.x - lastTgt.x) + Math.abs(tgt.y - lastTgt.y) + Math.abs(tgt.z - lastTgt.z);

        if (dP < 0.0001 && dT < 0.0001) return;

        // Sync using requestAnimationFrame
        if (rAF) cancelAnimationFrame(rAF);
        rAF = requestAnimationFrame(() => {
            isSyncing = true;
            try {
                lastPos = { x: pos.x, y: pos.y, z: pos.z };
                lastTgt = { x: tgt.x, y: tgt.y, z: tgt.z };

                // Use a safe way to get/set UpVector across different Viewer versions
                const up = (typeof nav.getUpVector === 'function')
                    ? nav.getUpVector()
                    : (typeof nav.getCameraUpVector === 'function' ? nav.getCameraUpVector() : { x: 0, y: 0, z: 1 });

                dst.navigation.setView(pos, tgt);
                if (dst.navigation.setUpVector) {
                    dst.navigation.setUpVector(up);
                }
                dst.impl.invalidate(true);
            } catch (e) {
                console.warn(`[CameraSync] ${label} error:`, e.message);
            } finally {
                // Reset lock in a tiny delay to ensure setView events are swallowed
                setTimeout(() => { isSyncing = false; }, 0);
                rAF = null;
            }
        });
    };

    const hA = () => onCameraChange(vA, vB, 'A→B');
    const hB = () => onCameraChange(vB, vA, 'B→A');

    const mEnterA = () => { activeMaster = vA; };
    const mEnterB = () => { activeMaster = vB; };

    // Store for cleanup
    syncHandlers.set(vA, { camera: hA, enter: mEnterA });
    syncHandlers.set(vB, { camera: hB, enter: mEnterB });

    vA.addEventListener(Autodesk.Viewing.CAMERA_CHANGE_EVENT, hA);
    vB.addEventListener(Autodesk.Viewing.CAMERA_CHANGE_EVENT, hB);
    vA.container.addEventListener('mouseenter', mEnterA);
    vB.container.addEventListener('mouseenter', mEnterB);

    console.log('[CameraSync] Initialized Event-Lock for Split Viewers');
}

/**
 * Removes all synchronization listeners from the viewers.
 */
export function cleanupCameraSync(vA, vB) {
    [vA, vB].forEach(v => {
        if (!v) return;
        const h = syncHandlers.get(v);
        if (h) {
            v.removeEventListener(Autodesk.Viewing.CAMERA_CHANGE_EVENT, h.camera);
            if (v.container) v.container.removeEventListener('mouseenter', h.enter);
            syncHandlers.delete(v);
        }
    });
    isSyncing = false;
    if (rAF) cancelAnimationFrame(rAF);
    rAF = null;
    console.log('[CameraSync] Cleanup complete');
}

/**
 * Adds a comparison button to the viewer toolbar.
 */
export function addToolbarButton(viewer, onClick) {
    const toolbar = viewer.getToolbar(true);
    if (!toolbar) return;
    const navGroup = toolbar.getControl(Autodesk.Viewing.TOOLBAR.NAVTOOLGROUP);
    if (!navGroup) return;
    if (toolbar.getControl('compare-versions-tool')) return;

    const compareButton = new Autodesk.Viewing.UI.Button('compare-versions-tool');
    compareButton.addClass('compare-tool-icon');
    compareButton.setToolTip('버전별 비교 (Compare Versions)');
    compareButton.onClick = onClick;
    compareButton.icon.innerText = '◫';
    compareButton.icon.style.fontSize = '20px';
    compareButton.icon.style.lineHeight = '24px';
    navGroup.addControl(compareButton);
}

/**
 * Initializes two viewers side-by-side with proper ViewCube support.
 */
export async function initSplitViewers() {
    if (viewers.length === 0) {
        // [중요] 실제 index.html의 ID인 viewer-left, viewer-right를 사용해야 함
        const vA = await initViewer(document.getElementById('viewer-left'));
        const vB = await initViewer(document.getElementById('viewer-right'));
        viewers = [vA, vB];

        // ── Load Buttons & ViewCube ──────────────────────────────────────────
        [vA, vB].forEach((v, idx) => {
            v.addEventListener(Autodesk.Viewing.TOOLBAR_CREATED_EVENT, () => {
                addCustomButtons(v);
            });
            loadViewCubeExtension(v, `Viewer${idx === 0 ? 'A' : 'B'}`);

            // [고도화] 이벤트 기반 모델명 데이터 바인딩 (강제 전수조사 헬퍼 호출)
            v.addEventListener(Autodesk.Viewing.GEOMETRY_LOADED_EVENT, () => {
                forceUpdateModelUI(v, idx);
            });
        });

        // ── 헬퍼 함수: 특정 요소나 텍스트를 찾아 모델명 강제 주입 ───────────────────────
        function forceUpdateModelUI(viewer, index) {
            const model = viewer.model;
            if (!model) return;

            // [1] 이름 추출 (사용자 지정 우선순위)
            const modelName = model.getDocumentNode()?.data?.name ||
                model.getData()?.loadOptions?.bubbleNode?.getDisplayName() ||
                model.getMetadata('name') ||
                "Unknown Model";

            const labelKey = index === 0 ? 'slot-a-name' : 'slot-b-name';
            console.log(`[Diff][Force] Viewer ${index === 0 ? 'A' : 'B'} name sync: ${modelName}`);

            // 1. ID로 직접 업데이트
            const elById = document.getElementById(labelKey);
            if (elById) elById.textContent = modelName;

            // 2. [사용자 요청] 전수 조사: 상단바에서 "Select from tree..." 텍스트를 가진 요소 모두 교체
            const allSlotValues = document.querySelectorAll('.slot-value, .version-info, .version-label');
            allSlotValues.forEach(el => {
                if (el.textContent.includes('Select from tree...')) {
                    // index 0이면 A측, index 1이면 B측 요소를 매칭 (부모가 slot-a/b 인지 확인)
                    const isSideA = el.closest('#slot-a') || el.id === 'slot-a-name' || el.classList.contains('slot-a');
                    const isSideB = el.closest('#slot-b') || el.id === 'slot-b-name' || el.classList.contains('slot-b');

                    if (index === 0 && isSideA) el.textContent = modelName;
                    if (index === 1 && isSideB) el.textContent = modelName;

                    // 만약 구분이 모호하다면 텍스트 내용만으로 임시 교체
                    if (!isSideA && !isSideB) {
                        el.textContent = modelName;
                    }
                }
            });
        }
        window.forceUpdateModelUI = forceUpdateModelUI; // 타 파일(main.js 등)에서도 인지 가능하도록 등록


        // ── ViewCube debug + smooth-transition override ───────────────────────
        const patchViewCube = (viewer, label) => {
            // VIEW_CUBE_EVENT fires when the user clicks a face/edge/corner
            const VIEW_CUBE_EVENT = 'viewCubeTriggered';
            try {
                viewer.addEventListener(VIEW_CUBE_EVENT, (ev) => {
                    console.log(`[ViewCube] ${label} clicked:`, ev);
                    // Ensure smooth transition is enabled
                    if (viewer.navigation) {
                        viewer.navigation.setRequestTransition(true);
                    }
                });
            } catch (e) {
                // Event name may differ across Viewer versions — use a DOM fallback below
            }

            // Fallback: listen on the canvas for mousedown originating in the
            // ViewCube container and log it for diagnosis.
            const cubeEl = viewer.container?.querySelector('.viewcubeWrapper, .adsk-viewing-viewer');
            if (cubeEl) {
                cubeEl.addEventListener('mousedown', (e) => {
                    console.log(`[ViewCube][DOM] ${label} mousedown on viewer`, e.target?.className);
                }, { capture: true });
            }
        };

        patchViewCube(viewers[0], 'ViewerA');
        patchViewCube(viewers[1], 'ViewerB');

        // ── Selection handler ─────────────────────────────────────────────────
        let isSelectingSelf = false;

        const handleSelection = (srcViewer, dstViewer, srcLabel, ev) => {
            const dbIds = ev.dbIdArray;
            if (!dbIds || dbIds.length === 0) return;
            const dbId = dbIds[0];

            console.log(`[${srcLabel}] dbId ${dbId} 속성 요청 중...`);

            if (!isSelectingSelf) {
                isSelectingSelf = true;
                dstViewer.clearSelection();
                isSelectingSelf = false;
            }

            const panel = srcViewer.getPropertyPanel
                ? srcViewer.getPropertyPanel()
                : (srcViewer._toolbar && srcViewer._toolbar._propPanel);

            if (!panel) {
                console.warn(`[${srcLabel}] Property panel not found.`);
                return;
            }

            // 특성창의 뷰어 참조 강제 변경 (동기화 픽스)
            panel.viewer = srcViewer;

            // requestNodeProperties 함수 재정의 (클릭 시마다 모델 확인)
            if (!panel._isSyncPatched) {
                panel.requestNodeProperties = function (id) {
                    const activeViewer = this.viewer;
                    const activeModel = activeViewer.model;
                    console.log(`[PropertyPanel] Fetching properties for dbId: ${id} from model:`, activeModel?.getUrn());

                    if (activeModel) {
                        activeModel.getProperties(id, (result) => {
                            this.setProperties(result.properties || [], result.name);
                        }, (err) => {
                            console.error(`[PropertyPanel] Failed to fetch properties for dbId: ${id}`, err);
                        });
                    }
                };
                panel._isSyncPatched = true;
            }

            panel.setNodeProperties(dbId);
        };

        viewers[0].addEventListener(Autodesk.Viewing.SELECTION_CHANGED_EVENT,
            (ev) => handleSelection(viewers[0], viewers[1], 'Viewer A', ev));
        viewers[1].addEventListener(Autodesk.Viewing.SELECTION_CHANGED_EVENT,
            (ev) => handleSelection(viewers[1], viewers[0], 'Viewer B', ev));
    }
    return { viewerA: viewers[0], viewerB: viewers[1] };
}

/**
 * Loads the ViewCube extension on a viewer and ensures navigation is active.
 * @param {Autodesk.Viewing.GuiViewer3D} viewer
 * @param {string} label - For logging
 */
async function loadViewCubeExtension(viewer, label) {
    try {
        // The ViewCube is bundled inside Autodesk.ViewCubeUi
        const extName = 'Autodesk.ViewCubeUi';
        let ext = viewer.getExtension(extName);
        if (!ext) {
            ext = await viewer.loadExtension(extName);
        }
        if (ext && typeof ext.displayViewCube === 'function') {
            ext.displayViewCube(true); // Make sure cube is visible
        }
        // Ensure the viewer's navigation tool is the active tool
        if (viewer.toolController) {
            viewer.toolController.activateTool('orbit');
        }
        if (viewer.navigation) {
            viewer.navigation.setRequestTransition(true);
        }
        console.log(`[ViewCube] ${label}: ViewCube extension loaded & navigation activated.`);
    } catch (e) {
        console.warn(`[ViewCube] ${label}: Could not load ViewCube extension:`, e.message);
    }
}




/**
 * Loads models into the split views.
 */
export async function loadVersions(urnA, urnB) {
    console.log('[Diff] loadVersions started...');
    await initSplitViewers();

    // 모델 로드 수행
    await Promise.all([loadModel(viewers[0], urnA), loadModel(viewers[1], urnB)]);

    // [강제 업데이트] 로드 완료 후 즉시 이름 주입 (이벤트가 씹히는 경우 대비)
    [0, 1].forEach(idx => {
        const v = viewers[idx];
        if (v && v.model) {
            const name = v.model.getDocumentNode()?.data?.name ||
                v.model.getData()?.loadOptions?.bubbleNode?.getDisplayName() ||
                "Unknown Model";

            const elId = idx === 0 ? 'slot-a-name' : 'slot-b-name';
            const el = document.getElementById(elId);

            if (el) {
                el.textContent = name;
                console.log(`[Manual UI Update] ${elId} successfully set to: ${name}`);
            } else {
                console.error(`[Manual UI Update] Element not found: ${elId}`);
            }
        }
    });
}

/**
 * Client-side: Extracts and maps properties of all leaf nodes by externalId.
 */
async function getModelMap(viewer) {
    return new Promise(async (resolve, reject) => {
        const model = viewer.model;
        if (!model) return reject(new Error('Viewer model is not loaded.'));

        const getTree = () => model.getInstanceTree();
        let it = getTree();

        // Safety wait if tree isn't immediately available
        if (!it) {
            console.warn('[Diff] Instance tree not ready, waiting...');
            await new Promise(res => {
                const onTree = () => {
                    viewer.removeEventListener(Autodesk.Viewing.OBJECT_TREE_CREATED_EVENT, onTree);
                    res();
                };
                viewer.addEventListener(Autodesk.Viewing.OBJECT_TREE_CREATED_EVENT, onTree);
                setTimeout(res, 5000);
            });
            it = getTree();
        }

        if (!it) return reject(new Error('Instance tree could not be loaded.'));

        const map = new Map();
        const leafIds = [];

        it.enumNodeChildren(it.getRootId(), (dbId) => {
            if (it.getChildCount(dbId) === 0) leafIds.push(dbId);
        }, true);

        let processed = 0;
        const total = leafIds.length;
        if (total === 0) return resolve(map);

        const chunkSize = 100;
        function processNext() {
            const end = Math.min(processed + chunkSize, total);
            const chunk = leafIds.slice(processed, end);

            model.getBulkProperties(chunk, { propagate: true }, (props) => {
                props.forEach(p => {
                    const extId = p.externalId || (p.properties.find(pr => pr.displayName === 'GlobalId')?.displayValue);
                    if (extId) {
                        map.set(extId, {
                            dbId: p.dbId,
                            name: p.name,
                            properties: p.properties,
                            externalId: extId,
                            category: p.properties.find(pr => pr.displayName === 'Category')?.displayValue || 'Element',
                            level: p.properties.find(pr => ['Level', 'Base Level', 'Constraint', 'Reference Level'].includes(pr.displayName))?.displayValue || '-'
                        });
                    }
                });
                processed = end;
                if (processed < total) {
                    processNext();
                } else {
                    resolve(map);
                }
            }, (err) => {
                console.error('[Diff] Error in getBulkProperties:', err);
                processed = end;
                if (processed < total) processNext(); else resolve(map);
            });
        }
        processNext();
    });
}

/**
 * Local Comparison Logic:
 * Standardizes comparison of two models in the browser.
 */
export async function runDiff(projectId, prevUrn, curUrn, region, onProgress) {
    console.log(`[CLIENT] Starting local runDiff...`);
    if (onProgress) onProgress(10);

    const [mapOld, mapNew] = await Promise.all([
        getModelMap(viewers[0]),
        getModelMap(viewers[1])
    ]);

    if (onProgress) onProgress(50);

    const added = [];
    const removed = [];
    const changed = [];

    console.log(`[Diff] Matching objects... Old: ${mapOld.size}, New: ${mapNew.size}`);

    // Check for Added and Changed
    mapNew.forEach((data, extId) => {
        if (isCenterlineObject(data)) return;
        if (!mapOld.has(extId)) {
            added.push(data);
        } else {
            const oldData = mapOld.get(extId);
            const diffs = compareProperties(oldData.properties, data.properties);
            if (diffs.length > 0) {
                // Store both dbIds and the list of changes if needed
                changed.push({ ...data, oldDbId: oldData.dbId, diffs });
            }
        }
    });

    // Check for Removed
    mapOld.forEach((data, extId) => {
        if (isCenterlineObject(data)) return;
        if (!mapNew.has(extId)) {
            removed.push(data);
        }
    });

    console.log(`[Diff] Results -> Added: ${added.length}, Removed: ${removed.length}, Changed: ${changed.length}`);
    if (changed.length > 0) {
        console.log(`[Diff] Example Changed Item:`, changed[0].name, changed[0].diffs);
    }

    if (onProgress) onProgress(100);

    currentDiffData = { added, removed, changed };
    return currentDiffData;
}

function compareProperties(propsA, propsB) {
    const TOLERANCE = 0.001;
    const changes = [];

    // Create maps for faster lookup
    const mapA = new Map();
    propsA.forEach(p => { if (p.displayName) mapA.set(p.displayName, p.displayValue); });

    const mapB = new Map();
    propsB.forEach(p => { if (p.displayName) mapB.set(p.displayName, p.displayValue); });

    const allKeys = new Set([...mapA.keys(), ...mapB.keys()]);

    for (const key of allKeys) {
        const valA = mapA.get(key);
        const valB = mapB.get(key);

        if (valA === valB) continue;

        let isDifferent = false;

        // Numeric comparison with tolerance
        const numA = parseFloat(valA);
        const numB = parseFloat(valB);

        if (!isNaN(numA) && !isNaN(numB)) {
            if (Math.abs(numA - numB) > TOLERANCE) {
                isDifferent = true;
            }
        } else {
            // String comparison
            if (String(valA) !== String(valB)) {
                isDifferent = true;
            }
        }

        if (isDifferent) {
            const oldVal = (valA === undefined) ? '(none)' : valA;
            const newVal = (valB === undefined) ? '(none)' : valB;
            changes.push(`${key}: ${oldVal} → <b>${newVal}</b>`);
        }
    }
    return changes;
}

/**
 * Applies color coding and ghosting effects.
 */
export function visualizeDiff(results) {
    if (!results || viewers.length < 2) return;
    viewers[0].clearThemingColors();
    viewers[1].clearThemingColors();

    const applyGhost = (viewer) => {
        const it = viewer.model.getInstanceTree();
        if (!it) return;
        it.enumNodeChildren(it.getRootId(), (dbId) => {
            viewer.setThemingColor(dbId, COLORS.ghost, null, true);
        }, true);
    };
    applyGhost(viewers[0]);
    applyGhost(viewers[1]);

    (results.added || []).forEach(obj => { if (obj.dbId) viewers[1].setThemingColor(obj.dbId, COLORS.added, null, true); });
    (results.removed || []).forEach(obj => { if (obj.dbId) viewers[0].setThemingColor(obj.dbId, COLORS.removed, null, true); });
    (results.changed || []).forEach(obj => {
        if (obj.dbId) {
            viewers[1].setThemingColor(obj.dbId, COLORS.changed, null, true);
            // Also find the relative dbId in viewer 0
            // Since we use externalId mapping, we can store that or find it again.
            // For now, let's focus on the 'current' version highlight.
        }
    });

    updateResultsPanel(results);
}

function updateResultsPanel(results) {
    const columnsPanel = document.getElementById('diff-results-three-columns');
    if (columnsPanel) columnsPanel.style.display = 'flex';

    // Show export & filter toolbars
    const exportBar = document.getElementById('diff-export-toolbar');
    if (exportBar) exportBar.style.display = 'flex';
    const filterBar = document.getElementById('diff-filter-toolbar');
    if (filterBar) filterBar.style.display = 'flex';

    // Collect unique categories from all results
    const allCategories = new Set();
    [...(results.added || []), ...(results.removed || []), ...(results.changed || [])].forEach(obj => {
        if (obj.category) allCategories.add(obj.category);
    });

    const categoriesAdded = new Set((results.added || []).map(o => o.category).filter(Boolean));
    const categoriesRemoved = new Set((results.removed || []).map(o => o.category).filter(Boolean));
    const categoriesChanged = new Set((results.changed || []).map(o => o.category).filter(Boolean));

    // Populate shared dropdown
    populateCategorySelect('filter-all-categories', allCategories, '전체 보기 (All)');
    // Populate per-table dropdowns
    populateCategorySelect('filter-added-categories', categoriesAdded, '카테고리 전체');
    populateCategorySelect('filter-removed-categories', categoriesRemoved, '카테고리 전체');
    populateCategorySelect('filter-changed-categories', categoriesChanged, '카테고리 전체');

    // Update raw counts
    updateCount('count-added-v2', results.added || []);
    updateCount('count-removed-v2', results.removed || []);
    updateCount('count-changed-v2', results.changed || []);

    populateTable('added', results.added || [], 'list-added');
    populateTable('removed', results.removed || [], 'list-removed');
    populateTable('changed', results.changed || [], 'list-changed');

    setupToggles();
}

/** Fills a <select> element with category options, preserving the first "all" option */
function populateCategorySelect(selectId, categorySet, allLabel) {
    const sel = document.getElementById(selectId);
    if (!sel) return;
    sel.innerHTML = `<option value="">${allLabel}</option>`;
    [...categorySet].sort().forEach(cat => {
        const opt = document.createElement('option');
        opt.value = cat;
        opt.textContent = cat;
        sel.appendChild(opt);
    });
    sel.value = ''; // Reset to "all" whenever results change
}

/** Updates a count span with format "(visible/total)" */
function updateCount(spanId, list, visibleOverride) {
    const el = document.getElementById(spanId);
    if (!el) return;
    const total = list.length;
    const visible = visibleOverride !== undefined ? visibleOverride : total;
    el.textContent = visible === total ? `(${total})` : `(${visible}/${total})`;
}

function populateTable(type, list, tbodyId) {
    const tbody = document.getElementById(tbodyId);
    if (!tbody) return;
    tbody.innerHTML = '';

    list.forEach(obj => {
        const tr = document.createElement('tr');
        tr.className = 'diff-row-v2';
        tr.dataset.dbId = obj.dbId; // Store dbId for later extraction (e.g. PDF Export)

        if (type === 'changed') {
            const changesHtml = (obj.diffs || []).join('<br>');
            const changesText = (obj.diffs || []).join('\n').replace(/<b>/g, '').replace(/<\/b>/g, '');
            tr.innerHTML = `
                <td><div class="table-name" title="${obj.name}">${obj.name || 'Unknown'}</div></td>
                <td><span class="category-pill">${obj.category || 'Element'}</span></td>
                <td><span class="level-info">${obj.level || '-'}</span></td>
                <td><div class="table-changes" title="${changesText}">${changesHtml}</div></td>
            `;
        } else {
            tr.innerHTML = `
                <td><div class="table-name" title="${obj.name}">${obj.name || 'Unknown'}</div></td>
                <td><span class="category-pill">${obj.category || 'Element'}</span></td>
                <td><span class="level-info">${obj.level || '-'}</span></td>
            `;
        }

        tr.onclick = async () => {
            document.querySelectorAll('.diff-row-v2').forEach(r => r.classList.remove('selected'));
            tr.classList.add('selected');

            if (type === 'removed') {
                // Object exists in OLD viewer only
                // Navigate both viewers to that object's position
                await navigateBothViewers(viewers[0], obj.dbId, viewers[1], null);
                if (viewers[0]?.model) { viewers[0].select([obj.dbId]); viewers[1].clearSelection(); }
            } else if (type === 'added') {
                // Object exists in NEW viewer only
                await navigateBothViewers(viewers[1], obj.dbId, viewers[0], null);
                if (viewers[1]?.model) { viewers[1].select([obj.dbId]); viewers[0].clearSelection(); }
            } else if (type === 'changed') {
                // Object exists in BOTH viewers - navigate each to its own version
                await navigateBothViewers(viewers[1], obj.dbId, viewers[0], obj.oldDbId);
                if (viewers[1]?.model) viewers[1].select([obj.dbId]);
                if (viewers[0]?.model && obj.oldDbId) viewers[0].select([obj.oldDbId]);
            }
        };
        tbody.appendChild(tr);
    });
}

/**
 * Gets the world bounding box of an object from its fragment list.
 * @param {Autodesk.Viewing.Viewer3D} viewer
 * @param {number} dbId
 * @returns {Promise<THREE.Box3>}
 */
function getObjectBounds(viewer, dbId) {
    return new Promise((resolve, reject) => {
        if (!viewer || !viewer.model) return reject(new Error('Viewer model not loaded'));
        const it = viewer.model.getInstanceTree();
        if (!it) return reject(new Error('Instance tree not ready'));

        const bounds = new THREE.Box3();
        const fragList = viewer.model.getFragmentList();

        it.enumNodeFragments(dbId, (fragId) => {
            const fragBounds = new THREE.Box3();
            fragList.getWorldBounds(fragId, fragBounds);
            bounds.union(fragBounds);
        }, true);

        if (bounds.isEmpty()) {
            return reject(new Error(`Empty bounds for dbId ${dbId}`));
        }
        resolve(bounds);
    });
}

/**
 * Navigates both viewers to the target object's bounding box.
 * 
 * @param {Autodesk.Viewing.Viewer3D} srcViewer - The viewer that "owns" the object
 * @param {number} srcDbId - The dbId in srcViewer
 * @param {Autodesk.Viewing.Viewer3D} dstViewer - The other viewer to sync the camera to
 * @param {number|null} dstDbId - If provided, navigate dstViewer to its own object; otherwise mirror srcViewer
 */
async function navigateBothViewers(srcViewer, srcDbId, dstViewer, dstDbId) {
    // Pause camera sync to prevent interference
    isSyncing = true;

    try {
        // Navigate the source viewer and get its resulting camera state
        if (!srcViewer || !srcViewer.model) throw new Error('Source viewer not ready');
        srcViewer.fitToView([srcDbId], srcViewer.model);

        // Wait for the camera animation to complete (~500ms)
        await new Promise(res => setTimeout(res, 500));

        if (dstViewer && dstViewer.model) {
            if (dstDbId) {
                // Navigate destination viewer to its own version of the object
                dstViewer.fitToView([dstDbId], dstViewer.model);
            } else {
                // Mirror the camera from the source viewer to the destination viewer
                // so the user sees the same spatial area in both panels
                const cameraState = srcViewer.getState({ viewport: true });
                dstViewer.restoreState(cameraState, null, true);
            }
        }
    } catch (err) {
        console.warn('[Diff] navigateBothViewers error:', err.message);
    } finally {
        // Re-enable camera sync after 800ms total
        setTimeout(() => { isSyncing = false; }, 300);
    }
}

function setupToggles() {
    ['added', 'removed', 'changed'].forEach(type => {
        const checkbox = document.getElementById(`toggle-${type}`);
        if (!checkbox) return;
        checkbox.onchange = () => {
            const visible = checkbox.checked;
            const color = visible ? COLORS[type] : null;
            if (type === 'added') applyThemingColorToList(viewers[1], currentDiffData.added || [], color);
            else if (type === 'removed') applyThemingColorToList(viewers[0], currentDiffData.removed || [], color);
            else {
                applyThemingColorToList(viewers[0], currentDiffData.changed || [], color);
                applyThemingColorToList(viewers[1], currentDiffData.changed || [], color);
            }
        };
    });
}

// ── Category Filter ──────────────────────────────────────────────────────────

/**
 * Filters diff table rows by category.
 * @param {'all'|'added'|'removed'|'changed'} scope - 'all' applies to all three tables
 * @param {string} category - empty string means "show all"
 */
window.applyDiffFilter = function (scope, category) {
    if (scope === 'all') {
        // Sync per-table dropdowns to match the shared dropdown
        ['added', 'removed', 'changed'].forEach(type => {
            const sel = document.getElementById(`filter-${type}-categories`);
            if (sel && [...sel.options].some(o => o.value === category)) sel.value = category;
            else if (sel) sel.value = '';
        });
        filterTableByCategory('list-added', category, 'count-added-v2', currentDiffData?.added || []);
        filterTableByCategory('list-removed', category, 'count-removed-v2', currentDiffData?.removed || []);
        filterTableByCategory('list-changed', category, 'count-changed-v2', currentDiffData?.changed || []);
    } else {
        const tbodyId = `list-${scope}`;
        const countId = `count-${scope}-v2`;
        const list = currentDiffData?.[scope] || [];
        filterTableByCategory(tbodyId, category, countId, list);
    }
};

function filterTableByCategory(tbodyId, category, countSpanId, fullList) {
    const tbody = document.getElementById(tbodyId);
    if (!tbody) return;

    let visibleCount = 0;
    [...tbody.querySelectorAll('tr.diff-row-v2')].forEach(tr => {
        const catCell = tr.querySelector('.category-pill');
        const rowCat = catCell ? catCell.textContent.trim() : '';
        const show = !category || rowCat === category;
        tr.style.display = show ? '' : 'none';
        if (show) visibleCount++;
    });

    // Update count badge
    updateCount(countSpanId, fullList, visibleCount);
}

function applyThemingColorToList(viewer, list, color) {
    if (!viewer) return;
    list.forEach(obj => { if (obj.dbId) viewer.setThemingColor(obj.dbId, color, null, true); });
}

export function showDiffList(type) { }

// ── Snapshot Capture Utilities ────────────────────────────────────────────────

/**
 * Captures a screenshot of a single object in the given viewer.
 * Flow: isolate → fitToView → wait for CAMERA_TRANSITION_COMPLETED (or 1.2s) → getScreenShot
 *
 * @param {Autodesk.Viewing.Viewer3D} viewer
 * @param {number} dbId
 * @param {number} [width=400]
 * @param {number} [height=300]
 * @returns {Promise<string>} Base64 DataURL (image/jpeg)
 */
async function captureSnapshotForItem(viewer, dbId, width = 400, height = 300) {
    if (!viewer || !viewer.model) return null;

    try {
        // [1] 객체 고립 및 포커스 (Standard Public API)
        viewer.isolate(dbId);
        viewer.fitToView(dbId);

        // [2] 화면이 완전히 그려질 때까지 넉넉하게 대기 (대형 모델 안정화)
        await new Promise(resolve => setTimeout(resolve, 1000));

        // [3] 하이브리드 스냅샷 시도 (Public API + DOM Fallback)
        return new Promise((resolve) => {
            try {
                // 이전에 'viewer.impl'을 사용하던 로직을 완전히 제거하고 공식 API 우선 사용
                viewer.getScreenShot(width, height, (blobOrUrl) => {
                    if (blobOrUrl && blobOrUrl.length > 500) {
                        console.log(`[Snapshot] Public API success for dbId ${dbId} (len: ${blobOrUrl.length})`);
                        resolve(blobOrUrl);
                    } else {
                        // [4] 공식 API 실패 시 최후의 보루: 브라우저 표준 DOM 방식 캔버스 복제
                        try {
                            const canvas = viewer.canvas || (viewer.container && viewer.container.querySelector('canvas'));
                            if (canvas) {
                                // JPEG 85% 품질로 캔버스 내용 추출
                                const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
                                if (dataUrl && dataUrl.length > 500) {
                                    console.log(`[Snapshot] DOM Canvas success for dbId ${dbId} (len: ${dataUrl.length})`);
                                    resolve(dataUrl);
                                    return;
                                }
                            }
                            resolve(null);
                        } catch (err) {
                            console.error("[Snapshot] Final DOM capture retry failed:", err);
                            resolve(null);
                        }
                    }
                });
            } catch (err) {
                console.error(`[Snapshot] Public API call exception:`, err);
                resolve(null);
            }
        });
    } catch (e) {
        console.error(`[Snapshot] Critical error at dbId ${dbId}:`, e);
        return null;
    }
}

/**
 * Shows / updates the snapshot progress overlay.
 * @param {number} current - Items done so far
 * @param {number} total   - Total items
 * @param {string} [label] - Current item name
 */
function showSnapshotProgress(current, total, label = '') {
    let overlay = document.getElementById('snapshot-progress-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'snapshot-progress-overlay';
        overlay.innerHTML = `
            <div class="sp-inner">
                <p class="sp-title">📸 스냅샷 생성 중...</p>
                <p class="sp-label" id="sp-label"></p>
                <div class="sp-track"><div class="sp-fill" id="sp-fill"></div></div>
                <p class="sp-count" id="sp-count"></p>
            </div>`;
        document.body.appendChild(overlay);
    }

    const pct = total > 0 ? Math.round((current / total) * 100) : 0;
    const fillEl = document.getElementById('sp-fill');
    const labelEl = document.getElementById('sp-label');
    const countEl = document.getElementById('sp-count');

    if (fillEl) fillEl.style.width = pct + '%';
    if (labelEl) labelEl.textContent = label ? `"${label}"` : '';
    if (countEl) countEl.textContent = `${current} / ${total}`;

    overlay.style.display = 'flex';
}

/** Hides the snapshot progress overlay. */
function hideSnapshotProgress() {
    const overlay = document.getElementById('snapshot-progress-overlay');
    if (overlay) overlay.style.display = 'none';
}



/**
 * Fully terminates compare mode.
 * Called by main.js handleExitCompare.
 */
export function exitCompareMode() {
    console.log('[Diff] Exiting compare mode...');

    // 1. Finish (teardown) all split viewers safely
    if (viewers.length > 0) {
        viewers.forEach((v, i) => {
            try {
                if (v && typeof v.finish === 'function') {
                    v.finish();
                    console.log(`[Diff] Viewer ${i} finished.`);
                }
            } catch (e) {
                console.warn(`[Diff] Error finishing viewer ${i}:`, e.message);
            }
        });
        viewers = [];
    }

    // 2. Hide all diff-related panels
    const panelIds = [
        'diff-results-three-columns',
        'diff-export-toolbar',
        'diff-filter-toolbar'
    ];
    panelIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });

    // 3. Reset filter dropdowns to "all"
    ['filter-all-categories', 'filter-added-categories', 'filter-removed-categories', 'filter-changed-categories'].forEach(id => {
        const sel = document.getElementById(id);
        if (sel) sel.value = '';
    });

    // 4. Clear result counts
    ['count-added-v2', 'count-removed-v2', 'count-changed-v2'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.textContent = '(0)';
    });

    // 5. Clear diff data
    currentDiffData = null;

    console.log('[Diff] Compare mode fully exited. All panels hidden, viewers unloaded.');
}

/**
 * Adds a dedicated "Exit Compare" ✕ button to the APS viewer toolbar.
 * Call this once after the toolbar is ready.
 */
export function addExitCompareButton(viewer, onClick) {
    const toolbar = viewer.getToolbar(true);
    if (!toolbar) return;
    if (toolbar.getControl('exit-compare-tool')) return; // Already added

    const btn = new Autodesk.Viewing.UI.Button('exit-compare-tool');
    btn.setToolTip('비교 모드 종료 (Exit Compare)');
    btn.icon.innerText = '✕';
    btn.icon.style.fontSize = '18px';
    btn.icon.style.fontWeight = 'bold';
    btn.icon.style.lineHeight = '28px';
    btn.icon.style.color = '#f87171';
    btn.onClick = onClick;
    btn.setVisible(false); // Hidden by default; shown when compare starts

    const navGroup = toolbar.getControl(Autodesk.Viewing.TOOLBAR.NAVTOOLGROUP);
    if (navGroup) navGroup.addControl(btn);

    return btn; // Return so main.js can toggle visibility
}


// ── Export Functions (window globals for inline onclick) ─────────────────────

window.exportDiffExcel = function () {
    if (!currentDiffData) return alert('내보낼 데이터가 없습니다.');
    const total = (currentDiffData.added?.length || 0) +
        (currentDiffData.removed?.length || 0) +
        (currentDiffData.changed?.length || 0);
    if (total === 0) return alert('내보낼 데이터가 없습니다.');

    const wb = XLSX.utils.book_new();

    const makeSheet = (list, status) => {
        const isChanged = status === 'Changed';
        const headers = ['Name', 'Category', 'Level', 'Status'];
        if (isChanged) headers.splice(3, 0, 'Changes');
        const rows = [headers];

        (list || []).forEach(obj => {
            if (isChanged) {
                const changes = (obj.diffs || []).join('\n').replace(/<b>/g, '').replace(/<\/b>/g, '');
                rows.push([obj.name || '', obj.category || '', obj.level || '', changes, status]);
            } else {
                rows.push([obj.name || '', obj.category || '', obj.level || '-', status]);
            }
        });

        const ws = XLSX.utils.aoa_to_sheet(rows);
        ws['!cols'] = isChanged
            ? [{ wch: 40 }, { wch: 20 }, { wch: 15 }, { wch: 60 }, { wch: 12 }]
            : [{ wch: 45 }, { wch: 25 }, { wch: 15 }, { wch: 12 }];

        return ws;
    };

    XLSX.utils.book_append_sheet(wb, makeSheet(currentDiffData.added, 'Added'), 'Added');
    XLSX.utils.book_append_sheet(wb, makeSheet(currentDiffData.removed, 'Removed'), 'Removed');
    XLSX.utils.book_append_sheet(wb, makeSheet(currentDiffData.changed, 'Changed'), 'Changed');

    const today = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `BIM_Full_Data_Report_${today}.xlsx`);
};

/**
 * Collects only currently visible rows from each table and exports as Excel.
 */
window.exportFilteredDiffExcel = function () {
    if (!currentDiffData) return alert('내보낼 데이터가 없습니다.');

    const addedVisible = getVisibleRows('list-added');
    const removedVisible = getVisibleRows('list-removed');
    const changedVisible = getVisibleRows('list-changed');
    const total = addedVisible.length + removedVisible.length + changedVisible.length;

    if (total === 0) return alert('필터링된 데이터가 없습니다.\n카테고리 필터를 먼저 적용한 뒤 시도해 주세요.');

    const wb = XLSX.utils.book_new();

    const makeSheet = (list, status) => {
        const isChanged = status === 'Changed';
        const headers = ['Name', 'Category', 'Level', 'Status'];
        if (isChanged) headers.splice(3, 0, 'Changes');
        const rows = [headers];

        (list || []).forEach(obj => {
            if (isChanged) {
                rows.push([obj.name || '', obj.category || '', obj.level || '', obj.changes || '', status]);
            } else {
                rows.push([obj.name || '', obj.category || '', obj.level || '', status]);
            }
        });

        const ws = XLSX.utils.aoa_to_sheet(rows);
        ws['!cols'] = isChanged
            ? [{ wch: 40 }, { wch: 20 }, { wch: 15 }, { wch: 60 }, { wch: 12 }]
            : [{ wch: 45 }, { wch: 25 }, { wch: 15 }, { wch: 12 }];

        return ws;
    };

    XLSX.utils.book_append_sheet(wb, makeSheet(addedVisible, 'Added'), 'Added');
    XLSX.utils.book_append_sheet(wb, makeSheet(removedVisible, 'Removed'), 'Removed');
    XLSX.utils.book_append_sheet(wb, makeSheet(changedVisible, 'Changed'), 'Changed');

    const today = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `BIM_Filtered_Data_Report_${today}.xlsx`);
};


// ── Korean Font Loader ──────────────────────────────────────────────────────
// Caches the loaded Base64 font string so we don't re-download on each export.
let _nanumGothicBase64 = null;

/**
 * Fetches NanumGothic-Regular TTF from jsDelivr, converts it to Base64,
 * and registers it with the jsPDF document.
 * @param {jsPDF} doc
 */
async function loadNanumGothicFont(doc) {
    const FONT_URL = 'https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/nanumgothic/NanumGothic-Regular.ttf';
    const FONT_NAME = 'NanumGothic';

    if (!_nanumGothicBase64) {
        console.log('[PDF] Fetching NanumGothic font...');
        const response = await fetch(FONT_URL);
        if (!response.ok) throw new Error(`폰트 다운로드 실패: ${response.status}`);
        const buffer = await response.arrayBuffer();

        // Convert ArrayBuffer → Base64
        const bytes = new Uint8Array(buffer);
        let binary = '';
        for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
        _nanumGothicBase64 = btoa(binary);
        console.log('[PDF] NanumGothic font loaded and encoded.');
    }

    doc.addFileToVFS('NanumGothic-Regular.ttf', _nanumGothicBase64);
    doc.addFont('NanumGothic-Regular.ttf', FONT_NAME, 'normal');
    doc.addFont('NanumGothic-Regular.ttf', FONT_NAME, 'bold');
    return FONT_NAME;
}

// Helper to build autoTable styles with NanumGothic applied to all cells
function koreanTableStyles(color) {
    return {
        theme: 'grid',
        headStyles: {
            fillColor: color,
            textColor: 255,
            fontStyle: 'bold',
            fontSize: 9,
            font: 'NanumGothic'
        },
        bodyStyles: {
            fontSize: 8,
            font: 'NanumGothic'
        },
        columnStyles: { 0: { cellWidth: 120 }, 1: { cellWidth: 62 } },
        margin: { left: 14, right: 14 }
    };
}

// ── Dropdown Controls ────────────────────────────────────────────────────────

window.togglePdfDropdown = function (e) {
    e.stopPropagation();
    window.closeExcelDropdown(); // Close other dropdown if open
    const menu = document.getElementById('pdf-dropdown-menu');
    const btn = document.getElementById('btn-export-pdf');
    const isOpen = menu.classList.toggle('open');
    btn.setAttribute('aria-expanded', isOpen);
};

window.closePdfDropdown = function () {
    const menu = document.getElementById('pdf-dropdown-menu');
    const btn = document.getElementById('btn-export-pdf');
    if (menu) menu.classList.remove('open');
    if (btn) btn.setAttribute('aria-expanded', 'false');
};

window.toggleExcelDropdown = function (e) {
    e.stopPropagation();
    window.closePdfDropdown(); // Close other dropdown if open
    const menu = document.getElementById('excel-dropdown-menu');
    const btn = document.getElementById('btn-export-excel');
    const isOpen = menu.classList.toggle('open');
    btn.setAttribute('aria-expanded', isOpen);
};

window.closeExcelDropdown = function () {
    const menu = document.getElementById('excel-dropdown-menu');
    const btn = document.getElementById('btn-export-excel');
    if (menu) menu.classList.remove('open');
    if (btn) btn.setAttribute('aria-expanded', 'false');
};

// Close dropdowns when clicking outside
document.addEventListener('click', (e) => {
    if (!document.getElementById('pdf-dropdown-wrap')?.contains(e.target)) {
        window.closePdfDropdown();
    }
    if (!document.getElementById('excel-dropdown-wrap')?.contains(e.target)) {
        window.closeExcelDropdown();
    }
});

// ── Export Shared Helpers ────────────────────────────────────────────────────

/**
 * Reads visible rows from a tbody and returns {name, category} objects.
 * @param {string} tbodyId
 * @returns {Array<{name, category}>}
 */
function getVisibleRows(tbodyId) {
    const tbody = document.getElementById(tbodyId);
    if (!tbody) return [];
    return [...tbody.querySelectorAll('tr.diff-row-v2')]
        .filter(tr => tr.style.display !== 'none')
        .map(tr => {
            const cells = tr.querySelectorAll('td');
            const name = cells[0]?.querySelector('.table-name')?.textContent.trim()
                || cells[0]?.textContent.trim() || '';
            const category = cells[1]?.querySelector('.category-pill')?.textContent.trim()
                || cells[1]?.textContent.trim() || '';
            const level = cells[2]?.querySelector('.level-info')?.textContent.trim()
                || cells[2]?.textContent.trim() || '';
            const changes = cells[3]?.querySelector('.table-changes')?.title.trim()
                || cells[3]?.textContent.trim() || '';
            const dbId = parseInt(tr.dataset.dbId);
            return { name, category, level, changes, dbId };
        });
}

// ── Shared PDF generation core ───────────────────────────────────────────────

/**
 * Builds and saves a PDF from provided section data.
 * @param {Array<{title, data, color, viewerKey}>} sections
 *   viewerKey: 'new' => viewers[1], 'old' => viewers[0]  (used for snapshot capture)
 * @param {string} filename
 * @param {object} [options]
 * @param {boolean} [options.includeSnapshots=false]
 */
async function generatePdfDocument(sections, filename, options = {}) {
    const { jsPDF } = window.jspdf;
    if (!jsPDF) return alert('PDF 라이브러리가 로드되지 않았습니다.');

    const includeSnapshots = !!options.includeSnapshots;
    const btn = document.getElementById('btn-export-pdf');
    const chk = document.getElementById('chk-include-snapshots');
    const origLabel = btn?.textContent;

    if (btn) {
        btn.disabled = true;
        btn.textContent = '⏳ 생성 중...';
    }
    if (chk) chk.disabled = true;

    console.log(`[PDF] Export started. Snapshots=${includeSnapshots}`);

    // ── Phase 1: Pre-capture snapshots (if enabled) ───────────────────────────
    // snapshots[sectionIndex][itemIndex] = dataUrl | null
    let snapshots = null;

    if (includeSnapshots) {
        snapshots = [];
        const vNew = viewers[1]; // Added / Changed → New model viewer
        const vOld = viewers[0]; // Removed         → Old model viewer

        // Count total items across all sections
        const totalItems = sections.reduce((sum, s) => sum + (s.data?.length || 0), 0);
        let captured = 0;

        showSnapshotProgress(0, totalItems, '');

        console.time('[PDF] Snapshot Capture Phase');
        for (let si = 0; si < sections.length; si++) {
            const section = sections[si];
            const sectionSnaps = [];
            snapshots.push(sectionSnaps);

            // Decide which viewer to use based on section type
            const isRemoved = section.title.toLowerCase().includes('removed') ||
                (section.viewerKey === 'old');
            const targetViewer = isRemoved ? vOld : vNew;

            console.log(`[PDF] Processing section "${section.title}" with viewer ${isRemoved ? 'Old' : 'New'}`);

            for (let ii = 0; ii < (section.data || []).length; ii++) {
                const obj = section.data[ii];
                const itemName = obj.name || `Item ${ii + 1}`;

                showSnapshotProgress(captured, totalItems, itemName);

                let dataUrl = null;
                if (obj.dbId && targetViewer && targetViewer.model) {
                    try {
                        dataUrl = await captureSnapshotForItem(targetViewer, obj.dbId, 400, 300);
                    } catch (snapErr) {
                        console.error(`[PDF] Error capturing dbId: ${obj.dbId}. Continuing...`, snapErr);
                    }
                } else {
                    console.warn(`[PDF] Skipping item ${ii} in "${section.title}": dbId=${obj.dbId}, viewerReady=${!!(targetViewer && targetViewer.model)}`);
                }

                sectionSnaps.push(dataUrl);
                captured++;
                showSnapshotProgress(captured, totalItems, itemName);
            }
        }
        console.timeEnd('[PDF] Snapshot Capture Phase');
        console.log(`[PDF] Total items processed: ${captured}/${totalItems}`);

        // Restore viewers after capture
        try {
            if (vNew && vNew.model) vNew.showAll();
            if (vOld && vOld.model) vOld.showAll();
        } catch (_) { /* ignore */ }

        hideSnapshotProgress();
        if (btn) btn.textContent = '⏳ PDF 레이아웃 빌드 중...';
    }

    // ── Phase 2: Build PDF ────────────────────────────────────────────────────
    const SNAP_COL_W = 55;  // mm width of snapshot column in PDF
    const SNAP_IMG_W = 50;  // mm image width
    const SNAP_IMG_H = 37.5; // mm image height (400x300 → 4:3 ratio)
    const SNAP_ROW_H = 40;  // mm row height when snapshot is shown

    try {
        const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
        const fontName = await loadNanumGothicFont(doc);
        doc.setFont(fontName, 'normal');

        const today = new Date().toLocaleDateString('ko-KR');
        const versionAName = document.getElementById('slot-a-name')?.textContent || 'Version A';
        const versionBName = document.getElementById('slot-b-name')?.textContent || 'Version B';

        // Branded header
        doc.setFillColor(30, 30, 47);
        doc.rect(0, 0, 210, 34, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(14);
        doc.text('APS AI Platform — BIM Comparison Report', 14, 13);
        doc.setFont(fontName, 'normal');
        doc.setFontSize(9);
        doc.text(`날짜: ${today}`, 14, 21);
        doc.text(`Version A: ${versionAName}`, 14, 28);
        doc.text(`Version B: ${versionBName}`, 80, 28);
        if (includeSnapshots) {
            doc.text('📸 스냅샷 포함', 160, 28);
        }
        doc.setTextColor(0, 0, 0);

        let curY = 40;

        for (let si = 0; si < sections.length; si++) {
            const section = sections[si];
            const sectionSnaps = snapshots ? snapshots[si] : null;

            doc.setFontSize(11);
            doc.setFont(fontName, 'bold');
            doc.setTextColor(...section.color);
            doc.text(section.title, 14, curY);
            doc.setTextColor(0, 0, 0);
            doc.setFont(fontName, 'normal');

            const isChangedSection = section.title.includes('Changed');

            let head, colStyles;

            if (includeSnapshots) {
                head = isChangedSection
                    ? [['스냅샷', '이름 (Name)', '카테고리', '레벨', '변경 내용']]
                    : [['스냅샷', '이름 (Name)', '카테고리 (Category)', '레벨 (Level)']];

                colStyles = isChangedSection
                    ? { 0: { cellWidth: SNAP_COL_W, avoidPageBreak: true }, 1: { cellWidth: 40 }, 2: { cellWidth: 25 }, 3: { cellWidth: 20 }, 4: { cellWidth: 'auto' } }
                    : { 0: { cellWidth: SNAP_COL_W, avoidPageBreak: true }, 1: { cellWidth: 65 }, 2: { cellWidth: 40 }, 3: { cellWidth: 'auto' } };
            } else {
                head = isChangedSection
                    ? [['이름 (Name)', '카테고리', '레벨', '변경 내용 (Changes)']]
                    : [['이름 (Name)', '카테고리 (Category)', '레벨 (Level)']];

                colStyles = isChangedSection
                    ? { 0: { cellWidth: 45 }, 1: { cellWidth: 30 }, 2: { cellWidth: 25 }, 3: { cellWidth: 'auto' } }
                    : { 0: { cellWidth: 80 }, 1: { cellWidth: 50 }, 2: { cellWidth: 'auto' } };
            }

            const rows = (section.data || []).map((obj, ii) => {
                const name = obj.name || '(이름 없음)';
                const cat = obj.category || '요소';
                const lvl = obj.level || '-';

                if (includeSnapshots) {
                    if (isChangedSection) {
                        const ch = (obj.changes || (obj.diffs || []).join('\n')).replace(/<b>/g, '').replace(/<\/b>/g, '');
                        return [{ content: '' }, name, cat, lvl, ch]; // cell 0 = image placeholder
                    }
                    return [{ content: '' }, name, cat, lvl];
                }

                if (isChangedSection) {
                    const ch = (obj.changes || (obj.diffs || []).join('\n')).replace(/<b>/g, '').replace(/<\/b>/g, '');
                    return [name, cat, lvl, ch];
                }
                return [name, cat, lvl];
            });

            // 프로젝트 명 동적 추출 (UI 요소 기반)
            const dynamicProjectName = document.querySelector('.sidebar-title')?.innerText ||
                document.getElementById('model-name-label')?.innerText ||
                "BIM Comparison Project";

            const tableOptions = {
                head: head,
                body: rows.length ? rows : [includeSnapshots ? [{ content: '(항목 없음)', colSpan: head[0].length }] : ['(항목 없음)', '', '']],
                startY: curY + 4,
                ...koreanTableStyles(section.color),
                columnStyles: colStyles,
                headStyles: {
                    fillColor: section.color,
                    fontStyle: 'bold',
                    halign: 'center',
                    valign: 'middle',
                    minCellHeight: 10,
                    textColor: [255, 255, 255]
                },
                styles: {
                    overflow: 'linebreak',
                    font: fontName,
                    minCellHeight: includeSnapshots ? SNAP_ROW_H : 0
                },
                rowPageBreak: 'avoid',
                didDrawPage: (data) => {
                    // 상단 텍스트 제거 (사용자 요청: 깔끔한 상단 복구)
                    // 날짜 및 프로젝트명은 더 이상 출력되지 않습니다.
                }
            };

            // Insert snapshot images inside each data row's first cell
            if (includeSnapshots && sectionSnaps) {
                tableOptions.didDrawCell = (hookData) => {
                    if (hookData.section !== 'body' || hookData.column.index !== 0) return;

                    const rowIdx = hookData.row.index;
                    const dataUrl = sectionSnaps[rowIdx];

                    // If dataUrl is invalid, show fallback text
                    if (!dataUrl || typeof dataUrl !== 'string' || dataUrl.length < 500) {
                        if (hookData.row.raw[0] !== '(항목 없음)') {
                            const { x, y, width: cw, height: ch } = hookData.cell;
                            doc.setFontSize(7);
                            doc.setTextColor(150, 150, 150);
                            doc.text('이미지 로딩 실패', x + 5, y + ch / 2, { align: 'left' });
                            doc.setTextColor(0, 0, 0);
                        }
                        return;
                    }
                    if (hookData.row.raw[0] === '(항목 없음)') return;

                    const { x, y, width: cw, height: ch } = hookData.cell;
                    // Center image within the cell
                    const imgX = x + (cw - SNAP_IMG_W) / 2;
                    const imgY = y + (ch - SNAP_IMG_H) / 2;

                    try {
                        console.log(`[PDF Debug] Item ${rowIdx} at X=${imgX.toFixed(1)}, Y=${imgY.toFixed(1)}`);
                        doc.addImage(dataUrl, 'JPEG', imgX, imgY, SNAP_IMG_W, SNAP_IMG_H, undefined, 'FAST');
                    } catch (imgErr) {
                        console.warn('[PDF] addImage failed:', imgErr.message);
                    }
                };
            }

            doc.autoTable(tableOptions);
            curY = doc.lastAutoTable.finalY + 10;
        }

        const fileDate = new Date().toISOString().slice(0, 10);
        const suffix = includeSnapshots ? '_with_snapshots' : '';
        doc.save(`${filename}${suffix}_${fileDate}.pdf`);
    } catch (err) {
        console.error('[PDF Export Error]', err);
        alert(`PDF 생성 중 오류 발생: ${err.message}`);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.textContent = origLabel;
        }
        if (chk) chk.disabled = false;
        hideSnapshotProgress();
    }
}

window.exportDiffPdf = async function () {
    if (!currentDiffData) return alert('내보낼 데이터가 없습니다.');
    const total = (currentDiffData.added?.length || 0) +
        (currentDiffData.removed?.length || 0) +
        (currentDiffData.changed?.length || 0);
    if (total === 0) return alert('내보낼 데이터가 없습니다.');

    const includeSnapshots = document.getElementById('chk-include-snapshots')?.checked || false;

    const sections = [
        { title: `추가된 요소 (Added) — ${(currentDiffData.added || []).length}건`, data: currentDiffData.added || [], color: [0, 160, 80], viewerKey: 'new' },
        { title: `삭제된 요소 (Removed) — ${(currentDiffData.removed || []).length}건`, data: currentDiffData.removed || [], color: [200, 50, 50], viewerKey: 'old' },
        { title: `변경된 요소 (Changed) — ${(currentDiffData.changed || []).length}건`, data: currentDiffData.changed || [], color: [190, 140, 0], viewerKey: 'new' }
    ];
    await generatePdfDocument(sections, 'BIM_Full_Report', { includeSnapshots });
};

/**
 * Collects only currently visible rows from each table and exports as PDF.
 */
window.exportFilteredDiffPdf = async function () {
    if (!currentDiffData) return alert('내보낼 데이터가 없습니다.');

    const addedVisible = getVisibleRows('list-added');
    const removedVisible = getVisibleRows('list-removed');
    const changedVisible = getVisibleRows('list-changed');
    const totalCount = addedVisible.length + removedVisible.length + changedVisible.length;

    if (totalCount === 0) return alert('필터링된 데이터가 없습니다.\n카테고리 필터를 먼저 적용한 뒤 시도해 주세요.');

    const includeSnapshots = document.getElementById('chk-include-snapshots')?.checked || false;

    const sections = [
        { title: `추가된 요소 (Added) — ${addedVisible.length}건`, data: addedVisible, color: [0, 160, 80], viewerKey: 'new' },
        { title: `삭제된 요소 (Removed) — ${removedVisible.length}건`, data: removedVisible, color: [200, 50, 50], viewerKey: 'old' },
        { title: `변경된 요소 (Changed) — ${changedVisible.length}건`, data: changedVisible, color: [190, 140, 0], viewerKey: 'new' }
    ];
    await generatePdfDocument(sections, 'BIM_Filtered_Report', { includeSnapshots });
};




// ── Korean PDF Test Function ────────────────────────────────────────────────
/**
 * Quick sanity test: generates a minimal PDF with Korean text.
 * Call via browser console: window.testKoreanPdf()
 */
window.testKoreanPdf = async function () {
    const { jsPDF } = window.jspdf;
    if (!jsPDF) return alert('jsPDF 라이브러리 없음');

    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const fontName = await loadNanumGothicFont(doc);
    doc.setFont(fontName, 'normal');

    doc.setFontSize(20);
    doc.text('한글 PDF 테스트', 20, 30);
    doc.setFontSize(12);
    doc.text('추가된 요소 / 삭제된 요소 / 변경된 요소', 20, 45);
    doc.text('가나다라마바사아자차카타파하', 20, 58);

    doc.autoTable({
        head: [['이름', '카테고리', '상태']],
        body: [
            ['기초 슬래브', '구조-기초', '추가됨'],
            ['외벽 패널 A-01', '건축-벽체', '변경됨'],
            ['창호 W-03', '건축-창호', '삭제됨']
        ],
        startY: 68,
        headStyles: { font: fontName, fillColor: [30, 30, 100], textColor: 255 },
        bodyStyles: { font: fontName },
        margin: { left: 20, right: 20 }
    });

    doc.save('korean_pdf_test.pdf');
    console.log('[Test] Korean PDF generated successfully.');
};

/* ============================================================
   Resizing Engine — Robust Implementation (Panel, Table, Vertical)
   ============================================================ */

const ResizingEngine = (() => {
    let panelDragging = false;
    let vDragging = false;
    let colDragging = false;

    let startX = 0, startY = 0;
    let startW = 0, startH = 0;
    let activeTh = null;

    function triggerViewerResize() {
        requestAnimationFrame(() => {
            // Resize split viewers (Viewer A, Viewer B) if they are in the array
            if (viewers && viewers.length > 0) {
                viewers.forEach(v => { if (v && v.resize) v.resize(); });
            }
            // Resize main viewer if it exists on window._viewer
            if (window._viewer && window._viewer.resize) {
                window._viewer.resize();
            }
            // Force browser layout update
            window.dispatchEvent(new Event('resize'));
        });
    }

    // ── 1. Side Panel Resizing (Right Sidebar) ──────────────────
    function initPanelResizer() {
        const handle = document.getElementById('panel-resizer-handle');
        const sidebar = document.getElementById('sidebar-right');
        if (!handle || !sidebar) return;

        handle.addEventListener('mousedown', (e) => {
            if (e.target.closest('#ai-collapse-btn')) return;
            panelDragging = true;
            startX = e.clientX;
            startW = sidebar.getBoundingClientRect().width;
            handle.classList.add('dragging');
            sidebar.classList.add('no-transition');
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
            e.preventDefault();
        });

        document.addEventListener('mousemove', (e) => {
            if (!panelDragging) return;
            const delta = startX - e.clientX;
            let newW = startW + delta;

            // Limits: 200px to 70% of screen
            newW = Math.min(window.innerWidth * 0.7, Math.max(200, newW));

            sidebar.style.width = newW + 'px';
            if (newW > 50) {
                sidebar.classList.remove('collapsed');
                localStorage.setItem('ai-panel-collapsed', 'false');
            }
            triggerViewerResize();
        });

        document.addEventListener('mouseup', () => {
            if (!panelDragging) return;
            panelDragging = false;
            handle.classList.remove('dragging');
            sidebar.classList.remove('no-transition');
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            localStorage.setItem('ai-panel-width', parseInt(sidebar.style.width));
        });

        // Toggle Collapse
        const collapseBtn = document.getElementById('ai-collapse-btn');
        if (collapseBtn) {
            collapseBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const nowCollapsed = sidebar.classList.toggle('collapsed');
                localStorage.setItem('ai-panel-collapsed', nowCollapsed);

                if (!nowCollapsed && (!sidebar.style.width || sidebar.style.width === '0px')) {
                    const savedW = localStorage.getItem('ai-panel-width');
                    sidebar.style.width = (savedW || 360) + 'px';
                }

                // Wait for transition animation to finish before resizing viewer
                setTimeout(triggerViewerResize, 350);
            });
        }
    }

    // ── 2. Vertical Results Area Resizing ───────────────────────
    function initVerticalResizer() {
        const vHandle = document.getElementById('diff-v-resizer-handle');
        const resultsArea = document.getElementById('diff-results-three-columns');
        if (!vHandle || !resultsArea) return;

        vHandle.addEventListener('mousedown', (e) => {
            vDragging = true;
            startY = e.clientY;
            startH = resultsArea.getBoundingClientRect().height;
            vHandle.classList.add('dragging');
            document.body.style.cursor = 'ns-resize';
            document.body.style.userSelect = 'none';
            e.preventDefault();
        });

        document.addEventListener('mousemove', (e) => {
            if (!vDragging) return;
            const delta = e.clientY - startY;
            const maxH = window.innerHeight * 0.7; // Limit to 70% of screen
            const newH = Math.max(100, Math.min(maxH, startH - delta));

            resultsArea.style.height = newH + 'px';
            triggerViewerResize();
        });

        document.addEventListener('mouseup', () => {
            if (!vDragging) return;
            vDragging = false;
            vHandle.classList.remove('dragging');
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            triggerViewerResize();
        });
    }

    // ── 3. Table Column Resizing ────────────────────────────────
    function initTableColumnResizer() {
        document.addEventListener('mousedown', (e) => {
            if (e.target.classList.contains('th-resizer')) {
                colDragging = true;
                activeTh = e.target.parentElement;
                startX = e.clientX;
                startW = activeTh.getBoundingClientRect().width;
                e.target.classList.add('dragging');
                document.body.style.cursor = 'col-resize';
                e.preventDefault();
            }
        });

        document.addEventListener('mousemove', (e) => {
            if (!colDragging || !activeTh) return;
            const delta = e.clientX - startX;
            const newW = Math.max(40, startW + delta);
            activeTh.style.width = newW + 'px';
        });

        document.addEventListener('mouseup', () => {
            if (!colDragging) return;
            colDragging = false;
            const resizer = activeTh?.querySelector('.th-resizer');
            if (resizer) resizer.classList.remove('dragging');
            activeTh = null;
            document.body.style.cursor = '';
        });

        // Auto-fit on Double Click
        document.addEventListener('dblclick', (e) => {
            const target = e.target.closest('th');
            if (target && target.querySelector('.th-resizer')) {
                autoFitColumn(target);
            }
        });
    }

    function autoFitColumn(th) {
        const table = th.closest('table');
        const index = Array.from(th.parentElement.children).indexOf(th);
        const cells = table.querySelectorAll(`tbody tr td:nth-child(${index + 1})`);

        let maxW = th.innerText.length * 9; // Approx base width

        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        context.font = '11px Inter, sans-serif';

        cells.forEach(cell => {
            const textW = context.measureText(cell.innerText).width + 35; // padding
            if (textW > maxW) maxW = textW;
        });

        th.style.width = Math.min(500, Math.max(50, maxW)) + 'px';
    }

    function loadSavedState() {
        const sidebar = document.getElementById('sidebar-right');
        const savedW = localStorage.getItem('ai-panel-width');
        // Always start collapsed on page load
        const isCollapsed = true;
        localStorage.setItem('ai-panel-collapsed', 'true');

        if (sidebar) {
            if (savedW && !isNaN(parseInt(savedW))) {
                sidebar.style.width = parseInt(savedW) + 'px';
            }
            if (isCollapsed) {
                sidebar.classList.add('collapsed');
            }
        }

        // Initial resize to ensure viewers match the loaded state
        triggerViewerResize();
    }

    function init() {
        initPanelResizer();
        initVerticalResizer();
        initTableColumnResizer();
        loadSavedState();
        console.log('[ResizingEngine] Initialized with persistent state and APS Viewer Sync');
        console.log('[Resize Fix] Direction Corrected');
    }

    return { init };
})();

// Initialize on load
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ResizingEngine.init);
} else {
    ResizingEngine.init();
}
