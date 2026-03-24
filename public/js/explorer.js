/**
 * explorer.js
 * Manages the folder-based table view within the main viewer area.
 */

class FolderExplorer {
    constructor() {
        this.container = document.getElementById('explorer-container');
        this.breadcrumb = document.getElementById('explorer-breadcrumb');
        this.list = document.getElementById('explorer-list');
        this.viewerContainer = document.getElementById('preview');
        this.refreshBtn = document.getElementById('refresh-explorer-btn');
        this.backBtn = document.getElementById('back-to-explorer-btn');
        this.infoBar = document.getElementById('viewer-info-bar');

        this.currentHubId = null;
        this.currentProjectId = null;
        this.currentFolderId = null;
        this.history = []; // For breadcrumbs

        this.init();
    }

    init() {
        if (this.refreshBtn) {
            this.refreshBtn.onclick = () => this.refresh();
        }
        if (this.backBtn) {
            this.backBtn.onclick = () => this.handleBackToExplorer();
        }
    }

    async showFolder(hubId, projectId, folderId, folderName = 'Root') {
        this.currentHubId = hubId;
        this.currentProjectId = projectId;
        this.currentFolderId = folderId;

        // Update history for breadcrumbs
        const lastIdx = this.history.findIndex(h => h.id === folderId);
        if (lastIdx !== -1) {
            this.history = this.history.slice(0, lastIdx + 1);
        } else {
            this.history.push({ id: folderId, name: folderName });
        }

        this.updateBreadcrumbs();
        this.switchMode('explorer');
        this.renderLoading();

        try {
            const url = `/api/hubs/${hubId}/projects/${projectId}/contents?folder_id=${folderId}`;
            const response = await fetch(url);
            const items = await response.json();
            this.renderTable(items);
        } catch (err) {
            console.error('[Explorer] Failed to load folder:', err);
            this.renderError('폴더 정보를 가져오지 못했습니다.');
        }
    }

    switchMode(mode) {
        const dashboard = document.getElementById('project-selection-dashboard');
        const topBar = document.getElementById('viewer-top-bar');

        if (mode === 'explorer') {
            this.container.style.display = 'flex';
            this.viewerContainer.style.display = 'none';
            if (this.infoBar) this.infoBar.style.display = 'none';
            if (topBar) topBar.style.display = 'none';
            if (dashboard) dashboard.style.display = 'none';
        } else if (mode === 'viewer') {
            this.container.style.display = 'none';
            this.viewerContainer.style.display = 'block';
            if (topBar) topBar.style.display = 'flex';
            if (dashboard) dashboard.style.display = 'none';
        } else {
            this.container.style.display = 'none';
            this.viewerContainer.style.display = 'block';
        }

        // Hide comparison container always when switching
        const comparisonContainer = document.getElementById('comparison-container');
        if (comparisonContainer) {
            comparisonContainer.style.display = 'none';
        }
    }

    handleBackToExplorer() {
        console.log('[Explorer] Returning to folder list...');
        this.switchMode('explorer');
    }

    updateBreadcrumbs() {
        this.breadcrumb.innerHTML = '';
        this.history.forEach((h, i) => {
            const item = document.createElement('span');
            item.className = `breadcrumb-item ${i === this.history.length - 1 ? 'active' : ''}`;
            item.textContent = h.name;
            item.onclick = () => this.showFolder(this.currentHubId, this.currentProjectId, h.id, h.name);

            this.breadcrumb.appendChild(item);

            if (i < this.history.length - 1) {
                const sep = document.createElement('span');
                sep.className = 'breadcrumb-separator';
                sep.textContent = ' / ';
                this.breadcrumb.appendChild(sep);
            }
        });
    }

    renderLoading() {
        this.list.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:40px; color:var(--text-muted);">Loading folder contents...</td></tr>';
    }

    renderError(msg) {
        this.list.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:40px; color:var(--accent-red);">${msg}</td></tr>`;
    }

