/**
 * public/js/clash-viewer.js
 * Handles Local Clash Detection results and Viewer highlighting.
 */
import { LocalClashDetector } from './local-clash.js';

let detector = null;
let currentClashes = [];

/**
 * Adds a clash detection button to the viewer toolbar.
 */
export function addClashToolbarButton(viewer, onClick) {
    console.log('[Clash] Attempting to add toolbar button...');
    const toolbar = viewer.getToolbar(true);
    if (!toolbar) {
        console.warn('[Clash] Toolbar not found');
        return;
    }

    let navGroup = toolbar.getControl(Autodesk.Viewing.TOOLBAR.NAVTOOLGROUP);
    if (!navGroup) {
        navGroup = new Autodesk.Viewing.UI.ControlGroup('custom-nav-group');
        toolbar.addControl(navGroup);
    }

    if (toolbar.getControl('clash-detection-tool')) return;

    const clashButton = new Autodesk.Viewing.UI.Button('clash-detection-tool');
    clashButton.setToolTip('간섭 체크 (Local)');
    clashButton.onClick = onClick;

    clashButton.icon.innerText = '⚡';
    clashButton.icon.style.fontSize = '18px';
    clashButton.icon.style.display = 'flex';
    clashButton.icon.style.alignItems = 'center';
    clashButton.icon.style.justifyContent = 'center';

    navGroup.addControl(clashButton);
    console.log('[Clash] Toolbar button added successfully');
}

/**
 * Initializes the Local Clash UI and detector.
 */
export async function initLocalClash(viewer) {
    if (!detector) {
        console.log('[Clash] Initializing Local Clash Detector...');
        detector = new LocalClashDetector(viewer);
        detector.initOverlays();

        // [Force Detection] Listen for additional models loading
        viewer.addEventListener(Autodesk.Viewing.GEOMETRY_LOADED_EVENT, () => {
            const panel = document.getElementById('clash-results-panel');
            if (panel && panel.style.display !== 'none') {
                console.log('[Clash] Geometry loaded event detected. Refreshing model list...');
                refreshModelDropdowns(viewer);
            }
        });
    }

    // 1. Show panel
    document.getElementById('clash-results-panel').style.display = 'flex';
    document.getElementById('clash-results-list').innerHTML = '<tr><td colspan="3" style="text-align:center;">Select models/categories and run check.</td></tr>';

    // 2. Initial population
    refreshModelDropdowns(viewer);

    // 4. Setup run button
    const runBtn = document.getElementById('run-local-clash-btn');
    if (runBtn) {
        runBtn.onclick = () => handleRunLocalClash(viewer);
    }

    // 5. Setup End Session button
    const endBtn = document.getElementById('end-clash-session-btn');
    if (endBtn) {
        endBtn.onclick = () => {
            if (detector) detector.resetState();
            endBtn.style.display = 'none';
            if (runBtn) {
                runBtn.style.display = 'block';
                runBtn.disabled = false;
            }
        };
    }

    // 6. Setup panel close
    const closeBtn = document.getElementById('close-clash-panel');
    if (closeBtn) {
        closeBtn.onclick = () => closeClashPanel();
    }
}

/**
 * [Force Detection] 로드된 모델 리스트를 강제로 다시 읽어와서 드롭다운 갱신
 */
async function refreshModelDropdowns(viewer) {
    const models = viewer.getAllModels() || [];
    console.log(`[DEBUG] Detected Models: ${models.length}`);

    const selectModelA = document.getElementById('clash-model-a');
    const selectModelB = document.getElementById('clash-model-b');
    const runBtn = document.getElementById('run-local-clash-btn');

    if (models.length < 1) {
        if (selectModelA) selectModelA.innerHTML = '<option value="">No Models Loaded</option>';
        if (selectModelB) selectModelB.innerHTML = '<option value="">No Models Loaded</option>';
        if (runBtn) {
            runBtn.disabled = true;
            runBtn.textContent = '로드된 모델이 없습니다';
            runBtn.style.background = '#475569';
        }
        return;
    }

    if (runBtn) {
        runBtn.disabled = false;
        runBtn.textContent = 'Run Broad-Phase Check';
        runBtn.style.background = 'linear-gradient(135deg, #6366f1, #0ea5e9)';
    }

    const modelOptions = models.map((m, idx) => {
        // [Naming Fix] 사용자의 요청대로 이름 추출 시도 순서 조정
        const node = m.getDocumentNode();
        const data = m.getData();
        let name = (node && node.data && node.data.name) ||
            (data && data.loadOptions && data.loadOptions.bubbleNode && data.loadOptions.bubbleNode.name()) ||
            'Model ' + (idx + 1);

        // Clean up common suffix
        name = name.replace('{3D}', '').trim();
        return `<option value="${idx}">${name}</option>`;
    }).join('');

    if (selectModelA) selectModelA.innerHTML = modelOptions;
    if (selectModelB) {
        selectModelB.innerHTML = modelOptions;
        selectModelB.value = models.length > 1 ? "1" : "0";
    }

    // Update categories for initial selection
    if (selectModelA) await updateCategoriesForModel(viewer, selectModelA.value, 'a');
    if (selectModelB) await updateCategoriesForModel(viewer, selectModelB.value, 'b');

    // Re-bind change listeners
    if (selectModelA) selectModelA.onchange = () => updateCategoriesForModel(viewer, selectModelA.value, 'a');
    if (selectModelB) selectModelB.onchange = () => updateCategoriesForModel(viewer, selectModelB.value, 'b');
}

