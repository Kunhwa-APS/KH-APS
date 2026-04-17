/* ============================================================
   main.js — Application Entry Point (ES6 Module)
   ============================================================ */
import { initViewer, loadModel, loadModelWithTracking, getSafeUrn } from './viewer.js';
import { initTree } from './sidebar.js';
import { runDiff, visualizeDiff, loadVersions, exitCompareMode, showDiffList, addToolbarButton, addExitCompareButton } from './diff-viewer.js';
// import { initLocalClash, closeClashPanel } from './clash-viewer.js';
import { IssueManager } from './issue-manager.js';
import { addCustomButtons } from './toolbar-utils.js';
import { initMap, addProjectMarkers, flyToLocation, resizeMap } from './map.js';
import { loadVersionsDropdown } from './version-manager.js?v=ver_20260330_1715';
import { renderPremiumDashboard } from './dashboard-premium.js';
import { explorer } from './explorer.js';

const login = document.getElementById('login');
const compareBar = document.getElementById('compare-bar');
const runDiffBtn = document.getElementById('run-diff-btn');
const exitCompareBtn = document.getElementById('exit-compare-btn');

let currentViewer = null;
let currentProjectId = null;
let currentRegion = 'US';
let versionA = null;
let versionB = null;
let _exitCompareToolbarBtn = null; // Reference to the toolbar exit button
let issueManager = null;
let mapInitialized = false;
let mapApiKey = null;

// Expose handles globally for toolbar-utils.js
window._issueManager = null;
// window._handleClashToolClick = (viewer) => handleClashToolClick(viewer);
window.loadModelWithTracking = loadModelWithTracking; // Expose globally
window.currentModelName = ''; // Global tracker for active model name

// ── [Data Recovery] ──
// Restore IDs from localStorage on startup to prevent context loss
window.currentHubId = localStorage.getItem('aps_last_hub_id');
window.currentProjectId = localStorage.getItem('aps_last_project_id');
window.currentRegion = localStorage.getItem('aps_last_region') || 'US';

if (window.currentProjectId) {
    console.log('[Main] Restored context from storage:', {
        hub: window.currentHubId,
        project: window.currentProjectId,
        region: window.currentRegion
    });
}

try {
    const resp = await fetch('/api/auth/profile');
    const isLogged = resp.ok;

    if (isLogged) {
        const user = await resp.json();
        login.innerText = `Logout (${user.name})`;
        login.onclick = () => { logout(); };
        login.style.visibility = 'visible';

        // 1. Init default single viewer
        try {
            currentViewer = await initViewer(document.getElementById('preview'));
            window._viewer = currentViewer;

            issueManager = new IssueManager(currentViewer);
            await issueManager.init();
            window._issueManager = issueManager;
            setupIssueModal();
            console.log('[Main] Viewer and IssueManager initialized');

            // ── CRITICAL: Auto-populate version dropdown on model load ──
            // This fires for ALL model loading paths (tree click, explorer, URN input, etc.)
            currentViewer.addEventListener(Autodesk.Viewing.GEOMETRY_LOADED_EVENT, async () => {
                const hubId = window.currentHubId;
                const projectId = window.currentProjectId;
                const itemId = window.currentItemId;
                const currentVersionId = window.currentVersionId;
                console.log('[Main] GEOMETRY_LOADED - loading version dropdown with:', { hubId, projectId, itemId });
                if (hubId && projectId && itemId) {
                    await loadVersionsDropdown(hubId, projectId, itemId, currentVersionId);
                } else {
                    console.warn('[Main] GEOMETRY_LOADED - missing context, version dropdown not populated');
                }
            });

            // 2. Add Toolbar Buttons (Event-Driven)
            currentViewer.addEventListener(Autodesk.Viewing.TOOLBAR_CREATED_EVENT, () => {
                console.log('[Main] Toolbar created, adding custom buttons...');
                addCustomButtons(currentViewer);

                // Add Compare-specific buttons
                addToolbarButton(currentViewer, () => {
                    if (versionA && versionB) handleRunDiff();
                    else alert('버전 A와 B를 브라우저 트리에서 먼저 선택해주세요.');
                });
                _exitCompareToolbarBtn = addExitCompareButton(currentViewer, () => handleExitCompare());
            });
        } catch (vErr) {
            console.error('Viewer initialization failed:', vErr);
        }

        // 3. Init Tree
        initTree('#tree', (node) => handleTreeSelection(node));

        // 4. Project Dashboard Init
        renderPremiumDashboard(); // New premium dashboard
        renderProjectSelectionDashboard(); // Legacy one (hidden)



        // 5. UI Events
        runDiffBtn.onclick = () => handleRunDiff();
        exitCompareBtn.onclick = () => handleExitCompare();
        setupResultsUI();

        // 6. Viewer Top Bar Events
        document.getElementById('viewer-back-btn').onclick = () => {
            if (window.explorer) window.explorer.handleBackToExplorer();
        };
        document.getElementById('viewer-reset-btn').onclick = () => {
            if (window._viewer) window._viewer.setViewFromFile();
        };

    } else {
        login.innerText = 'Login';
        login.onclick = () => window.location.replace('/api/auth/login');
    }
    login.style.visibility = 'visible';

    // 7. Load Map Config
    try {
        const cfgResp = await fetch('/api/config/maps');
        if (cfgResp.ok) {
            const cfg = await cfgResp.json();
            mapApiKey = cfg.apiKey;
        } else {
            console.warn('Map configuration fetch failed.');
        }
    } catch (err) {
        console.warn('Could not load maps config:', err.message);
    }

    // 8. Bind Tab Events
    setupTabs();

} catch (err) {
    console.error('Initialization error:', err);
    login.style.visibility = 'visible';
}



