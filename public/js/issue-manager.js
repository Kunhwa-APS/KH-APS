/**
 * public/js/issue-manager.js
 * Manages custom 3D issues, markers, and local storage persistence with PDF Item Selection.
 */
import { unreadManager } from './unread-manager.js';

const WORK_TYPE_MAPPING = {
    'C': '토목',
    'A': '건축',
    'AM': '건축설비',
    'E': '전기',
    'M': '기계'
};

/**
 * IDBStorage: Promise-based wrapper for IndexedDB
 */
class IDBStorage {
    constructor(dbName = 'APS_DATABASE', storeName = 'issues_store') {
        this.dbName = dbName;
        this.storeName = storeName;
        this.db = null;
    }

    init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, 1);
            request.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(this.storeName)) {
                    db.createObjectStore(this.storeName);
                }
            };
            request.onsuccess = (e) => {
                this.db = e.target.result;
                resolve();
            };
            request.onerror = (e) => reject(e.target.error);
        });
    }

    get(key) {
        return new Promise((resolve, reject) => {
            if (!this.db) return resolve(null);
            const transaction = this.db.transaction([this.storeName], 'readonly');
            const store = transaction.objectStore(this.storeName);
            const request = store.get(key);
            request.onsuccess = (e) => resolve(e.target.result);
            request.onerror = (e) => reject(e.target.error);
        });
    }

    set(key, value) {
        return new Promise((resolve, reject) => {
            if (!this.db) return reject(new Error('DB not initialized'));
            const transaction = this.db.transaction([this.storeName], 'readwrite');
            const store = transaction.objectStore(this.storeName);
            const request = store.put(value, key);
            request.onsuccess = () => resolve();
            request.onerror = (e) => reject(e.target.error);
        });
    }
}

export class IssueManager {
    constructor(viewer) {
        this.viewer = viewer;
        this.storage = new IDBStorage();
        this.issues = [];
        this.isCreationMode = false;
        this.exportPayload = null;
        this._onIssueClick = this._onIssueClick.bind(this);
        this._onCameraChange = this._onCameraChange.bind(this);
        this.tempIssueMarker = null;
        this.tempIssuePosition = null;
        this.htmlMarkersMap = new Map();
        this.activeStructureFilter = null;
        this.activeWorkTypeFilter = null;
        this.markersVisible = true;
        this.initOverlays();

        this._syncLoop = this._syncLoop.bind(this);
        requestAnimationFrame(this._syncLoop);
    }

    async init() {
        try {
            await this.storage.init();
            const legacyData = localStorage.getItem('aps-viewer-issues');
            if (legacyData) {
                const legacyIssues = JSON.parse(legacyData);
                await this.storage.set('issues', legacyIssues);
                localStorage.removeItem('aps-viewer-issues');
            }
            const saved = await this.storage.get('issues');
            this.issues = saved || [];
            this.renderIssueList();
            this.restorePins();

            const syncEvents = [
                Autodesk.Viewing.CAMERA_CHANGE_EVENT,
                Autodesk.Viewing.VIEWER_STATE_RESTORED_EVENT,
                Autodesk.Viewing.TRANSITION_COMPLETED_EVENT,
                Autodesk.Viewing.FOCAL_LENGTH_CHANGED_EVENT,
                Autodesk.Viewing.MODEL_ROOT_LOADED_EVENT,
                Autodesk.Viewing.GEOMETRY_LOADED_EVENT
            ];
            syncEvents.forEach(evt => {
                this.viewer.removeEventListener(evt, this._onCameraChange);
                this.viewer.addEventListener(evt, this._onCameraChange);
            });

            this.viewer.addEventListener(Autodesk.Viewing.GEOMETRY_LOADED_EVENT, () => {
                this.restorePins();
            });

            this._injectMarkerToggle();
        } catch (err) {
            console.error('[IssueManager] Init failed:', err);
        }
    }

