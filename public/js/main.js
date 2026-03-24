/* ============================================================
   main.js — Application Entry Point (ES6 Module)
   ============================================================ */
import { initViewer, loadModel, loadModelWithTracking } from './viewer.js';
import { initTree } from './sidebar.js';
import { runDiff, visualizeDiff, loadVersions, exitCompareMode, showDiffList, addToolbarButton, addExitCompareButton } from './diff-viewer.js';
// import { initLocalClash, closeClashPanel } from './clash-viewer.js';
import { IssueManager } from './issue-manager.js';
import { addCustomButtons } from './toolbar-utils.js';

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

// Expose handles globally for toolbar-utils.js
window._issueManager = null;
// window._handleClashToolClick = (viewer) => handleClashToolClick(viewer);
window.loadModelWithTracking = loadModelWithTracking; // Expose globally

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
        renderProjectSelectionDashboard();



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
        login.style.visibility = 'visible';
    }
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

        row.onclick = () => {
            console.log('[Dashboard] Project selected:', project.name);
            const dashboard = document.getElementById('project-selection-dashboard');
            if (dashboard) dashboard.style.display = 'none';

            // Set global context
            window.currentHubId = project.hubId;
            window.currentProjectId = project.id;
            localStorage.setItem('aps_last_hub_id', project.hubId);
            localStorage.setItem('aps_last_project_id', project.id);

            // Transition to Explorer mode
            if (window.explorer) {
                window.explorer.switchMode('explorer');
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
        const urn = (type === 'version') ? tokens[2] : node.urn;
        const versionName = (type === 'version') ? tokens[3] : (node.text + ` (V${node.vNumber})`);

        if (!urn) return;

        console.log(`[Main] Loading ${type}: ${versionName} | URN: ${urn}`);

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
                    window._saveModelContext(urn, {
                        hubId: tokens[1],
                        projectId: tokens[2],
                        region: tokens[3],
                        itemId: tokens[4],
                        itemName: node.text.trim()
                    });
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
        if (issueManager) issueManager.toggleCreationMode(false);
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
            } else {
                resSection.style.display = 'none';
            }
        });
    }

    // Capture After Snapshot Logic
    const captureAfterBtn = document.getElementById('issue-capture-after-btn');
    if (captureAfterBtn) {
        captureAfterBtn.onclick = () => {
            if (issueManager) {
                // Instantly capture state
                const afterViewstate = issueManager.viewer.getState();
                modal.dataset.afterViewstate = JSON.stringify(afterViewstate);

                // Show loading state on button
                const originalText = captureAfterBtn.innerHTML;
                captureAfterBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Capturing...';

                issueManager.captureIssueThumbnail((base64) => {
                    captureAfterBtn.innerHTML = originalText;
                    if (base64) {
                        modal.dataset.afterThumbnail = base64;
                        const afterPreviewImg = document.getElementById('issue-after-preview-img');
                        const afterPreviewContainer = document.getElementById('modal-after-image-preview');
                        if (afterPreviewImg && afterPreviewContainer) {
                            afterPreviewImg.src = base64;
                            afterPreviewContainer.style.display = 'flex';
                        }
                    }
                });
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
                    urn
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
