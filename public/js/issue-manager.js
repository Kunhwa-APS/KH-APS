/**
 * public/js/issue-manager.js
 * Manages custom 3D issues, markers, and local storage persistence.
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
            console.log('[IDBStorage] Initializing IndexedDB...');
            const request = indexedDB.open(this.dbName, 1);
            request.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(this.storeName)) {
                    db.createObjectStore(this.storeName);
                    console.log('[IDBStorage] Store created:', this.storeName);
                }
            };
            request.onsuccess = (e) => {
                this.db = e.target.result;
                console.log('[IDBStorage] Connection opened.');
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
        this.issues = []; // Populated via init()
        this.isCreationMode = false;
        this.exportPayload = null; // [New] Store the issues for PDF export directly to avoid dataset limits
        this._onIssueClick = this._onIssueClick.bind(this);
        this._onCameraChange = this._onCameraChange.bind(this); // [New] Camera Sync
        this.tempIssueMarker = null; // [New] HTML Marker Element
        this.tempIssuePosition = null; // [New] 3D World Position
        this.htmlMarkersMap = new Map();
        // [Multi-Criteria Filter] Null = show all; set via this.setMarkerFilter()
        this.activeStructureFilter = null;
        this.activeWorkTypeFilter = null;
        this.initOverlays();

        // [Nuclear Reconstruction] Infinite Update Loop at Browser Level
        this._syncLoop = this._syncLoop.bind(this);
        requestAnimationFrame(this._syncLoop);
    }

    /**
     * Async initialization: Setup DB, Migrate, Load Issues
     */
    async init() {
        console.log('[IssueManager] Async initialization started...');
        try {
            await this.storage.init();

            // 1. Check for migration from localStorage
            const legacyData = localStorage.getItem('aps-viewer-issues');
            if (legacyData) {
                console.log('[IssueManager] Legacy data found. Migrating to IndexedDB...');
                const legacyIssues = JSON.parse(legacyData);
                await this.storage.set('issues', legacyIssues);
                localStorage.removeItem('aps-viewer-issues'); // Clear after migration
                console.log('[IssueManager] Migration complete.');
            }

            // 2. Load issues
            const saved = await this.storage.get('issues');
            this.issues = saved || [];
            console.log(`[IssueManager] ${this.issues.length} issues loaded from IndexedDB.`);

            // 3. Render initial state
            this.renderIssueList();
            this.restorePins();
            this._updateBulkBtnLabel();
            // [Nuclear Reconstruction] Persistent Multi-event listeners
            const syncEvents = [
                Autodesk.Viewing.CAMERA_CHANGE_EVENT,
                Autodesk.Viewing.VIEWER_STATE_RESTORED_EVENT,
                Autodesk.Viewing.TRANSITION_COMPLETED_EVENT,
                Autodesk.Viewing.FOCAL_LENGTH_CHANGED_EVENT,
                Autodesk.Viewing.MODEL_ROOT_LOADED_EVENT
            ];

            syncEvents.forEach(evt => {
                this.viewer.removeEventListener(evt, this._onCameraChange);
                this.viewer.addEventListener(evt, this._onCameraChange);
            });

            // [Filtering Logic] Trigger pin restoration on model load
            this.viewer.addEventListener(Autodesk.Viewing.GEOMETRY_LOADED_EVENT, () => {
                console.log('[Filtering Logic] Model loaded, restoring pins for current GUID');
                this.restorePins();
            });

            console.log('[Nuclear Reconstruction] Hardware-level event binding complete');

            // [Toggle Button] Inject marker visibility toggle into viewer container
            this._injectMarkerToggle();
        } catch (err) {
            console.error('[IssueManager] Initialization failed:', err);
            // Fallback to empty list
            this.issues = [];
        }
    }

    /**
     * [Toggle] Injects a floating toggle button into the viewer container.
     */
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

    /**
     * [Toggle] Show or hide all HTML issue markers.
     * @param {boolean} visible - true: show, false: hide
     */
    toggleMarkerVisibility(visible) {
        this.markersVisible = visible;
        this.htmlMarkersMap.forEach((data) => {
            if (data.element) {
                data.element.style.visibility = visible ? 'visible' : 'hidden';
            }
        });
        // Also hide/show temp marker if present
        if (this.tempIssueMarker) {
            this.tempIssueMarker.style.visibility = visible ? 'visible' : 'hidden';
        }
        console.log(`[Toggle] Issue markers ${visible ? 'shown' : 'hidden'}`);
    }
    initOverlays() {
        if (!this.viewer.impl.overlayScenes['issue-markers']) {
            this.viewer.impl.createOverlayScene('issue-markers');
        }
    }

    async saveIssues() {
        console.log('[IssueManager] Saving issues to IndexedDB...', this.issues);
        try {
            await this.storage.set('issues', this.issues);
            console.log('[IssueManager] Save successful.');
        } catch (e) {
            console.error('[IssueManager] Error saving to IndexedDB:', e);
            alert('저장에 실패했습니다. 저장 공간 부족 여부를 확인해 주세요.');
        }

        this.renderIssueList();
        this._updateBulkBtnLabel();
    }


    toggleCreationMode(on) {
        this.isCreationMode = (on !== undefined) ? on : !this.isCreationMode;
        console.log(`[IssueManager] Creation Mode: ${this.isCreationMode}`);

        // [Emergency Fix] Use viewer.canvas for listener as requested by User
        const targetElement = this.viewer.canvas;

        // Clean up both container and canvas listeners to prevent any conflict
        this.viewer.container.removeEventListener('click', this._onIssueClick);
        targetElement.removeEventListener('click', this._onIssueClick);

        if (this.isCreationMode) {
            targetElement.style.cursor = 'crosshair';
            targetElement.classList.add('issue-creation-active');
            targetElement.addEventListener('click', this._onIssueClick);
            console.log('[Restore] Click listener re-registered on viewer.canvas');
        } else {
            targetElement.style.cursor = '';
            targetElement.classList.remove('issue-creation-active');
            targetElement.removeEventListener('click', this._onIssueClick);
            console.log('[Restore] Click listener removed from viewer.canvas');
        }

        // Update toolbar button state if it exists
        const btn = document.getElementById('add-issue-tool-btn');
        if (btn) {
            if (this.isCreationMode) {
                btn.classList.add('active');
                btn.classList.add('pulsing');
            } else {
                btn.classList.remove('active');
                btn.classList.remove('pulsing');
            }
        }
    }

    _onIssueClick(e) {
        console.log('[IssueManager] Click detected -> beginning instant capture flow');

        try {
            const rect = this.viewer.container.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;

            // [Emergency] Using hitTest on the calculated mouse coordinates
            const result = this.viewer.impl.hitTest(x, y, true);

            if (result && result.dbId) {
                console.log(`[IssueManager] Hit Success! dbId: ${result.dbId}, Point:`, result.intersectPoint);

                // [Step 1] Create HTML Marker
                this.removeTempMarker();
                this.tempIssuePosition = result.intersectPoint.clone();

                const modelGuid = (this.viewer.model && this.viewer.model.getGuid) ? this.viewer.model.getGuid() :
                    (result.model && result.model.getModelGuid ? result.model.getModelGuid() : 'N/A');

                const marker = document.createElement('div');
                marker.id = 'temp-issue-marker-div';
                marker.className = 'issue-temp-marker';
                marker.dataset.dbId = result.dbId;
                marker.dataset.modelGuid = modelGuid;

                if (window.currentIssueStatus === 'Closed') {
                    marker.classList.add('green');
                }

                this.viewer.container.appendChild(marker);
                this.tempIssueMarker = marker;

                // Sync immediately
                this._onCameraChange();

                // STOP listening for clicks but keep marker
                this.toggleCreationMode(false);

                // [Markup Flow] Enter Markup Mode and show modal
                this.showCreateModal(result.dbId, result.intersectPoint, null);

                // [Async Capture]
                this.captureIssueThumbnail((base64) => {
                    this.tempThumbnail = base64;
                    const modal = document.getElementById('issue-modal');
                    if (modal && modal.style.display === 'flex' && modal.dataset.dbId == result.dbId) {
                        modal.dataset.thumbnail = base64;
                        const previewContainer = document.getElementById('modal-image-preview');
                        const previewImg = document.getElementById('issue-preview-img');
                        if (previewContainer && previewImg && base64) {
                            previewImg.src = base64;
                            previewContainer.style.display = 'flex';
                        }
                    }
                });

            } else {
                console.log('[IssueManager] No object at click location');
                alert('빈 공간을 클릭했습니다. 모델 위를 클릭해주세요.');
                this.toggleCreationMode(false);
            }
        } catch (err) {
            console.error('[IssueManager] Critical error during capture:', err);
            this.toggleCreationMode(false);
        }
    }

    _onCameraChange() {
        this.syncAllMarkers();
    }

    /**
     * [Nuclear Reconstruction] Infinite loop to ensure markers are always synced.
     */
    _syncLoop() {
        this.syncAllMarkers();
        requestAnimationFrame(this._syncLoop);
    }

    /**
     * [Nuclear Reconstruction] Central Engine for all marker-to-3D projection sync.
     * Uses worldPosition as the single Source of Truth.
     */
    syncAllMarkers() {
        // 1. Sync Temporary Marker
        if (this.tempIssueMarker && this.tempIssuePosition) {
            const screenPos = this.viewer.worldToClient(this.tempIssuePosition);
            this.tempIssueMarker.style.left = `${Math.round(screenPos.x)}px`;
            this.tempIssueMarker.style.top = `${Math.round(screenPos.y)}px`;

            const camera = this.viewer.navigation.getCamera();
            const dir = new THREE.Vector3().subVectors(this.tempIssuePosition, camera.position).normalize();
            const cameraDir = camera.getWorldDirection(new THREE.Vector3());
            const dot = dir.dot(cameraDir);
            this.tempIssueMarker.style.display = dot > 0 ? 'block' : 'none';
        }

        // 2. Sync all persistent HTML markers
        this.htmlMarkersMap.forEach((data) => {
            const worldPos = data.position;
            const screenPoint = this.viewer.worldToClient(new THREE.Vector3(worldPos.x, worldPos.y, worldPos.z));

            // [Nuclear Safeguard] Invalid projection detection
            if (!screenPoint || (screenPoint.x === 0 && screenPoint.y === 0)) {
                data.element.style.display = 'none';
                return;
            }

            // Forced position update (Rounded for sub-pixel stability)
            data.element.style.left = `${Math.round(screenPoint.x)}px`;
            data.element.style.top = `${Math.round(screenPoint.y)}px`;

            const camera = this.viewer.navigation.getCamera();
            const dir = new THREE.Vector3().subVectors(worldPos, camera.position).normalize();
            const cameraDir = camera.getWorldDirection(new THREE.Vector3());
            const dot = dir.dot(cameraDir);

            // Visibility & Interaction anchoring
            data.element.style.display = (dot > 0.05) ? 'block' : 'none';
            data.element.style.zIndex = 2000;
        });
    }

    // Facade for backward compatibility
    refreshAllMarkers() {
        this.syncAllMarkers();
    }

    /**
     * Updates the position of the temporary creation marker.
     * @param {THREE.Vector3} [worldPoint] - Optional override for position.
     */
    updateTempMarkerPosition(worldPoint) {
        if (!this.tempIssueMarker) return;

        const pos = worldPoint || this.tempIssuePosition;
        if (!pos) return;

        const screenPos = this.viewer.worldToClient(pos);
        this.tempIssueMarker.style.left = `${screenPos.x}px`;
        this.tempIssueMarker.style.top = `${screenPos.y}px`;
    }

    removeTempMarker() {
        if (this.tempIssueMarker) {
            this.tempIssueMarker.remove();
            this.tempIssueMarker = null;
            this.viewer.removeEventListener(Autodesk.Viewing.CAMERA_CHANGE_EVENT, this._onCameraChange);
        }
        this.tempIssuePosition = null;
    }

    captureIssueThumbnail(callback, markupExt = null) {
        console.log('[IssueManager] Capturing background screenshot...');
        try {
            if (typeof this.viewer.setQualityLevel === 'function') {
                this.viewer.setQualityLevel(true, true);
            }
            // [Hard Compositing] 1. Get Base Screenshot
            const width = this.viewer.container.clientWidth;
            const height = this.viewer.container.clientHeight;
            console.log(`[IssueManager] Dynamic capture at ${width}x${height}`);
            this.viewer.getScreenShot(width, height, (blobUrl) => {
                if (!blobUrl) {
                    console.error('[IssueManager] Screenshot failed.');
                    callback(null);
                    return;
                }
                this._performHardCanvasCompositing(blobUrl, width, height, markupExt, callback);
            });
        } catch (err) {
            console.error('[IssueManager] Capture error:', err);
            callback(null);
        }
    }

    async _performHardCanvasCompositing(blobUrl, w, h, markupExt, callback) {
        try {
            const img = new Image();
            img.onload = async () => {
                const canvas = document.createElement('canvas');
                canvas.width = w; canvas.height = h;
                const ctx = canvas.getContext('2d');
                ctx.fillStyle = '#FFFFFF';
                ctx.fillRect(0, 0, w, h);
                ctx.drawImage(img, 0, 0, w, h);

                if (markupExt) {
                    console.log('[IssueManager] Performing Hard Canvas Compositing...');
                    await new Promise(resolve => markupExt.renderToCanvas(ctx, resolve));
                }

                // [Optimization] Switch to JPEG with 0.85 quality for better compression
                const finalB64 = canvas.toDataURL('image/jpeg', 0.85);

                // [Debug] Check compression results
                const sizeInMB = (finalB64.length * (3 / 4) / (1024 * 1024)).toFixed(2);
                console.log(`[IssueManager] Snapshot processed (JPEG 0.85). Estimated size: ${sizeInMB} MB`);

                URL.revokeObjectURL(img.src);
                console.log('[IssueManager] Hard compositing success.');
                callback(finalB64);
            };
            img.src = blobUrl;
        } catch (e) {
            console.error('[IssueManager] Compositing failed:', e);
            callback(null);
        }
    }
}

