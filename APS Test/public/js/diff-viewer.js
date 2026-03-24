/**
 * public/js/diff-viewer.js
 * Handles the Split Viewer logic and local client-side model comparison.
 */

import { initViewer, loadModel } from './viewer.js';

let viewers = []; // [viewers[0]: Old, viewers[1]: New]
let currentDiffData = null;
let isSyncing = false;

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
        const vA = await initViewer(document.getElementById('preview-a'));
        const vB = await initViewer(document.getElementById('preview-b'));
        viewers = [vA, vB];

        // ── Load ViewCube extension explicitly on both viewers ────────────────
        await Promise.all([
            loadViewCubeExtension(viewers[0], 'ViewerA'),
            loadViewCubeExtension(viewers[1], 'ViewerB'),
        ]);

        // ── Camera Sync ───────────────────────────────────────────────────────
        // Use a debounced approach so ViewCube animated transitions are not
        // cancelled by the immediate isSyncing=false flip.
        let syncTimer = null;

        const syncCamera = (src, dst, label) => {
            if (isSyncing) return;
            isSyncing = true;

            // Clear any pending sync first
            if (syncTimer) { clearTimeout(syncTimer); syncTimer = null; }

            try {
                const state = src.getState({ viewport: true, camera: true });
                // Use immediate=true so dest camera jumps with src
                dst.restoreState(state, null, true);
            } catch (e) {
                console.warn(`[CameraSync] ${label} error:`, e.message);
            }

            // Release the lock after a short delay so that any follow-up
            // CAMERA_CHANGE_EVENTs from restoreState don't ping-pong.
            syncTimer = setTimeout(() => {
                isSyncing = false;
                syncTimer = null;
            }, 80);
        };

        viewers[0].addEventListener(Autodesk.Viewing.CAMERA_CHANGE_EVENT,
            () => syncCamera(viewers[0], viewers[1], 'A→B'));
        viewers[1].addEventListener(Autodesk.Viewing.CAMERA_CHANGE_EVENT,
            () => syncCamera(viewers[1], viewers[0], 'B→A'));

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
    await initSplitViewers();
    await Promise.all([loadModel(viewers[0], urnA), loadModel(viewers[1], urnB)]);
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
                            category: p.properties.find(pr => pr.displayName === 'Category')?.displayValue || 'Element'
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

        // Handle undefined (prop exists in one but not other)
        if (valA === undefined || valB === undefined) {
            changes.push({ key, old: valA, new: valB });
            continue;
        }

        // Numeric comparison with tolerance (handle strings that look like numbers)
        const numA = parseFloat(valA);
        const numB = parseFloat(valB);

        if (!isNaN(numA) && !isNaN(numB)) {
            if (Math.abs(numA - numB) > TOLERANCE) {
                changes.push({ key, old: valA, new: valB });
            }
        } else {
            // String comparison
            if (String(valA) !== String(valB)) {
                changes.push({ key, old: valA, new: valB });
            }
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

        if (type === 'changed') {
            const diffCount = obj.diffs ? obj.diffs.length : 0;
            tr.innerHTML = `
                <td><div class="table-name" title="${obj.name}">${obj.name || 'Unknown'}</div></td>
                <td><span class="category-pill">${obj.category || 'Element'}</span></td>
                <td><span class="change-count" style="color: #eab308; font-weight: bold;">${diffCount} 속성 변경</span></td>
            `;
        } else {
            tr.innerHTML = `
                <td><div class="table-name" title="${obj.name}">${obj.name || 'Unknown'}</div></td>
                <td><span class="category-pill">${obj.category || 'Element'}</span></td>
                <td><span class="level-info">-</span></td>
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
        const rows = [['Name', 'Category', 'Status']];
        (list || []).forEach(obj => rows.push([obj.name || '', obj.category || '', status]));
        const ws = XLSX.utils.aoa_to_sheet(rows);
        ws['!cols'] = [{ wch: 45 }, { wch: 25 }, { wch: 12 }];
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
        const rows = [['Name', 'Category', 'Status']];
        (list || []).forEach(obj => rows.push([obj.name || '', obj.category || '', status]));
        const ws = XLSX.utils.aoa_to_sheet(rows);
        ws['!cols'] = [{ wch: 45 }, { wch: 25 }, { wch: 12 }];
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
            return { name, category };
        });
}

// ── Shared PDF generation core ───────────────────────────────────────────────

/**
 * Builds and saves a PDF from provided section data.
 * @param {Array<{title,data,color}>} sections
 * @param {string} filename
 */
async function generatePdfDocument(sections, filename) {
    const { jsPDF } = window.jspdf;
    if (!jsPDF) return alert('PDF 라이브러리가 로드되지 않았습니다.');

    const btn = document.getElementById('btn-export-pdf');
    const origLabel = btn?.textContent;
    if (btn) btn.textContent = '⏳ 생성 중...';

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
        doc.setTextColor(0, 0, 0);

        let curY = 40;

        for (const section of sections) {
            doc.setFontSize(11);
            doc.setFont(fontName, 'bold');
            doc.setTextColor(...section.color);
            doc.text(section.title, 14, curY);
            doc.setTextColor(0, 0, 0);
            doc.setFont(fontName, 'normal');

            const rows = section.data.map(obj => [obj.name || '(이름 없음)', obj.category || '요소']);

            doc.autoTable({
                head: [['이름 (Name)', '카테고리 (Category)']],
                body: rows.length ? rows : [['(항목 없음)', '']],
                startY: curY + 4,
                ...koreanTableStyles(section.color)
            });

            curY = doc.lastAutoTable.finalY + 10;
        }

        const fileDate = new Date().toISOString().slice(0, 10);
        doc.save(`${filename}_${fileDate}.pdf`);
    } catch (err) {
        console.error('[PDF Export Error]', err);
        alert(`PDF 생성 중 오류 발생: ${err.message}`);
    } finally {
        if (btn) btn.textContent = origLabel;
    }
}

window.exportDiffPdf = async function () {
    if (!currentDiffData) return alert('내보낼 데이터가 없습니다.');
    const total = (currentDiffData.added?.length || 0) +
        (currentDiffData.removed?.length || 0) +
        (currentDiffData.changed?.length || 0);
    if (total === 0) return alert('내보낼 데이터가 없습니다.');

    const sections = [
        { title: `추가된 요소 (Added) — ${(currentDiffData.added || []).length}건`, data: currentDiffData.added || [], color: [0, 160, 80] },
        { title: `삭제된 요소 (Removed) — ${(currentDiffData.removed || []).length}건`, data: currentDiffData.removed || [], color: [200, 50, 50] },
        { title: `변경된 요소 (Changed) — ${(currentDiffData.changed || []).length}건`, data: currentDiffData.changed || [], color: [190, 140, 0] }
    ];
    await generatePdfDocument(sections, 'BIM_Full_Report');
};

/**
 * Collects only currently visible rows from each table and exports as PDF.
 */
window.exportFilteredDiffPdf = async function () {
    if (!currentDiffData) return alert('내보낼 데이터가 없습니다.');

    const addedVisible = getVisibleRows('list-added');
    const removedVisible = getVisibleRows('list-removed');
    const changedVisible = getVisibleRows('list-changed');
    const total = addedVisible.length + removedVisible.length + changedVisible.length;

    if (total === 0) return alert('필터링된 데이터가 없습니다.\n카테고리 필터를 먼저 적용한 뒤 시도해 주세요.');

    const sections = [
        { title: `추가된 요소 (Added) — ${addedVisible.length}건`, data: addedVisible, color: [0, 160, 80] },
        { title: `삭제된 요소 (Removed) — ${removedVisible.length}건`, data: removedVisible, color: [200, 50, 50] },
        { title: `변경된 요소 (Changed) — ${changedVisible.length}건`, data: changedVisible, color: [190, 140, 0] }
    ];
    await generatePdfDocument(sections, 'BIM_Filtered_Report');
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