    renderTable(items) {
        if (!items || !Array.isArray(items) || items.length === 0) {
            this.list.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:40px; color:var(--text-muted);">이 폴더는 비어 있거나 데이터를 불러오지 못했습니다.</td></tr>';
            return;
        }

        this.list.innerHTML = '';
        items.forEach(item => {
            const tr = document.createElement('tr');
            tr.className = item.folder ? 'row-folder' : 'row-item';

            const iconClass = this.getIconClass(item);
            const dateStr = item.lastModifiedTime ? new Date(item.lastModifiedTime).toLocaleDateString() : '-';

            tr.innerHTML = `
                <td class="col-name">
                    <span class="explorer-icon ${iconClass}">
                        <i class="${item.folder ? 'fas fa-folder' : 'fas fa-file-alt'}"></i>
                    </span>
                    <span class="item-name">${item.name}</span>
                </td>
                <td class="col-version">
                    ${item.folder ? '-' : `<span class="badge-version" data-item-id="${item.id}" data-item-name="${item.name}">v${item.vNumber || 1}</span>`}
                </td>
                <td class="col-date"><span class="text-date">${dateStr}</span></td>
                <td class="col-user"><span class="text-user">${item.lastModifiedUserName || 'Unknown'}</span></td>
                <td class="col-actions">
                    ${item.folder ? '' : '<button class="tool-btn" title="Open in Viewer">Load</button>'}
                </td>
            `;

            if (item.folder) {
                tr.onclick = () => this.showFolder(this.currentHubId, this.currentProjectId, item.id, item.name);
            } else {
                tr.onclick = (e) => {
                    // Prevent loading if clicking on the version badge
                    if (e.target.classList.contains('badge-version')) return;
                    this.loadIntoViewer(item.urn, item.name);
                };

                const badge = tr.querySelector('.badge-version');
                if (badge) {
                    badge.onclick = (e) => {
                        e.stopPropagation();
                        this.handleVersionClick(e.target, item.id, item.name);
                    };
                }
            }

            this.list.appendChild(tr);
        });
    }

    getIconClass(item) {
        if (item.folder) return 'icon-folder';
        const name = item.name.toLowerCase();
        if (name.endsWith('.rvt')) return 'icon-rvt';
        if (name.endsWith('.dwg')) return 'icon-dwg';
        return 'icon-file';
    }

    async handleVersionClick(target, itemId, itemName) {
        const modal = document.getElementById('version-modal');
        const filenameLabel = document.getElementById('version-modal-filename');
        const listBody = document.getElementById('version-list-body');
        const closeBtn = document.getElementById('close-version-modal');
        const closeBtn2 = document.getElementById('close-version-btn');

        if (!modal || !listBody) return;

        // Reset and Show Modal
        filenameLabel.textContent = itemName;
        listBody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:40px;">Loading versions...</td></tr>';
        modal.style.display = 'flex';

        const hide = () => { modal.style.display = 'none'; };
        closeBtn.onclick = hide;
        closeBtn2.onclick = hide;

        // Compare Mode State
        this.isCompareMode = false;
        this.compareSelection = [];
        const toggleBtn = document.getElementById('toggle-compare-mode');
        if (toggleBtn) {
            toggleBtn.classList.remove('active');
            toggleBtn.innerHTML = '<i class="fas fa-columns"></i> 버전 비교';
            toggleBtn.onclick = () => {
                this.isCompareMode = !this.isCompareMode;
                this.compareSelection = [];
                toggleBtn.classList.toggle('active', this.isCompareMode);
                toggleBtn.innerHTML = this.isCompareMode ? '<i class="fas fa-times"></i> 비교 취소' : '<i class="fas fa-columns"></i> 버전 비교';
                if (this.currentVersions) {
                    this.renderVersionTable(listBody, this.currentVersions, itemName);
                }
            };
        }

        try {
            const url = `/api/hubs/${this.currentHubId}/projects/${this.currentProjectId}/contents/${encodeURIComponent(itemId)}/versions`;
            const response = await fetch(url);
            if (!response.ok) throw new Error('Failed to fetch versions');
            const versions = await response.json();

            this.currentVersions = versions;
            this.renderVersionTable(listBody, versions, itemName);
        } catch (err) {
            console.error('[Explorer] Version fetch error:', err);
            listBody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:40px; color:var(--accent-red);">버전 정보를 가져올 수 없습니다.</td></tr>';
        }
    }