async function updateCategoriesForModel(viewer, modelIdx, suffix) {
    const models = viewer.getAllModels();
    const model = models[parseInt(modelIdx)];
    if (!model) return;

    const select = document.getElementById(`clash-category-${suffix}`);
    if (select) select.innerHTML = '<option value="">Category (Loading...)</option>';

    const categories = await getUniqueCategories(model);

    const options = categories.map(cat => `<option value="${cat}">${cat}</option>`).join('');
    const defaultOpt = '<option value="">Category (All)...</option>';
    if (select) select.innerHTML = defaultOpt + options;
}

async function getUniqueCategories(model) {
    return new Promise((resolve) => {
        model.getBulkProperties([], ['Category', '명칭', 'Element Name', 'Type Name'], (props) => {
            const set = new Set();
            props.forEach(p => {
                const catProp = p.properties.find(x =>
                    x.displayName === 'Category' ||
                    x.displayName === '명칭' ||
                    x.displayName === 'Element Name' ||
                    x.displayName === 'Type Name'
                );
                if (catProp && catProp.displayValue && !catProp.displayValue.includes(':')) {
                    set.add(catProp.displayValue);
                }
            });
            resolve(Array.from(set).sort());
        });
    });
}

async function handleRunLocalClash(viewer) {
    const models = viewer.getAllModels();
    const idxA = document.getElementById('clash-model-a').value;
    const idxB = document.getElementById('clash-model-b').value;
    const catA = document.getElementById('clash-category-a').value;
    const catB = document.getElementById('clash-category-b').value;

    const modelA = models[parseInt(idxA)];
    const modelB = models[parseInt(idxB)];

    if (!modelA || !modelB) {
        alert('비교할 모델을 선택해주세요.');
        return;
    }

    viewer.setGhosting(true);
    console.log(`선택된 모델: A(${modelA.getDocumentNode()?.data?.name}), B(${modelB.getDocumentNode()?.data?.name})`);

    const runBtn = document.getElementById('run-local-clash-btn');
    const endBtn = document.getElementById('end-clash-session-btn');
    const resultsList = document.getElementById('clash-results-list');

    try {
        runBtn.disabled = true;
        runBtn.textContent = 'Preparing...';
        resultsList.innerHTML = '<tr><td colspan="3" style="text-align:center;">Initializing BVH engine...</td></tr>';

        const idsA = await getLeafIds(modelA, catA);
        const idsB = await getLeafIds(modelB, catB);

        currentClashes = await detector.calculateBroadPhase(modelA, idsA, modelB, idsB, (status) => {
            resultsList.innerHTML = `<tr><td colspan="3" style="text-align:center; color:#38bdf8;">${status}</td></tr>`;
        });

        if (currentClashes.length > 50000) {
            const proceed = confirm(`후보군이 너무 많습니다 (${currentClashes.length}건). 계속하시겠습니까?`);
            if (!proceed) {
                runBtn.disabled = false;
                runBtn.textContent = 'Run Broad-Phase Check';
                return;
            }
        }

        if (currentClashes.length > 0) {
            resultsList.innerHTML = '';
            let firstClashFound = false;

            const broadCandidates = [...currentClashes];
            currentClashes = await detector.calculateNarrowPhase(
                broadCandidates,
                (status) => {
                    const progressRow = document.getElementById('clash-progress-row');
                    if (!progressRow) {
                        const row = document.createElement('tr');
                        row.id = 'clash-progress-row';
                        resultsList.prepend(row);
                    }
                    document.getElementById('clash-progress-row').innerHTML = `<td colspan="3" style="text-align:center; color:#818cf8;">${status}</td>`;
                },
                (clash, count) => {
                    appendSingleResultRow(viewer, clash, count);
                    const colorA = new THREE.Vector4(0, 0, 1, 0.8);
                    const colorB = new THREE.Vector4(1, 0, 0, 0.8);
                    viewer.setThemingColor(clash.dbId1, colorA, clash.modelA, true);
                    viewer.setThemingColor(clash.dbId2, colorB, clash.modelB, true);

                    if (!firstClashFound) {
                        firstClashFound = true;
                        viewer.fitToView([clash.dbId1, clash.dbId2], clash.modelA === clash.modelB ? clash.modelA : null);
                    }
                    viewer.impl.invalidate(true, true, true);
                }
            );
        }

        detector.visualize(currentClashes);

        const progressRow = document.getElementById('clash-progress-row');
        if (progressRow) progressRow.remove();

        if (currentClashes.length === 0) {
            resultsList.innerHTML = '<tr><td colspan="3" style="text-align:center; padding: 20px; color:#f87171;">간섭이 발견되지 않았습니다.</td></tr>';
            alert('간섭이 발견되지 않았습니다.');
        } else {
            const finalInfo = document.createElement('tr');
            finalInfo.innerHTML = `<td colspan="3" style="text-align:center; font-size:0.8rem; color:#94a3b8;">Precision Hit: ${currentClashes.length} items found.</td>`;
            resultsList.appendChild(finalInfo);
            alert(`검사 완료! ${currentClashes.length}건의 간섭을 찾았습니다.`);
        }

        runBtn.textContent = 'Check Finished';
        runBtn.style.display = 'none';
        if (endBtn) endBtn.style.display = 'block';

    } catch (err) {
        console.error('[Clash] Expert Calculation failed:', err);
        resultsList.innerHTML = `<tr><td colspan="3" style="text-align:center; color:#f87171;">오류: ${err.message}</td></tr>`;
        alert(`간섭 검사 중 오류가 발생했습니다: ${err.message}`);
        runBtn.textContent = 'Run Check';
    }
}