// ── Project Selection Dashboard Logic ──────────────────────────────────────────
async function renderProjectSelectionDashboard() {
    const dashboard = document.getElementById('project-selection-dashboard');
    const projectListBody = document.getElementById('project-list-body');
    if (!dashboard || !projectListBody) return;

    // 0. Update Date
    const dateEl = document.getElementById('dashboard-current-date');
    if (dateEl) {
        const now = new Date();
        const days = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
        const yyyy = now.getFullYear();
        const mm = String(now.getMonth() + 1).padStart(2, '0');
        const dd = String(now.getDate()).padStart(2, '0');
        dateEl.textContent = `${yyyy}-${mm}-${dd} ${days[now.getDay()]}`;
    }

    try {
        // 1. Fetch Hubs
        const hubsResponse = await fetch('/api/hubs');
        const hubs = await hubsResponse.json();

        if (!Array.isArray(hubs) || hubs.length === 0) {
            const errorMsg = hubs.error || '허브 정보를 찾을 수 없습니다. 로그인을 확인해주세요.';
            projectListBody.innerHTML = `<tr><td colspan="6" class="error-state">${errorMsg}</td></tr>`;
            return;
        }

        // 2. Fetch Projects for all Hubs in parallel
        projectListBody.innerHTML = '<tr><td colspan="6" class="loading-state">참여 중인 프로젝트를 검색하고 있습니다...</td></tr>';

        let allProjects = [];
        const projectPromises = hubs.map(async (hub) => {
            try {
                const projectsResponse = await fetch(`/api/hubs/${hub.id}/projects`);
                const projects = await projectsResponse.json();
                return projects.map(p => ({ ...p, hubName: hub.name, hubId: hub.id }));
            } catch (err) {
                console.warn(`Failed to fetch projects for hub ${hub.id}:`, err);
                return [];
            }
        });

        const results = await Promise.all(projectPromises);
        allProjects = results.flat();

        if (allProjects.length === 0) {
            projectListBody.innerHTML = '<tr><td colspan="6" class="error-state">참여 중인 프로젝트가 없습니다.</td></tr>';
            return;
        }

        // 3. Sort by creation date (descending)
        allProjects.sort((a, b) => new Date(b.created || 0) - new Date(a.created || 0));

        // 4. Render Table
        renderProjectRows(allProjects);

        // 5. Search filtering
        const searchInput = document.getElementById('project-search');
        searchInput.oninput = (e) => {
            const term = e.target.value.toLowerCase();
            const filtered = allProjects.filter(p =>
                p.name.toLowerCase().includes(term) ||
                (p.hubName && p.hubName.toLowerCase().includes(term))
            );
            renderProjectRows(filtered);
        };

    } catch (err) {
        console.error('[Dashboard] Error rendering:', err);
        projectListBody.innerHTML = '<tr><td colspan="6" class="error-state">프로젝트 목록을 가져오는 중 오류가 발생했습니다.</td></tr>';
    }
}

function renderProjectRows(projects) {
    const projectListBody = document.getElementById('project-list-body');
    projectListBody.innerHTML = '';

    projects.forEach(project => {
        const row = document.createElement('tr');

        // Mock data for some fields to match the screenshot look
        const projectNum = project.id.slice(-8).toUpperCase();
        const createdDate = project.created ? new Date(project.created).toLocaleDateString('ko-KR', {
            year: 'numeric', month: 'long', day: 'numeric'
        }) : '-';

        row.innerHTML = `
            <td><div class="project-icon"><i class="fas fa-project-diagram"></i></div></td>
            <td>
                <div class="project-name-cell">${project.name}</div>
                <div class="project-subtext">신축공사</div>
            </td>
            <td>${projectNum}</td>
            <td>
                <div class="access-chip">
                    <i class="fas fa-file-alt"></i> Docs <i class="fas fa-caret-down"></i>
                </div>
            </td>
            <td>${project.hubName}</td>
            <td>${createdDate}</td>
        `;

        row.onclick = async () => {
            console.log('[Dashboard] Project selected:', project.name);
            const dashboard = document.getElementById('project-selection-dashboard');
            if (dashboard) dashboard.style.display = 'none';

            // Set global context
            window.currentHubId = project.hubId;
            window.currentProjectId = project.id;
            localStorage.setItem('aps_last_hub_id', project.hubId);
            localStorage.setItem('aps_last_project_id', project.id);

            // [Optimization] проекта가 선택되면 뷰어 로드 전에도 즉시 이슈 분석(API Fetch) 가동
            if (window.ContextHarness) {
                console.log('[Dashboard] 프로젝트 선택됨. 백그라운드 이슈 수합(Aggregation) 시작');
                window.ContextHarness.extract(null);
            }

            // Transition to Explorer mode
            if (window.explorer) {
                window.explorer.switchMode('explorer');

                try {
                    // [Feature] Automatically find and enter 'Project Files' folder
                    const resp = await fetch(`/api/hubs/${project.hubId}/projects/${project.id}/contents`);
                    if (resp.ok) {
                        const items = await resp.json();
                        const projectFiles = items.find(i => i.folder && i.name.toLowerCase().includes('project files'));
                        if (projectFiles) {
                            console.log('[Dashboard] Auto-navigating to Project Files:', projectFiles.id);
                            window.explorer.showFolder(project.hubId, project.id, projectFiles.id, projectFiles.name);
                            return;
                        }
                    }
                } catch (err) {
                    console.warn('[Dashboard] Failed to auto-locate Project Files, falling back to root:', err);
                }

                // Fallback to root (Top Folders)
                window.explorer.showFolder(project.hubId, project.id, null, project.name);
            }
        };

        projectListBody.appendChild(row);
    });
}
// ──────────────────────────────────────────────────────────────────