    renderVersionTable(container, versions, itemName) {
        container.innerHTML = '';
        versions.forEach(v => {
            const tr = document.createElement('tr');
            const dateStr = this.formatDate(v.name || v.displayName);

            // 1. localStorage에서 해당 버전의 메모 조회 (version.id 기준)
            const localKey = `memo-${v.id}`;
            const localMemo = localStorage.getItem(localKey) || v.description || '';

            const isSelected = this.compareSelection.includes(v.id);
            const btnText = this.isCompareMode ? (isSelected ? 'Selected' : 'Compare') : 'View';
            const btnStyle = (this.isCompareMode && isSelected) ? 'background-color: var(--accent-green); color: #fff;' : '';

            tr.innerHTML = `
                <td><span class="v-num-badge">V${v.vNumber}</span></td>
                <td>${dateStr}</td>
                <td>${v.createUserName || 'Unknown'}</td>
                <td>
                    <div class="v-desc-cell">
                        <input type="text" class="editable-desc" value="${localMemo}" placeholder="변경 사항 입력...">
                        <button class="btn-save-v" id="save-v-${v.vNumber}">Save</button>
                    </div>
                </td>
                <td class="col-vaction">
                    <button class="btn-view-v" id="btn-view-${v.vNumber}" style="${btnStyle}">${btnText}</button>
                </td>
            `;

            const saveBtn = tr.querySelector('.btn-save-v');
            const input = tr.querySelector('.editable-desc');
            saveBtn.onclick = async () => {
                const newDesc = input.value.trim();
                saveBtn.classList.add('saving');
                saveBtn.textContent = '...';
                try {
                    localStorage.setItem(`memo-${v.id}`, newDesc);
                    console.log(`[Explorer] 데이터 저장 완료 (localStorage): ${newDesc}`);
                    const memoUrl = '/api/version-memo';
                    await fetch(memoUrl, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ versionUrn: v.id, memoText: newDesc })
                    }).catch(e => console.warn('[Explorer] Server sync failed, but localStorage updated.', e));

                    saveBtn.textContent = '✓';
                    setTimeout(() => { saveBtn.textContent = 'Save'; }, 2000);
                } catch (err) {
                    console.error('[Explorer] Save failed:', err);
                    saveBtn.textContent = 'Err';
                    setTimeout(() => { saveBtn.textContent = 'Save'; }, 2000);
                } finally {
                    saveBtn.classList.remove('saving');
                }
            };

            const viewBtn = tr.querySelector('.btn-view-v');
            if (this.isCompareMode) {
                viewBtn.onclick = () => {
                    const idx = this.compareSelection.indexOf(v.id);
                    if (idx > -1) {
                        this.compareSelection.splice(idx, 1);
                    } else {
                        if (this.compareSelection.length >= 2) return alert('이미 2개의 버전이 선택되었습니다.');
                        this.compareSelection.push(v.id);
                    }
                    this.renderVersionTable(container, versions, itemName);

                    if (this.compareSelection.length === 2) {
                        this.executeCompare(this.compareSelection[0], this.compareSelection[1]);
                        document.getElementById('version-modal').style.display = 'none';
                        this.isCompareMode = false;
                        this.compareSelection = [];
                    }
                };
            } else {
                viewBtn.onclick = async () => {
                    console.log(`[Explorer] VIEW 버튼 클릭 - 팝업 종료 및 모델 로드 시퀀스 시작`);
                    document.getElementById('version-modal').style.display = 'none';
                    await new Promise(r => setTimeout(r, 300));

                    const decodedId = this.decodeUrn(v.id);
                    console.log(`[FINAL ATTEMPT] 원본ID(Decoded): ${decodedId}`);

                    try {
                        const { getSafeUrn } = await import('./viewer.js');
                        const finalUrn = getSafeUrn(decodedId);
                        console.log(`[FINAL ATTEMPT] 최종URN: ${finalUrn}`);
                        this.loadVersionWithStatusCheck(finalUrn, `${itemName} (V${v.vNumber})`);
                    } catch (e) {
                        console.error('[Explorer] Failed to process URN:', e);
                    }
                };
            }