showCreateModal(dbId, point, thumbnail) {
    const modal = document.getElementById('issue-modal');
    if (!modal) return;

    // Capture visual context instantly
    const viewstate = this.viewer.getState();
    const model = this.viewer.model;
    const targetModelUrn = model ? model.getData().urn : null;

    // Store temp data in modal dataset
    modal.dataset.dbId = dbId;
    modal.dataset.point = JSON.stringify(point);
    modal.dataset.thumbnail = thumbnail;
    modal.dataset.viewstate = JSON.stringify(viewstate);
    modal.dataset.urn = targetModelUrn;
    modal.dataset.itemId = window.currentItemId || null;

    const previewContainer = document.getElementById('modal-image-preview');
    const previewImg = document.getElementById('issue-preview-img');
    if (thumbnail && previewContainer && previewImg) {
        previewImg.src = thumbnail;
        previewContainer.style.display = 'flex';
    } else if (previewContainer) {
        previewContainer.style.display = 'none';
    }
    modal.style.display = 'flex';
    document.getElementById('issue-title').focus();

    // ── Auto-extract Structure & Work Type (UI-based Logic) ──
    const structureInput = document.getElementById('issue-structure');
    const workTypeInput = document.getElementById('issue-work-type');
    const modelNameTag = document.getElementById('viewer-model-name');

    // ── Auto-generate Issue Number ──
    let issueNumber = `ISSUE-${Date.now().toString().slice(-4)}`; // Fallback

    if (modelNameTag) {
        const fullText = modelNameTag.innerText || '';
        console.log('[IssueManager] Parsing UI model name for metadata:', fullText);
        const parts = fullText.split('_');

        // 1. Structure (5th segment, index 4)
        if (structureInput) {
            let structExtracted = '-';
            if (parts.length >= 5) {
                structExtracted = parts[4].split('.')[0];
            }
            structureInput.value = structExtracted;
        }

        // 2. Work Type (6th segment, index 5)
        let workExtracted = '-';
        let workTypeCode = 'XX';
        if (parts.length >= 6) {
            workTypeCode = parts[5].split('.')[0].toUpperCase();
            workExtracted = WORK_TYPE_MAPPING[workTypeCode] || workTypeCode || '-';
        }
        if (workTypeInput) workTypeInput.value = workExtracted;

        // 3. Issue Number Generation [WorkType]_[BuildingNumber]_[Sequence]
        const buildingNum = parts.length > 3 ? parts[3] : '00';
        const prefix = `${workTypeCode}_${buildingNum}_`;

        let maxSeq = 0;
        this.issues.forEach(i => {
            if (i.issue_number && i.issue_number.startsWith(prefix)) {
                const seqStr = i.issue_number.split('_').pop();
                const seqNum = parseInt(seqStr, 10);
                if (!isNaN(seqNum) && seqNum > maxSeq) {
                    maxSeq = seqNum;
                }
            }
        });
        const nextSeq = String(maxSeq + 1).padStart(3, '0');
        issueNumber = `${prefix}${nextSeq}`;
        console.log(`[IssueManager] Auto-populated Structure: ${structureInput?.value}, WorkType: ${workTypeInput?.value}, IssueNumber: ${issueNumber}`);
    }

    modal.dataset.issueNumber = issueNumber;
    const numberDisplay = document.getElementById('issue-number-display');
    if (numberDisplay) {
        numberDisplay.textContent = issueNumber;
    }
}