/**
 * 간섭 결과 한 줄을 테이블에 즉시 추가
 */
function appendSingleResultRow(viewer, clash, count) {
    const tbody = document.getElementById('clash-results-list');
    const tr = document.createElement('tr');
    tr.style.cursor = 'pointer';
    tr.className = 'clash-row-item';
    tr.innerHTML = `
        <td style="text-align:center;">${count}</td>
        <td><span class="clash-item-name" style="color:#60a5fa;">A: ${clash.dbId1}</span></td>
        <td><span class="clash-item-name" style="color:#f87171;">B: ${clash.dbId2}</span></td>
    `;

    tr.onclick = () => {
        try {
            detector.focusClash(clash);
            viewer.fitToView([clash.dbId1, clash.dbId2], clash.modelA === clash.modelB ? clash.modelA : null);
            if (clash.intersectionPoint) {
                viewer.navigation.setPivotPoint(clash.intersectionPoint);
            }
        } catch (e) {
            console.warn('[Clash] Interaction failed:', e);
        }
    };
    tbody.appendChild(tr);
}

async function getLeafIds(model, categoryName) {
    return new Promise((resolve) => {
        const it = model.getInstanceTree();
        const leafIds = [];

        if (categoryName) {
            model.getBulkProperties([], ['Category', '명칭', 'Element Name'], (props) => {
                const filtered = props
                    .filter(p => p.properties.some(x =>
                        (x.displayName === 'Category' || x.displayName === '명칭' || x.displayName === 'Element Name') &&
                        x.displayValue === categoryName
                    ))
                    .map(p => p.dbId);

                filtered.forEach(id => {
                    if (it.getChildCount(id) === 0) leafIds.push(id);
                });
                resolve(leafIds);
            });
        } else {
            it.enumNodeChildren(it.getRootId(), (dbId) => {
                if (it.getChildCount(dbId) === 0) leafIds.push(dbId);
            }, true);
            resolve(leafIds);
        }
    });
}

/**
 * 하단 테이블에 정밀 간섭 결과 렌더링
 */
function renderLocalResults(viewer, clashes) {
    const tbody = document.getElementById('clash-results-list');
    tbody.innerHTML = '';

    if (clashes.length === 0) {
        tbody.innerHTML = '<tr><td colspan="3" style="text-align:center; padding: 20px;">No triangle-level clashes found.</td></tr>';
        return;
    }

    clashes.forEach((clash, idx) => {
        const tr = document.createElement('tr');
        tr.style.cursor = 'pointer';
        tr.className = 'clash-row-item';
        tr.innerHTML = `
            <td style="text-align:center;">${idx + 1}</td>
            <td><span class="clash-item-name" style="color:#60a5fa;">A: ${clash.dbId1}</span></td>
            <td><span class="clash-item-name" style="color:#f87171;">B: ${clash.dbId2}</span></td>
        `;

        tr.onclick = () => {
            try {
                // 상호작용: 줌인 및 파랑/빨강 강조
                detector.focusClash(clash);

                // Fit to elements
                viewer.fitToView([clash.dbId1, clash.dbId2], clash.modelA === clash.modelB ? clash.modelA : null);

                if (clash.intersectionPoint) {
                    viewer.navigation.setPivotPoint(clash.intersectionPoint);
                }
            } catch (e) {
                console.warn('[Clash] Interaction failed:', e);
            }
        };
        tbody.appendChild(tr);
    });

    const infoRow = document.createElement('tr');
    infoRow.innerHTML = `<td colspan="3" style="text-align:center; font-size:0.8rem; color:#94a3b8; padding:10px; border-top:1px solid rgba(255,255,255,0.1);">Precision Hit: ${clashes.length} items found.</td>`;
    tbody.appendChild(infoRow);
}

export function closeClashPanel() {
    const panel = document.getElementById('clash-results-panel');
    if (panel) panel.style.display = 'none';
    if (detector) detector.resetState();
}