async function handleTreeSelection(node) {
    const tokens = node.id.split('|');
    const type = tokens[0];

    // Common context setup for project-related nodes
    if (type === 'project' || type === 'folder' || type === 'item' || type === 'version') {
        const hubId = tokens[1];
        const projectId = tokens[2];
        const region = tokens[3] || 'US';

        window.currentHubId = hubId;
        window.currentProjectId = projectId;
        window.currentRegion = region;

        localStorage.setItem('aps_last_hub_id', hubId);
        localStorage.setItem('aps_last_project_id', projectId);
        localStorage.setItem('aps_last_region', region);
    }

    if (type === 'folder') {
        const hubId = tokens[1];
        const projectId = tokens[2];
        const folderId = tokens[4]; // In sidebar.js, folder id is tokens[4]
        console.log('[Main] Folder selected, opening explorer:', node.text);
        explorer.showFolder(hubId, projectId, folderId, node.text);
    }

    if (type === 'project') {
        console.log('[Main] Project selected, showing top folders in explorer:', tokens[2]);
        explorer.showFolder(tokens[1], tokens[2], null, node.text);
    }

    if (type === 'version' || type === 'item') {
        const urn = (type === 'version') ? tokens[4] : node.urn;
        const versionName = (type === 'version') ? tokens[5] : (node.text + ` (V${node.vNumber})`);

        if (!urn) return;

        console.log(`[Main] Loading ${type}: ${versionName} | URN: ${urn}`);

        // ── Set context BEFORE load so GEOMETRY_LOADED_EVENT has correct data ──
        if (type === 'item') {
            window.currentItemId = tokens[4];
            window.currentVersionId = node.id;
        } else if (type === 'version' && tokens[6]) {
            window.currentItemId = tokens[6];
            window.currentVersionId = tokens[4]; // urn/versionId
        }

        // Ensure we switch to viewer mode if we are in explorer mode
        explorer.switchMode('viewer');

        if (document.getElementById('preview').style.display !== 'none') {
            loadModelWithTracking(currentViewer, urn, versionName).then(() => {
                const label = document.getElementById('model-name-label');
                if (label) label.textContent = versionName;
                const topBarName = document.getElementById('viewer-model-name');
                if (topBarName) topBarName.textContent = versionName;

                // ── Context 저장 (툴바 버전 버튼 등에서 활용) ──
                if (type === 'item') {
                    window.currentItemId = tokens[4]; // Store for cross-version issue management
                    loadVersionsDropdown(tokens[1], tokens[2], tokens[4], node.id);

                    window._saveModelContext(urn, {
                        hubId: tokens[1],
                        projectId: tokens[2],
                        region: tokens[3],
                        itemId: tokens[4],
                        itemName: node.text.trim()
                    });
                } else if (type === 'version') {
                    // version|hubId|projectId|region|urn|name|itemId
                    // itemId is now tokens[6]
                    if (tokens[6]) {
                        window.currentItemId = tokens[6];
                        loadVersionsDropdown(tokens[1], tokens[2], tokens[6], tokens[4]); // tokens[4] is the urn/versionId
                    }
                }
            });
        }
    }
}

async function handleClashToolClick(viewer) {
    console.log('[Main] Legacy Clash Clicked (Ignored - NavisClashExtension active)');
}

function updateCompareUI() {
    compareBar.style.display = 'flex';
    if (versionA) document.getElementById('slot-a-name').textContent = versionA.name;
    if (versionB) {
        document.getElementById('slot-b-name').textContent = versionB.name;
        runDiffBtn.disabled = false;
    }
}