addIssue(data) {
    console.log('[IssueManager] addIssue process started with object:', data);

    const { title, description, assignee, status, dbId, point, thumbnail, viewstate, urn, resolutionDesc, afterThumbnail, afterViewstate } = data;

    // [Normalization] Explicitly extract structure and work type from all possible input keys
    const structureName = data.structure_name || data.structureName || data.structure || data.struct || '-';
    const workType = data.work_type || data.workType || data.work_type || '-';

    // Validation
    if (!title || !description) {
        console.warn('[IssueManager] Validation failed: Missing title or description');
        alert('제목과 내용을 모두 입력해주세요.');
        return false;
    }

    const issue = {
        id: Date.now(),
        title,
        description,
        assignee: assignee || 'Anonymous',
        status,
        dbId,
        point,
        thumbnail,
        viewstate,
        modelUrn: this.viewer.model ? this.viewer.model.getData().urn : (urn || null),
        itemId: data.itemId || window.currentItemId || null, // NEW: Cross-version key
        createdAt: new Date().toISOString(),
        resolution_description: resolutionDesc || null,
        after_snapshot_url: afterThumbnail || null,
        after_viewpoint: afterViewstate || null,
        // [Filtering Logic] Capture current model GUID as primary filter key
        modelGuid: (this.viewer.model && this.viewer.model.getGuid) ? this.viewer.model.getGuid() : null,
        // [Fix] Enforce normalized snake_case keys
        structure_name: structureName.toString().trim(),
        work_type: workType.toString().trim(),
        issue_number: data.issueNumber || `REQ-${Date.now().toString().slice(-4)}`,
        // [NEW] Metadata for UI Sync
        hubId: window.currentHubId,
        projectId: window.currentProjectId,
        modelName: window.currentModelName
    };

    console.log('[AUDIT] New Issue Data Normalized:', issue);

    this.issues.push(issue);
    this.saveIssues();
    this.createPin(issue);
    this.removeTempMarker(); // Clear temporary marker after saving

    // Auto-exit creation mode
    this.toggleCreationMode(false);

    console.log('[IssueManager] Issue successfully created:', issue.id);
    return true;
}

updateIssue(id, data) {
    console.log('[IssueManager] updateIssue process started for ID:', id, 'with object:', data);

    const index = this.issues.findIndex(i => i.id === id);
    if (index === -1) {
        console.error('[IssueManager] Issue not found for update:', id);
        return false;
    }

    const { title, description, assignee, status, resolutionDesc, afterThumbnail, afterViewstate, structureName, workType } = data;

    if (!title || !description) {
        alert('제목과 내용을 모두 입력해주세요.');
        return false;
    }

    // [Normalization] Explicitly extract structure and work type from all possible input keys
    const structureNameRaw = data.structure_name || data.structureName || data.structure || data.struct || this.issues[index].structure_name || '-';
    const workTypeRaw = data.work_type || data.workType || data.work_type || this.issues[index].work_type || '-';

    this.issues[index] = {
        ...this.issues[index],
        title,
        description,
        assignee: assignee || 'Anonymous',
        status,
        updatedAt: new Date().toISOString(),
        resolution_description: status === 'Closed' ? (resolutionDesc || this.issues[index].resolution_description) : this.issues[index].resolution_description,
        after_snapshot_url: status === 'Closed' ? (afterThumbnail || this.issues[index].after_snapshot_url) : this.issues[index].after_snapshot_url,
        after_viewpoint: status === 'Closed' ? (afterViewstate || this.issues[index].after_viewpoint) : this.issues[index].after_viewpoint,
        // [Fix] Enforce normalized snake_case keys
        structure_name: structureNameRaw.toString().trim(),
        work_type: workTypeRaw.toString().trim()
    };

    this.saveIssues();
    this.restorePins();

    console.log('[IssueManager] Issue successfully updated (Object):', id);
    return true;
}

    // ── Markup Tools Implementation ──────────────────────────────────────────

    async enterMarkupMode(dbId, point, mode = 'create') {
    console.log(`[IssueManager] Entering Markup Mode [${mode}]:`, { dbId, point });

    // [Global Sync] Ensure all markers are aligned before entering markup mode
    this.refreshAllMarkers();

    // Ensure extension is loaded
    this.markupsExt = await this.viewer.loadExtension('Autodesk.Viewing.MarkupsCore');
    this.markupsExt.enterEditMode();

    // Store context with mode
    this.markupContext = { dbId, point, mode };

    this.renderMarkupToolbar();
}