    _injectMarkerToggle() {
        if (document.getElementById('issue-marker-toggle-wrap')) return;
        const container = this.viewer.container;
        const wrap = document.createElement('div');
        wrap.id = 'issue-marker-toggle-wrap';
        wrap.innerHTML = `
            <label class="issue-toggle-label" title="이슈 마커 표시/숨기기">
                <i class="fas fa-map-marker-alt"></i>
                <span>이슈</span>
                <div class="issue-toggle-track">
                    <input type="checkbox" id="issue-marker-toggle-cb" checked>
                    <span class="issue-toggle-thumb"></span>
                </div>
            </label>
        `;
        container.style.position = 'relative';
        container.appendChild(wrap);
        document.getElementById('issue-marker-toggle-cb').addEventListener('change', (e) => {
            this.toggleMarkerVisibility(e.target.checked);
        });
    }

    toggleMarkerVisibility(visible) {
        this.markersVisible = visible;
        this.htmlMarkersMap.forEach((data) => {
            if (data.element) {
                data.element.style.visibility = visible ? 'visible' : 'hidden';
            }
        });
        if (this.tempIssueMarker) {
            this.tempIssueMarker.style.visibility = visible ? 'visible' : 'hidden';
        }
    }

    initOverlays() {
        if (!this.viewer.impl.overlayScenes['issue-markers']) {
            this.viewer.impl.createOverlayScene('issue-markers');
        }
    }

    async saveIssues() {
        try {
            await this.storage.set('issues', this.issues);
        } catch (e) {
            console.error('[IssueManager] Save failed:', e);
        }
        this.renderIssueList();
    }

    toggleCreationMode(on) {
        this.isCreationMode = (on !== undefined) ? on : !this.isCreationMode;
        const targetElement = this.viewer.canvas;
        targetElement.removeEventListener('click', this._onIssueClick);
        if (this.isCreationMode) {
            targetElement.style.cursor = 'crosshair';
            targetElement.addEventListener('click', this._onIssueClick);
        } else {
            targetElement.style.cursor = '';
        }
        const btn = document.getElementById('add-issue-tool-btn');
        if (btn) btn.classList.toggle('active', this.isCreationMode);
    }

    _onIssueClick(e) {
        const rect = this.viewer.container.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        const result = this.viewer.impl.hitTest(x, y, true);

        if (result && result.dbId) {
            const dbId = result.dbId;
            this.removeTempMarker();
            this.tempIssuePosition = result.intersectPoint.clone();

            const marker = document.createElement('div');
            marker.id = 'temp-issue-marker-div';
            marker.className = 'issue-temp-marker';
            this.viewer.container.appendChild(marker);
            this.tempIssueMarker = marker;

            this.syncAllMarkers();
            this.toggleCreationMode(false);

            // Enter Markup Mode
            this.enterMarkupMode(dbId, result.intersectPoint);

            this.captureIssueThumbnail((base64) => {
                const modal = document.getElementById('issue-modal');
                if (modal && modal.style.display === 'flex') {
                    modal.dataset.thumbnail = base64;
                    const preview = document.getElementById('issue-preview-img');
                    if (preview) {
                        preview.src = base64;
                        document.getElementById('modal-image-preview').style.display = 'flex';
                    }
                }
            });
        } else {
            this.toggleCreationMode(false);
        }
    }

    _onCameraChange() {
        this.syncAllMarkers();
    }

    _syncLoop() {
        this.syncAllMarkers();
        requestAnimationFrame(this._syncLoop);
    }