async function handleRunDiff() {
    if (!versionA || !versionB) return;

    // [필수] 비교 실행 시점에 UI 상단바 명칭 즉시 동기화
    const slotA = document.getElementById('slot-a-name');
    const slotB = document.getElementById('slot-b-name');
    if (slotA) slotA.textContent = versionA.name;
    if (slotB) slotB.textContent = versionB.name;
    console.log('[Main] Slot names set to:', versionA.name, versionB.name);

    runDiffBtn.disabled = true;
    runDiffBtn.textContent = 'Indexing...';

    // [정정] index.html의 실제 ID인 'preview'로 컨테이너 전환
    document.getElementById('preview').style.display = 'none';
    document.getElementById('comparison-container').style.display = 'block';

    try {
        await loadVersions(versionA.urn, versionB.urn);
        const results = await runDiff(versionA.projectId, versionA.id, versionB.id, versionA.region, (p) => {
            runDiffBtn.textContent = typeof p === 'string' ? p : `Analyzing ${p}%...`;
        });
        visualizeDiff(results);
        runDiffBtn.textContent = 'Comparison Ready';
        runDiffBtn.disabled = false;
        // Show the toolbar exit button so the user can exit from the viewer
        if (_exitCompareToolbarBtn) _exitCompareToolbarBtn.setVisible(true);
    } catch (err) {
        alert('Diff failed: ' + err.message);
        runDiffBtn.disabled = false;
        runDiffBtn.textContent = 'Run Comparison';
    }
}

function handleExitCompare() {
    // 1. Call diff-viewer cleanup (finishes split viewers, removes listeners, hides panels)
    exitCompareMode();

    // 2. Restore layout: show single viewer, hide comparison container
    document.getElementById('preview').style.display = 'block';
    document.getElementById('comparison-container').style.display = 'none';

    // 3. Hide compare bar and reset slot labels
    compareBar.style.display = 'none';
    document.getElementById('slot-a-name').textContent = 'Select from tree...';
    document.getElementById('slot-b-name').textContent = 'Select from tree...';

    // 4. Reset version state
    versionA = null;
    versionB = null;
    runDiffBtn.disabled = true;
    runDiffBtn.textContent = 'Run Comparison';

    // 5. Restore main viewer canvas size and fit-to-screen
    if (currentViewer) {
        setTimeout(() => {
            try {
                currentViewer.resize();
                currentViewer.fitToView();
            } catch (e) {
                console.warn('[Exit Compare] resize/fitToView error:', e.message);
            }
        }, 100);
    }

    // 6. Hide the toolbar exit button
    if (_exitCompareToolbarBtn) _exitCompareToolbarBtn.setVisible(false);

    console.log('[Main] Compare mode exited. Single viewer restored.');
}

function setupResultsUI() {
    const tabs = document.querySelectorAll('.diff-tab');
    tabs.forEach(tab => {
        tab.onclick = () => {
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            showDiffList(tab.dataset.type);
        };
    });
    // close-diff-panel may not exist in the current HTML — guard it
    document.getElementById('close-diff-panel')?.addEventListener('click', () => {
        document.getElementById('diff-results-three-columns')?.style?.setProperty('display', 'none');
    });
    document.getElementById('close-clash-panel').onclick = () => {
        // Legacy clash panel close - no longer needed but kept for safety if HTML exists
        document.getElementById('clash-results-panel').style.display = 'none';
    };

    // ── Version Comparison Trigger from Popup ──
    window.addEventListener('request-version-diff', async (e) => {
        const { versionA: vA, versionB: vB } = e.detail;
        console.log('[Main] Received comparison request from popup:', vA.name, 'vs', vB.name);

        // Update main state
        versionA = vA;
        versionB = vB;
        updateCompareUI();

        // Run diff
        handleRunDiff();
    });
}

function logout() {
    const iframe = document.createElement('iframe');
    iframe.style.visibility = 'hidden';
    iframe.src = 'https://accounts.autodesk.com/Authentication/LogOut';
    document.body.appendChild(iframe);
    iframe.onload = () => {
        window.location.replace('/api/auth/logout');
        document.body.removeChild(iframe);
    };
}

/**
 * Adds a custom button to the viewer toolbar for issue management.
 */
function addIssueToolbarButton(viewer, onClick) {
    const toolbar = viewer.getToolbar(true);
    if (!toolbar) return;

    let navControl = toolbar.getControl('settingsControl');
    if (!navControl) {
        navControl = new Autodesk.Viewing.UI.ControlGroup('custom-issue-group');
        toolbar.addControl(navControl);
    }

    const btn = new Autodesk.Viewing.UI.Button('add-issue-tool-btn');

    // Custom SVG Location Pin for a premium look
    btn.icon.innerHTML = `
        <svg viewBox="0 0 24 24" width="20" height="20" style="margin-top: 4px;">
            <path fill="currentColor" d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
        </svg>
    `;
    btn.addClass('adsk-viewing-viewer-toolbar-record-button');
    btn.setToolTip('Add Issue (Click on model)');
    btn.onClick = onClick;
    navControl.addControl(btn);
    return btn;
}