renderMarkupToolbar() {
    if (document.getElementById('markup-toolbar')) return;

    const toolbar = document.createElement('div');
    toolbar.id = 'markup-toolbar';
    toolbar.className = 'markup-toolbar';
    toolbar.innerHTML = `
            <div class="markup-tool-group">
                <button class="markup-btn" data-tool="rectangle" title="Rectangle"><i class="fas fa-square"></i></button>
                <button class="markup-btn" data-tool="cloud" title="Cloud"><i class="fas fa-cloud"></i></button>
                <button class="markup-btn" data-tool="arrow" title="Arrow"><i class="fas fa-long-arrow-alt-right"></i></button>
                <button class="markup-btn" data-tool="text" title="Text"><i class="fas fa-font"></i></button>
            </div>
            <div class="markup-palette">
                <div class="color-dot active" data-color="#ff0000" style="background:#ff0000;"></div>
                <div class="color-dot" data-color="#0000ff" style="background:#0000ff;"></div>
                <div class="color-dot" data-color="#ffff00" style="background:#ffff00;"></div>
            </div>
            <div class="markup-style-controls">
                <label>Size:</label>
                <input type="range" class="markup-slider" min="0.1" max="20" step="0.1" value="1">
                <input type="number" class="markup-num-input" value="1" min="0.1" max="20" step="0.1">
            </div>
            <button class="markup-finish-btn">작성 완료</button>
        `;

    document.body.appendChild(toolbar);
    this._bindMarkupEvents(toolbar);

    // Set default tool
    toolbar.querySelector('[data-tool="rectangle"]').click();
}

