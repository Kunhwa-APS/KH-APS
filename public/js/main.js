/* ============================================================
   main.js — Application Entry Point (ES6 Module)
   ============================================================ */
import { initViewer, loadModel, loadModelWithTracking, getSafeUrn } from './viewer.js';
import { initTree } from './sidebar.js';
import { runDiff, visualizeDiff, loadVersions, exitCompareMode, showDiffList, addToolbarButton, addExitCompareButton } from './diff-viewer.js';
import { IssueManager } from './issue-manager.js';
import { addCustomButtons } from './toolbar-utils.js';
import { initMap, addProjectMarkers, flyToLocation, resizeMap } from './map.js';
import { loadVersionsDropdown } from './version-manager.js?v=20260417_2130';
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
let _exitCompareToolbarBtn = null;
let issueManager = null;
let mapInitialized = false;
let mapApiKey = null;

window._issueManager = null;
window.loadModelWithTracking = loadModelWithTracking; // Expose globally
window.currentModelName = ''; // Global tracker for active model name

// Data Recovery
window.currentHubId = localStorage.getItem('aps_last_hub_id');
window.currentProjectId = localStorage.getItem('aps_last_project_id');
window.currentRegion = localStorage.getItem('aps_last_region') || 'US';

try {
    const resp = await fetch('/api/auth/profile');
    const isLogged = resp.ok;

    if (isLogged) {
        const user = await resp.json();
        login.innerText = `Logout (${user.name})`;
        login.onclick = () => { logout(); };
        login.style.visibility = 'visible';

        try {
            currentViewer = await initViewer(document.getElementById('preview'));
            window._viewer = currentViewer;

            issueManager = new IssueManager(currentViewer);
            await issueManager.init();
            window._issueManager = issueManager;
            setupIssueModal();

            // ── CRITICAL: Auto-populate version dropdown on model load ──
            currentViewer.addEventListener(Autodesk.Viewing.GEOMETRY_LOADED_EVENT, async () => {
                const hubId = window.currentHubId;
                const projectId = window.currentProjectId;
                const itemId = window.currentItemId;
                const currentVersionId = window.currentVersionId;

                console.log('[Main] GEOMETRY_LOADED - sync UI and loading version dropdown');
                if (hubId && projectId && itemId) {
                    await loadVersionsDropdown(hubId, projectId, itemId, currentVersionId);
                }

                // Sync UI title if name is available
                if (window.currentModelName) {
                    window.syncUIState(window.currentModelName, { hubId, projectId, itemId, urn: currentVersionId });
                }
            });

            currentViewer.addEventListener(Autodesk.Viewing.TOOLBAR_CREATED_EVENT, () => {
                addCustomButtons(currentViewer);
                addToolbarButton(currentViewer, () => {
                    if (versionA && versionB) handleRunDiff();
                    else alert('버전 A와 B를 브라우저 트리에서 먼저 선택해주세요.');
                });
                _exitCompareToolbarBtn = addExitCompareButton(currentViewer, () => handleExitCompare());
            });
        } catch (vErr) {
            console.error('Viewer initialization failed:', vErr);
        }

        initTree('#tree', (node) => handleTreeSelection(node));
        renderPremiumDashboard();

        runDiffBtn.onclick = () => handleRunDiff();
        exitCompareBtn.onclick = () => handleExitCompare();
        setupResultsUI();

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

    try {
        const cfgResp = await fetch('/api/config/maps');
        if (cfgResp.ok) {
            const cfg = await cfgResp.json();
            mapApiKey = cfg.apiKey;
        }
    } catch (err) { }

    setupTabs();

} catch (err) {
    console.error('Initialization error:', err);
    login.style.visibility = 'visible';
}

async function renderProjectSelectionDashboard() {
    const dashboard = document.getElementById('project-selection-dashboard');
    const projectListBody = document.getElementById('project-list-body');
    if (!dashboard || !projectListBody) return;

    const dateEl = document.getElementById('dashboard-current-date');
    if (dateEl) {
        const now = new Date();
        const yyyy = now.getFullYear();
        const mm = String(now.getMonth() + 1).padStart(2, '0');
        const dd = String(now.getDate()).padStart(2, '0');
        dateEl.textContent = `${yyyy}-${mm}-${dd}`;
    }

    try {
        const hubsResponse = await fetch('/api/hubs');
        const hubs = await hubsResponse.json();
        if (!Array.isArray(hubs) || hubs.length === 0) return;

        let allProjects = [];
        const projectPromises = hubs.map(async (hub) => {
            try {
                const projectsResponse = await fetch(`/api/hubs/${hub.id}/projects`);
                const projects = await projectsResponse.json();
                return projects.map(p => ({ ...p, hubName: hub.name, hubId: hub.id }));
            } catch (err) { return []; }
        });

        const results = await Promise.all(projectPromises);
        allProjects = results.flat();
        allProjects.sort((a, b) => new Date(b.created || 0) - new Date(a.created || 0));

        renderProjectRows(allProjects);

        const searchInput = document.getElementById('project-search');
        if (searchInput) {
            searchInput.oninput = (e) => {
                const term = e.target.value.toLowerCase();
                const filtered = allProjects.filter(p =>
                    p.name.toLowerCase().includes(term) ||
                    (p.hubName && p.hubName.toLowerCase().includes(term))
                );
                renderProjectRows(filtered);
            };
        }
    } catch (err) { }
}

function renderProjectRows(projects) {
    const projectListBody = document.getElementById('project-list-body');
    if (!projectListBody) return;
    projectListBody.innerHTML = '';

    projects.forEach(project => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td><div class="project-icon"><i class="fas fa-project-diagram"></i></div></td>
            <td><div class="project-name-cell">${project.name}</div></td>
            <td>${project.id.slice(-8).toUpperCase()}</td>
            <td><div class="access-chip">Docs</div></td>
            <td>${project.hubName}</td>
            <td>${project.created ? new Date(project.created).toLocaleDateString() : '-'}</td>
        `;

        row.onclick = async () => {
            console.log('[Dashboard] Project selected:', project.name);
            const dashboard = document.getElementById('project-selection-dashboard');
            const dashboardPremium = document.getElementById('dashboard-premium-container');
            if (dashboard) dashboard.style.display = 'none';
            if (dashboardPremium) dashboardPremium.style.display = 'none';

            window.currentHubId = project.hubId;
            window.currentProjectId = project.id;
            localStorage.setItem('aps_last_hub_id', project.hubId);
            localStorage.setItem('aps_last_project_id', project.id);

            // [Optimization] 추출기 작동
            if (window.ContextHarness) {
                console.log('[Dashboard] 프로젝트 선택됨. 백그라운드 이슈 수합 시작');
                window.ContextHarness.extract(null);
            }

            if (window.explorer) {
                window.explorer.switchMode('explorer');
                try {
                    const resp = await fetch(`/api/hubs/${project.hubId}/projects/${project.id}/contents`);
                    if (resp.ok) {
                        const items = await resp.json();
                        const projectFiles = items.find(i => i.folder && i.name.toLowerCase().includes('project files'));
                        if (projectFiles) {
                            window.explorer.showFolder(project.hubId, project.id, projectFiles.id, projectFiles.name);
                            return;
                        }
                    }
                } catch (err) { }
                window.explorer.showFolder(project.hubId, project.id, null, project.name);
            }
        };
        projectListBody.appendChild(row);
    });
}

async function handleTreeSelection(node) {
    const tokens = node.id.split('|');
    const type = tokens[0];

    if (['project', 'folder', 'item', 'version'].includes(type)) {
        const hubId = tokens[1];
        const projectId = tokens[2];
        const region = tokens[3] || 'US';
        window.currentHubId = hubId;
        window.currentProjectId = projectId;
        window.currentRegion = region;
        localStorage.setItem('aps_last_hub_id', hubId);
        localStorage.setItem('aps_last_project_id', projectId);
    }

    if (type === 'folder') {
        explorer.showFolder(tokens[1], tokens[2], tokens[4], node.text);
    } else if (type === 'project') {
        explorer.showFolder(tokens[1], tokens[2], null, node.text);
    } else if (type === 'version' || type === 'item') {
        const urn = (type === 'version') ? tokens[4] : node.urn;
        const versionName = (type === 'version') ? tokens[5] : (node.text + ` (V${node.vNumber})`);
        if (!urn) return;

        if (type === 'item') {
            window.currentItemId = tokens[4];
            window.currentVersionId = node.id;
        } else if (type === 'version' && tokens[6]) {
            window.currentItemId = tokens[6];
            window.currentVersionId = tokens[4];
        }

        explorer.switchMode('viewer');
        loadModelWithTracking(currentViewer, urn, versionName).then(() => {
            const label = document.getElementById('model-name-label');
            if (label) label.textContent = versionName;
            const topBarName = document.getElementById('viewer-model-name');
            if (topBarName) topBarName.textContent = versionName;

            if (type === 'item') {
                loadVersionsDropdown(tokens[1], tokens[2], tokens[4], node.id);
                if (window._saveModelContext) {
                    window._saveModelContext(urn, {
                        hubId: tokens[1],
                        projectId: tokens[2],
                        region: tokens[3],
                        itemId: tokens[4],
                        itemName: node.text.trim()
                    });
                }
            } else if (type === 'version' && tokens[6]) {
                loadVersionsDropdown(tokens[1], tokens[2], tokens[6], tokens[4]);
            }
        });
    }
}

async function handleRunDiff() {
    if (!versionA || !versionB) return;
    runDiffBtn.disabled = true;
    runDiffBtn.textContent = 'Analyzing...';
    document.getElementById('preview').style.display = 'none';
    document.getElementById('comparison-container').style.display = 'block';

    try {
        await loadVersions(versionA.urn, versionB.urn);
        const results = await runDiff(versionA.projectId, versionA.id, versionB.id, versionA.region);
        visualizeDiff(results);
        runDiffBtn.textContent = 'Comparison Ready';
        runDiffBtn.disabled = false;
        if (_exitCompareToolbarBtn) _exitCompareToolbarBtn.setVisible(true);
    } catch (err) {
        alert('Diff failed: ' + err.message);
        runDiffBtn.disabled = false;
    }
}

function handleExitCompare() {
    exitCompareMode();
    document.getElementById('preview').style.display = 'block';
    document.getElementById('comparison-container').style.display = 'none';
    compareBar.style.display = 'none';
    versionA = null;
    versionB = null;
    runDiffBtn.disabled = true;
    if (currentViewer) {
        currentViewer.resize();
        currentViewer.fitToView();
    }
    if (_exitCompareToolbarBtn) _exitCompareToolbarBtn.setVisible(false);
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
    document.getElementById('close-diff-panel')?.addEventListener('click', () => {
        document.getElementById('diff-results-three-columns')?.style?.setProperty('display', 'none');
    });

    window.addEventListener('request-version-diff', async (e) => {
        const { versionA: vA, versionB: vB } = e.detail;
        versionA = vA; versionB = vB;
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

function setupIssueModal() {
    const modal = document.getElementById('issue-modal');
    const closeBtn = document.getElementById('close-issue-modal');
    const cancelBtn = document.getElementById('cancel-issue-btn');
    const saveBtn = document.getElementById('save-issue-btn');

    const hide = () => {
        modal.style.display = 'none';
        if (issueManager) {
            issueManager.toggleCreationMode(false);
            if (issueManager.removeTempMarker) issueManager.removeTempMarker();
        }
    };

    closeBtn.onclick = hide;
    cancelBtn.onclick = hide;

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

    const captureAfterBtn = document.getElementById('issue-capture-after-btn');
    if (captureAfterBtn) {
        captureAfterBtn.onclick = () => {
            if (issueManager) {
                const afterViewstate = issueManager.viewer.getState();
                modal.dataset.afterViewstate = JSON.stringify(afterViewstate);
                modal.style.display = 'none';
                const editId = parseInt(modal.dataset.editId);
                const issue = issueManager.issues.find(i => i.id === editId);
                issueManager.enterMarkupMode(issue ? issue.dbId : 0, issue ? issue.point : null, 'resolve');
            }
        };
    }

    saveBtn.onclick = (e) => {
        if (saveBtn.disabled) return;
        saveBtn.disabled = true;

        const title = document.getElementById('issue-title').value.trim();
        const desc = document.getElementById('issue-desc').value.trim();
        const status = document.getElementById('issue-status').value;
        const resolutionDesc = document.getElementById('issue-resolution-desc')?.value.trim() || '';
        const afterThumbnail = modal.dataset.afterThumbnail || null;

        if (!title || !desc) {
            alert('제목과 내용을 모두 입력해주세요.');
            saveBtn.disabled = false;
            return;
        }

        if (status === 'Closed') {
            if (!resolutionDesc || !afterThumbnail) {
                alert('해결(Closed) 상태로 변경하려면 해결 내용과 캡처 이미지가 필요합니다.');
                saveBtn.disabled = false;
                return;
            }
        }

        const issueData = {
            title, description: desc,
            status,
            assignee: document.getElementById('issue-assignee').value,
            structureName: document.getElementById('issue-structure')?.value || '-',
            workType: document.getElementById('issue-work-type')?.value || '-',
            resolutionDesc,
            afterThumbnail,
            afterViewstate: modal.dataset.afterViewstate ? JSON.parse(modal.dataset.afterViewstate) : null
        };

        if (modal.dataset.mode === 'edit') {
            issueManager.updateIssue(parseInt(modal.dataset.editId), issueData);
        } else {
            issueManager.addIssue({
                ...issueData,
                dbId: parseInt(modal.dataset.dbId),
                point: JSON.parse(modal.dataset.point),
                thumbnail: modal.dataset.thumbnail,
                viewstate: modal.dataset.viewstate ? JSON.parse(modal.dataset.viewstate) : null,
                urn: modal.dataset.urn,
                itemId: modal.dataset.itemId || null
            });
        }
        saveBtn.disabled = false;
        hide();
    };
}

function setupTabs() {
    const headerMapBtn = document.getElementById('header-map-btn');
    const headerDashboardBtn = document.getElementById('header-dashboard-btn');
    const headerProjectsBtn = document.getElementById('header-projects-btn');
    const dashboardPremium = document.getElementById('dashboard-premium-container');
    const mapContainer = document.getElementById('map-container');
    const preview = document.getElementById('preview');

    if (headerDashboardBtn) {
        headerDashboardBtn.onclick = () => {
            if (dashboardPremium) dashboardPremium.style.display = 'flex';
            if (mapContainer) mapContainer.style.display = 'none';
            if (preview) preview.style.display = 'none';
        };
    }
}

// ── UI Sync Logic ──
window.syncUIState = async (name, context = {}) => {
    console.log('[Main] syncUIState:', name);
    const titleElements = ['viewer-model-name', 'model-title', 'model-name-label'];
    titleElements.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.innerText = name;
    });
    window.currentModelName = name;

    if (context.urn) window.currentUrn = context.urn;
    if (context.itemId) window.currentItemId = context.itemId;
    if (context.hubId) window.currentHubId = context.hubId;
    if (context.projectId) window.currentProjectId = context.projectId;

    if (window.ContextHarness && window._viewer) {
        window.ContextHarness.extract(window._viewer);
    }
};

window.addEventListener('load', async () => {
    const urlParams = new URLSearchParams(window.location.search);
    const urlUrn = urlParams.get('urn');
    if (urlUrn) {
        const checkViewer = setInterval(async () => {
            if (window._viewer && window._viewer.model === undefined) {
                clearInterval(checkViewer);
                explorer.switchMode('viewer');
                loadModelWithTracking(window._viewer, urlUrn, 'Loaded from URL');
            } else if (window._viewer && window._viewer.model !== undefined) {
                clearInterval(checkViewer);
            }
        }, 500);
    }
});

document.addEventListener('DOMContentLoaded', () => {
    const aiBtn = document.getElementById('ai-assistant-icon');
    const aiContainer = document.getElementById('ai-assistant-container');
    if (aiBtn && aiContainer) {
        aiBtn.onclick = () => {
            aiContainer.style.display = (aiContainer.style.display === 'none') ? 'block' : 'none';
        };
    }
});