            container.appendChild(tr);
        });
    }

    executeCompare(urn1, urn2) {
        const raw1 = this.decodeUrn(urn1);
        const raw2 = this.decodeUrn(urn2);

        console.log('[Explorer Compare] URN1:', raw1);
        console.log('[Explorer Compare] URN2:', raw2);

        if (typeof window.compareModels === 'function') {
            window.compareModels(raw1, raw2);
        } else {
            alert('compareModels 함수를 찾을 수 없습니다.');
        }
    }

    /**
     * Helper to decode Base64 URN if necessary.
     */
    decodeUrn(encUrn) {
        if (!encUrn) return encUrn;
        // Check if it's already a safe base64 URN
        if (encUrn.startsWith('urn:dXJu') || encUrn.startsWith('dXJu')) {
            try {
                const b64 = encUrn.replace('urn:', '').replace(/-/g, '+').replace(/_/g, '/');
                let decoded = atob(b64);
                return decoded.startsWith('urn:') ? decoded : 'urn:' + decoded;
            } catch (e) {
                return encUrn;
            }
        }
        return encUrn;
    }

    formatDate(dateString) {
        if (!dateString) return '-';
        const d = new Date(dateString);
        if (isNaN(d.getTime())) return dateString;

        const pad = (num) => String(num).padStart(2, '0');
        const yyyy = d.getFullYear();
        const mm = pad(d.getMonth() + 1);
        const dd = pad(d.getDate());
        const hh = pad(d.getHours());
        const min = pad(d.getMinutes());

        return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
    }

    async loadVersionWithStatusCheck(urn, label) {
        // URN Validation
        console.log(`\n[EXPLORER] Loading Version...`);
        console.log(` - Label: ${label}`);
        console.log(` - Raw URN: ${urn}`);

        if (!urn) {
            alert('이 버전에는 뷰어용 데이터가 없습니다.');
            return;
        }

        const isBase64 = (str) => {
            try { return btoa(atob(str)) === str; } catch (err) { return false; }
        }
        console.log(` - URN format check: ${isBase64(urn) ? 'Base64 Valid' : 'Raw (Needs internal encoding check)'}`);

        // Show loading spinner
        const loading = document.getElementById('viewer-loading');
        if (loading) loading.style.display = 'flex';

        try {
            // [Fix] Strip 'urn:' prefix for the server-side API call to avoid 400 errors
            const cleanUrnForApi = urn.replace('urn:', '');
            console.log(` - Calling Status API: /api/aps/model/${cleanUrnForApi}/status`);

            const statusResp = await fetch(`/api/aps/model/${cleanUrnForApi}/status`, {
                headers: { 'Accept': 'application/json' }
            });

            if (!statusResp.ok) {
                const errText = await statusResp.text();
                console.warn(`[Explorer] Status API HTTP Error: ${statusResp.status}. Loading directly. Response text:`, errText);
                return this.loadIntoViewer(urn, label);
            }

            const contentType = statusResp.headers.get("content-type");
            if (!contentType || !contentType.includes("application/json")) {
                console.warn('[Explorer] Status API returned non-JSON. Loading directly.');
                return this.loadIntoViewer(urn, label);
            }

            const statusData = await statusResp.json();

            if (statusData.status === 'success' || statusData.progress === 'complete') {
                this.loadIntoViewer(urn, label);
            } else if (statusData.status === 'inprogress' || statusData.status === 'pending') {
                if (loading) loading.style.display = 'none';
                alert(`모델 변환 중입니다 (${statusData.progress}). 잠시 후 다시 시도해주세요.`);
            } else {
                if (loading) loading.style.display = 'none';
                alert('모델 변환에 실패했거나 데이터가 없습니다.');
            }
        } catch (err) {
            console.error('[Explorer] Status check failed:', err);
            this.loadIntoViewer(urn, label);
        }

    }

    async loadIntoViewer(urn, name) {
        console.log(`[Explorer] loadIntoViewer 호출 - URN: ${urn}`);
        this.switchMode('viewer');

        // Layout Recovery: Ensure single viewer mode is active
        const comparisonContainer = document.getElementById('comparison-container');
        if (comparisonContainer) {
            comparisonContainer.style.display = 'none';
        }
        if (this.viewerContainer) {
            this.viewerContainer.style.display = 'block';
        }

        // Robust model loading: Clean up existing model first
        if (window._viewer) {
            console.log('[Explorer] Cleaning up current viewer instance...');
            try {
                // Finish dual viewers if they exist
                if (window.viewerLeft) { window.viewerLeft.finish(); window.viewerLeft = null; }
                if (window.viewerRight) { window.viewerRight.finish(); window.viewerRight = null; }

                if (window._viewer.model) {
                    window._viewer.unloadModel(window._viewer.model);
                }
            } catch (e) { console.warn('[Explorer] Cleanup error:', e); }
        }

        // Dynamically import viewer functions
        const { loadModel } = await import('./viewer.js');

        if (window._viewer) {
            try {
                // Reinforce: Ensure viewer is started/running
                if (!window._viewer.running) {
                    console.log('[Explorer] Viewer not running, starting...');
                    window._viewer.start();
                }

                // Await model loading to ensure timing
                await loadModel(window._viewer, urn);

                const label = document.getElementById('model-name-label');
                if (label) label.textContent = name;

                const topBarName = document.getElementById('viewer-model-name');
                if (topBarName) topBarName.textContent = name;

                console.log(`[Explorer] 모델 로드 완료: ${urn}`);

                // Trigger resize for layout adjustment
                window.dispatchEvent(new Event('resize'));
            } catch (err) {
                console.error('[Explorer] 모델 로드 실패:', err);
                alert('모델을 로드하는 중 오류가 발생했습니다.');
            } finally {
                const loading = document.getElementById('viewer-loading');
                if (loading) loading.style.display = 'none';
            }
        }
    }


    refresh() {
        if (this.currentFolderId) {
            this.showFolder(this.currentHubId, this.currentProjectId, this.currentFolderId, this.history[this.history.length - 1].name);
        }
    }
}

export const explorer = new FolderExplorer();
window.explorer = explorer;