    syncAllMarkers() {
        if (this.tempIssueMarker && this.tempIssuePosition) {
            const screenPos = this.viewer.worldToClient(this.tempIssuePosition);
            this.tempIssueMarker.style.left = `${Math.round(screenPos.x)}px`;
            this.tempIssueMarker.style.top = `${Math.round(screenPos.y)}px`;

            const camera = this.viewer.navigation.getCamera();
            const dir = new THREE.Vector3().subVectors(this.tempIssuePosition, camera.position).normalize();
            const dot = dir.dot(camera.getWorldDirection(new THREE.Vector3()));
            this.tempIssueMarker.style.display = dot > 0 ? 'block' : 'none';
        }

        this.htmlMarkersMap.forEach((data) => {
            const worldPos = data.position;
            const screenPoint = this.viewer.worldToClient(new THREE.Vector3(worldPos.x, worldPos.y, worldPos.z));

            if (!screenPoint || (screenPoint.x === 0 && screenPoint.y === 0)) {
                data.element.style.display = 'none';
                return;
            }

            data.element.style.left = `${Math.round(screenPoint.x)}px`;
            data.element.style.top = `${Math.round(screenPoint.y)}px`;

            const camera = this.viewer.navigation.getCamera();
            const dir = new THREE.Vector3().subVectors(worldPos, camera.position).normalize();
            const dot = dir.dot(camera.getWorldDirection(new THREE.Vector3()));

            data.element.style.display = (dot > 0.05) ? 'block' : 'none';
        });
    }

    removeTempMarker() {
        if (this.tempIssueMarker) {
            this.tempIssueMarker.remove();
            this.tempIssueMarker = null;
        }
        this.tempIssuePosition = null;
    }

    captureIssueThumbnail(callback, markupExt = null) {
        const width = this.viewer.container.clientWidth;
        const height = this.viewer.container.clientHeight;
        this.viewer.getScreenShot(width, height, (blobUrl) => {
            if (!blobUrl) return callback(null);
            this._performHardCanvasCompositing(blobUrl, width, height, markupExt, callback);
        });
    }

    async _performHardCanvasCompositing(blobUrl, w, h, markupExt, callback) {
        const img = new Image();
        img.onload = async () => {
            const canvas = document.createElement('canvas');
            canvas.width = w; canvas.height = h;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#FFFFFF';
            ctx.fillRect(0, 0, w, h);
            ctx.drawImage(img, 0, 0, w, h);
            if (markupExt) await new Promise(resolve => markupExt.renderToCanvas(ctx, resolve));
            const finalB64 = canvas.toDataURL('image/jpeg', 0.85);
            URL.revokeObjectURL(img.src);
            callback(finalB64);
        };
        img.src = blobUrl;
    }

    showCreateModal(dbId, point, thumbnail) {
        const modal = document.getElementById('issue-modal');
        if (!modal) return;
        modal.dataset.mode = 'create';
        modal.dataset.dbId = dbId;
        modal.dataset.point = JSON.stringify(point);
        modal.dataset.viewstate = JSON.stringify(this.viewer.getState());
        modal.dataset.urn = this.viewer.model?.getData().urn;
        modal.dataset.itemId = window.currentItemId || null;

        if (thumbnail) {
            const img = document.getElementById('issue-preview-img');
            if (img) img.src = thumbnail;
            document.getElementById('modal-image-preview').style.display = 'flex';
        }
        modal.style.display = 'flex';

        // Metadata extraction
        const parts = (document.getElementById('viewer-model-name')?.innerText || '').split('_');
        if (parts.length >= 6) {
            const structure = document.getElementById('issue-structure');
            const workType = document.getElementById('issue-work-type');
            if (structure) structure.value = parts[4].split('.')[0];
            if (workType) {
                const code = parts[5].split('.')[0].toUpperCase();
                workType.value = WORK_TYPE_MAPPING[code] || code;
            }
        }
    }

    addIssue(data) {
        const issue = {
            id: Date.now(),
            ...data,
            createdAt: new Date().toISOString()
        };
        this.issues.push(issue);
        this.saveIssues();
        this.createPin(issue);
        this.removeTempMarker();
        this.toggleCreationMode(false);
        return true;
    }

