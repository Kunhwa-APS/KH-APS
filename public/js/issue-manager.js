/**
 * public/js/issue-manager.js
 * Manages custom 3D issues, markers, and local storage persistence.
 */

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
        this.initOverlays();
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
        } catch (err) {
            console.error('[IssueManager] Initialization failed:', err);
            // Fallback to empty list
            this.issues = [];
        }
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

        // [Fix] 캔버스가 아닌 뷰어 전체 컨테이너에 이벤트 리스너 부착하여 클릭 유실(Swallowing) 방지
        const targetElement = this.viewer.container;

        // Remove existing listener to strictly prevent duplicates
        targetElement.removeEventListener('click', this._onIssueClick);

        if (this.isCreationMode) {
            targetElement.style.cursor = 'crosshair';
            targetElement.classList.add('issue-creation-active');
            targetElement.addEventListener('click', this._onIssueClick);
            console.log('[IssueManager] Click event listener attached to viewer container');
        } else {
            targetElement.style.cursor = ''; // Revert to default
            targetElement.classList.remove('issue-creation-active');
            console.log('[IssueManager] Click event listener removed');
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

        // [Fix] 1. 좌표 보정: 브라우저 뷰포트(clientX/Y)에서 뷰어 컨테이너의 위치(getBoundingClientRect)를 차감
        const rect = this.viewer.container.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        // [Fix] 2. 디버깅 로그 추가 (좌표 및 오프셋 확인용)
        console.log(`[IssueManager] Coordinate Debug:
            - ClientX/Y: (${e.clientX}, ${e.clientY})
            - ViewerRect: (L:${rect.left.toFixed(1)}, T:${rect.top.toFixed(1)}, W:${rect.width}, H:${rect.height})
            - Adjusted X/Y: (${x.toFixed(1)}, ${y.toFixed(1)})`);

        // [Fix] 3. 보정된 좌표로 Hit Test 실행
        // 세 번째 인자 true는 투명한 객체를 무시하고 실제 지오메트리를 찾도록 함
        const result = this.viewer.impl.hitTest(x, y, true);

        if (result && result.dbId) {
            console.log(`[IssueManager] Hit Success! dbId: ${result.dbId}, Point:`, result.intersectPoint);

            // [Fix] 객체를 맞췄다면 즉시 생성 모드 종료
            this.toggleCreationMode(false);

            // 모달 즉시 호출
            this.showCreateModal(result.dbId, result.intersectPoint, null);

            console.log('[IssueManager] Starting async capture for thumbnail...');
            this.captureIssueThumbnail((base64) => {
                const modal = document.getElementById('issue-modal');
                if (modal && modal.style.display === 'flex' && modal.dataset.dbId == result.dbId) {
                    console.log('[IssueManager] Capture complete -> Injecting thumbnail');
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
            console.log('[IssueManager] Hit Failed: No object at adjusted location.');

            // [Fix] 4. 감도 보조 로직 (주변 5px 범위 내에서 재검색 시도) - 선택 사항이나 안정성 위해 추가
            let retryResult = null;
            const offsets = [[-3, 0], [3, 0], [0, -3], [0, 3]];
            for (let offset of offsets) {
                retryResult = this.viewer.impl.hitTest(x + offset[0], y + offset[1], true);
                if (retryResult && retryResult.dbId) {
                    console.log(`[IssueManager] Hit Success on retry (offset ${offset})! dbId: ${retryResult.dbId}`);
                    this.toggleCreationMode(false);
                    this.showCreateModal(retryResult.dbId, retryResult.intersectPoint, null);
                    return;
                }
            }

            alert('빈 공간을 클릭했습니다. 모델 위를 클릭해주세요.\n(클릭 위치가 모델의 아주 미세한 경계일 수 있습니다.)');
            this.toggleCreationMode(false);
        }
    }

    captureIssueThumbnail(callback) {
        console.log('[IssueManager] Capturing high-resolution snapshot...');
        try {
            if (typeof this.viewer.setQualityLevel === 'function') {
                this.viewer.setQualityLevel(true, true);
            }
            const width = 1600;
            const height = 1200;
            this.viewer.getScreenShot(width, height, (blobUrl) => {
                if (!blobUrl) {
                    console.warn('[IssueManager] High-res failed. Trying fallback...');
                    this.viewer.getScreenShot(800, 600, (fb) => {
                        if (fb) this._processSnapshotBlob(fb, 800, 600, callback);
                        else callback(null);
                    });
                    return;
                }
                this._processSnapshotBlob(blobUrl, width, height, callback);
            });
        } catch (err) {
            console.error('[IssueManager] Capture error:', err);
            callback(null);
        }
    }

    _processSnapshotBlob(blobUrl, w, h, callback) {
        fetch(blobUrl).then(r => r.blob()).then(blob => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                canvas.width = w; canvas.height = h;
                const ctx = canvas.getContext('2d');
                ctx.fillStyle = '#FFFFFF';
                ctx.fillRect(0, 0, w, h);
                ctx.drawImage(img, 0, 0, w, h);

                // [Optimization] Switch to JPEG with 0.75 quality for better compression
                const b64 = canvas.toDataURL('image/jpeg', 0.75);

                // [Debug] Check compression results
                const sizeInMB = (b64.length * (3 / 4) / (1024 * 1024)).toFixed(2);
                console.log(`[IssueManager] Snapshot processed (JPEG 0.75). Estimated size: ${sizeInMB} MB`);

                URL.revokeObjectURL(img.src);
                callback(b64);
            };
            img.src = URL.createObjectURL(blob);
        }).catch(e => {
            console.error('[IssueManager] Process error:', e);
            callback(null);
        });
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

    deleteIssue(id) {
        console.log('[IssueManager] deleteIssue requested for ID:', id);

        if (!confirm('정말 이 이슈를 삭제하시겠습니까?')) return;

        this.issues = this.issues.filter(i => i.id !== id);
        this.saveIssues();
        this.restorePins();

        console.log('[IssueManager] Issue deleted:', id);
    }

    createPin(issue) {
        // Simple Sphere as Pin
        const geom = new THREE.SphereGeometry(0.4, 16, 16);
        const color = issue.status === 'Open' ? 0xff4444 : 0x44ff44;
        const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthTest: false });
        const sphere = new THREE.Mesh(geom, mat);

        sphere.position.copy(issue.point);
        sphere.userData = { issueId: issue.id };

        // 1. 씬 존재 확인 및 생성
        if (!this.viewer.impl.overlayScenes["issue-markers"]) {
            this.viewer.impl.createOverlayScene("issue-markers");
        }

        // 2. 오버레이에 메쉬 추가 (안전한 방식)
        this.viewer.impl.addOverlay("issue-markers", sphere);
        this.pins.push(sphere);
        this.viewer.impl.invalidate(true);
    }

    restorePins() {
        // 3. 안정성 확보: 뷰어 엔진 렌더사이클 대기 (0.2초 지연)
        setTimeout(() => {
            if (this.viewer.impl.hasOverlayScene && this.viewer.impl.hasOverlayScene('issue-markers')) {
                this.viewer.impl.clearOverlay('issue-markers');
            }
            this.pins = [];

            // [수정] 버전(itemId) 필터링 제거: 모든 이슈의 핀을 표시
            console.log(`[IssueManager] Restoring pins for all ${this.issues.length} issues.`);
            this.issues.forEach(issue => this.createPin(issue));

            console.log('[FIX] Sidebar & Overlay issues resolved.');
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
                            <span class="issue-item-title" title="${issue.title}">${issue.title}</span>
                            <div class="issue-item-actions">
                                ${issue.status === 'Closed' ? `<button class="issue-btn-pdf" title="Export PDF" style="background:rgba(16,185,129,0.15);border:1px solid rgba(16,185,129,0.3);color:#10b981;">📄</button>` : ''}
                                <button class="issue-btn-edit" title="Edit">✎</button>
                                <button class="issue-btn-delete" title="Delete">✕</button>
                            </div>
                        </div>
                        <div class="issue-item-desc">${issue.description}</div>
                        <div class="issue-item-meta">
                            <span>👤 ${issue.assignee}</span>
                            <span>📍 ID: ${issue.dbId}</span>
                        </div>
                    </div>
                </div>
            </div>
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

                // [New] 2. Filter Issues based on Checkboxes in Modal
                const checkedIssueIds = [...document.querySelectorAll('.pdf-issue-check:checked')]
                    .map(el => parseInt(el.dataset.id));

                let issuesToExport = this.exportPayload.filter(i => checkedIssueIds.includes(i.id));

                if (issuesToExport.length === 0) {
                    alert('선택된 이슈가 없습니다.');
                    return;
                }

                // [PDF Item Selector] Filter by checked checkboxes in the modal's list
                const checkedEls = [...document.querySelectorAll('#pdf-item-list input[type="checkbox"]:checked')];
                if (checkedEls.length > 0) {
                    const checkedIds = checkedEls.map(el => parseInt(el.dataset.id));
                    issuesToExport = issuesToExport.filter(i => checkedIds.includes(i.id));
                }

                if (issuesToExport.length === 0) {
                    alert('포함할 항목을 하나 이상 선택해주세요.');
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
                    <input type="checkbox" data-id="${issue.id}" checked
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
        if (issue.viewstate) {
            console.log('[IssueManager] Restoring camera state...');
            this.viewer.restoreState(issue.viewstate);
        } else {
            // Fallback: zoom to point if no state saved
            const target = new THREE.Vector3(issue.point.x, issue.point.y, issue.point.z);
            this.viewer.navigation.setPivotPoint(target);
            this.viewer.navigation.setRequestHomeView(true);
        }

        // 2. Select the clashing element if dbId exists
        console.log(JSON.stringify(issue, null, 2));

        // 2단계: 'URN 헌터' 로직 구현 (Robust Mapping)
        const targetUrn = issue.modelUrn || issue.urn || issue.targetUrn || issue.targetModelUrn || issue.versionId || (issue.attributes && issue.attributes.urn);
        const currentUrn = this.viewer.model ? this.viewer.model.getData().urn : null;

        // 디버깅 로그
        console.log(`[Check] Target URN: ${targetUrn}`);
        console.log(`[Check] Current URN: ${currentUrn}`);

        const issueState = typeof issue.viewstate === 'string' ? JSON.parse(issue.viewstate) : issue.viewstate;

        // 예외 상황 처리: 뷰어 모델이 없을 경우(초기 상태) targetUrn과 currentUrn이 다르다고 판단하여 교체 로직 진행
        if (!this.viewer.model) {
            console.log("[Action] 모델 교체 여부: Yes (초기 대시보드 상태)");
        } else {
            console.log(`[Action] 모델 교체 여부: ${targetUrn !== currentUrn ? 'Yes' : 'No'}`);
        }

        // 실행 로직 분리 (필수)
        if (targetUrn !== currentUrn || !this.viewer.model) {
            console.log("모델이 다름! 모델 교체 및 UI 동기화 시작...");

            if (!targetUrn) {
                alert("이 이슈에는 연결된 모델 주소가 저장되지 않았습니다");
                return;
            }

            // [NEW] 1. 즉각적인 상단 제목 주입 (UI 배달 사고 방지)
            let safeName = issue.modelName || issue.fileName;

            // [FALLBACK] 만약 데이터가 없다면 사이드바에서 현재 활성화된 노드 텍스트 추출
            if (!safeName || safeName === '{3D}' || safeName === 'undefined') {
                const activeNode = document.querySelector('.tree-item.active .text');
                if (activeNode) {
                    safeName = activeNode.innerText;
                    console.log('[IssueManager] Extracted name from sidebar fallback:', safeName);
                } else {
                    safeName = 'Loading Model...';
                }
            }

            console.log('[DEBUG] FocusIssue - Passing to syncUIState:', { name: safeName, itemId: issue.itemId });

            const topBarName = document.getElementById('viewer-model-name');
            if (topBarName) topBarName.innerText = safeName;

            // [NEW] 2. 중앙 상태 동기화
            if (window.syncUIState) {
                window.syncUIState(safeName, {
                    urn: targetUrn,
                    itemId: issue.itemId || issue.lineageUrn,
                    hubId: issue.hubId,
                    projectId: issue.projectId
                });
            }

            if (this.viewer.model) {
                this.viewer.tearDown();
                this.viewer.setUp(this.viewer.config);
            }

            const { getSafeUrn, loadModel } = await import('./viewer.js');
            const safeUrn = getSafeUrn(targetUrn);

            // 이벤트 동기화: 로드 완료 후 핀/카메라 복원 및 제목 최종 확정
            this.viewer.addEventListener(Autodesk.Viewing.GEOMETRY_LOADED_EVENT, () => {
                this.restorePins();
                this.viewer.restoreState(issueState);

                // [NEW] 3. 로드 완료 후 제목 최종 싱크 (fallback 추출 보장)
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
                console.error("모델 로드 실패:", err);
                alert("해당 이슈의 모델을 불러올 수 없습니다.");
            }
        } else {
            console.log("모델 동일! 시점만 이동...");
            this.viewer.restoreState(issueState);

            // 동일 모델이라도 제목은 다시 한번 확인
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
            const sName = (issue.structure_name || issue.structureName || issue.structure || '-').toString().trim();
            const wType = (issue.work_type || issue.workType || '-').toString().trim();
            return {
                ...issue,
                structure_name: (sName === 'null' || !sName) ? '-' : sName,
                work_type: (wType === 'null' || !wType) ? '-' : wType
            };
        });

        // ── [Reset 2] Data Payload Hard-Filter ───────────────────────────
        const targetStructure = this.lastTargetStructure || null;
        const targetWorkType = this.lastTargetWorkType || null; // [New] 공종 필터 추가
        const targetStatus = this.lastTargetStatus || null;

        // [Harness-Sync] 하네스에서 강제 주입된 필터링 데이터가 있으면 최우선 사용 (물리적 제거)
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

        try {
            const resp = await fetch('/api/issues/export-pdf', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!resp.ok) {
                const err = await resp.json();
                alert('PDF 생성 실패: ' + (err.details || err.error));
                return;
            }

            const blob = await resp.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `issue_report_${Date.now()}.pdf`;
            document.body.appendChild(a);
            a.click();
            URL.revokeObjectURL(url);
            document.body.removeChild(a);
        } catch (err) {
            console.error('[IssueManager] PDF export failed:', err);
            alert('PDF 내보내기 중 오류가 발생했습니다: ' + err.message);
        }
    }
}