function setupIssueModal() {
    const modal = document.getElementById('issue-modal');
    const closeBtn = document.getElementById('close-issue-modal');
    const cancelBtn = document.getElementById('cancel-issue-btn');
    const saveBtn = document.getElementById('save-issue-btn');

    const resetModal = () => {
        document.getElementById('issue-title').value = '';
        document.getElementById('issue-desc').value = '';
        document.getElementById('issue-assignee').value = '';
        document.getElementById('issue-status').value = 'Open';

        const resDescInput = document.getElementById('issue-resolution-desc');
        if (resDescInput) resDescInput.value = '';
        const resSection = document.getElementById('issue-resolution-section');
        if (resSection) resSection.style.display = 'none';

        const structureInput = document.getElementById('issue-structure');
        if (structureInput) structureInput.value = '';

        const afterPreviewContainer = document.getElementById('modal-after-image-preview');
        const afterPreviewImg = document.getElementById('issue-after-preview-img');
        if (afterPreviewImg) afterPreviewImg.src = '';
        if (afterPreviewContainer) afterPreviewContainer.style.display = 'none';

        // Reset header and button
        modal.querySelector('.modal-header h3').textContent = 'Create New Issue';
        saveBtn.textContent = 'Create Issue';

        // Clear metadata
        delete modal.dataset.mode;
        delete modal.dataset.editId;
        delete modal.dataset.thumbnail;
        delete modal.dataset.viewstate;
        delete modal.dataset.point;
        delete modal.dataset.dbId;
        delete modal.dataset.afterThumbnail;
        delete modal.dataset.afterViewstate;

        // Clear Image Preview
        const previewContainer = document.getElementById('modal-image-preview');
        const previewImg = document.getElementById('issue-preview-img');
        if (previewImg) previewImg.src = '';
        if (previewContainer) previewContainer.style.display = 'none';
    };

    const hide = () => {
        console.log('[Main] Closing issue modal and resetting state');
        modal.style.display = 'none';
        resetModal();
        if (issueManager) {
            issueManager.toggleCreationMode(false);
            issueManager.removeTempMarker(); // Clear marker if any
        }
    };

    closeBtn.onclick = hide;
    cancelBtn.onclick = hide;

    // Toggle Resolution Section based on Status
    const statusSelect = document.getElementById('issue-status');
    const resSection = document.getElementById('issue-resolution-section');
    if (statusSelect && resSection) {
        statusSelect.addEventListener('change', (e) => {
            if (e.target.value === 'Closed') {
                resSection.style.display = 'block';
                const marker = document.getElementById('temp-issue-marker-div');
                if (marker) marker.classList.add('green');
            } else {
                resSection.style.display = 'none';
                const marker = document.getElementById('temp-issue-marker-div');
                if (marker) marker.classList.remove('green');
            }
        });
    }

    // Capture After Snapshot Logic (Integrates Markup Tools)
    const captureAfterBtn = document.getElementById('issue-capture-after-btn');
    if (captureAfterBtn) {
        captureAfterBtn.onclick = () => {
            if (issueManager) {
                // 1. Instantly capture viewpoint state
                const afterViewstate = issueManager.viewer.getState();
                modal.dataset.afterViewstate = JSON.stringify(afterViewstate);

                // 2. Temporarily hide modal to allow drawing on viewer
                modal.style.display = 'none';

                // 3. Find current issue context for markup extension
                const editId = parseInt(modal.dataset.editId);
                const issue = issueManager.issues.find(i => i.id === editId);

                // 4. Trigger Markup Mode with 'resolve' context
                console.log('[Main] Triggering resolution markup Mode for issue:', editId);
                issueManager.enterMarkupMode(
                    issue ? issue.dbId : 0,
                    issue ? issue.point : null,
                    'resolve'
                );
            }
        };
    }

    saveBtn.onclick = (e) => {
        if (e) {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
        }

        if (saveBtn.disabled) return;
        saveBtn.disabled = true;

        console.log('[Main] Issue Modal Save/Update clicked. Attempting to save data...');

        const titleInput = document.getElementById('issue-title');
        const descInput = document.getElementById('issue-desc');
        const assigneeInput = document.getElementById('issue-assignee');
        const statusInput = document.getElementById('issue-status');
        const structureInput = document.getElementById('issue-structure');
        const workTypeInput = document.getElementById('issue-work-type');

        const title = titleInput.value.trim();
        const desc = descInput.value.trim();
        const assignee = assigneeInput.value.trim();
        const status = statusInput.value;
        const structureName = structureInput ? structureInput.value.trim() : '-';
        const workType = workTypeInput ? workTypeInput.value.trim() : '-';

        const resDescInput = document.getElementById('issue-resolution-desc');
        const resolutionDesc = resDescInput ? resDescInput.value.trim() : '';
        const afterThumbnail = modal.dataset.afterThumbnail || null;
        const afterViewstate = modal.dataset.afterViewstate ? JSON.parse(modal.dataset.afterViewstate) : null;
        const issueNumber = modal.dataset.issueNumber || `ISSUE-${Date.now()}`;
        const itemId = modal.dataset.itemId || null;

        // Skip validation check closing by returning early if invalid
        if (!title || !desc) {
            alert('제목과 내용을 모두 입력해주세요.');
            saveBtn.disabled = false;
            return;
        }

        if (status === 'Closed') {
            if (!resolutionDesc) {
                alert('해결(Closed) 상태로 변경하려면 해결 내용을 입력해야 합니다.');
                saveBtn.disabled = false;
                return;
            }
            if (!afterThumbnail) {
                alert('해결(Closed) 상태로 변경하려면 캡처 버튼을 눌러 상태를 저장해야 합니다.');
                saveBtn.disabled = false;
                return;
            }
        }

        const issueData = {
            title,
            description: desc,
            assignee,
            status,
            resolutionDesc,
            afterThumbnail,
            afterViewstate,
            structureName,
            workType,
            issueNumber
        };

        try {
            if (modal.dataset.mode === 'edit') {
                const editId = parseInt(modal.dataset.editId);
                console.log(`[Main] updateIssue for ID: ${editId}`, issueData);
                issueManager.updateIssue(editId, issueData);
            } else {
                const dbId = parseInt(modal.dataset.dbId);
                const point = JSON.parse(modal.dataset.point);
                const thumbnail = modal.dataset.thumbnail;
                const viewstate = modal.dataset.viewstate ? JSON.parse(modal.dataset.viewstate) : null;
                const urn = modal.dataset.urn;

                const fullIssueData = {
                    ...issueData,
                    dbId,
                    point,
                    thumbnail,
                    viewstate,
                    urn,
                    itemId
                };
                console.log('[Main] addIssue with full data:', fullIssueData);
                issueManager.addIssue(fullIssueData);
            }
        } catch (error) {
            console.error('[Main] Non-fatal error during issue save (e.g., storage quota):', error);
        } finally {
            console.log('[Main] Validation passed, save process finished, hiding modal unconditionally.');
            saveBtn.disabled = false;
            hide();
            if (issueManager) {
                issueManager.renderIssueList();
                issueManager.restorePins();
            }
        }
    };
}