    updateIssue(id, data) {
        const index = this.issues.findIndex(i => i.id === id);
        if (index === -1) return false;
        this.issues[index] = { ...this.issues[index], ...data, updatedAt: new Date().toISOString() };
        this.saveIssues();
        this.restorePins();
        return true;
    }

    async enterMarkupMode(dbId, point, mode = 'create') {
        this.markupsExt = await this.viewer.loadExtension('Autodesk.Viewing.MarkupsCore');
        this.markupsExt.enterEditMode();
        this.markupContext = { dbId, point, mode };
        this.renderMarkupToolbar();
    }

    renderMarkupToolbar() {
        if (document.getElementById('markup-toolbar')) return;
        const tb = document.createElement('div');
        tb.id = 'markup-toolbar';
        tb.className = 'markup-toolbar';
        tb.innerHTML = `
            <div class="markup-tool-group">
                <button class="markup-btn" data-tool="rectangle"><i class="fas fa-square"></i></button>
                <button class="markup-btn" data-tool="cloud"><i class="fas fa-cloud"></i></button>
                <button class="markup-btn" data-tool="arrow"><i class="fas fa-long-arrow-alt-right"></i></button>
                <button class="markup-btn" data-tool="text"><i class="fas fa-font"></i></button>
            </div>
            <button class="markup-finish-btn">작성 완료</button>
        `;
        document.body.appendChild(tb);
        tb.querySelectorAll('.markup-btn').forEach(btn => {
            btn.onclick = () => {
                const tool = btn.dataset.tool;
                let markupTool;
                switch (tool) {
                    case 'rectangle': markupTool = new Autodesk.Viewing.Extensions.Markups.Core.EditModeRectangle(this.markupsExt); break;
                    case 'cloud': markupTool = new Autodesk.Viewing.Extensions.Markups.Core.EditModeCloud(this.markupsExt); break;
                    case 'arrow': markupTool = new Autodesk.Viewing.Extensions.Markups.Core.EditModeArrow(this.markupsExt); break;
                    case 'text': markupTool = new Autodesk.Viewing.Extensions.Markups.Core.EditModeText(this.markupsExt); break;
                }
                this.markupsExt.changeEditMode(markupTool);
            };
        });
        tb.querySelector('.markup-finish-btn').onclick = async () => {
            const svg = this.markupsExt.generateData();
            await this._captureMarkupScreenshot(svg);
            this.markupsExt.leaveEditMode();
            this.markupsExt.hide();
            tb.remove();
        };
    }

    async _captureMarkupScreenshot(svg) {
        const mode = this.markupContext?.mode || 'create';
        return new Promise(resolve => {
            this.captureIssueThumbnail(b64 => {
                const modal = document.getElementById('issue-modal');
                if (mode === 'create') this.showCreateModal(this.markupContext.dbId, this.markupContext.point, b64);
                else if (modal) {
                    modal.dataset.afterThumbnail = b64;
                    const prev = document.getElementById('issue-after-preview-img');
                    if (prev) { prev.src = b64; document.getElementById('modal-after-image-preview').style.display = 'flex'; }
                    modal.style.display = 'flex';
                }
                if (modal) modal.dataset.markup = svg;
                resolve();
            }, this.markupsExt);
        });
    }

    createPin(issue) {
        if (this.htmlMarkersMap.has(issue.id)) return;
        const marker = document.createElement('div');
        marker.className = 'issue-marker';
        if (issue.status === 'Closed') marker.classList.add('green');
        marker.dataset.id = issue.id;

        if (unreadManager.isUnread(issue.id)) {
            const b = document.createElement('div');
            b.className = 'marker-unread-badge'; b.textContent = 'N';
            marker.appendChild(b);
        }
        marker.innerHTML += '<i class="fas fa-map-marker-alt"></i>';
        this.viewer.container.appendChild(marker);
        marker.onclick = (e) => {
            e.stopPropagation();
            if (unreadManager.markAsRead(issue.id)) {
                const b = marker.querySelector('.marker-unread-badge');
                if (b) b.remove();
                this.renderIssueList();
            }
            this.focusIssue(issue);
        };
        this.htmlMarkersMap.set(issue.id, {
            element: marker,
            position: new THREE.Vector3(issue.point.x, issue.point.y, issue.point.z)
        });
        this._applyTargetFilter(issue.id);
    }

