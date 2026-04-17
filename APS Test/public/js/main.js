/* ============================================================
   main.js — Application Entry Point (ES6 Module)
   ============================================================ */
import { initViewer, loadModel } from './viewer.js';
import { initTree } from './sidebar.js';
import { runDiff, visualizeDiff, loadVersions, exitCompareMode, showDiffList, addToolbarButton, addExitCompareButton } from './diff-viewer.js';
import { addClashToolbarButton, loadClashContainers, loadClashTests, closeClashPanel } from './clash-viewer.js';

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
            window._viewer = currentViewer; // Store global for clash-viewer
            console.log('[Main] Viewer initialized');

            // 2. Add Toolbar Buttons (Wait for toolbar to be ready)
            const checkToolbar = setInterval(() => {
                const toolbar = currentViewer.getToolbar(true);
                if (toolbar) {
                    clearInterval(checkToolbar);
                    console.log('[Main] Toolbar ready, adding buttons...');

                    // Add Compare Button
                    addToolbarButton(currentViewer, () => {
                        if (versionA && versionB) handleRunDiff();
                        else alert('버전 A와 B를 브라우저 트리에서 먼저 선택해주세요.');
                    });

                    // Add Exit Compare Button (hidden until compare starts)
                    _exitCompareToolbarBtn = addExitCompareButton(currentViewer, () => handleExitCompare());

                    // Add Clash Button with a slight delay
                    setTimeout(() => {
                        console.log('[Main] Adding Clash Button...');
                        addClashToolbarButton(currentViewer, () => {
                            handleClashToolClick();
                        });
                    }, 200);
                }
            }, 500);
        } catch (vErr) {
            console.error('Viewer initialization failed:', vErr);
        }

        // 3. Init Tree
        initTree('#tree', (node) => handleTreeSelection(node));

        // 4. UI Events
        runDiffBtn.onclick = () => handleRunDiff();
        exitCompareBtn.onclick = () => handleExitCompare();
        setupResultsUI();

    } else {
        login.innerText = 'Login';
        login.onclick = () => window.location.replace('/api/auth/login');
        login.style.visibility = 'visible';
    }
} catch (err) {
    console.error('Initialization error:', err);
    login.style.visibility = 'visible';
}

async function handleTreeSelection(node) {
    const tokens = node.id.split('|');
    const type = tokens[0];

    if (type === 'project') {
        currentProjectId = tokens[2]; // tokens: ['project', hubId, projectId, region]
        currentRegion = tokens[3] || 'US';
        console.log('[Main] Selected Project:', currentProjectId, 'Region:', currentRegion);
    }

    if (type === 'version') {
        const projectId = tokens[1]; // tokens: ['version', projectId, versionId, name, region]
        const versionId = tokens[2];
        const versionName = tokens[3];
        const region = tokens[4] || 'US';
        const urn = window.btoa(versionId).replace(/=/g, '');

        currentProjectId = projectId;
        currentRegion = region;
        console.log('[Main] Selected Version (Region):', currentRegion);

        if (!versionA) {
            versionA = { id: versionId, urn, name: versionName, projectId, region };
            updateCompareUI();
        } else if (!versionB && versionId !== versionA.id) {
            versionB = { id: versionId, urn, name: versionName, projectId, region };
            updateCompareUI();
        }

        if (document.getElementById('preview').style.display !== 'none') {
            loadModel(currentViewer, urn);
        }
    }
}

async function handleClashToolClick() {
    if (!currentProjectId) {
        alert('프로젝트를 먼저 선택해 주세요.');
        return;
    }

    try {
        console.log('[Main] Fetching clash containers for:', currentProjectId, 'Region:', currentRegion);
        const containers = await loadClashContainers(currentProjectId, currentRegion);
        if (containers && containers.length > 0) {
            const containerId = containers[0].id;
            await loadClashTests(containerId, currentRegion);
        } else {
            alert('이 프로젝트에는 활성화된 Model Coordination 컨테이너가 없습니다.');
        }
    } catch (err) {
        alert('간섭 데이터를 불러오지 못했습니다: ' + err.message);
    }
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

    // [추가] 비교 실행 시점에 UI 상단바 명칭 강제 동기화
    const slotA = document.getElementById('slot-a-name');
    const slotB = document.getElementById('slot-b-name');
    if (slotA) slotA.textContent = versionA.name;
    if (slotB) slotB.textContent = versionB.name;

    runDiffBtn.disabled = true;
    runDiffBtn.textContent = 'Indexing...';

    // [수정] 실제 index.html 구조에 맞는 컨테이너 전환
    document.getElementById('viewer-main-container').style.display = 'none';
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
    document.getElementById('viewer-main-container').style.display = 'block';
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
        closeClashPanel();
    };
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