// ── AIAssistant Management (Hotfix V4 - Hard Toggle) ──────────────────
document.addEventListener('DOMContentLoaded', () => {
    const aiBtn = document.getElementById('ai-assistant-icon');
    const aiContainer = document.getElementById('ai-assistant-container');
    const closeBtn = document.getElementById('close-ai-widget');

    if (aiBtn && aiContainer) {
        aiBtn.onclick = function () {
            console.log("AI Assistant 버튼 클릭됨!"); // 로그로 확인
            if (aiContainer.style.display === 'none' || aiContainer.style.display === '') {
                aiContainer.style.setProperty('display', 'block', 'important');
                aiContainer.style.opacity = '1';
                aiContainer.style.transform = 'translateY(0) scale(1)';

                // Auto-focus input
                const chatInput = document.getElementById('chat-input');
                if (chatInput) setTimeout(() => chatInput.focus(), 100);
            } else {
                aiContainer.style.setProperty('display', 'none', 'important');
                aiContainer.style.opacity = '0';
                aiContainer.style.transform = 'translateY(40px) scale(0.92)';
            }
        };
    }

    if (closeBtn && aiContainer) {
        closeBtn.onclick = function () {
            aiContainer.style.setProperty('display', 'none', 'important');
            aiContainer.style.opacity = '0';
            aiContainer.style.transform = 'translateY(40px) scale(0.92)';
        };
    }
});

// ── Tab Management ────────────────────────────────────────────────────────────
function setupTabs() {
    const headerMapBtn = document.getElementById('header-map-btn');
    const headerDashboardBtn = document.getElementById('header-dashboard-btn');
    const headerProjectsBtn = document.getElementById('header-projects-btn');
    const tabProjects = document.getElementById('tab-projects');
    const dashboardLegacy = document.getElementById('project-selection-dashboard');
    const dashboardPremium = document.getElementById('dashboard-premium-container');
    const mapContainer = document.getElementById('map-container');
    const preview = document.getElementById('preview');

    if (!headerMapBtn || !tabProjects || !headerDashboardBtn || !headerProjectsBtn) return;

    // Premium Dashboard button in Header
    headerDashboardBtn.onclick = () => {
        headerMapBtn.classList.remove('active');
        headerProjectsBtn.classList.remove('active');
        headerDashboardBtn.classList.add('active');

        if (dashboardPremium) dashboardPremium.style.display = 'flex';
        if (dashboardLegacy) dashboardLegacy.style.display = 'none';
        if (mapContainer) mapContainer.style.display = 'none';
        if (preview) preview.style.display = 'none';
    };

    // Legacy Projects button in Header
    headerProjectsBtn.onclick = () => {
        headerMapBtn.classList.remove('active');
        headerDashboardBtn.classList.remove('active');
        headerProjectsBtn.classList.add('active');
        tabProjects.classList.add('active'); // legacy inner tab sync

        if (dashboardLegacy) dashboardLegacy.style.display = 'flex';
        if (dashboardPremium) dashboardPremium.style.display = 'none';
        if (mapContainer) mapContainer.style.display = 'none';
        if (preview) preview.style.display = 'none';
    };

    // Map button in Header
    headerMapBtn.onclick = async () => {
        const isMapVisible = mapContainer.style.display === 'block';

        if (isMapVisible) {
            // Already in map, switch back to dashboard (default behavior)
            headerMapBtn.classList.remove('active');
            headerDashboardBtn.classList.add('active');
            headerProjectsBtn.classList.remove('active');
            
            if (dashboardPremium) dashboardPremium.style.display = 'flex';
            if (dashboardLegacy) dashboardLegacy.style.display = 'none';
            if (mapContainer) mapContainer.style.display = 'none';
        } else {
            // Switch to map
            headerDashboardBtn.classList.remove('active');
            headerProjectsBtn.classList.remove('active');
            headerMapBtn.classList.add('active');

            // Hide other panels
            if (dashboardPremium) dashboardPremium.style.display = 'none';
            if (dashboardLegacy) dashboardLegacy.style.display = 'none';
            if (preview) preview.style.display = 'none';

            // Show Map
            mapContainer.style.display = 'block';

            if (!mapInitialized) {
                if (mapApiKey) {
                    try {
                        await initMap('map-container', mapApiKey);
                        mapInitialized = true;
                        await loadHubsOnMap();
                    } catch (err) {
                        console.error('Map init error:', err);
                        mapContainer.style.display = 'none';
                        headerMapBtn.classList.remove('active');
                        headerDashboardBtn.classList.add('active');
                        if (dashboardPremium) dashboardPremium.style.display = 'flex';
                        alert('지도를 불러오는 중 오류가 발생했습니다: ' + err.message);
                    }
                } else {
                    // API key missing
                    mapContainer.style.display = 'none';
                    headerMapBtn.classList.remove('active');
                    headerDashboardBtn.classList.add('active');
                    if (dashboardPremium) dashboardPremium.style.display = 'flex';
                    alert('.env 파일에 API 설정이 필요합니다.');
                }
            } else {
                setTimeout(() => resizeMap(), 100);
            }
        }
    };

    // Legacy inner tab (just in case it's used inside legacy or sidebars)
    tabProjects.onclick = () => {
        headerProjectsBtn.onclick(); // trigger the same logic as header projects btn
    };
}