    _applyTargetFilter(id) {
        const data = this.htmlMarkersMap.get(id);
        const issue = this.issues.find(i => i.id === id);
        if (!data || !issue) return;
        let visible = true;
        if (this.activeStructureFilter && issue.structure_name !== this.activeStructureFilter) visible = false;
        if (this.activeWorkTypeFilter && issue.work_type !== this.activeWorkTypeFilter) visible = false;
        data.element.style.visibility = (visible && this.markersVisible !== false) ? 'visible' : 'hidden';
    }

    restorePins() {
        this.htmlMarkersMap.forEach(d => d.element.remove());
        this.htmlMarkersMap.clear();
        const guid = this.viewer.model?.getGuid();
        this.issues.forEach(i => {
            if (!guid || !i.modelGuid || i.modelGuid === guid) this.createPin(i);
        });
        this.syncAllMarkers();
    }

    renderIssueList() {
        const container = document.getElementById('issue-list-container');
        if (!container) return;
        if (this.issues.length === 0) {
            container.innerHTML = '<div class="issue-empty-state"><p>등록된 이슈가 없습니다.</p></div>';
            return;
        }
        const sorted = [...this.issues].sort((a, b) => b.id - a.id);
        container.innerHTML = sorted.map(i => {
            const isUnread = unreadManager.isUnread(i.id);
            return `
                <div class="issue-item ${isUnread ? 'unread' : ''}" data-id="${i.id}">
                    <div class="issue-item-main">
                        <label class="issue-check-wrap" onclick="event.stopPropagation()">
                            <input type="checkbox" class="issue-check" data-id="${i.id}">
                        </label>
                        <img src="${i.thumbnail || ''}" class="issue-thumbnail">
                        <div class="issue-info">
                            <div class="issue-item-header">
                                <span class="issue-status-badge ${i.status.toLowerCase()}">${i.status}</span>
                                <span class="issue-item-title">${i.title}</span>
                                <div class="issue-item-actions">
                                    ${i.status === 'Closed' ? `<button class="issue-btn-pdf" title="Export PDF">📄</button>` : ''}
                                    <button class="issue-btn-edit"><i class="fas fa-edit"></i></button>
                                    <button class="issue-btn-delete"><i class="fas fa-trash-alt"></i></button>
                                </div>
                            </div>
                            <div class="issue-item-desc">${i.description}</div>
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        container.querySelectorAll('.issue-item').forEach(item => {
            const id = parseInt(item.dataset.id);
            const issue = this.issues.find(i => i.id === id);
            item.onclick = (e) => {
                if (e.target.closest('button') || e.target.closest('input')) return;
                if (unreadManager.markAsRead(id)) {
                    item.classList.remove('unread');
                    const m = this.htmlMarkersMap.get(id);
                    if (m) { const b = m.element.querySelector('.marker-unread-badge'); if (b) b.remove(); }
                }
                this.focusIssue(issue);
            };
            const pdfBtn = item.querySelector('.issue-btn-pdf');
            if (pdfBtn) pdfBtn.onclick = (e) => { e.stopPropagation(); this.openPdfExportModal(id); };
            item.querySelector('.issue-btn-edit').onclick = (e) => { e.stopPropagation(); this.showEditModal(id); };
            item.querySelector('.issue-btn-delete').onclick = (e) => { e.stopPropagation(); this.deleteIssue(id); };
            item.querySelector('.issue-check').onchange = () => this._updateBulkBtnLabel();
        });
        this._updateBulkBtnLabel();
    }

    _updateBulkBtnLabel() {
        const btn = document.getElementById('bulk-pdf-btn');
        if (!btn) return;
        const checked = document.querySelectorAll('.issue-check:checked').length;
        btn.textContent = checked > 0 ? `📄 선택 내보내기(${checked})` : '📄 전체 내보내기';
    }

    openPdfExportModal(issueId) {
        const modal = document.getElementById('pdf-export-modal');
        if (!modal) return;
        const issue = this.issues.find(i => i.id === issueId);
        this.exportPayload = issue ? [issue] : [...this.issues];
        this.setupPdfModalListeners();
        this._populatePdfItemList();
        modal.style.display = 'flex';
    }

    _populatePdfItemList() {
        const listEl = document.getElementById('pdf-item-list');
        if (!listEl) return;
        listEl.innerHTML = this.exportPayload.map(i => `
            <label class="pdf-item-label" style="display:flex;align-items:center;gap:8px;padding:5px;cursor:pointer;">
                <input type="checkbox" class="pdf-issue-check" data-id="${i.id}" checked>
                <span class="v-num">#${i.id.toString().slice(-4)}</span>
                <span style="flex:1;overflow:hidden;text-overflow:ellipsis;">${i.title}</span>
            </label>
        `).join('');
    }

    setupPdfModalListeners() {
        const modal = document.getElementById('pdf-export-modal');
        if (!modal || modal.dataset.listenersBound) return;
        modal.dataset.listenersBound = '1';
        document.getElementById('close-pdf-modal').onclick = () => modal.style.display = 'none';
        document.getElementById('cancel-pdf-btn').onclick = () => modal.style.display = 'none';

        document.getElementById('run-pdf-export-btn').onclick = async () => {
            const checkedIds = [...document.querySelectorAll('.pdf-issue-check:checked')].map(el => parseInt(el.dataset.id));
            const selectedIssues = this.issues.filter(i => checkedIds.includes(i.id));
            if (selectedIssues.length === 0) return alert('항목을 선택해주세요.');

            const sf = {
                no: document.getElementById('pdf-field-no')?.checked,
                structure: document.getElementById('pdf-field-structure')?.checked,
                work_type: document.getElementById('pdf-field-worktype')?.checked,
                description: document.getElementById('pdf-field-description')?.checked,
                resolution: document.getElementById('pdf-field-resolution')?.checked,
                screenshot: document.getElementById('pdf-field-images')?.checked
            };
            await this.exportToPdf(selectedIssues, sf);
            modal.style.display = 'none';
        };
    }

    async focusIssue(issue) {
        if (!issue) return;
        const state = typeof issue.viewstate === 'string' ? JSON.parse(issue.viewstate) : issue.viewstate;
        this.viewer.restoreState(state);
    }

    deleteIssue(id) {
        if (!confirm('정말 삭제하시겠습니까?')) return;
        this.issues = this.issues.filter(i => i.id !== id);
        this.saveIssues();
        this.restorePins();
    }

    showEditModal(id) {
        const issue = this.issues.find(i => i.id === id);
        if (!issue) return;
        const modal = document.getElementById('issue-modal');
        modal.dataset.mode = 'edit';
        modal.dataset.editId = id;
        document.getElementById('issue-title').value = issue.title;
        document.getElementById('issue-desc').value = issue.description;
        document.getElementById('issue-assignee').value = issue.assignee;
        document.getElementById('issue-status').value = issue.status;
        modal.style.display = 'flex';
    }

    async exportToPdf(issues, sf) {
        const payload = { title: 'Report', issues, sf };
        const resp = await fetch('/api/issues/export-pdf', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (resp.ok) {
            const blob = await resp.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a'); a.href = url; a.download = `report_${Date.now()}.pdf`; a.click();
        }
    }
}