_bindMarkupEvents(toolbar) {
    const ext = this.markupsExt;

    // Tool Selection
    toolbar.querySelectorAll('.markup-btn').forEach(btn => {
        btn.onclick = () => {
            toolbar.querySelectorAll('.markup-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            const tool = btn.dataset.tool;
            let markupTool;
            switch (tool) {
                case 'rectangle': markupTool = new Autodesk.Viewing.Extensions.Markups.Core.EditModeRectangle(ext); break;
                case 'cloud': markupTool = new Autodesk.Viewing.Extensions.Markups.Core.EditModeCloud(ext); break;
                case 'arrow': markupTool = new Autodesk.Viewing.Extensions.Markups.Core.EditModeArrow(ext); break;
                case 'text': markupTool = new Autodesk.Viewing.Extensions.Markups.Core.EditModeText(ext); break;
            }
            ext.changeEditMode(markupTool);

            // [Hard Fix] Force inject current styles immediately upon tool selection
            const color = toolbar.querySelector('.color-dot.active').dataset.color;
            const size = parseFloat(toolbar.querySelector('.markup-num-input').value);
            ext.setStyle({
                'stroke-color': color,
                'stroke-width': size,
                'stroke-opacity': 1,
                'fill-color': color,
                'fill-opacity': 0.1,
                'font-size': size * 5
            });
        };
    });

    // Color Palette
    toolbar.querySelectorAll('.color-dot').forEach(dot => {
        dot.onclick = () => {
            toolbar.querySelectorAll('.color-dot').forEach(d => d.classList.remove('active'));
            dot.classList.add('active');
            const color = dot.dataset.color;

            const style = {
                'stroke-color': color,
                'stroke-opacity': 1,
                'fill-color': color,
                'fill-opacity': 0.1
            };
            ext.setStyle(style);
        };
    });

    // [Nuclear Option] 무한 루프 차단을 위한 상태 잠금(State Locking) 로직
    const slider = toolbar.querySelector('.markup-slider');
    const numInput = toolbar.querySelector('.markup-num-input');
    let isUpdatingMarkup = false;

    const updateSize = (val) => {
        if (isUpdatingMarkup) return; // 상태 잠금 시 즉시 반환

        // 0.1 단위 정밀도 강제 정규화 (부동 소수점 오차 제거)
        const normalizedVal = Math.round(parseFloat(val) * 10) / 10;
        if (isNaN(normalizedVal)) return;

        isUpdatingMarkup = true;

        // 엔진 상태 확인 및 비교
        const currentStyle = ext.getStyle();
        const currentEngineVal = Math.round(parseFloat(currentStyle['stroke-width'] || 0) * 10) / 10;

        if (normalizedVal !== currentEngineVal) {
            // 엔진과 값이 다를 때만 업데이트 실행
            ext.setStyle({
                'stroke-width': normalizedVal,
                'font-size': normalizedVal * 5
            });
        }

        // UI 동기화 (슬라이더 및 숫자 입력창)
        if (Math.round(parseFloat(slider.value) * 10) / 10 !== normalizedVal) slider.value = normalizedVal;
        if (Math.round(parseFloat(numInput.value) * 10) / 10 !== normalizedVal) numInput.value = normalizedVal;

        // 50ms 후 잠금 해제 (이벤트 루프 분리)
        setTimeout(() => { isUpdatingMarkup = false; }, 50);
    };

    // 엔진 이벤트를 UI에 반영할 때도 상태 잠금 확인
    const onMarkupSelected = () => {
        if (isUpdatingMarkup) return;
        const style = ext.getStyle();
        if (style && style['stroke-width']) {
            const engineVal = Math.round(parseFloat(style['stroke-width']) * 10) / 10;
            slider.value = engineVal;
            numInput.value = engineVal;
        }
    };
    ext.addEventListener(Autodesk.Viewing.Extensions.Markups.Core.EVENT_MARKUP_SELECTED, onMarkupSelected);
    ext.addEventListener(Autodesk.Viewing.Extensions.Markups.Core.EVENT_EDIT_MODE_CHANGED, onMarkupSelected);
    slider.oninput = (e) => updateSize(e.target.value);
    numInput.oninput = (e) => updateSize(e.target.value);

    // Finish Button
    toolbar.querySelector('.markup-finish-btn').onclick = async () => {
        const svgMarkup = ext.generateData();

        // [Critical Fix] Capture BEFORE leaving edit mode or hiding
        console.log('[IssueManager] Initiating capture while markups are active...');
        await this._captureMarkupScreenshot(svgMarkup);

        // [Cleanup] Only after capture is initiated/processed
        ext.removeEventListener(Autodesk.Viewing.Extensions.Markups.Core.EVENT_MARKUP_SELECTED, onMarkupSelected);
        ext.removeEventListener(Autodesk.Viewing.Extensions.Markups.Core.EVENT_EDIT_MODE_CHANGED, onMarkupSelected);
        ext.leaveEditMode();
        ext.hide();
        toolbar.remove();
    };
}

    async _captureMarkupScreenshot(svgData) {
    const mode = this.markupContext?.mode || 'create';
    console.log(`[IssueManager] Rendering markup screenshot for mode: ${mode}`);

    // [Global Sync] Final alignment before capture
    this.refreshAllMarkers();

    return new Promise((resolve) => {
        this.captureIssueThumbnail((base64) => {
            const modal = document.getElementById('issue-modal');

            if (mode === 'create') {
                // Standard creation flow
                this.showCreateModal(this.markupContext.dbId, this.markupContext.point, base64);
            } else {
                // Resolution (Closed) flow: update existing edit modal
                if (modal && base64) {
                    modal.dataset.afterThumbnail = base64;
                    const afterPreviewImg = document.getElementById('issue-after-preview-img');
                    const afterPreviewContainer = document.getElementById('modal-after-image-preview');
                    if (afterPreviewImg && afterPreviewContainer) {
                        afterPreviewImg.src = base64;
                        afterPreviewContainer.style.display = 'flex';
                    }
                    // Re-show modal after drawing is finished
                    modal.style.display = 'flex';
                }
            }

            if (modal) modal.dataset.markup = svgData;
            resolve();
        }, this.markupsExt);
    });
}
deleteIssue(id) {
    console.log('[IssueManager] deleteIssue requested for ID:', id);

    if (!confirm('정말 이 이슈를 삭제하시겠습니까?')) return;

    this.issues = this.issues.filter(i => i.id !== id);
    this.saveIssues();
    this.restorePins();

    console.log('[IssueManager] Issue deleted:', id);
}

createPin(issue) {
    // [Nuclear Step 3] Create HTML-based Marker for Interaction
    const marker = document.createElement('div');
    marker.className = 'issue-marker';
    if (issue.status === 'Closed') marker.classList.add('green');

    // Source of Truth Data Binding
    marker.dataset.issueId = issue.id;
    marker.dataset.worldPos = JSON.stringify(issue.point);

    // Position Marker Initial Projection
    const pos = new THREE.Vector3(issue.point.x, issue.point.y, issue.point.z);
    const screenPoint = this.viewer.worldToClient(pos);
    marker.style.left = `${screenPoint.x}px`;
    marker.style.top = `${screenPoint.y}px`;

    // Click Event: Open Edit Modal
    marker.onclick = (e) => {
        e.stopPropagation();
        console.log(`[IssueManager] Marker clicked! Issue ID: ${issue.id}`);
        this.showEditModal(issue.id);
    };

    this.viewer.container.appendChild(marker);

    // Store for camera sync and cleanup
    this.htmlMarkersMap.set(issue.id, {
        element: marker,
        position: pos
    });
}

restorePins() {
    // 3. Cleanup existing HTML markers and reconstruct
    setTimeout(() => {
        // Remove from DOM
        this.htmlMarkersMap.forEach(data => {
            if (data.element && data.element.parentNode) {
                data.element.parentNode.removeChild(data.element);
            }
        });
        this.htmlMarkersMap.clear();

        // Legend removal (if any legacy pins existed)
        if (this.viewer.impl.hasOverlayScene && this.viewer.impl.hasOverlayScene('issue-markers')) {
            this.viewer.impl.clearOverlay('issue-markers');
        }

        // [Async Guard]
        let currentModelGuid = null;
        try { currentModelGuid = (this.viewer.model && this.viewer.model.getGuid) ? this.viewer.model.getGuid() : null; } catch (e) { }

        this.issues.forEach(issue => {
            try {
                const rawIssueGuid = issue.modelGuid || issue.modelId || issue.modelUrn || '';
                const issueModelId = String(rawIssueGuid).trim().toLowerCase();
                const targetModelId = String(currentModelGuid || '').trim().toLowerCase();

                console.log(`[Diagnostic] Issue: ${issue.id}, Stored: ${rawIssueGuid}, Current: ${currentModelGuid}`);

                // [Multi-Criteria Filter] Structure AND WorkType
                const structureFilter = this.activeStructureFilter;
                const workTypeFilter = this.activeWorkTypeFilter;

                if (structureFilter !== null || workTypeFilter !== null) {
                    const issueStruct = String(issue.structure_name || issue.structureName || '').trim().toLowerCase();
                    const issueWork = String(issue.work_type || issue.workType || '').trim().toLowerCase();
                    const targetStruct = String(structureFilter || '').trim().toLowerCase();
                    const targetWork = String(workTypeFilter || '').trim().toLowerCase();

                    const structMatch = !structureFilter || (issueStruct && issueStruct === targetStruct);
                    const workMatch = !workTypeFilter || (issueWork && issueWork === targetWork);

                    if (!structMatch || !workMatch) {
                        console.log(`[Multi-Criteria] Filtered out issue ${issue.id} (struct:${issueStruct}/${targetStruct}, work:${issueWork}/${targetWork})`);
                        return;
                    }
                }

                // [URN Filter] Compare by decoded base URN, version-agnostic
                const decodeUrn = (s) => {
                    try {
                        // Convert base64url → base64 → decode
                        return atob(s.replace(/-/g, '+').replace(/_/g, '/'));
                    } catch (e) {
                        return s; // Not base64, use as-is
                    }
                };
                const baseUrn = (s) => decodeUrn(String(s || '').trim()).split('?')[0].toLowerCase().trim();

                const currentUrn = String(
                    (this.viewer.model && this.viewer.model.getData)
                        ? (this.viewer.model.getData().urn || '') : ''
                ).trim();
                const storedUrn = String(issue.modelUrn || issue.modelGuid || issue.modelId || '').trim();

                const currentBase = baseUrn(currentUrn);
                const storedBase = baseUrn(storedUrn);

                console.log(`[URN Filter] Issue ${issue.id} | storedBase: "${storedBase}" | currentBase: "${currentBase}"`);

                // Match = same file regardless of version; Legacy = no URN stored at all
                const isMatch = storedBase && currentBase && (storedBase === currentBase);
                const isLegacy = !storedUrn;

                if (!isMatch && !isLegacy) {
                    console.warn(`[URN Filter] Skipping issue ${issue.id} — model mismatch`);
                    return;
                }

                this.createPin(issue);
            } catch (pinErr) {
                console.error(`[Emergency] Failed to render pin for issue ${issue.id}:`, pinErr);
            }
        });
    }, 200);
}
renderIssueList() {
    const container = document.getElementById('issue-list-container');
    if (!container) return;

    // [수정] 버전 필터링 로직 제거 및 디버깅 로그 추가
    console.log('--- [DEBUG] Issue Rendering Audit ---');
    console.log('Total Issues in Memory:', this.issues.length);
    console.log('Raw Data Array:', this.issues);

    // 컨테이너 초기화
    container.innerHTML = '';

    if (this.issues.length === 0) {
        container.innerHTML = '<p class="issue-empty">No issues found.</p>';
        return;
    }

    // 전체 렌더링 강제 (forEach 사용)
    const htmlParts = [];
    this.issues.forEach(issue => {
        const isRead = unreadManager.isRead(issue.id);
        const nameClass = isRead ? 'read-item-name' : 'unread-item-name';

        htmlParts.push(`
            <div class="issue-item" data-id="${issue.id}" data-structure="${issue.structure_name || ''}">
                <div class="issue-item-main">
                    <label style="display:flex;align-items:flex-start;padding-right:6px;margin-top:2px;cursor:pointer;" onclick="event.stopPropagation()">
                        <input type="checkbox" class="issue-check" data-id="${issue.id}"
                            style="cursor:pointer;margin-top:3px;accent-color:#6366f1;" />
                    </label>
                    ${issue.thumbnail ? `<img src="${issue.thumbnail}" class="issue-thumbnail" alt="Issue Screenshot">` : ''}
                    <div class="issue-info">
                        <div class="issue-item-header">
                            <span class="issue-status-badge ${issue.status.toLowerCase()}">${issue.status}</span>
                            <span class="issue-item-title ${nameClass}" title="${issue.title}">${issue.title}</span>
                            <div class="issue-item-actions">
                                ${issue.status === 'Closed' ? `<button class="issue-btn-pdf" title="Export PDF" style="background:rgba(16,185,129,0.15);border:1px solid rgba(16,185,129,0.3);color:#10b981;">📄</button>` : ''}
                                <button class="issue-btn-edit" title="Edit">✎</button>
                                <button class="issue-btn-delete" title="Delete">✕</button>
                            </div>
                        </div >
                        <div class="issue-item-desc">${issue.description}</div>
                        <div class="issue-item-meta">
                            <span>👤 ${issue.assignee}</span>
                            <span>📍 ID: ${issue.dbId}</span>
                        </div>
                    </div >
                </div >
            </div >
            `);
    });

    container.innerHTML = htmlParts.join('');

    // Bind checkbox events to update bulk button label
    container.querySelectorAll('.issue-check').forEach(chk => {
        chk.addEventListener('change', () => this._updateBulkBtnLabel());
    });

    // Action Handlers
    container.querySelectorAll('.issue-item').forEach(item => {
        const id = parseInt(item.dataset.id);
        const issue = this.issues.find(i => i.id === id);

        // Focus on Click
        item.onclick = (e) => {
            if (e.target.tagName === 'BUTTON') return;

            // [Unread Status] Mark as read
            if (unreadManager.markAsRead(id)) {
                this.renderIssueList();
            }

            if (issue) this.focusIssue(issue);
        };

        // PDF Export Button (only for Closed issues)
        const pdfBtn = item.querySelector('.issue-btn-pdf');
        if (pdfBtn) {
            pdfBtn.onclick = (e) => {
                e.stopPropagation();
                this.openPdfExportModal(id);
            };
        }

        // Edit Button
        item.querySelector('.issue-btn-edit').onclick = (e) => {
            e.stopPropagation();
            this.showEditModal(id);
        };

        // Delete Button
        item.querySelector('.issue-btn-delete').onclick = (e) => {
            e.stopPropagation();
            this.deleteIssue(id);
        };
    });

    // Setup bulk export button (once per render)
    this.setupBulkExportButton();

    // Update issue count badge
    const badge = document.getElementById('issue-count');
    if (badge) badge.textContent = this.issues.length;
}

_updateBulkBtnLabel() {
    const btn = document.getElementById('bulk-pdf-btn');
    if (!btn) return;
    const checked = document.querySelectorAll('.issue-check:checked').length;
    btn.textContent = checked > 0 ? `📄 선택 내보내기 (${checked})` : '📄 전체 내보내기';
}

setupBulkExportButton() {
    const btn = document.getElementById('bulk-pdf-btn');
    if (!btn || btn.dataset.bound) return;
    btn.dataset.bound = '1';

    btn.onclick = () => {
        const checked = [...document.querySelectorAll('.issue-check:checked')];
        let targetIssues;
        if (checked.length > 0) {
            const ids = checked.map(c => parseInt(c.dataset.id));
            targetIssues = this.issues.filter(i => ids.includes(i.id));
        } else {
            targetIssues = [...this.issues];
        }

        if (targetIssues.length === 0) {
            alert('내보낼 이슈가 없습니다.');
            return;
        }

        const modal = document.getElementById('pdf-export-modal');
        if (!modal) return;

        // [Fix] Store directly on instance, not in dataset
        this.exportPayload = [...targetIssues];
        modal.dataset.issueId = '';

        this.setupPdfModalListeners();
        this._populatePdfItemList();
        modal.style.display = 'flex';
    };
}

setupPdfModalListeners() {
    const modal = document.getElementById('pdf-export-modal');
    if (!modal || modal.dataset.listenersBound) return;
    modal.dataset.listenersBound = '1';

    document.getElementById('close-pdf-modal').onclick = () => { modal.style.display = 'none'; };
    document.getElementById('cancel-pdf-btn').onclick = () => { modal.style.display = 'none'; };

    // [Field Selector] 전체 선택/해제 버튼
    const fieldAllBtn = document.getElementById('pdf-field-select-all-btn');
    if (fieldAllBtn) {
        fieldAllBtn.onclick = () => {
            const fieldChecks = document.querySelectorAll('#pdf-field-list input[type="checkbox"]');
            const allChecked = [...fieldChecks].every(c => c.checked);
            fieldChecks.forEach(c => { c.checked = !allChecked; });
            fieldAllBtn.textContent = allChecked ? '전체 선택' : '전체 해제';
        };
    }

    document.getElementById('run-pdf-export-btn').onclick = async () => {
        const runBtn = document.getElementById('run-pdf-export-btn');
        runBtn.textContent = 'Generating...';
        runBtn.disabled = true;

        try {
            // [New] 1. Collect Selected Fields (sf) using consistent IDs
            const sf = {
                no: document.getElementById('pdf-field-no').checked,
                structure: document.getElementById('pdf-field-structure').checked,
                work_type: document.getElementById('pdf-field-worktype').checked,
                description: document.getElementById('pdf-field-description').checked,
                resolution: document.getElementById('pdf-field-resolution').checked,
                screenshot: document.getElementById('pdf-field-images').checked
            };

            // 2. Filter Issues based on Checkboxes in Modal (Real-time sync)
            const checkedIssueIds = [...document.querySelectorAll('.pdf-issue-check:checked')]
                .map(el => parseInt(el.dataset.id));

            const issuesToExport = this.exportPayload.filter(i => checkedIssueIds.includes(i.id));

            if (issuesToExport.length === 0) {
                alert('내보낼 항목을 하나 이상 선택해주세요.');
                runBtn.textContent = 'Generate PDF';
                runBtn.disabled = false;
                return;
            }

            await this.exportToPdf(issuesToExport, sf);
        } catch (err) {
            console.error('[PDF Export] Listener error:', err);
        } finally {
            runBtn.textContent = 'Generate PDF';
            runBtn.disabled = false;
            modal.style.display = 'none';
        }
    };
    // [New] 3. "Select All" Button for Issues
    const allBtn = document.getElementById('pdf-all-issues-btn');
    if (allBtn) {
        allBtn.onclick = () => {
            const checks = document.querySelectorAll('.pdf-issue-check');
            const allChecked = [...checks].every(c => c.checked);
            checks.forEach(c => c.checked = !allChecked);
            allBtn.textContent = allChecked ? '전체 선택' : '전체 해제';
        };
    }
}

_populatePdfItemList() {
    const listEl = document.getElementById('pdf-item-list');
    const selectAllBtn = document.getElementById('pdf-select-all-btn');
    if (!listEl) return;

    const issues = this.exportPayload || [];

    if (issues.length === 0) {
        listEl.innerHTML = '<p style="color:#94a3b8;font-size:12px;margin:0;padding:6px 0;">표시할 이슈가 없습니다.</p>';
        return;
    }

    listEl.innerHTML = issues.map(issue => {
        const label = issue.issue_number
            ? `[${issue.issue_number}] ${issue.title}`
            : `[#${issue.id}] ${issue.title}`;
        const statusColor = issue.status === 'Closed' ? '#10b981' : '#f59e0b';
        return `
                <label style="display:flex;align-items:center;gap:8px;padding:5px 4px;border-radius:4px;cursor:pointer;font-size:13px;color:#1e293b;user-select:none;" class="pdf-item-label">
                    <input type="checkbox" class="pdf-issue-check" data-id="${issue.id}" checked
                        style="cursor:pointer;accent-color:#6366f1;width:15px;height:15px;flex-shrink:0;" />
                    <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${statusColor};flex-shrink:0;"></span>
                    <span style="flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${label}">${label}</span>
                </label>
            `;
    }).join('');

    // Hover effect
    listEl.querySelectorAll('.pdf-item-label').forEach(lbl => {
        lbl.addEventListener('mouseenter', () => lbl.style.background = '#f1f5f9');
        lbl.addEventListener('mouseleave', () => lbl.style.background = '');
    });

    // "전체 선택" button toggle
    if (selectAllBtn) {
        selectAllBtn.onclick = () => {
            const allChecks = listEl.querySelectorAll('input[type="checkbox"]');
            const allChecked = [...allChecks].every(c => c.checked);
            allChecks.forEach(c => { c.checked = !allChecked; });
            selectAllBtn.textContent = allChecked ? '전체 선택' : '전체 해제';
        };
    }

    console.log(`[PdfItemList] Rendered ${issues.length} items.`);
}

showEditModal(id) {
    const issue = this.issues.find(i => i.id === id);
    if (!issue) return;

    const modal = document.getElementById('issue-modal');
    if (!modal) return;

    // Pre-fill modal
    modal.dataset.mode = 'edit';
    modal.dataset.editId = id;
    document.getElementById('issue-title').value = issue.title;
    document.getElementById('issue-desc').value = issue.description;
    document.getElementById('issue-assignee').value = issue.assignee;
    document.getElementById('issue-status').value = issue.status;
    document.getElementById('issue-structure').value = issue.structure_name || '';
    document.getElementById('issue-work-type').value = issue.work_type || '';

    // Populate Resolution fields
    const resDescInput = document.getElementById('issue-resolution-desc');
    const resSection = document.getElementById('issue-resolution-section');
    const afterPreviewContainer = document.getElementById('modal-after-image-preview');
    const afterPreviewImg = document.getElementById('issue-after-preview-img');

    if (issue.status === 'Closed') {
        if (resSection) resSection.style.display = 'block';
        if (resDescInput) resDescInput.value = issue.resolution_description || '';

        if (issue.after_snapshot_url && afterPreviewContainer && afterPreviewImg) {
            afterPreviewImg.src = issue.after_snapshot_url;
            afterPreviewContainer.style.display = 'flex';
            modal.dataset.afterThumbnail = issue.after_snapshot_url;
        } else {
            if (afterPreviewContainer) afterPreviewContainer.style.display = 'none';
        }
        if (issue.after_viewpoint) {
            modal.dataset.afterViewstate = JSON.stringify(issue.after_viewpoint);
        }
    } else {
        if (resSection) resSection.style.display = 'none';
        if (resDescInput) resDescInput.value = '';
        if (afterPreviewContainer) afterPreviewContainer.style.display = 'none';
        delete modal.dataset.afterThumbnail;
        delete modal.dataset.afterViewstate;
    }

    // Update UI
    modal.querySelector('.modal-header h3').textContent = 'Edit Issue';
    document.getElementById('save-issue-btn').textContent = 'Update Issue';

    // Update Image Preview
    const previewContainer = document.getElementById('modal-image-preview');
    const previewImg = document.getElementById('issue-preview-img');
    if (issue.thumbnail && previewContainer && previewImg) {
        previewImg.src = issue.thumbnail;
        previewContainer.style.display = 'flex';
    } else if (previewContainer) {
        previewContainer.style.display = 'none';
    }

    modal.style.display = 'flex';
}

    async focusIssue(issue) {
    if (!issue || !issue.point) return;

    console.log('[IssueManager] Focusing issue:', issue.id);

    // 1. Restore Camera Viewstate (Requested Feature)
    const issueState = typeof issue.viewstate === 'string' ? JSON.parse(issue.viewstate) : issue.viewstate;
    if (issueState) {
        console.log('[IssueManager] Restoring camera state...');
        this.viewer.restoreState(issueState);
    } else {
        // Fallback: zoom to point if no state saved
        const target = new THREE.Vector3(issue.point.x, issue.point.y, issue.point.z);
        this.viewer.navigation.setPivotPoint(target);
        this.viewer.navigation.setRequestHomeView(true);
    }

    // 2. Determine if model needs to be replaced
    const targetUrn = issue.modelUrn || issue.urn || issue.targetUrn || issue.targetModelUrn || issue.versionId || (issue.attributes && issue.attributes.urn);
    const currentUrn = this.viewer.model ? this.viewer.model.getData().urn : null;

    console.log(`[IssueManager] Target URN: ${targetUrn}, Current URN: ${currentUrn}`);

    if (targetUrn !== currentUrn || !this.viewer.model) {
        console.log("[IssueManager] Models differ! Re-loading model and syncing UI...");

        if (!targetUrn) {
            console.error("[IssueManager] Critical data missing: No URN found for this issue.");
            alert("이 이슈에는 연결된 모델 주소가 저장되지 않았습니다.");
            return;
        }

        // Immediately apply name to Top Bar
        let safeName = issue.modelName || issue.fileName;
        if (!safeName || safeName === '{3D}' || safeName === 'undefined') {
            const activeNode = document.querySelector('.tree-item.active .text');
            safeName = activeNode ? activeNode.innerText : 'Loading Model...';
        }

        const topBarName = document.getElementById('viewer-model-name');
        if (topBarName) topBarName.innerText = safeName;

        // Sync global UI state (Dashboard compatibility)
        if (window.syncUIState) {
            window.syncUIState(safeName, {
                urn: targetUrn,
                itemId: issue.itemId || issue.lineageUrn,
                hubId: issue.hubId,
                projectId: issue.projectId
            });
        }

        // Prepare viewer for new model
        if (this.viewer.model) {
            this.viewer.tearDown();
        }
        this.viewer.setUp(this.viewer.config);

        const { getSafeUrn, loadModel } = await import('./viewer.js');
        const safeUrn = getSafeUrn(targetUrn);

        // Sync pins and title post-load
        this.viewer.addEventListener(Autodesk.Viewing.GEOMETRY_LOADED_EVENT, () => {
            this.restorePins();
            this.viewer.restoreState(issueState);

            if (window.syncUIState) {
                const postLoadName = issue.modelName || issue.fileName;
                window.syncUIState(postLoadName, {
                    urn: targetUrn,
                    itemId: issue.itemId || issue.lineageUrn
                });
            }
        }, { once: true });

        try {
            await loadModel(this.viewer, safeUrn);
            if (window.syncTreeHighlight) {
                window.syncTreeHighlight(targetUrn);
            }
        } catch (err) {
            console.error("[IssueManager] Model load failed:", err);
            alert("해당 이슈의 모델을 불러올 수 없습니다.");
            const dashboard = document.getElementById('project-selection-dashboard');
            if (dashboard) {
                dashboard.style.display = 'flex';
                document.getElementById('preview').style.display = 'none';
            }
        }
    } else {
        console.log("[IssueManager] Same model. Restoring state only...");
        this.viewer.restoreState(issueState);
        if (window.syncUIState) {
            window.syncUIState(issue.modelName || null, { urn: currentUrn, itemId: issue.itemId });
        }
    }
}

openPdfExportModal(issueId) {
    const issue = this.issues.find(i => i.id === issueId);
    if (!issue) return;

    const modal = document.getElementById('pdf-export-modal');
    if (!modal) return;

    this.exportPayload = [issue];
    modal.dataset.issueId = issueId;

    this.setupPdfModalListeners();
    this._populatePdfItemList();
    modal.style.display = 'flex';
}

_populatePdfIssueList() {
    const listContainer = document.getElementById('pdf-issue-list');
    if (!listContainer) return;

    if (!this.exportPayload || this.exportPayload.length === 0) {
        listContainer.innerHTML = '<p style="font-size:12px; color:#94a3b8;">선택된 이슈가 없습니다.</p>';
        return;
    }

    listContainer.innerHTML = this.exportPayload.map(issue => `
                <label style="display: flex; align-items: center; gap: 8px; padding: 6px 0; border-bottom: 1px solid #f1f5f9; cursor: pointer; font-size: 13px;">
                    <input type="checkbox" class="pdf-issue-check" data-id="${issue.id}" checked>
                    <span style="font-weight: 600; color: #6366f1; min-width: 80px;">${issue.issue_number || 'N/A'}</span>
                    <span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1;">${issue.title}</span>
                </label>
            `).join('');

    // Reset Field selectors to checked
    ['sf-no', 'sf-structure', 'sf-work-type', 'sf-description', 'sf-resolution', 'sf-image'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.checked = true;
    });

    const allBtn = document.getElementById('pdf-all-issues-btn');
    if (allBtn) allBtn.textContent = '전체 해제';
}

    async exportToPdf(issuesArray, sf = {}) {
    const issuesList = Array.isArray(issuesArray) ? issuesArray : [issuesArray];
    const title = document.getElementById('pdf-export-title')?.value || '이슈 해결 결과 보고서';
    const logoFile = document.getElementById('pdf-export-logo')?.files?.[0];

    const logoBase64 = logoFile ? await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.readAsDataURL(logoFile);
    }) : '';

    // [Enrichment] 속성명 정규화
    const enrichedIssues = issuesList.map(issue => {
        const sName = (issue.structure_name || issue.structureName || issue.structure || issue.struct || '-').toString().trim();
        const wType = (issue.work_type || issue.workType || issue.work_type || issue.worktype || '-').toString().trim();

        const finalSName = (sName === 'null' || sName === 'undefined' || !sName) ? '-' : sName;
        const finalWType = (wType === 'null' || wType === 'undefined' || !wType) ? '-' : wType;

        return {
            ...issue,
            structure_name: finalSName,
            work_type: finalWType
        };
    });

    // ── [Reset 2] Data Payload Hard-Filter ───────────────────────────
    const targetStructure = this.lastTargetStructure || null;
    const targetWorkType = this.lastTargetWorkType || null;
    const targetStatus = this.lastTargetStatus || null;

    let finalIssues = this.forcePayloadIssues || enrichedIssues;

    if (!this.forcePayloadIssues && (targetStructure || targetWorkType || targetStatus)) {
        console.log(`[Nuclear-Reset] Hard-Filter 적용: 구조물="${targetStructure}", 공종="${targetWorkType}", 상태="${targetStatus}"`);
        finalIssues = enrichedIssues.filter(item => {
            let match = true;
            if (targetStructure && !item.structure_name.includes(targetStructure)) match = false;
            if (targetWorkType && !item.work_type.includes(targetWorkType)) match = false;
            if (targetStatus && !item.status?.toLowerCase().includes(targetStatus.toLowerCase())) match = false;
            return match;
        });
        console.log(`[Nuclear-Reset] 필터링 결과: ${enrichedIssues.length}개 -> ${finalIssues.length}개`);
    }

    // 초기화
    this.lastTargetStructure = null;
    this.lastTargetWorkType = null;
    this.lastTargetStatus = null;
    this.forcePayloadIssues = null;

    // [Guardrail] 필터링 결과 유실 체크
    if (finalIssues.length === 0) {
        alert(`[오류] 해당 구조물(${targetStructure})의 데이터가 필터링 과정에서 유실되었습니다.`);
        return;
    }

    const payload = {
        title,
        logoBase64,
        issues: finalIssues,
        sf: sf,
        issuesCount: finalIssues.length
    };

    // ── [Audit Log] 최종 데이터 출력 ────────────────────────────────
    console.log('--- [PDF EXPORT DATA AUDIT] ---');
    console.log(`1. Target: ${targetStructure || '전체'}`);
    console.log(`2. Count: ${finalIssues.length}`);
    console.table(finalIssues.map(i => ({
        id: i.id,
        title: i.title,
        struct: i.structure_name,
        work: i.work_type
    })));
    console.log('--- [END AUDIT] ---');

    const payloadString = JSON.stringify(payload);
    const totalSizeMB = (payloadString.length / (1024 * 1024)).toFixed(2);
    console.log(`[PDF Export] Final payload being sent to server. Total Size: ${totalSizeMB} MB`, {
        issuesCount: finalIssues.length,
        title
    });

    try {
        const resp = await fetch('/api/issues/export-pdf', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: payloadString
        });

        if (!resp.ok) {
            const err = await resp.json();
            alert('PDF 생성 실패: ' + (err.details || err.error));
            return;
        }

        // Trigger file download
        const blob = await resp.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = issuesList.length === 1
            ? `issue_report_${issuesList[0].id || 'export'}.pdf`
            : `issue_report_batch_${Date.now()}.pdf`;
        document.body.appendChild(a);
        a.click();
        URL.revokeObjectURL(url);
        document.body.removeChild(a);
        console.log('[IssueManager] PDF downloaded successfully.');
    } catch (err) {
        console.error('[IssueManager] PDF export failed:', err);
        alert('PDF 내보내기 중 오류가 발생했습니다: ' + err.message);
    }
}
}