async function loadHubsOnMap() {
    try {
        const hubs = await fetch('/api/hubs').then(r => r.json());
        const allProjects = [];

        for (const hub of hubs) {
            if (!hub.id) continue;
            const projects = await fetch(`/api/hubs/${hub.id}/projects`).then(r => r.json());

            for (const p of projects) {
                let lat = p.latitude ? parseFloat(p.latitude) : null;
                let lng = p.longitude ? parseFloat(p.longitude) : null;
                let address = '';
                let hasRealLocation = !!(lat && lng);

                if (!hasRealLocation) {
                    const street = [p.addressLine1, p.addressLine2].filter(Boolean).join('');
                    const candidates = [
                        [p.stateOrProvince, p.city, street].filter(Boolean).join(' '),
                        [p.stateOrProvince, p.city, p.addressLine1].filter(Boolean).join(' '),
                        [p.stateOrProvince, p.city].filter(Boolean).join(' '),
                        p.postalCode || '',
                        p.city || '',
                    ].filter(Boolean);

                    for (const candidate of candidates) {
                        try {
                            const params = new URLSearchParams({ address: candidate });
                            if (candidate === p.postalCode) params.set('postalCode', p.postalCode);
                            const geo = await fetch(`/api/geocode?${params}`).then(r => r.json());
                            if (geo.lat && geo.lng) {
                                lat = geo.lat;
                                lng = geo.lng;
                                address = candidate;
                                hasRealLocation = true;
                                break;
                            }
                        } catch (e) { }
                    }
                    if (!hasRealLocation) {
                        address = candidates[0] || '';
                    }
                } else {
                    address = `${p.city || ''} ${p.stateOrProvince || ''}`.trim();
                }

                allProjects.push({
                    id: p.id,
                    name: p.name,
                    hubId: hub.id,
                    hubName: hub.name,
                    address: address || '주소 미설정',
                    lat: lat ?? (36.5 + (Math.random() - 0.5) * 2),
                    lng: lng ?? (127.5 + (Math.random() - 1.5) * 2),
                    hasRealLocation: !!(lat && lng),
                });
            }
        }

        if (allProjects.length > 0) {
            addProjectMarkers(allProjects, (project) => {
                flyToLocation(project.lat, project.lng, 5000);
            });
            const firstReal = allProjects.find(p => p.hasRealLocation) || allProjects[0];
            flyToLocation(firstReal.lat, firstReal.lng, 200000);
        }
    } catch (err) {
        console.warn('Map hub load error:', err.message);
    }
}

/**
 * ── Centralized UI Sync Utility ──
 * Updates titles and triggers version dropdown refresh consistently.
 */
/**
 * ── Robust UI Sync Architecture ──
 * Addressing race conditions and Revit title extraction issues.
 */

// 1. URN Normalization Utility
window.normalizeUrn = (urn) => {
    if (!urn) return null;
    let decoded = urn;
    try { decoded = decodeURIComponent(urn); } catch (e) { }
    if (decoded.includes('dm.lineage:')) return decoded.split('?')[0];
    return decoded;
};

// 2. Sidebar MutationObserver (Immediate Feedback)
const sidebarObserver = new MutationObserver(() => {
    const activeNode = document.querySelector('.tree-item.active .text');
    if (activeNode && activeNode.innerText && activeNode.innerText !== window.currentModelName) {
        console.log('[Sync] Observer detected active node:', activeNode.innerText);
        const titleElements = ['viewer-model-name', 'model-title'];
        titleElements.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.innerText = activeNode.innerText;
        });
        window.currentModelName = activeNode.innerText;
    }
});

// Start observing sidebar when available
const startSidebarObservation = () => {
    const container = document.getElementById('hub-tree-container') || document.querySelector('.inspire-tree');
    if (container) {
        sidebarObserver.observe(container, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
        console.log('[Sync] Sidebar MutationObserver started.');
    } else {
        setTimeout(startSidebarObservation, 1500);
    }
};
startSidebarObservation();

// 3. Async Name Extraction Worker (Addressing Race Conditions)
window.retryExtractName = async (context, maxRetries = 10) => {
    console.log('[SyncWorker] Started for URN:', context.urn);

    for (let i = 0; i < maxRetries; i++) {
        const viewer = window._viewer || (typeof NOP_VIEWER !== 'undefined' ? NOP_VIEWER : null);
        let foundName = null;

        // A. Check Viewer Metadata (Most Reliable)
        if (viewer && viewer.model) {
            const model = viewer.model;
            const modelData = model.getData();

            // [Fix] getDocument().getProperty() 제거 및 최신 API 표준 반영
            foundName = modelData.loadOptions?.bubbleNode?.name?.() ||
                model.getDocumentNode()?.data?.name ||
                modelData.metadata?.name;

            if (foundName && !['{3D}', 'Scene', 'undefined', 'Loading...'].includes(String(foundName).trim())) {
                console.log(`[SyncWorker] Viewer API에서 모델명 추출 성공 (Attempt ${i + 1}):`, foundName);
                return foundName;
            }
        }

        // B. Check Sidebar DOM (Active Item)
        const activeNode = document.querySelector('.tree-item.active .text');
        if (activeNode && activeNode.innerText && !['{3D}', 'Loading...'].includes(activeNode.innerText)) {
            console.log(`[SyncWorker] Found in Sidebar DOM (Attempt ${i + 1}):`, activeNode.innerText);
            return activeNode.innerText;
        }

        // C. Check Global Map (From Sidebar Loading)
        if (context.urn && window.urnToNameMap && window.urnToNameMap[context.urn]) {
            console.log(`[SyncWorker] Found in Global Map (Attempt ${i + 1}):`, window.urnToNameMap[context.urn]);
            return window.urnToNameMap[context.urn];
        }

        await new Promise(r => setTimeout(r, 600));
    }

    console.warn('[SyncWorker] Failed to resolve name after retries.');
    return null;
};

// 4. Central Orchestrator
window.syncUIState = async (name, context = {}) => {
    console.log('[Main] DISPATCH_SYNC:', { name, context });

    // Immediate injection if name provided
    let initialName = (name && !['undefined', '{3D}'].includes(String(name))) ? name : null;

    const updateUI = (finalName) => {
        if (!finalName) return;
        const titleElements = ['viewer-model-name', 'model-title', 'model-name-label'];
        titleElements.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.innerText = finalName;
        });
        window.currentModelName = finalName;
    };

    if (initialName) updateUI(initialName);

    // Context persistence
    if (context.urn) window.currentUrn = context.urn;
    if (context.itemId) window.currentItemId = context.itemId;
    if (context.hubId) window.currentHubId = context.hubId;
    if (context.projectId) window.currentProjectId = context.projectId;

    // Trigger Version Manager
    if (window.VersionManager && (context.itemId || window.currentItemId)) {
        window.VersionManager.init({
            hubId: context.hubId || window.currentHubId,
            projectId: context.projectId || window.currentProjectId,
            itemId: context.itemId || window.currentItemId,
            currentVersionId: context.urn || window.currentUrn
        });
    }

    // Launch Async Worker for final resolution
    const refinedName = await window.retryExtractName(context);
    if (refinedName) updateUI(refinedName);

    // [Harness-Architecture] 추출된 데이터를 컨텍스트 하네스에 최종 주입
    if (window.ContextHarness) {
        const viewer = window._viewer || (typeof NOP_VIEWER !== 'undefined' ? NOP_VIEWER : null);
        if (viewer && viewer.model) {
            console.log('[Main] SyncUIState -> ContextHarness.extract 트리거');
            window.ContextHarness.extract(viewer);
        }
    }
};


// ── Initial State via URL Parameter ────────────────────────
window.addEventListener('load', async () => {
    const urlParams = new URLSearchParams(window.location.search);
    const urlUrn = urlParams.get('urn');

    if (urlUrn) {
        console.log('[Main] Initializing with URN from URL:', urlUrn);

        // Wait for viewer initialization
        const checkViewer = setInterval(async () => {
            if (window._viewer && window._viewer.model === undefined) { // Check if viewer ready but no model yet
                clearInterval(checkViewer);

                // Switch to viewer mode
                const dashboard = document.getElementById('project-selection-dashboard');
                const explorerCont = document.getElementById('explorer-container');
                if (dashboard) dashboard.style.display = 'none';
                if (explorerCont) explorerCont.style.display = 'none';
                document.getElementById('viewer-top-bar').style.display = 'flex';
                document.getElementById('preview').style.display = 'block';
                document.getElementById('viewer-info-bar').style.display = 'flex';

                try {
                    const { loadModelWithTracking } = await import('./viewer.js');
                    await loadModelWithTracking(window._viewer, urlUrn, 'Loaded from URL');
                    window.currentUrn = urlUrn;
                } catch (err) {
                    console.error('[Main] Failed to load initial URN:', err);
                }
            } else if (window._viewer && window._viewer.model !== undefined) {
                // Model already loading/loaded, just stop check
                clearInterval(checkViewer);
            }
        }, 500);
    }
});
