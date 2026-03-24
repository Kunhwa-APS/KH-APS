/**
 * NavisClashExtension.js
 * 
 * A Navisworks-style Clash Detective for APS Viewer.
 */


class NavisClashExtension extends Autodesk.Viewing.Extension {
    constructor(viewer, options) {
        super(viewer, options);
        this._group = null;
        this._button = null;
        this.panel = null;
    }

    async load() {
        console.log('NavisClashExtension loading...');
        window.viewer = this.viewer; // Ensure global accessibility as requested

        // If toolbar is already created, manually trigger onToolbarCreated
        if (this.viewer.getToolbar()) {
            this.onToolbarCreated();
        }
        return true;
    }

    unload() {
        console.log('NavisClashExtension unloading...');
        if (this.panel) {
            this.panel.uninitialize();
            this.panel = null;
        }
        if (this._group && this._button) {
            this._group.removeControl(this._button);
        }
        return true;
    }

    onToolbarCreated() {
        console.log('NavisClashExtension onToolbarCreated');
        const toolbar = this.viewer.getToolbar(true);
        if (!toolbar) {
            console.error('NavisClashExtension: Toolbar not found');
            return;
        }

        // Create or get the custom group
        this._group = toolbar.getControl('customExtensionsGroup');
        if (!this._group) {
            this._group = new Autodesk.Viewing.UI.ControlGroup('customExtensionsGroup');
            toolbar.addControl(this._group);
        }

        if (this._group.getControl('navisClashButton')) return;

        this._button = new Autodesk.Viewing.UI.Button('navisClashButton');
        this._button.onClick = () => {
            console.log('[DEBUG] Clash Detective button clicked');
            try {
                if (!this.panel) {
                    console.log('[DEBUG] Creating NavisClashPanel instance...');
                    this.panel = new NavisClashPanel(this.viewer, 'navisClashPanel', 'Clash Detective');
                }
                const isVisible = this.panel.isVisible();
                console.log('[DEBUG] Panel visibility current:', isVisible, '-> Setting to:', !isVisible);
                this.panel.setVisible(!isVisible);
            } catch (e) {
                console.error('[DEBUG] Error during panel toggle:', e);
            }
        };
        this._button.setToolTip('Clash Detective');

        // Custom SVG for the icon to ensure it's visible and looks premium
        this._button.icon.innerHTML = `
            <svg viewBox="0 0 24 24" width="20" height="20" style="margin-top: 4px; pointer-events: none;">
                <path fill="#38bdf8" d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-8 14H7v-2h4v2zm0-4H7v-2h4v2zm0-4H7V7h4v2zm6 8h-4v-2h4v2zm0-4h-4v-2h4v2zm0-4h-4V7h4v2z"/>
            </svg>
        `;

        this._group.addControl(this._button);
    }
}

class NavisClashPanel extends Autodesk.Viewing.UI.DockingPanel {
    constructor(viewer, id, title, options) {
        console.log('[DEBUG] NavisClashPanel constructor started');
        super(viewer.container, id, title, options);
        this.viewer = viewer;
        this._projectModelsCache = null;
        this._isScanning = false;
        console.log('[SYSTEM] Manual Refresh Logic Injected');

        // Defer initialization to allow viewer engine to settle
        setTimeout(() => {
            const v = this.viewer || (typeof NOP_VIEWER !== 'undefined' ? NOP_VIEWER : null);
            if (v) {
                console.log('[DEBUG] Binding events after 1s delay');
                v.addEventListener(Autodesk.Viewing.GEOMETRY_LOADED_EVENT, () => this.updateModelLists());
                v.addEventListener(Autodesk.Viewing.MODEL_ADDED_EVENT, () => this.updateModelLists());
                v.addEventListener(Autodesk.Viewing.MODEL_REMOVED_EVENT, () => this.updateModelLists());
                v.addEventListener(Autodesk.Viewing.OBJECT_TREE_CREATED_EVENT, () => this.updateModelLists());

                this.loadTests();

                // Pre-allocate calculation objects for Narrow-Phase performance
                this._tempVecA = new THREE.Vector3();
                this._tempVecB = new THREE.Vector3();
                this._tempVecC = new THREE.Vector3();
                this._tempVecD = new THREE.Vector3();
                this._tempVecE = new THREE.Vector3();
                this._tempVecF = new THREE.Vector3();
                this._tempBoxA = new THREE.Box3();
                this._tempBoxB = new THREE.Box3();
                this._tempMatA = new THREE.Matrix4();
                this._tempMatB = new THREE.Matrix4();
                this._tempTriA = new THREE.Triangle();
                this._tempTriB = new THREE.Triangle();
                this._tempPlaneA = new THREE.Plane();
                this._tempPlaneB = new THREE.Plane();
                this._tempLine = new THREE.Line3();

                if (this.clashTests.length === 0) {
                    this.createTest('테스트 1');
                }
            }
        }, 1000);
    }

    initialize() {
        console.log('[DEBUG] NavisClashPanel.initialize() called');
        this.clashTests = [];
        this.clashResults = [];
        this.selectedClashIds = new Set();
        this._activeResultId = null;
        this._anchorId = null; // for shift-multi-selection
        this.tolerance = 0.001;
        this._offsetFrags = new Map(); // model -> Set of fragIds
        this._clashIconTexture = this._createClashIconTexture();
        this.initWorker();

        try {
            this.container.id = 'navis-clash-panel';
            this.container.classList.add('navis-clash-panel');

            // Position at bottom, full width
            this.container.style.left = '0px';
            this.container.style.bottom = '0px';
            this.container.style.top = 'unset';
            this.container.style.width = '100%';
            this.container.style.height = '350px';
            this.container.style.minWidth = '300px';
            this.container.style.minHeight = '200px';
            this.container.style.maxHeight = '80vh';
            this.container.style.borderTop = '1px solid #444'; // Subtle border instead of thick blue
            this.container.style.zIndex = '1000';
            this.container.style.pointerEvents = 'auto';
            this.container.style.boxShadow = '0 -4px 20px rgba(0,0,0,0.5)';

            // ── Model Browser Modal Container ──
            this._browserModal = document.createElement('div');
            this._browserModal.id = 'navis-model-browser';
            this._browserModal.className = 'navis-modal';
            this._browserModal.innerHTML = `
                <div class="navis-modal-content">
                    <div class="navis-modal-header">
                        <span>Project Model Browser</span>
                        <span class="navis-modal-close">&times;</span>
                    </div>
                    <div class="navis-modal-search">
                        <input type="text" id="modelSearchInput" placeholder="Search models by name or folder..." class="navis-input">
                    </div>
                    <div class="navis-modal-body" id="modelBrowserList">
                        <!-- Model items will be injected here -->
                    </div>
                </div>
            `;
            document.body.appendChild(this._browserModal);

            // ── Loading Overlay ──
            this._loadingOverlay = document.createElement('div');
            this._loadingOverlay.className = 'navis-loading-overlay';
            this._loadingOverlay.innerHTML = `
                <div class="navis-spinner"></div>
                <div class="navis-loading-text">대상 모델 로드 및 위치 이동 중...</div>
            `;
            document.body.appendChild(this._loadingOverlay);

            this._browserModal.querySelector('.navis-modal-close').onclick = () => {
                this._browserModal.style.display = 'none';
            };

            this._browserModal.querySelector('#modelSearchInput').oninput = (e) => {
                this.renderBrowserList(e.target.value);
            };

            // ── Top-Edge Resizer ──
            const resizer = document.createElement('div');
            resizer.className = 'navis-resizer-top';
            this.container.appendChild(resizer);

            let isResizing = false;
            let startY, startHeight;

            resizer.onmousedown = (e) => {
                isResizing = true;
                startY = e.clientY;
                startHeight = parseInt(document.defaultView.getComputedStyle(this.container).height, 10);
                document.body.style.cursor = 'ns-resize';
                e.preventDefault();
            };

            window.addEventListener('mousemove', (e) => {
                if (!isResizing) return;
                const deltaY = startY - e.clientY; // Moving up increases height
                const newHeight = Math.min(window.innerHeight * 0.8, Math.max(200, startHeight + deltaY));
                this.container.style.height = `${newHeight}px`;
            });

            window.addEventListener('mouseup', () => {
                if (isResizing) {
                    isResizing = false;
                    document.body.style.cursor = 'default';
                }
            });

            this.title = this.createTitleBar(this.titleLabel || this.container.id);
            this.container.appendChild(this.title);
            this.container.appendChild(this.createCloseButton());

            this.content = document.createElement('div');
            this.content.style.height = 'calc(100% - 40px)';
            this.content.style.display = 'flex';
            this.content.style.flexDirection = 'column';
            this.content.style.position = 'relative'; // Added for layout stability

            const style = document.createElement('style');
            style.innerHTML = `
            :root {
                --navis-bg: #1a1a1a;
                --navis-bg-alt: #222222;
                --navis-border: #444444;
                --navis-accent: #0696d7;
            }
            .navis-tabs { display: flex; background: #333; border-bottom: 1px solid var(--navis-border); padding: 0 10px; }
            .navis-tab { padding: 10px 15px; cursor: pointer; font-size: 12px; font-weight: 600; color: #888; transition: 0.2s; border-bottom: 2px solid transparent; }
            .navis-tab:hover { color: #ccc; }
            .navis-tab.active { color: #fff; border-bottom: 2px solid var(--navis-accent); background: rgba(255,255,255,0.05); }
            .navis-tab-content { display: none; padding: 0; min-height: 0; flex: 1; border-top: 1px solid var(--navis-border); background: var(--navis-bg); }
            .navis-tab-content.active { display: flex; flex-direction: column; }

            /* Results Tab Layout - Split View */
            .navis-results-grid { display: flex; flex: 1; min-height: 0; }
            .navis-results-left { flex: 2; border-right: 1px solid var(--navis-border); display: flex; flex-direction: column; overflow: hidden; }
            .navis-results-right { flex: 1; background: var(--navis-bg-alt); padding: 12px; display: flex; flex-direction: column; gap: 15px; overflow-y: auto; }

            /* Desktop-style Results Table */
            .navis-res-table { width: 100%; border-collapse: collapse; font-size: 11px; table-layout: fixed; }
            .navis-res-table th { background: var(--navis-bg-alt); padding: 8px 10px; text-align: left; border-bottom: 1px solid var(--navis-border); color: #888; border-right: 1px solid var(--navis-border); }
            .navis-res-table td { padding: 6px 10px; border-bottom: 1px solid rgba(255,255,255,0.05); color: #ddd; vertical-align: middle; border-right: 1px solid var(--navis-border); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
            .navis-result-row { cursor: pointer; transition: background 0.1s; }
            .navis-result-row:hover { background: rgba(0, 150, 255, 0.1); }
            .navis-result-row.active { background: #0696d7 !important; }
            .navis-result-row.active td { color: white !important; }

            /* Result Status & Styles */
            .clash-status-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; margin-right: 8px; background: #ff4d4d; }
            .navis-status-select { background: transparent; border: none; color: #ddd; font-size: 11px; width: 100%; cursor: pointer; border-radius: 2px; }
            .navis-status-select:focus { background: #222; outline: none; }
            .navis-result-row.active .navis-status-select { color: white; }

            /* Clash Name & Objects Cell */
            .navis-clash-title-cell { display: flex; flex-direction: column; gap: 4px; justify-content: center; height: 100%; padding: 4px 0; }
            .clash-name-text { font-weight: 700; color: #fff; font-size: 13px; }
            .clash-objects-info { font-size: 11px; color: #aaa; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-left: 16px; font-family: 'JetBrains Mono', monospace; }
            .navis-result-row.active .clash-objects-info { color: rgba(255,255,255,0.9); }

            /* Resizable Table Header */
            .navis-res-table th { position: relative; }
            .navis-col-resizer {
                position: absolute;
                top: 0;
                right: 0;
                width: 5px;
                height: 100%;
                cursor: col-resize;
                z-index: 10;
            }
            .navis-col-resizer:hover { background: rgba(6, 150, 215, 0.5); }

            /* Right Display Settings Panel */
            .navis-group-box { border: 1px solid var(--navis-border); border-radius: 4px; padding: 10px; position: relative; margin-top: 8px; }
            .navis-group-label { position: absolute; top: -9px; left: 10px; background: var(--navis-bg-alt); padding: 0 5px; font-size: 10px; color: #888; }
            .navis-btn-toggle-group { display: flex; background: #2a2a2a; border-radius: 3px; padding: 2px; gap: 2px; }
            .navis-btn-toggle { flex: 1; border: none; background: transparent; color: #999; padding: 5px; cursor: pointer; font-size: 10px; border-radius: 2px; }
            .navis-btn-toggle.active { background: #444; color: white; box-shadow: 0 1px 3px rgba(0,0,0,0.3); }

            .navis-option-row { display: flex; align-items: center; gap: 10px; font-size: 11px; color: #bbb; margin-top: 4px; }
            .navis-color-box { width: 12px; height: 12px; border-radius: 2px; }
            .red-box { background: #ff4d4d; border: 1px solid rgba(255,255,255,0.2); }
            .blue-box { background: #4d8df1; border: 1px solid rgba(255,255,255,0.2); }
            
            #resultsList { flex: 1; overflow-y: auto; }
            .navis-empty-placeholder { padding: 40px 20px; text-align: center; color: #555; font-size: 12px; font-style: italic; }
            
            /* Top-Edge Resizer Style */
            .navis-resizer-top {
                position: absolute;
                top: 0;
                left: 0;
                width: 100%;
                height: 6px;
                cursor: ns-resize;
                z-index: 1001;
                background: transparent;
                transition: background 0.2s;
            }
            .navis-resizer-top:hover {
                background: rgba(6, 150, 215, 0.5);
            }

            .navis-select-container { display: flex; flex-direction: column; gap: 15px; height: 100%; width: 100%; padding: 15px; box-sizing: border-box; overflow-y: auto; }
            
            /* Test List Header & Area */
            .navis-test-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px; }
            .navis-test-list-area { background: #1a1a1a; border: 1px solid #444; min-height: 100px; max-height: 120px; overflow-y: auto; margin-bottom: 20px; }
            .navis-test-table { width: 100%; border-collapse: collapse; font-size: 12px; }
            .navis-test-table th { background: #333; color: #aaa; text-align: left; padding: 6px 10px; font-weight: 600; position: sticky; top: 0; }
            .navis-test-table td { padding: 6px 10px; border-bottom: 1px solid #333; color: #eee; cursor: pointer; }

            /* Modal Styles */
            .navis-modal {
                display: none;
                position: fixed;
                z-index: 10001;
                left: 0; top: 0; width: 100vw; height: 100vh;
                background-color: rgba(0,0,0,0.7);
                backdrop-filter: blur(4px);
            }
            .navis-modal-content {
                background-color: #222;
                margin: 100px auto;
                padding: 0;
                border: 1px solid #444;
                width: 450px;
                max-height: 70vh;
                border-radius: 8px;
                display: flex;
                flex-direction: column;
                box-shadow: 0 10px 40px rgba(0,0,0,0.8);
            }
            .navis-modal-header {
                padding: 15px 20px;
                border-bottom: 1px solid #333;
                display: flex;
                justify-content: space-between;
                align-items: center;
                font-weight: bold;
                color: #0696d7;
                background: #2a2a2a;
                border-radius: 8px 8px 0 0;
            }
            .navis-modal-close { cursor: pointer; font-size: 24px; color: #888; }
            .navis-modal-close:hover { color: #fff; }
            .navis-modal-search { padding: 15px 20px; border-bottom: 1px solid #333; background: #1a1a1a; }
            .navis-modal-body { padding: 5px 0; overflow-y: auto; flex: 1; }
            .browser-item {
                padding: 12px 20px;
                border-bottom: 1px solid #2a2a2a;
                cursor: pointer;
                transition: 0.2s;
            }
            .browser-item:hover { background: #333; }
            .browser-item .item-name { color: #fff; font-size: 13px; font-weight: 500; }
            .browser-item .item-path { color: #777; font-size: 11px; margin-top: 3px; font-family: monospace; }
            .browser-item .item-status { font-size: 10px; color: #0696d7; margin-top: 5px; opacity: 0.8; }
            .navis-browse-btn { cursor: pointer; padding: 4px; color: #0696d7; font-size: 16px; opacity: 0.8; transition: 0.2s; }
            .navis-browse-btn:hover { opacity: 1; transform: scale(1.1); }
            .navis-test-row { transition: 0.1s; border-bottom: 1px solid #333; }
            
            /* Loading Overlay */
            .navis-loading-overlay {
                position: fixed;
                top: 0; left: 0; width: 100vw; height: 100vh;
                background: rgba(0,0,0,0.6);
                backdrop-filter: blur(8px);
                z-index: 20000;
                display: none;
                flex-direction: column;
                justify-content: center;
                align-items: center;
                color: #fff;
            }
            .navis-spinner {
                width: 40px; height: 40px;
                border: 4px solid rgba(255,255,255,0.1);
                border-top: 4px solid #0696d7;
                border-radius: 50%;
                animation: navis-spin 1s linear infinite;
                margin-bottom: 15px;
            }
            @keyframes navis-spin {
                0% { transform: rotate(0deg); }
                100% { transform: rotate(360deg); }
            }
            .navis-loading-text { font-size: 16px; font-weight: bold; text-shadow: 0 2px 10px rgba(0,0,0,0.5); }
            .navis-test-row:hover { background: rgba(255, 255, 255, 0.05); }
            .navis-test-row.active { background: #004a87 !important; color: #fff !important; font-weight: bold; }
            .navis-test-row.active td { color: #fff !important; }
            .navis-test-row.active .editable-name { color: #fff !important; }

            .navis-btn-delete { color: #ff6b6b; cursor: pointer; font-size: 14px; transition: 0.2s; padding: 2px 6px; }
            .navis-btn-delete:hover { color: #ff0000; transform: scale(1.2); }
            .navis-test-row.active .navis-btn-delete { color: #fff; }
            .navis-test-row.active .navis-btn-delete:hover { color: #ff6b6b; }

            .navis-btn-creat { background: #0696d7; color: #fff; border: none; padding: 4px 12px; font-size: 13px; font-weight: 700; border-radius: 2px; cursor: pointer; }
            .navis-btn-creat:hover { background: #0585c0; }

            /* Selection Box Side-by-Side */
            .navis-selection-row { display: flex; gap: 20px; flex: 1; min-height: 120px; }
            .navis-selection-box { flex: 1; display: flex; flex-direction: column; background: #252525; border: 1px solid #444; padding: 10px; border-radius: 2px; overflow: hidden; box-sizing: border-box; }
            .navis-header-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
            .navis-label { font-size: 13px; color: #bbb; text-transform: uppercase; font-weight: 700; letter-spacing: 0.5px; margin-bottom: 0; }
            .navis-refresh-btn { cursor: pointer; color: #0696d7; font-size: 14px; transition: 0.2s; padding: 2px; }
            .navis-refresh-btn:hover { transform: rotate(180deg); color: #fff; }
            
            .navis-dropdown { width: 100%; background: #1a1a1a; color: #eee; border: 1px solid #444; padding: 6px 8px; border-radius: 2px; font-size: 12px; margin-bottom: 10px; box-sizing: border-box; }
            .navis-dropdown:focus { border-color: #0696d7; outline: none; }

            /* Style for the new category dropdown */
            .navis-category-sel { width: 100%; background: #111; color: #ccc; border: 1px solid #333; padding: 6px 8px; border-radius: 2px; font-size: 12px; box-sizing: border-box; }
            .navis-category-sel:focus { border-color: #0696d7; outline: none; }

            .navis-settings-container { display: flex; flex-direction: column; gap: 12px; max-width: 400px; }
            .navis-input-group { display: flex; align-items: center; gap: 12px; }
            .navis-input { background: #1a1a1a; border: 1px solid #444; color: #fff; padding: 6px 10px; border-radius: 2px; width: 100px; font-size: 12px; }
            .navis-btn-run { background: #0696d7; color: #fff; border: none; padding: 8px 24px; border-radius: 2px; font-weight: 700; font-size: 12px; cursor: pointer; align-self: flex-start; margin-top: 10px; text-transform: uppercase; }
            .navis-btn-run:hover { background: #07a6eb; }
            .navis-btn-run:disabled { background: #444; opacity: 0.6; cursor: wait; }

            .navis-results-container { height: 100%; display: flex; flex-direction: column; width: 100%; }
            .navis-results-list { flex: 1; overflow-y: auto; background: #111; border: 1px solid #333; }
            .navis-result-item { display: flex; padding: 6px 12px; border-bottom: 1px solid #222; cursor: pointer; transition: 0.1s; font-size: 12px; align-items: center; }
            .navis-result-item:hover { background: #2a2a2a; }
            .navis-result-item.active { background: #0696d7; color: #fff; border-left: 3px solid #fff; }
            
            /* Scrollbar styling */
            ::-webkit-scrollbar { width: 6px; height: 6px; }
            ::-webkit-scrollbar-track { background: #1a1a1a; }
            ::-webkit-scrollbar-thumb { background: #444; border-radius: 3px; }
            ::-webkit-scrollbar-thumb:hover { background: #555; }

            /* Grouping UI */
            .navis-results-toolbar { display: flex; gap: 10px; padding: 6px 10px; background: #222; border-bottom: 1px solid #333; align-items: center; }
            .navis-toolbar-btn { background: #333; color: #eee; border: 1px solid #444; padding: 4px 8px; border-radius: 2px; cursor: pointer; font-size: 11px; display: flex; align-items: center; gap: 4px; }
            .navis-toolbar-btn:hover { background: #444; border-color: #0696d7; }
            .navis-toolbar-btn i { font-size: 12px; }

            .navis-checkbox-col { display: none; }
            .navis-expand-toggle { cursor: pointer; display: inline-block; width: 16px; margin-right: 4px; text-align: center; transition: 0.2s; color: #888; }
            .navis-expand-toggle:hover { color: #fff; }
            .navis-group-row { background: rgba(6, 150, 215, 0.1) !important; font-weight: bold; }
            .navis-child-row td:first-child { padding-left: 10px !important; }
            .navis-res-table th, .navis-res-table td { padding: 6px 4px; border-bottom: 1px solid #222; }
            .navis-res-table { width: 100%; border-collapse: collapse; table-layout: fixed; user-select: none; }
            .navis-result-row.selected { background: #004a87 !important; color: #fff !important; }
            .navis-result-row.selected td { color: #fff !important; }
            .navis-result-row.selected .clash-objects-info { color: #ccc !important; }
        `;
            document.head.appendChild(style);

            this.content.innerHTML = `
            <div class="navis-tabs">
                <div class="navis-tab active" data-tab="select">Select</div>
                <div class="navis-tab" data-tab="results">Results</div>
                <div class="navis-tab" data-tab="settings">Settings</div>
            </div>

            <!-- Select Tab -->
            <div class="navis-tab-content active" id="tab-select">
                <div class="navis-select-container">
                    <!-- Upper Test List -->
                    <div class="navis-test-header">
                        <div class="navis-label">테스트 목록</div>
                        <div style="display: flex; gap: 8px; align-items: center;">
                            <div class="navis-refresh-btn" id="btnManualRefresh" title="Force Refresh Models" style="font-size: 16px;">🔄</div>
                            <button class="navis-btn-creat" id="btnCreateTest">Creat</button>
                        </div>
                    </div>
                    <div class="navis-test-list-area">
                        <table class="navis-test-table">
                            <thead>
                                <tr>
                                    <th style="width: 20%;">이름</th>
                                    <th style="width: 32%;">Selection A vs B</th>
                                    <th style="width: 10%;">상태</th>
                                    <th style="width: 8%; text-align: right;">간섭</th>
                                    <th style="width: 8%; text-align: right;">해결</th>
                                    <th style="width: 15%;">생성날짜</th>
                                    <th style="width: 7%;">생성자</th>
                                </tr>
                            </thead>
                            <tbody id="clashTestTableBody">
                                <!-- Dynamic Rows -->
                            </tbody>
                        </table>
                    </div>

                    <!-- Lower Selection Area -->
                    <div class="navis-selection-row">
                        <div class="navis-selection-box">
                            <div class="navis-header-row">
                                <div class="navis-label">Selection A</div>
                                <div style="display: flex; gap: 8px; align-items: center;">
                                    <div class="navis-browse-btn" id="browseModelBtnA" title="Browse Project Models">📂</div>
                                    <div class="navis-refresh-btn" id="refreshModelsBtnA" title="Refresh Model List">🔄</div>
                                </div>
                            </div>
                            <select id="modelA" class="navis-dropdown clash-model-a"></select>
                            <select id="catA" class="navis-category-sel clash-cat-a"></select>
                        </div>
                        <div class="navis-selection-box">
                            <div class="navis-header-row">
                                <div class="navis-label">Selection B</div>
                                <div style="display: flex; gap: 8px; align-items: center;">
                                    <div class="navis-browse-btn" id="browseModelBtnB" title="Browse Project Models">📂</div>
                                    <div class="navis-refresh-btn" id="refreshModelsBtnB" title="Refresh Model List">🔄</div>
                                </div>
                            </div>
                            <select id="modelB" class="navis-dropdown clash-model-b"></select>
                            <select id="catB" class="navis-category-sel clash-cat-b"></select>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Results Tab -->
            <div class="navis-tab-content" id="tab-results">
                <div class="navis-results-grid">
                    <!-- Left: Results List -->
                    <div class="navis-results-left">
                        <div class="navis-results-toolbar">
                            <div style="display: flex; gap: 4px; flex-wrap: wrap;">
                                <button class="navis-toolbar-btn" id="btnNewGroup" title="새 그룹 만들기">
                                    <i class="fas fa-folder-plus"></i> 새 그룹
                                </button>
                                <button class="navis-toolbar-btn" id="btnRenameGroup" title="그룹 이름 바꾸기">
                                    <i class="fas fa-edit"></i> 이름 변경
                                </button>
                                <button class="navis-toolbar-btn" id="btnUngroup" title="그룹 해제 (Ungroup)">
                                    <i class="fas fa-folder-minus"></i> 그룹 해제
                                </button>
                            </div>
                            <div style="flex: 1;"></div>
                            <span id="clashSelectionCount" style="font-size: 11px; color: #888;">0개 선택됨</span>
                        </div>
                        <div id="resultsList" style="flex: 1; overflow-y: auto;">
                            <div class="navis-empty-placeholder">테스트를 먼저 실행해주세요.</div>
                        </div>
                    </div>
                    <!-- Right: Display Settings -->
                    <div class="navis-results-right">
                        <div class="navis-group-box">
                            <div class="navis-group-label">강조 표시</div>
                            <div class="navis-btn-toggle-group">
                                <button class="navis-btn-toggle active" id="btnColorA"><div class="navis-color-box red-box" style="display:inline-block; vertical-align:middle; margin-right:4px;"></div>항목 1</button>
                                <button class="navis-btn-toggle active" id="btnColorB"><div class="navis-color-box blue-box" style="display:inline-block; vertical-align:middle; margin-right:4px;"></div>항목 2</button>
                            </div>
                            <div class="navis-option-row" style="margin-top:10px;">
                                <input type="checkbox" id="checkHighlightAll" checked>
                                <label for="checkHighlightAll">모든 간섭 강조</label>
                            </div>
                        </div>

                        <div class="navis-group-box">
                            <div class="navis-group-label">격리</div>
                            <div class="navis-btn-toggle-group">
                                <button class="navis-btn-toggle active" id="btnIsolationGhost">기타 항목 흐리게</button>
                                <button class="navis-btn-toggle" id="btnIsolationHide">기타 항목 숨기기</button>
                            </div>
                            <div class="navis-option-row" style="margin-top:10px;">
                                <input type="checkbox" id="checkAutoShow" checked>
                                <label for="checkAutoShow">자동 표시</label>
                            </div>
                            <div class="navis-option-row">
                                <input type="checkbox" id="checkTransparency" checked>
                                <label for="checkTransparency">투명도 흐림</label>
                            </div>
                            <div class="navis-option-row">
                                <input type="checkbox" id="checkDebugBoxes">
                                <label for="checkDebugBoxes" style="color: #0696d7; font-weight: bold;">디버그 박스(AABB) 표시</label>
                            </div>
                        </div>

                        <div class="navis-group-box">
                            <div class="navis-group-label">관측점</div>
                            <select class="navis-dropdown" style="width:100%; margin-bottom:5px; padding:4px;">
                                <option>자동 업데이트</option>
                                <option>애니메이트 전환</option>
                            </select>
                            <button class="navis-btn" id="btnFocusClash" style="width:100%; padding:5px; font-size:11px;">간섭에 초점 맞춤</button>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Settings Tab -->
            <div class="navis-tab-content" id="tab-settings">
                <div class="navis-settings-container">
                    <div style="margin-bottom: 15px;">
                        <h4 style="margin: 0 0 10px 0; color: #0696d7; font-size: 13px;">Clash Detection Logic</h4>
                        <div class="navis-option-row" style="margin-bottom: 8px;">
                            <input type="checkbox" id="checkHardOnly" checked>
                            <label for="checkHardOnly" style="font-size: 12px; color: #eee; cursor: pointer;">Hard Only (직접 간섭만)</label>
                        </div>
                        <div class="navis-option-row" style="margin-bottom: 8px;">
                            <input type="checkbox" id="checkTurboMode" checked>
                            <label for="checkTurboMode" style="font-size: 11px; color: #4ade80; cursor: pointer; font-weight: bold;">Turbo Mode (MeshBVH 공간 인덱싱)</label>
                        </div>
                        <div class="navis-option-row" style="margin-bottom: 8px;">
                            <input type="checkbox" id="checkStrictHard">
                            <label for="checkStrictHard" style="font-size: 11px; color: #888; cursor: pointer;">Strict Hard (0.1mm 이하 무시)</label>
                        </div>
                        <div class="navis-input-group">
                            <span class="navis-label" style="width: 100px; margin-bottom: 0;">Tolerance (m):</span>
                            <input type="number" id="tolerance" class="navis-input" value="0.001" step="0.001">
                        </div>
                        <p style="font-size: 11px; color: #888; margin-top: 5px;">
                            * Hard Only가 켜져 있으면, 설정된 Tolerance 이내의 근접(Clearance) 항목은 무시됩니다.
                        </p>
                    </div>
                    <button id="btnRunTest" class="navis-btn-run">Run Test</button>
                    <div id="clashStatus" style="font-size:11px; color: #0696d7; margin-top: 5px;"></div>
                </div>
            </div>
        `;

            this.container.appendChild(this.content);

            // Bind Elements
            this.modelASel = this.content.querySelector('#modelA');
            this.modelBSel = this.content.querySelector('#modelB');
            this.catAList = this.content.querySelector('#catA');
            this.catBList = this.content.querySelector('#catB');
            this.btnRun = this.content.querySelector('#btnRunTest');
            this.resultsList = this.content.querySelector('#resultsList');
            this.statusDiv = this.content.querySelector('#clashStatus');
            this.toleranceInput = this.content.querySelector('#tolerance');
            this.hardOnlyInput = this.content.querySelector('#checkHardOnly');
            this.strictHardInput = this.content.querySelector('#checkStrictHard');
            this.turboModeInput = this.content.querySelector('#checkTurboMode');
            this.testTableBody = this.content.querySelector('#clashTestTableBody');

            // Setup Tabs
            this.content.querySelectorAll('.navis-tab').forEach(tab => {
                tab.onclick = () => {
                    this.content.querySelectorAll('.navis-tab').forEach(t => t.classList.remove('active'));
                    this.content.querySelectorAll('.navis-tab-content').forEach(c => c.classList.remove('active'));
                    tab.classList.add('active');
                    this.content.querySelector(`#tab-${tab.dataset.tab}`).classList.add('active');
                };
            });

            // [Interaction] Refresh on interaction if list is empty or context changed
            [this.modelASel, this.modelBSel].forEach(sel => {
                sel.onmousedown = async () => {
                    const hubId = window.currentHubId || localStorage.getItem('aps_last_hub_id');
                    console.log('[DEBUG] Dropdown interacted. HubId:', hubId);
                    // Force a check/fill when user clicks
                    await this.permanentFill(false);
                };
                sel.onchange = () => {
                    this.syncToActiveTest();
                    this.refreshCategories(sel, sel === this.modelASel ? this.catAList : this.catBList);
                };
            });

            this.content.querySelector('#btnManualRefresh').onclick = () => this.permanentFill(true);
            this.content.querySelector('#btnCreateTest').onclick = () => this.createTest();

            const btnNewGroup = this.content.querySelector('#btnNewGroup');
            if (btnNewGroup) btnNewGroup.onclick = () => this.groupSelectedClashes();

            const btnRenameGroup = this.content.querySelector('#btnRenameGroup');
            if (btnRenameGroup) btnRenameGroup.onclick = () => this.renameSelectedGroup();

            const btnUngroup = this.content.querySelector('#btnUngroup');
            if (btnUngroup) btnUngroup.onclick = () => this.ungroupSelected();

            const refreshA = this.content.querySelector('#refreshModelsBtnA');
            const refreshB = this.content.querySelector('#refreshModelsBtnB');
            if (refreshA) refreshA.onclick = () => this.permanentFill(true);
            if (refreshB) refreshB.onclick = () => this.permanentFill(true);

            this.content.querySelector('#browseModelBtnA').onclick = () => this.showModelBrowser('A');
            this.content.querySelector('#browseModelBtnB').onclick = () => this.showModelBrowser('B');
            this.btnRun.onclick = () => this.runClashDetection();


            // Results Display Settings Interaction
            const btnGhost = this.content.querySelector('#btnIsolationGhost');
            const btnHide = this.content.querySelector('#btnIsolationHide');

            btnGhost.onclick = () => {
                btnGhost.classList.add('active');
                btnHide.classList.remove('active');
                const active = this.resultsList.querySelector('.navis-result-row.active');
                if (active) active.click();
            };

            btnHide.onclick = () => {
                btnHide.classList.add('active');
                btnGhost.classList.remove('active');
                const active = this.resultsList.querySelector('.navis-result-row.active');
                if (active) active.click();
            };

            const btnFocus = this.content.querySelector('#btnFocusClash');
            btnFocus.onclick = () => {
                const activeRow = this.resultsList.querySelector('.navis-result-row.active');
                if (activeRow) {
                    const index = Array.from(this.resultsList.querySelectorAll('.navis-result-row')).indexOf(activeRow);
                    if (index !== -1) this.zoomToClash(this.clashResults[index]);
                }
            };

            // Global table resizing logic
            this._isResizingCol = false;
            this._resizingTh = null;
            this._resizingStartX = 0;
            this._resizingStartWidth = 0;

            window.addEventListener('mousemove', (e) => {
                if (!this._isResizingCol || !this._resizingTh) return;
                const diff = e.clientX - this._resizingStartX;
                this._resizingTh.style.width = `${this._resizingStartWidth + diff}px`;
            });

            window.addEventListener('mouseup', () => {
                this._isResizingCol = false;
                this._resizingTh = null;
            });

            // Initial Test creation moved to constructor after this.viewer is ready

            // Setup Visual Quality
            if (this.viewer) {
                this.viewer.prefs.set('antiAliasing', true);
                this.viewer.prefs.set('progressiveRendering', false); // Keep high quality on idle
                this.viewer.setQualityLevel(true, true);
            }

            console.log('[DEBUG] NavisClashPanel initialization completed successfully');
        } catch (err) {
            console.error('[DEBUG] Fatal error during NavisClashPanel.initialize():', err);
        }
    }

    createTest(name) {
        const viewer = this.viewer || (typeof NOP_VIEWER !== 'undefined' ? NOP_VIEWER : null);
        if (!viewer) return;
        const now = new Date();
        const dateStr = now.toISOString().split('T')[0];
        const models = viewer.getAllModels();
        const test = {
            id: Date.now(),
            name: name || `테스트 ${this.clashTests.length + 1}`,
            status: '미실행',
            clashCount: 0,
            resolvedCount: 0,
            createdAt: dateStr,
            createdBy: 'Manager',
            modelA: models.find(m => m.id == this.modelASel?.value) || null,
            catA: '',
            modelB: models.find(m => m.id == this.modelBSel?.value) || null,
            catB: '',
            dispA: this.modelASel?.options[this.modelASel.selectedIndex]?.text.replace(/^[✅☁️]\s*/, '') || 'None',
            dispB: this.modelBSel?.options[this.modelBSel.selectedIndex]?.text.replace(/^[✅☁️]\s*/, '') || 'None'
        };
        this.clashTests.push(test);
        this.renderTestList();
        this.selectTest(test.id);
    }

    selectTest(id) {
        const viewer = this.viewer || (typeof NOP_VIEWER !== 'undefined' ? NOP_VIEWER : null);
        if (!viewer) return;
        this.activeTestId = id;
        const test = this.clashTests.find(t => t.id === id);
        if (!test) return;

        // Re-link model objects if they are just IDs from storage
        const models = viewer.getAllModels();
        if (test.modelA && !test.modelA.getAllModels) { // Check if it's a proxy object
            test.modelA = models.find(m => m.id == test.modelA.id) || null;
        }
        if (test.modelB && !test.modelB.getAllModels) {
            test.modelB = models.find(m => m.id == test.modelB.id) || null;
        }

        // Restore Results
        if (test.results) {
            this.clashResults = test.results.map(r => this._restoreClashItem(r, models));
            this.renderResults(); // Show them immediately
        } else {
            this.clashResults = [];
            this.renderResults();
        }

        // Update UI to match test settings
        if (this.modelASel) {
            if (test.modelA) this.modelASel.value = test.modelA.id;
            else if (test.unloadedUrnA) this.modelASel.value = test.unloadedUrnA;
        }
        if (this.modelBSel) {
            if (test.modelB) this.modelBSel.value = test.modelB.id;
            else if (test.unloadedUrnB) this.modelBSel.value = test.unloadedUrnB;
        }

        // Force category refresh and then set value
        Promise.all([
            this.refreshCategories(this.modelASel, this.catAList),
            this.refreshCategories(this.modelBSel, this.catBList)
        ]).then(() => {
            if (this.catAList) this.catAList.value = test.catA;
            if (this.catBList) this.catBList.value = test.catB;
        });

        this.renderTestList();
    }

    syncToActiveTest() {
        if (!this.activeTestId) return;
        const viewer = this.viewer || (typeof NOP_VIEWER !== 'undefined' ? NOP_VIEWER : null);
        if (!viewer) return;
        const test = this.clashTests.find(t => t.id === this.activeTestId);
        if (!test) return;

        const valA = this.modelASel.value;
        const valB = this.modelBSel.value;
        const models = viewer.getAllModels();

        test.modelA = models.find(m => m.id == valA) || null;
        test.unloadedUrnA = test.modelA ? null : valA;
        test.catA = this.catAList.value;

        test.modelB = models.find(m => m.id == valB) || null;
        test.unloadedUrnB = test.modelB ? null : valB;
        test.catB = this.catBList.value;

        // Store display names for the test list table
        test.dispA = this.modelASel.options[this.modelASel.selectedIndex]?.text.replace(/^[✅☁️]\s*/, '') || 'None';
        test.dispB = this.modelBSel.options[this.modelBSel.selectedIndex]?.text.replace(/^[✅☁️]\s*/, '') || 'None';

        this.saveTests();
        this.renderTestList(); // Update the table immediately
    }

    _sanitizeClashItem(item) {
        if (!item) return null;
        const sanitized = {
            id: item.id,
            name: item.name,
            status: item.status || 'New',
            idA: item.idA,
            idB: item.idB,
            modelAId: item.modelA ? item.modelA.id : (item.modelAId || null),
            modelBId: item.modelB ? item.modelB.id : (item.modelBId || null),
            point: item.point ? { x: item.point.x, y: item.point.y, z: item.point.z } : null,
            dateStr: item.dateStr,
            type: item.type,
            expanded: item.expanded,
            distance: item.distance,
            isHard: item.isHard
        };
        if (item.children && Array.isArray(item.children)) {
            sanitized.children = item.children.map(child => this._sanitizeClashItem(child));
        }
        return sanitized;
    }

    _restoreClashItem(item, models) {
        if (!item) return null;
        const restored = {
            ...item,
            modelA: models.find(m => m.id == (item.modelAId || (item.modelA?.id || item.model1?.id))) || null,
            modelB: models.find(m => m.id == (item.modelBId || (item.modelB?.id || item.model2?.id))) || null,
            point: (item.point && typeof item.point === 'object' && 'x' in item.point)
                ? new THREE.Vector3(item.point.x, item.point.y, item.point.z)
                : item.point
        };
        // Defensive point restoration
        if (restored.point && typeof restored.point === 'object' && !(restored.point instanceof THREE.Vector3)) {
            restored.point = new THREE.Vector3(restored.point.x || 0, restored.point.y || 0, restored.point.z || 0);
        }
        if (restored.children && Array.isArray(restored.children)) {
            restored.children = restored.children.map(child => this._restoreClashItem(child, models));
        }
        return restored;
    }

    saveTests() {
        if (!this.clashTests) return;

        // Use setTimeout to avoid blocking the main thread during heavy JSON stringification
        setTimeout(() => {
            try {
                const dataToSave = this.clashTests.map(t => ({
                    id: t.id,
                    name: t.name,
                    status: t.status,
                    clashCount: t.clashCount,
                    resolvedCount: t.resolvedCount,
                    createdAt: t.createdAt,
                    createdBy: t.createdBy,
                    modelAId: t.modelA ? t.modelA.id : (t.modelAId || null),
                    modelBId: t.modelB ? t.modelB.id : (t.modelBId || null),
                    catA: t.catA,
                    catB: t.catB,
                    dispA: t.dispA,
                    dispB: t.dispB,
                    unloadedUrnA: t.unloadedUrnA,
                    unloadedUrnB: t.unloadedUrnB,
                    results: t.results ? t.results.map(r => this._sanitizeClashItem(r)) : []
                }));

                const jsonString = JSON.stringify(dataToSave);
                localStorage.setItem('navis_clash_tests', jsonString);
                console.log('[DEBUG] Tests saved to localStorage (Async/Sanitized)');
            } catch (err) {
                console.error('[DEBUG] Fatal error during saveTests:', err);
            }
        }, 0);
    }

    loadTests() {
        const saved = localStorage.getItem('navis_clash_tests');
        if (saved) {
            try {
                this.clashTests = JSON.parse(saved);
                this.renderTestList();
                console.log('[DEBUG] Tests loaded from localStorage:', this.clashTests.length);
            } catch (e) {
                console.error('[DEBUG] Error loading tests:', e);
                this.clashTests = [];
            }
        }
    }

    renderTestList() {
        if (!this.testTableBody) return;
        this.testTableBody.innerHTML = '';
        this.clashTests.forEach(test => {
            const row = document.createElement('tr');
            row.className = `navis-test-row ${test.id === this.activeTestId ? 'active' : ''}`;
            row.innerHTML = `
                <td class="editable-name" style="color: #0696d7; font-weight: bold; cursor: text;">${test.name}</td>
                <td style="font-size: 11px; color: #aaa;">
                    <span style="color: #eee;">${test.dispA || 'None'}</span> 
                    <span style="color: #0696d7;">VS</span> 
                    <span style="color: #eee;">${test.dispB || 'None'}</span>
                </td>
                <td>${test.status}</td>
                <td style="text-align: right;">${test.clashCount}</td>
                <td style="text-align: right; color: #4ade80;">${test.resolvedCount}</td>
                <td>${test.createdAt}</td>
                <td>${test.createdBy}</td>
                <td style="text-align: center;"><span class="navis-btn-delete" title="Delete Test">🗑️</span></td>
            `;

            // Selection logic
            row.onclick = (e) => {
                if (e.target.classList.contains('navis-btn-delete')) {
                    this.deleteTest(test.id);
                } else if (!e.target.classList.contains('editable-name')) {
                    this.selectTest(test.id);
                }
            };

            // Inline renaming logic
            const nameCell = row.querySelector('.editable-name');
            nameCell.ondblclick = (e) => {
                e.stopPropagation();
                const currentName = test.name;
                const input = document.createElement('input');
                input.type = 'text';
                input.value = currentName;
                input.style.width = '100%';
                input.style.background = '#333';
                input.style.color = '#fff';
                input.style.border = '1px solid #0696d7';

                input.onblur = () => {
                    const newName = input.value.trim() || currentName;
                    test.name = newName;
                    this.saveTests();
                    this.renderTestList();
                };
                input.onkeydown = (ev) => {
                    if (ev.key === 'Enter') input.blur();
                    if (ev.key === 'Escape') { input.value = currentName; input.blur(); }
                };

                nameCell.innerHTML = '';
                nameCell.appendChild(input);
                input.focus();
                input.select();
            };

            this.testTableBody.appendChild(row);
        });
    }

    deleteTest(id) {
        if (confirm('정말로 이 테스트를 삭제하시겠습니까?')) {
            this.clashTests = this.clashTests.filter(t => t.id !== id);
            if (this.activeTestId === id) {
                this.activeTestId = this.clashTests.length > 0 ? this.clashTests[0].id : null;
            }
            this.saveTests();
            this.renderTestList();
            if (this.activeTestId) {
                this.selectTest(this.activeTestId);
            }
        }
    }

    setVisible(show) {
        super.setVisible(show);
        if (show) {
            this.permanentFill();
        }
    }

    async permanentFill(force = false) {
        const viewer = window.NOP_VIEWER || (window.app && window.app.viewer) || this.viewer;
        if (!viewer) {
            console.error('[FAILURE] Viewer not found for permanentFill');
            return;
        }

        const selects = document.querySelectorAll('.clash-model-a, .clash-model-b');
        let needsFill = false;
        selects.forEach(sel => {
            if (force || sel.options.length <= 1) needsFill = true;
        });

        if (needsFill) {
            await this.updateModelLists();
        }
    }

    getModelName(model) {
        if (!model) return 'Unknown Model';
        const docNode = model.getDocumentNode();
        return docNode?.data?.name ||
            model.getData()?.loadOptions?.bubbleNode?.name() ||
            model.getData()?.url?.split('/').pop() ||
            `Model ${model.id}`;
    }

    async fetchProjectModels(forceRefresh = false) {
        const hubId = window.currentHubId || localStorage.getItem('aps_last_hub_id');
        const projectId = window.currentProjectId || localStorage.getItem('aps_last_project_id');

        if (!hubId || !projectId) return [];

        const cacheKey = `clash_models_${hubId}_${projectId}`;
        const cachedStr = localStorage.getItem(cacheKey);

        // 1. Optimistic Return: If cache exists and not forced, return it but refresh in background
        if (cachedStr && !forceRefresh && !this._isScanning) {
            try {
                const cached = JSON.parse(cachedStr);
                // Disable automatic background refresh to prevent unexpected load
                /*
                if (Date.now() - (cached.timestamp || 0) > 300000) {
                    console.log('[DEBUG] Cache old. Starting background refresh.');
                    this.fetchProjectModels(true).then(() => {
                        this.updateModelLists();
                    });
                }
                */
                this._projectModelsCache = { key: `cache_${hubId}_${projectId}`, data: cached.data };
                return cached.data;
            } catch (e) {
                localStorage.removeItem(cacheKey);
            }
        }

        if (this._isScanning) return this._projectModelsCache?.data || [];
        this._isScanning = true;

        const allModels = [];
        const urnSet = new Set();
        const processedFolders = new Set();
        const MAX_CONCURRENCY = 1; // STRICT SEQUENTIAL to avoid circuit breaker

        const scanFoldersConcurrent = async (foldersToScan) => {
            const results = [];
            for (let i = 0; i < foldersToScan.length; i += MAX_CONCURRENCY) {
                const chunk = foldersToScan.slice(i, i + MAX_CONCURRENCY);
                // Process current chunk in parallel - but don't fail entire batch if one fails
                const batchResults = await Promise.allSettled(chunk.map(f => scanFolder(f.id, f.depth, f.name)));

                // Increase delay between batches to 500ms to allow circuit breaker to recover
                await new Promise(r => setTimeout(r, 500));
            }
            return results;
        };

        const scanFolder = async (folderId = null, depth = 0, currentPath = '') => {
            if (depth > 6) return;

            const url = `/api/hubs/${hubId}/projects/${projectId}/contents` + (folderId ? `?folder_id=${folderId}` : '');
            try {
                const resp = await fetch(url);
                if (resp.status === 429 || resp.status === 500) {
                    console.warn(`[DEBUG] Rate limit or Server Error (${resp.status}) at folder ${folderId}. Skipping sub-tree.`);
                    return;
                }
                if (!resp.ok) return;
                const data = await resp.json();

                const subFolders = [];
                for (const item of data) {
                    if (item.folder) {
                        if (!processedFolders.has(item.id)) {
                            processedFolders.add(item.id);
                            subFolders.push({ id: item.id, depth: depth + 1, name: item.name });
                        }
                    } else {
                        const name = item.name.toLowerCase();
                        if (name.endsWith('.rvt') || name.endsWith('.nwd') || name.endsWith('.nwc')) {
                            const urn = item.urn || item.id;
                            if (!urnSet.has(urn)) {
                                urnSet.add(urn);
                                allModels.push({ id: urn, name: item.name, folderName: currentPath, isLoaded: false });
                            }
                        }
                    }
                }

                if (subFolders.length > 0) {
                    await scanFoldersConcurrent(subFolders);
                }
            } catch (e) {
                console.warn('[DEBUG] Folder scan error:', e);
            }
        };

        console.log('[DEBUG] Controlled Parallel Model Discovery started.');
        await scanFolder();

        // Append currently loaded models to check for new ones
        if (this.viewer) {
            this.viewer.getAllModels().forEach(m => {
                const urn = m.getData()?.urn || m.getDocumentNode()?.data?.urn;
                if (urn && !urnSet.has(urn)) {
                    urnSet.add(urn);
                    allModels.push({ id: urn, name: this.getModelName(m), folderName: 'Loaded', isLoaded: true });
                }
            });
        }

        console.log(`[DEBUG] Parallel Discovery finished. Found ${allModels.length} models.`);

        // 3. Save to localStorage
        try {
            localStorage.setItem(cacheKey, JSON.stringify({
                timestamp: Date.now(),
                data: allModels
            }));
        } catch (e) {
            console.warn('[DEBUG] Failed to save model cache:', e);
        }

        this._projectModelsCache = { key: `cache_${hubId}_${projectId}`, data: allModels };
        this._isScanning = false;
        return allModels;
    }

    async updateModelLists(force = false) {
        const viewer = this.viewer || (typeof NOP_VIEWER !== 'undefined' ? NOP_VIEWER : null);
        if (!viewer) return;

        // 1. Show Searching/Refreshing State
        [this.modelASel, this.modelBSel].forEach(sel => {
            if (sel.options.length <= 1) {
                sel.innerHTML = this._projectModelsCache ? '<option value="">Refreshing models...</option>' : '<option value="">Searching project models...</option>';
            }
        });

        // Perform Discovery with potential force refresh
        const projectModels = await this.fetchProjectModels(force);

        // 2. Get currently loaded models
        const models = viewer.getAllModels();
        const loadedData = models.map(m => {
            let name = this.getModelName(m);
            const parentFolderName = m.getData()?.loadOptions?.bubbleNode?.parent?.name() || '';
            const urn = m.getData()?.urn || m.getDocumentNode()?.data?.urn || m.id;

            if (typeof name === 'string') {
                name = name.replace(/\{3D\}/g, '').replace(/\[3D\]/g, '').replace(/\.rvt$/i, '').replace(/\.nwd$/i, '').trim();
            }
            if (!name || name === "{3D}") name = `Model ${m.id}`;
            return { id: m.id, urn: urn, name: name, folderName: parentFolderName, isLoaded: true };
        });

        const mergedList = [...loadedData];
        const seenUrns = new Set(loadedData.map(l => l.urn));

        projectModels.forEach(pm => {
            if (!seenUrns.has(pm.id)) {
                seenUrns.add(pm.id);
                mergedList.push({
                    id: pm.id,
                    name: pm.name.replace(/\.rvt$/i, '').replace(/\.nwd$/i, '').trim(),
                    folderName: pm.folderName,
                    isLoaded: false
                });
            }
        });

        // 4. Resolve Name Collisions
        const nameCounts = {};
        mergedList.forEach(m => nameCounts[m.name] = (nameCounts[m.name] || 0) + 1);
        mergedList.forEach(m => {
            m.displayName = (nameCounts[m.name] > 1 && m.folderName) ? `[${m.folderName}] ${m.name}` : m.name;
        });

        // 5. Populate
        [this.modelASel, this.modelBSel].forEach((sel, i) => {
            if (!sel) return;
            const currentVal = sel.value;
            sel.innerHTML = '';

            if (mergedList.length === 0) {
                sel.add(new Option('-- No Models Found --', ''));
                return;
            }

            mergedList.forEach((mItem) => {
                const prefix = mItem.isLoaded ? '✅' : '☁️';
                const opt = new Option(`${prefix} ${mItem.displayName}`, mItem.id);
                if (!mItem.isLoaded) opt.style.color = '#888';
                sel.add(opt);
            });

            if (currentVal && Array.from(sel.options).some(o => o.value == currentVal)) {
                sel.value = currentVal;
            } else if (!currentVal && i === 1 && mergedList.length > 1) {
                sel.selectedIndex = 1;
            }
        });

        // 6. Sync categories
        if (this.activeTestId) {
            const test = this.clashTests.find(t => t.id === this.activeTestId);
            if (test) {
                if (test.modelA && this.modelASel) this.modelASel.value = test.modelA.id;
                else if (test.unloadedUrnA && this.modelASel) this.modelASel.value = test.unloadedUrnA;

                if (test.modelB && this.modelBSel) this.modelBSel.value = test.modelB.id;
                else if (test.unloadedUrnB && this.modelBSel) this.modelBSel.value = test.unloadedUrnB;
            }
        }

        this.refreshCategories(this.modelASel, this.catAList);
        this.refreshCategories(this.modelBSel, this.catBList);
    }

    refreshModels() { // Redirect to updateModelLists
        this.updateModelLists();
    }

    async refreshCategories(modelSel, catSel) {
        if (!catSel) return;
        catSel.innerHTML = '<option value="">Category (All)...</option>';

        const viewer = this.viewer || (typeof NOP_VIEWER !== 'undefined' ? NOP_VIEWER : null);
        if (!viewer || !modelSel.value) return;

        const models = viewer.getAllModels();
        const model = models.find(m => m.id == modelSel.value);
        if (!model) {
            // Model might be unloaded (cloud icon)
            catSel.innerHTML = '<option value="">Load model to see categories</option>';
            return;
        }

        const currentVal = catSel.value;
        const tree = model.getInstanceTree();
        if (!tree) return;

        const categories = new Set();
        tree.enumNodeChildren(tree.getRootId(), (id) => {
            const name = tree.getNodeName(id);
            if (name && tree.getChildCount(id) > 0) {
                categories.add(name);
            }
        }, false);

        const sortedCats = Array.from(categories).sort();
        sortedCats.forEach(name => {
            const opt = document.createElement('option');
            opt.value = name;
            opt.textContent = name;
            catSel.appendChild(opt);
        });

        if (currentVal && Array.from(catSel.options).some(o => o.value === currentVal)) {
            catSel.value = currentVal;
        }
    }

    async waitForObjectTree(model) {
        if (!model) return true;
        if (model.isObjectTreeLoaded()) return true;
        return new Promise((resolve) => {
            const onTreeCreated = (event) => {
                if (event.model === model) {
                    this.viewer.removeEventListener(Autodesk.Viewing.OBJECT_TREE_CREATED_EVENT, onTreeCreated);
                    resolve(true);
                }
            };
            this.viewer.addEventListener(Autodesk.Viewing.OBJECT_TREE_CREATED_EVENT, onTreeCreated);
            setTimeout(() => resolve(true), 10000);
        });
    }

    async waitForGeometry(model) {
        if (!model) return true;
        if (model.isLoadDone()) return true;
        return new Promise((resolve) => {
            const onLoaded = (event) => {
                if (event.model === model) {
                    this.viewer.removeEventListener(Autodesk.Viewing.GEOMETRY_LOADED_EVENT, onLoaded);
                    resolve(true);
                }
            };
            this.viewer.addEventListener(Autodesk.Viewing.GEOMETRY_LOADED_EVENT, onLoaded);
            setTimeout(() => resolve(true), 5000);
        });
    }
    async ensureModelLoaded(urnOrId, retryCount = 0) {
        const viewer = this.viewer;

        // 1. Precise Existing Model Check
        const existingModel = viewer.getAllModels().find(m => {
            const mUrn = m.getData()?.urn || m.getDocumentNode()?.data?.urn;
            // Handle both URN string matches and Model ID (numeric or string-numeric) matches
            return (mUrn && (mUrn === urnOrId || mUrn === `urn:${urnOrId}`)) ||
                (m.id == urnOrId);
        });

        if (existingModel) {
            console.log('[DEBUG] Model already exists in viewer:', urnOrId);
            return existingModel;
        }

        // If it's a numeric ID but not found in current models, it's an invalid state
        if (!isNaN(urnOrId) && !String(urnOrId).startsWith('urn:')) {
            console.error('[DEBUG] Numeric ID provided but model not found:', urnOrId);
            throw new Error(`이미 로드된 모델(ID: ${urnOrId})을 찾을 수 없습니다. 목록을 새로고침 해주세요.`);
        }

        const normalizedUrn = urnOrId.startsWith('urn:') ? urnOrId : `urn:${urnOrId}`;
        console.log(`[DEBUG] Loading model via Document.load (Attempt ${retryCount + 1}):`, normalizedUrn);

        try {
            return await new Promise((resolve, reject) => {
                Autodesk.Viewing.Document.load(normalizedUrn, async (doc) => {
                    const viewable = doc.getRoot().getDefaultGeometry();
                    if (!viewable) return reject(new Error('3D 데이터를 찾을 수 없습니다. (SVF 변환 여부 확인 필요)'));

                    // Determine Global Offset to align federated models (Revit Synchronization)
                    let loadOptions = {
                        keepCurrentModels: true,
                        applyRefPoint: true  // Maintain Revit Coordinate System
                    };

                    const currentModels = viewer.getAllModels();
                    if (currentModels.length > 0) {
                        // Inherit globalOffset from the very first model to ensure perfect overlay
                        const firstModel = currentModels[0];
                        loadOptions.globalOffset = firstModel.getData().globalOffset;
                        console.log('[DEBUG] Aligning coordinates using shared globalOffset:', loadOptions.globalOffset);
                    }

                    // Load Document Node (SVF/SVF2)
                    const model = await viewer.loadDocumentNode(doc, viewable, loadOptions);

                    const onGeometryLoaded = (event) => {
                        const eventUrn = event.model.getData()?.urn || event.model.getDocumentNode()?.data?.urn;
                        if (eventUrn === normalizedUrn || event.model.id === model.id) {
                            viewer.removeEventListener(Autodesk.Viewing.GEOMETRY_LOADED_EVENT, onGeometryLoaded);
                            console.log('[DEBUG] Geometry load successful.');
                            resolve(event.model);
                        }
                    };
                    viewer.addEventListener(Autodesk.Viewing.GEOMETRY_LOADED_EVENT, onGeometryLoaded);

                    // Safety timeout
                    setTimeout(() => {
                        viewer.removeEventListener(Autodesk.Viewing.GEOMETRY_LOADED_EVENT, onGeometryLoaded);
                        if (model) resolve(model);
                    }, 45000);

                }, (errorCode, errorMsg) => {
                    reject({ code: errorCode, message: errorMsg });
                });
            });
        } catch (err) {
            console.warn(`[DEBUG] Document load failure:`, err);
            if (retryCount === 0) {
                console.log('[DEBUG] Retrying model load...');
                const partial = viewer.getAllModels().find(m => {
                    const mUrn = m.getData()?.urn || m.getDocumentNode()?.data?.urn;
                    return mUrn === normalizedUrn;
                });
                if (partial) viewer.unloadModel(partial);
                await new Promise(r => setTimeout(r, 2000));
                return this.ensureModelLoaded(urnOrId, 1);
            }
            throw new Error(`모델 로드 실패 (${err.code}). SVF 변환 상태를 확인해주세요.`);
        }
    }

    async runClashDetection() {
        const valA = this.modelASel.value;
        const valB = this.modelBSel.value;

        if (!valA || !valB) {
            alert('Selection A와 B에 모델을 모두 선택해주세요.');
            return;
        }

        this.btnRun.disabled = true;
        this._loadingOverlay.style.display = 'flex';

        try {
            // 1. Sequential Loading: Model A then Model B
            this.statusDiv.textContent = '모델 A 확인 및 로드 중...';
            this._loadingOverlay.querySelector('.navis-loading-text').textContent = '모델 A 로드 중...';
            const modelA = await this.ensureModelLoaded(valA);

            this.statusDiv.textContent = '모델 B 확인 및 로드 중...';
            this._loadingOverlay.querySelector('.navis-loading-text').textContent = '모델 B 로드 중...';
            const modelB = await this.ensureModelLoaded(valB);

            if (!modelA || !modelB) throw new Error('모델 인스턴스를 확보하지 못했습니다.');

            this.statusDiv.textContent = '객체 데이터 준비 중...';
            await Promise.all([
                this.waitForObjectTree(modelA),
                this.waitForObjectTree(modelB),
                this.waitForGeometry(modelA),
                this.waitForGeometry(modelB)
            ]);

            // 2. Fit to View and Visual Guide
            this.statusDiv.textContent = '화면 위치 최적화 중...';
            this._loadingOverlay.querySelector('.navis-loading-text').textContent = '카메라 위치 이동 중...';

            this.viewer.clearThemingColors();
            if (this.viewer.impl.overlayScenes['clash-markers']) {
                this.viewer.impl.clearOverlay('clash-markers');
            }
            this.viewer.setGhosting(true);

            // Defensive fitToView
            try {
                const boxA = modelA.getBoundingBox();
                const boxB = modelB.getBoundingBox();
                const combinedBounds = new THREE.Box3();
                if (boxA && isFinite(boxA.min.x)) combinedBounds.union(boxA);
                if (boxB && isFinite(boxB.min.x)) combinedBounds.union(boxB);

                if (!combinedBounds.isEmpty() && isFinite(combinedBounds.min.x)) {
                    this.viewer.navigation.fitBounds(false, combinedBounds);
                }
            } catch (err) {
                console.warn('[DEBUG] fitBounds skip:', err);
            }

            await new Promise(r => setTimeout(r, 800)); // Slightly faster wait

            this.statusDiv.textContent = '간섭 연산 준비 중...';
            this._loadingOverlay.style.display = 'none';
            this.tolerance = parseFloat(this.toleranceInput.value) || 0.001;

            const selectedCatsA = this.catAList.value ? [this.catAList.value] : [];
            const selectedCatsB = this.catBList.value ? [this.catBList.value] : [];

            const idsA = await this.getIdsMultiple(modelA, selectedCatsA);
            const idsB = await this.getIdsMultiple(modelB, selectedCatsB);

            const offA = modelA.getData().globalOffset;
            const offB = modelB.getData().globalOffset;

            // Precision Check: If offsets are identical, we work in 'Offset Space'
            const shareOffset = offA && offB &&
                Math.abs(offA.x - offB.x) < 0.001 &&
                Math.abs(offA.y - offB.y) < 0.001 &&
                Math.abs(offA.z - offB.z) < 0.001;

            console.log(`[COORD DIAG] IDs: A=${idsA.length}, B=${idsB.length}, ShareOffset=${shareOffset}`);
            this.statusDiv.textContent = `객체 수집 완료: A(${idsA.length}개), B(${idsB.length}개)`;

            this._currentAlignmentOffset = shareOffset ? offA : null;
            if (this._currentAlignmentOffset) {
                console.log(`[COORD DIAG] Using SHARED OFFSET mode for better precision.`, this._currentAlignmentOffset);
            } else {
                console.log(`[COORD DIAG] Using ABSOLUTE WORLD mode (Models have different offsets).`);
            }

            // [NEW] Spatial Diagnostics: Aggregate overall bounds for A and B
            this.statusDiv.textContent = '모델 공간 영역 분석 중...';
            const candidates = await this.broadPhase(modelA, idsA, modelB, idsB);

            if (candidates.length === 0) {
                this.statusDiv.textContent = '간섭 가능한 후보군(Bounding Box)을 찾지 못했습니다. 두 모델의 좌표계를 확인해주세요.';
                console.warn('[DEBUG] No candidates found in broadPhase. Coordinates might be misaligned.');
                this.btnRun.disabled = false;
                return;
            }

            this.statusDiv.textContent = `가선정 완료: ${candidates.length}개 쌍의 정밀 연산 시작...`;
            this.clashResults = [];
            this.renderResults(); // Clear previous results UI

            // Turbo Mode Integration: Use Worker for Narrow Phase if enabled
            const turboMode = this.turboModeInput?.checked;
            if (turboMode) {
                this.statusDiv.textContent = 'Turbo Mode: Worker에 데이터 전송 중...';
                await Promise.all([
                    this.loadModelToWorker(modelA),
                    this.loadModelToWorker(modelB)
                ]);
                this.statusDiv.textContent = 'Web Worker 정밀 연산 실행 중...';
                this.clashResults = await this.narrowPhaseWorker(candidates);
            } else {
                await this.narrowPhase(candidates);
            }

            // New Way: Geometric Clustering (Navisworks Parity)
            this.clashResults = await this.clusterResults(this.clashResults, 1.5); // Cluster radius 1.5m

            this.statusDiv.textContent = `Completed! ${this.clashResults.length} unique clash sites discovered.`;
            this.renderResults(); // Final Render
            this.drawClashIcons(); // Final Icons

            const tabBtn = this.content.querySelector('[data-tab="results"]');
            if (tabBtn) tabBtn.click();

            console.log(`[DEBUG] Syncing results for activeTestId: ${this.activeTestId}`);
            if (this.activeTestId) {
                const test = this.clashTests.find(t => t.id === this.activeTestId);
                console.log(`[DEBUG] Found test object:`, test ? test.name : 'null');
                if (test) {
                    test.status = '완료';
                    test.clashCount = this.clashResults.length;
                    test.results = [...this.clashResults]; // Save Results
                    this.saveTests(); // Persist
                    this.renderTestList();
                }
            } else {
                console.warn('[DEBUG] No activeTestId found at end of clash detection');
            }

        } catch (e) {
            console.error('[DEBUG] Clash Detection Error:', e);
            alert('간섭 체크 중 오류가 발생했습니다.\n모델을 로드할 수 없거나 형상 데이터에 문제가 있을 수 있습니다.\n에러 내용: ' + (e.message || e));
            this.statusDiv.textContent = '실행 중 오류 발생.';
        } finally {
            this._loadingOverlay.style.display = 'none';
            this.btnRun.disabled = false;
        }
    }

    async getIdsMultiple(model, catNames) {
        if (!model) return [];
        return this.getLeafIds(model, catNames);
    }

    getLeafIds(model, catNames) {
        const tree = model.getInstanceTree();
        const ids = [];
        if (!tree) return ids;

        const isFragBearing = (id) => {
            let hasFrags = false;
            tree.enumNodeFragments(id, () => { hasFrags = true; }, false);
            return hasFrags;
        };

        const isCenterlineNode = (id) => {
            const name = tree.getNodeName(id);
            return name && (name.toLowerCase().includes('centerline') || name.toLowerCase().includes('중심선'));
        };

        const processNode = (id) => {
            // Proactively include ANY node bearing fragments to ensure 100% coverage
            if (isFragBearing(id)) {
                ids.push(id);
            }
        };

        if (!catNames || catNames.length === 0 || catNames.includes('All')) {
            tree.enumNodeChildren(tree.getRootId(), processNode, true);
        } else {
            const tempTargetIds = [];
            tree.enumNodeChildren(tree.getRootId(), id => {
                const name = tree.getNodeName(id);
                if (catNames.includes(name)) tempTargetIds.push(id);
            }, false);

            tempTargetIds.forEach(catId => {
                tree.enumNodeChildren(catId, processNode, true);
            });
        }
        return Array.from(new Set(ids));
    }

    async getIds(model, catName) {
        return this.getIdsMultiple(model, catName ? [catName] : []);
    }

    getGlobalMatrix(model) {
        if (!model) return new THREE.Matrix4();

        // Log offset for diagnostic
        const off = model.getData().globalOffset;
        if (off) console.log(`[DEBUG] Model Offset: (${off.x}, ${off.y}, ${off.z})`);

        // Prioritize getUnitMatrix as it is often more stable for absolute transforms
        if (typeof model.getUnitMatrix === 'function') return model.getUnitMatrix();
        if (typeof model.getModelToWorldTransform === 'function') return model.getModelToWorldTransform();
        if (typeof model.getMatrix === 'function') return model.getMatrix();
        if (typeof model.getInverseModelToWorld === 'function') {
            const inv = model.getInverseModelToWorld();
            return new THREE.Matrix4().copy(inv).invert();
        }
        return new THREE.Matrix4(); // Identity
    }

    getUnifiedBox(model, fragId, fragList) {
        const box = new THREE.Box3();

        // Strategy: Always start from Local/Original bounds to avoid double-transformation
        // getWorldBounds often already includes the globalOffset from APS, which we handle manually.
        try {
            if (typeof fragList.getOriginalBounds === 'function') {
                fragList.getOriginalBounds(fragId, box);
            } else if (typeof fragList.getBox === 'function') {
                fragList.getBox(fragId, box);
            } else {
                // Manual fallback from geometry
                const geom = fragList.getGeometry(fragId);
                if (geom) {
                    const vb = geom.vb;
                    const stride = geom.vbstsize || 3;
                    if (vb) {
                        for (let i = 0; i < vb.length; i += stride) {
                            box.expandByPoint(new THREE.Vector3(vb[i], vb[i + 1], vb[i + 2]));
                        }
                    }
                }
            }
        } catch (err) {
            console.error('[DEBUG] Bounding box extraction error:', err);
        }

        if (box.isEmpty()) return box;

        const matrix = new THREE.Matrix4();
        this.getEffectiveMatrix(model, fragId, fragList, matrix);
        box.applyMatrix4(matrix);
        return box;
    }

    getEffectiveMatrix(model, fragId, fragList, matrix) {
        // High Precision Strategy: 
        // 1. If we found a shared globalOffset, use the raw internal fragment transform (Offset Space).
        // 2. If offsets differ, we MUST use the full Absolute World matrix.

        const fragMatrix = new THREE.Matrix4();
        fragList.getAnimTransform(fragId, null, null, fragMatrix);

        if (this._currentAlignmentOffset) {
            // OFFSET SPACE: Already includes local movement but excludes global viewer offset
            matrix.copy(fragMatrix);
        } else {
            // WORLD SPACE: Combine Model-to-World (which includes its specific offset) with Fragment-Local
            const modelToWorld = this.getGlobalMatrix(model);
            matrix.copy(modelToWorld).multiply(fragMatrix);
        }
    }

    async broadPhase(modelA, idsA, modelB, idsB) {
        const candidates = [];
        const fragAId = modelA.getFragmentList();
        const fragBId = modelB.getFragmentList();
        const treeA = modelA.getInstanceTree();
        const treeB = modelB.getInstanceTree();

        if (!treeA || !treeB) {
            console.error('[DEBUG] Instance tree(s) missing during broadPhase');
            return [];
        }

        const batchSize = 1000;
        let lastUpdate = Date.now();

        // 1. Fragment Collection A
        this.statusDiv.textContent = '객체 데이터 준비 중 (A)...';
        const fragsA = [];
        for (let i = 0; i < idsA.length; i++) {
            treeA.enumNodeFragments(idsA[i], f => {
                const geom = fragAId.getGeometry(f);
                if (geom) {
                    const box = this.getUnifiedBox(modelA, f, fragAId);
                    if (!box.isEmpty()) fragsA.push({ id: idsA[i], f, box });
                }
            }, true);

            // Proactive yielding: every 50ms instead of a fixed batch
            if (Date.now() - lastUpdate > 50) {
                await new Promise(r => setTimeout(r, 0));
                lastUpdate = Date.now();
                this.statusDiv.textContent = `객체 데이터 수집 중 (A): ${Math.round((i / idsA.length) * 100)}%`;
            }
        }

        // 2. Fragment Collection B
        this.statusDiv.textContent = '객체 데이터 준비 중 (B)...';
        const fragsB = [];
        for (let i = 0; i < idsB.length; i++) {
            treeB.enumNodeFragments(idsB[i], f => {
                const geom = fragBId.getGeometry(f);
                if (geom) {
                    const box = this.getUnifiedBox(modelB, f, fragBId);
                    if (!box.isEmpty()) fragsB.push({ id: idsB[i], f, box });
                }
            }, true);

            if (Date.now() - lastUpdate > 50) {
                await new Promise(r => setTimeout(r, 0));
                lastUpdate = Date.now();
                this.statusDiv.textContent = `객체 데이터 수집 중 (B): ${Math.round((i / idsB.length) * 100)}%`;
            }
        }

        // [COORD DIAG] Log collective extents
        const fullBoxA = new THREE.Box3();
        fragsA.forEach(f => fullBoxA.union(f.box));
        const fullBoxB = new THREE.Box3();
        fragsB.forEach(f => fullBoxB.union(f.box));

        console.log(`[COORD DIAG] Selection A Extents:`, fullBoxA.min, 'to', fullBoxA.max);
        console.log(`[COORD DIAG] Selection B Extents:`, fullBoxB.min, 'to', fullBoxB.max);

        const intersection = fullBoxA.clone().intersect(fullBoxB);
        if (intersection.isEmpty()) {
            console.warn(`[COORD DIAG] ABORT: Selection A and Selection B do NOT overlap in 3D space.`);
            console.log(`- Center A:`, fullBoxA.getCenter(new THREE.Vector3()));
            console.log(`- Center B:`, fullBoxB.getCenter(new THREE.Vector3()));
            console.log(`- Distance between centers:`, fullBoxA.getCenter(new THREE.Vector3()).distanceTo(fullBoxB.getCenter(new THREE.Vector3())));
        } else {
            console.log(`[COORD DIAG] Bounding Box Intersection found. Extent:`, intersection.getSize(new THREE.Vector3()));
        }

        console.log(`[DEBUG] Collected fragments: A=${fragsA.length}, B=${fragsB.length}`);
        this.statusDiv.textContent = '공간 그리드 생성 중...';

        const gridCellSize = 5.0;
        const getGridKey = (p) => {
            const gx = Math.floor(p.x / gridCellSize);
            const gy = Math.floor(p.y / gridCellSize);
            const gz = Math.floor(p.z / gridCellSize);
            return `${gx},${gy},${gz}`;
        };

        const grid = new Map();
        for (let i = 0; i < fragsB.length; i++) {
            const fb = fragsB[i];
            const kMin = getGridKey(fb.box.min);
            const kMax = getGridKey(fb.box.max);
            const [minX, minY, minZ] = kMin.split(',').map(Number);
            const [maxX, maxY, maxZ] = kMax.split(',').map(Number);
            for (let x = minX; x <= maxX; x++) {
                for (let y = minY; y <= maxY; y++) {
                    for (let z = minZ; z <= maxZ; z++) {
                        const key = `${x},${y},${z}`;
                        if (!grid.has(key)) grid.set(key, []);
                        grid.get(key).push(fb);
                    }
                }
            }
            if (i % batchSize === 0 && Date.now() - lastUpdate > 100) {
                await new Promise(r => setTimeout(r, 0));
                lastUpdate = Date.now();
            }
        }

        const seenPairs = new Set();
        const tolBox = new THREE.Vector3(this.tolerance, this.tolerance, this.tolerance);

        this.statusDiv.textContent = 'Broad Phase 후보군 추출 중...';
        for (let i = 0; i < fragsA.length; i++) {
            const fa = fragsA[i];
            const expandedA = fa.box.clone().expandByVector(tolBox);
            const kMin = getGridKey(expandedA.min);
            const kMax = getGridKey(expandedA.max);
            const [minX, minY, minZ] = kMin.split(',').map(Number);
            const [maxX, maxY, maxZ] = kMax.split(',').map(Number);

            for (let x = minX; x <= maxX; x++) {
                for (let y = minY; y <= maxY; y++) {
                    for (let z = minZ; z <= maxZ; z++) {
                        const candidatesB = grid.get(`${x},${y},${z}`);
                        if (candidatesB) {
                            for (let fb of candidatesB) {
                                if (modelA === modelB && fa.id === fb.id) continue;
                                const pairKey = `${fa.id}:${fa.f}|${fb.id}:${fb.f}`;
                                if (seenPairs.has(pairKey)) continue;

                                if (expandedA.intersectsBox(fb.box)) {
                                    seenPairs.add(pairKey);
                                    candidates.push({
                                        id: `${fa.id}-${fa.f}:${fb.id}-${fb.f}`,
                                        modelA, idA: fa.id, fragA: fa.f,
                                        modelB, idB: fb.id, fragB: fb.f
                                    });
                                }
                            }
                        }
                    }
                }
            }
            if (Date.now() - lastUpdate > 50) {
                await new Promise(r => setTimeout(r, 0));
                lastUpdate = Date.now();
                this.statusDiv.textContent = `후보군 추출 중: ${Math.round((i / fragsA.length) * 100)}%`;
            }
        }
        console.log(`[DEBUG] Broad Phase completed. Found ${candidates.length} candidates.`);
        return candidates;
    }

    initWorker() {
        if (this.clashWorker) return;
        this.clashWorker = new Worker('/js/ClashWorker.js');
        this.workerTasks = new Map();

        this.clashWorker.onmessage = (e) => {
            const { type, batchId, results } = e.data;
            if (type === 'BATCH_RESULT' && this.workerTasks.has(batchId)) {
                this.workerTasks.get(batchId)(results);
                this.workerTasks.delete(batchId);
            }
        };
    }

    async loadModelToWorker(model) {
        if (!this.clashWorker) this.initWorker();
        const modelId = model.id || model.getUrn() || Math.random().toString();
        const fragments = [];
        const fragList = model.getFragmentList();
        const transferables = [];

        const fragCount = fragList.getCount();
        for (let fragId = 0; fragId < fragCount; fragId++) {
            const geom = fragList.getGeometry(fragId);
            if (geom && geom.vb) {
                const stride = geom.vbstsize || 3;
                const vCount = Math.floor(geom.vb.length / stride);

                // Pure XYZ extraction for worker (avoids scrambling interleaved data)
                const pureVB = new Float32Array(vCount * 3);
                for (let v = 0; v < vCount; v++) {
                    pureVB[v * 3] = geom.vb[v * stride];
                    pureVB[v * 3 + 1] = geom.vb[v * stride + 1];
                    pureVB[v * 3 + 2] = geom.vb[v * stride + 2];
                }

                const vb = pureVB.buffer;
                const ib = geom.ib ? geom.ib.slice().buffer : null;
                const ibType = (geom.ib instanceof Uint32Array) ? 'uint32' : 'uint16';

                fragments.push({ fragId, vb, ib, ibType, vbstsize: 3 });
                transferables.push(vb);
                if (ib) transferables.push(ib);
            }
        }

        this.clashWorker.postMessage({
            type: 'LOAD_MODEL',
            data: { modelId, fragments }
        }, transferables);

        return modelId;
    }

    async narrowPhaseWorker(candidates) {
        const batchSize = 500;
        const total = candidates.length;
        let results = [];
        const hardEpsilon = this.strictHardInput?.checked ? 0.0001 : 0.000001;

        for (let i = 0; i < total; i += batchSize) {
            const batch = candidates.slice(i, i + batchSize);
            const batchId = `narrow-${Date.now()}-${i}`;

            const workerCandidates = batch.map(cand => ({
                id: cand.id,
                modelAId: cand.modelA.id || cand.modelA.getUrn(),
                fragA: cand.fragA,
                modelBId: cand.modelB.id || cand.modelB.getUrn(),
                fragB: cand.fragB,
                matA: this.getEffectiveMatrixArray(cand.modelA, cand.fragA),
                matB: this.getEffectiveMatrixArray(cand.modelB, cand.fragB)
            }));

            const batchResults = await new Promise(resolve => {
                this.workerTasks.set(batchId, resolve);
                this.clashWorker.postMessage({
                    type: 'CHECK_BATCH',
                    data: { batchId, candidates: workerCandidates, hardEpsilon }
                });
            });

            // Map worker results back to candidate objects
            for (let br of batchResults) {
                const cand = batch.find(c => c.id === br.id);
                if (cand) {
                    cand.point = new THREE.Vector3().fromArray(br.point);
                    if (this._currentAlignmentOffset) cand.point.add(this._currentAlignmentOffset);
                    cand.status = 'New';
                    cand.name = `Clash ${this.clashResults.length + results.length + 1}`;
                    results.push(cand);
                }
            }

            this.statusDiv.textContent = `Turbo Mode: 정밀 연산 중... (${Math.min(i + batchSize, total)} / ${total})`;
        }
        return results;
    }

    getEffectiveMatrixArray(model, fragId) {
        const mat = new THREE.Matrix4();
        const fl = model.getFragmentList();
        this.getEffectiveMatrix(model, fragId, fl, mat);
        return mat.toArray();
    }

    async narrowPhase(candidates) {
        const total = candidates.length;
        if (total === 0) return;

        let processedCount = 0;
        let lastUpdateTime = Date.now();
        let triCheckCounter = 0;
        const batchSize = 25; // Smaller batch for more frequent model switching
        const hardEpsilon = this.strictHardInput?.checked ? 0.0001 : 0.000001;

        // Reusable pools for zero-allocation
        const pa0 = new THREE.Vector3(), pa1 = new THREE.Vector3(), pa2 = new THREE.Vector3();
        const pb0 = new THREE.Vector3(), pb1 = new THREE.Vector3(), pb2 = new THREE.Vector3();
        const matA = new THREE.Matrix4(), matB = new THREE.Matrix4();

        for (let i = 0; i < total; i += batchSize) {
            const batch = candidates.slice(i, i + batchSize);

            for (const cand of batch) {
                const flA = cand.modelA.getFragmentList();
                const flB = cand.modelB.getFragmentList();
                const gA = flA.getGeometry(cand.fragA);
                const gB = flB.getGeometry(cand.fragB);

                if (!gA || !gA.vb || !gB || !gB.vb) continue;

                this.getEffectiveMatrix(cand.modelA, cand.fragA, flA, matA);
                this.getEffectiveMatrix(cand.modelB, cand.fragB, flB, matB);

                const strideA = gA.vbstsize || 3;
                const strideB = gB.vbstsize || 3;
                const ibA = gA.ib, vbA = gA.vb;
                const ibB = gB.ib, vbB = gB.vb;
                const numTrisA = ibA ? (ibA.length / 3) : (vbA.length / (3 * strideA));
                const numTrisB = ibB ? (ibB.length / 3) : (vbB.length / (3 * strideB));

                let hit = null;
                for (let ia = 0; ia < numTrisA; ia++) {
                    // Extract Triangle A
                    if (ibA) {
                        const a = ibA[ia * 3], b = ibA[ia * 3 + 1], c = ibA[ia * 3 + 2];
                        pa0.set(vbA[a * strideA], vbA[a * strideA + 1], vbA[a * strideA + 2]).applyMatrix4(matA);
                        pa1.set(vbA[b * strideA], vbA[b * strideA + 1], vbA[b * strideA + 2]).applyMatrix4(matA);
                        pa2.set(vbA[c * strideA], vbA[c * strideA + 1], vbA[c * strideA + 2]).applyMatrix4(matA);
                    } else {
                        const start = ia * 3 * strideA;
                        pa0.set(vbA[start], vbA[start + 1], vbA[start + 2]).applyMatrix4(matA);
                        pa1.set(vbA[start + strideA], vbA[start + strideA + 1], vbA[start + strideA + 2]).applyMatrix4(matA);
                        pa2.set(vbA[start + 2 * strideA], vbA[start + 2 * strideA + 1], vbA[start + 2 * strideA + 2]).applyMatrix4(matA);
                    }

                    for (let ib = 0; ib < numTrisB; ib++) {
                        // Extract Triangle B
                        if (ibB) {
                            const a = ibB[ib * 3], b = ibB[ib * 3 + 1], c = ibB[ib * 3 + 2];
                            pb0.set(vbB[a * strideB], vbB[a * strideB + 1], vbB[a * strideB + 2]).applyMatrix4(matB);
                            pb1.set(vbB[b * strideB], vbB[b * strideB + 1], vbB[b * strideB + 2]).applyMatrix4(matB);
                            pb2.set(vbB[c * strideB], vbB[c * strideB + 1], vbB[c * strideB + 2]).applyMatrix4(matB);
                        } else {
                            const start = ib * 3 * strideB;
                            pb0.set(vbB[start], vbB[start + 1], vbB[start + 2]).applyMatrix4(matB);
                            pb1.set(vbB[start + strideB], vbB[start + strideB + 1], vbB[start + strideB + 2]).applyMatrix4(matB);
                            pb2.set(vbB[start + 2 * strideB], vbB[start + 2 * strideB + 1], vbB[start + 2 * strideB + 2]).applyMatrix4(matB);
                        }

                        triCheckCounter++;
                        if (triCheckCounter > 5000) {
                            triCheckCounter = 0;
                            if (Date.now() - lastUpdateTime > 200) {
                                await new Promise(r => setTimeout(r, 0));
                                lastUpdateTime = Date.now();
                                const percentage = Math.round((processedCount / total) * 100);
                                this.statusDiv.textContent = `정밀 연산 중... (${processedCount} / ${total}) [${percentage}%]`;
                            }
                        }

                        // AABB Pre-filter
                        if (Math.max(pa0.x, pa1.x, pa2.x) < Math.min(pb0.x, pb1.x, pb2.x) ||
                            Math.min(pa0.x, pa1.x, pa2.x) > Math.max(pb0.x, pb1.x, pb2.x) ||
                            Math.max(pa0.y, pa1.y, pa2.y) < Math.min(pb0.y, pb1.y, pb2.y) ||
                            Math.min(pa0.y, pa1.y, pa2.y) > Math.max(pb0.y, pb1.y, pb2.y) ||
                            Math.max(pa0.z, pa1.z, pa2.z) < Math.min(pb0.z, pb1.z, pb2.z) ||
                            Math.min(pa0.z, pa1.z, pa2.z) > Math.max(pb0.z, pb1.z, pb2.z)) {
                            continue;
                        }

                        if (this._trianglesIntersectSAT(pa0, pa1, pa2, pb0, pb1, pb2, hardEpsilon)) {
                            hit = { point: pa0.clone().add(pb0).multiplyScalar(0.5) };
                            break;
                        }
                    }
                    if (hit) break;
                }

                if (hit) {
                    cand.point = hit.point;
                    if (this._currentAlignmentOffset) cand.point.add(this._currentAlignmentOffset);
                    cand.status = 'New';
                    cand.name = `Clash ${this.clashResults.length + 1}`;
                    this.clashResults.push(cand);
                }
            }

            processedCount += batch.length;
            const now = Date.now();
            if (now - lastUpdateTime > 500) {
                const percentage = Math.round((processedCount / total) * 100);
                this.statusDiv.textContent = `정밀 연산 중... (${processedCount} / ${total}) [${percentage}%]`;
                lastUpdateTime = now;
                await new Promise(r => setTimeout(r, 0));
            }
        }
    }

    _trianglesIntersectSAT(a0, a1, a2, b0, b1, b2, epsilon = 0.0001) {
        // Reuse temporary vectors to avoid allocation
        if (!this._sat) {
            this._sat = {
                eA1: new THREE.Vector3(), eA2: new THREE.Vector3(), eA3: new THREE.Vector3(),
                eB1: new THREE.Vector3(), eB2: new THREE.Vector3(), eB3: new THREE.Vector3(),
                nA: new THREE.Vector3(), nB: new THREE.Vector3(),
                axes: Array.from({ length: 11 }, () => new THREE.Vector3())
            };
        }
        const s = this._sat;

        s.eA1.subVectors(a1, a0); s.eA2.subVectors(a2, a1); s.eA3.subVectors(a0, a2);
        s.eB1.subVectors(b1, b0); s.eB2.subVectors(b2, b1); s.eB3.subVectors(b0, b2);

        s.nA.crossVectors(s.eA1, s.eA2); s.nB.crossVectors(s.eB1, s.eB2);
        if (s.nA.lengthSq() < 1e-12 || s.nB.lengthSq() < 1e-12) return false;

        const triA = [a0, a1, a2]; const triB = [b0, b1, b2];

        // Populate reusable axes
        s.axes[0].copy(s.nA); s.axes[1].copy(s.nB);
        s.axes[2].crossVectors(s.eA1, s.eB1); s.axes[3].crossVectors(s.eA1, s.eB2); s.axes[4].crossVectors(s.eA1, s.eB3);
        s.axes[5].crossVectors(s.eA2, s.eB1); s.axes[6].crossVectors(s.eA2, s.eB2); s.axes[7].crossVectors(s.eA2, s.eB3);
        s.axes[8].crossVectors(s.eA3, s.eB1); s.axes[9].crossVectors(s.eA3, s.eB2); s.axes[10].crossVectors(s.eA3, s.eB3);

        for (const axis of s.axes) {
            if (axis.lengthSq() < 1e-10) continue;
            axis.normalize();

            let minA = Infinity, maxA = -Infinity;
            for (let p of triA) {
                const d = p.dot(axis);
                if (d < minA) minA = d; if (d > maxA) maxA = d;
            }
            let minB = Infinity, maxB = -Infinity;
            for (let p of triB) {
                const d = p.dot(axis);
                if (d < minB) minB = d; if (d > maxB) maxB = d;
            }
            if (maxA < minB - epsilon || maxB < minA - epsilon) return false;
        }
        return true;
    }

    async clusterResults(results, threshold = 1.5) {
        if (!results || results.length <= 1) return results;

        const clusters = [];
        const grid = new Map();
        const getCellKey = (p) => {
            const x = Math.floor(p.x / threshold);
            const y = Math.floor(p.y / threshold);
            const z = Math.floor(p.z / threshold);
            return `${x},${y},${z}`;
        };

        // Step 1: Bucket results by spatial grid
        for (let r of results) {
            const key = getCellKey(r.point);
            if (!grid.has(key)) grid.set(key, []);
            grid.get(key).push(r);
        }

        const processed = new Set();
        let lastUpdate = Date.now();

        for (let i = 0; i < results.length; i++) {
            if (processed.has(results[i])) continue;

            const currentCluster = [];
            const queue = [results[i]];
            processed.add(results[i]);

            while (queue.length > 0) {
                const r = queue.shift();
                currentCluster.push(r);

                const cx = Math.floor(r.point.x / threshold);
                const cy = Math.floor(r.point.y / threshold);
                const cz = Math.floor(r.point.z / threshold);

                for (let x = cx - 1; x <= cx + 1; x++) {
                    for (let y = cy - 1; y <= cy + 1; y++) {
                        for (let z = cz - 1; z <= cz + 1; z++) {
                            const key = `${x},${y},${z}`;
                            const cellMembers = grid.get(key);
                            if (cellMembers) {
                                for (let m of cellMembers) {
                                    if (!processed.has(m) && r.point.distanceTo(m.point) < threshold) {
                                        processed.add(m);
                                        queue.push(m);
                                    }
                                }
                            }
                        }
                    }
                }
            }
            clusters.push(currentCluster);

            // Chunking for UI responsiveness
            if (i % 500 === 0 && Date.now() - lastUpdate > 100) {
                await new Promise(r => setTimeout(r, 0));
                lastUpdate = Date.now();
                this.statusDiv.textContent = `결과 그룹화 중... (${i}/${results.length})`;
            }
        }

        // Convert clusters to single Result objects (Groups)
        return clusters.map((cluster, index) => {
            if (cluster.length === 1) {
                cluster[0].name = `Clash ${index + 1}`;
                return cluster[0];
            }

            // Create a Group result
            const main = cluster[0];
            const group = {
                id: 'clash-group-' + Date.now() + '-' + index,
                name: `Clash Group ${index + 1}`,
                status: main.status,
                type: 'group',
                children: cluster,
                modelA: main.modelA,
                idA: main.idA,
                modelB: main.modelB,
                idB: main.idB,
                point: main.point, // Use the first point as the representative
                distance: Math.min(...cluster.map(c => c.distance)),
                isHard: cluster.some(c => c.isHard)
            };

            // Calculate center of the cluster for the point
            const center = new THREE.Vector3(0, 0, 0);
            cluster.forEach(c => center.add(c.point));
            group.point = center.divideScalar(cluster.length);

            return group;
        });
    }

    isActualClash(model1, dbId1, model2, dbId2, tolerance = 0.001, strictHard = false) {
        const tree1 = model1.getInstanceTree();
        const tree2 = model2.getInstanceTree();
        if (!tree1 || !tree2) return null;

        const frags1 = [];
        tree1.enumNodeFragments(dbId1, f => frags1.push(f), true);

        const frags2 = [];
        tree2.enumNodeFragments(dbId2, f => frags2.push(f), true);

        let minDistance = Infinity;
        let isHard = false;
        let intersectionPoint = null;

        for (const f1 of frags1) {
            for (const f2 of frags2) {
                // Fragment-Level Clash (re-using the OBB -> Triangle logic)
                // We'll rename it checkClash to follow context
                const res = this.checkClash(model1, f1, model2, f2, tolerance, false, strictHard);
                if (res) {
                    if (res.isHard) isHard = true;
                    if (res.distance < minDistance) minDistance = res.distance;
                    if (!intersectionPoint) intersectionPoint = res.point;

                    // Optimization: if hard clash found and it's 0 distance, we can stop early
                    if (isHard && minDistance === 0) break;
                }
            }
            if (isHard && minDistance === 0) break;
        }

        if (minDistance <= tolerance) {
            return { distance: minDistance, isHard, point: intersectionPoint };
        }
        return null;
    }

    // Removed the old checkIntersection as isActualClash replaces it

    // Refined checkClash method: OBB Phase -> Triangle Phase
    checkClash(modelA, fragA, modelB, fragB, tolerance, hardOnly = false, strictHard = false) {
        const fragListA = modelA.getFragmentList();
        const fragListB = modelB.getFragmentList();
        const geomA = fragListA.getGeometry(fragA);
        const geomB = fragListB.getGeometry(fragB);
        if (!geomA || !geomB) return null;

        // Unified Coordinate Mapping: Get world matrices and adjust for viewer global offset
        this.getFragWorldMatrix(modelA, fragA, fragListA, this._tempMatA);
        this.getFragWorldMatrix(modelB, fragB, fragListB, this._tempMatB);

        // Perform OBB/Box check first for performance
        const boxA = this.getUnifiedBox(modelA, fragA, fragListA);
        const boxB = this.getUnifiedBox(modelB, fragB, fragListB);

        if (!boxA.expandByScalar(tolerance).intersectsBox(boxB)) {
            return null;
        }

        return this.checkTriangleMeshIntersection(
            geomA, this._tempMatA,
            geomB, this._tempMatB,
            tolerance,
            hardOnly,
            strictHard
        );
    }

    _getGeometryBoundingBox(geom) {
        const box = new THREE.Box3();
        const pos = geom.vb || (geom.attributes?.position?.array);
        const stride = geom.vbstsize || geom.attributes?.position?.itemSize || 3;
        if (!pos) return box;
        for (let i = 0; i < pos.length / stride; i++) {
            const off = i * stride;
            box.expandByPoint(this._tempVecA.set(pos[off], pos[off + 1], pos[off + 2]));
        }
        geom.boundingBox = box; // Cache it
        return box;
    }

    checkOBBIntersection(boxA, matA, boxB, matB, tolerance = 0) {
        // Oriented Bounding Box SAT: 15 axes
        // 3 from A, 3 from B, 9 crosses
        const axes = [];
        const dirA = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)];
        const dirB = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)];

        dirA.forEach(d => d.transformDirection(matA).normalize());
        dirB.forEach(d => d.transformDirection(matB).normalize());

        axes.push(...dirA, ...dirB);
        for (let a of dirA) {
            for (let b of dirB) {
                const cross = a.clone().cross(b);
                if (cross.lengthSq() > 0.000001) axes.push(cross.normalize());
            }
        }

        const getCorners = (box, mat) => {
            const corners = [];
            for (let x = 0; x < 2; x++) for (let y = 0; y < 2; y++) for (let z = 0; z < 2; z++) {
                const p = new THREE.Vector3(
                    x ? box.max.x : box.min.x,
                    y ? box.max.y : box.min.y,
                    z ? box.max.z : box.min.z
                );
                corners.push(p.applyMatrix4(mat));
            }
            return corners;
        };

        const cornersA = getCorners(boxA, matA);
        const cornersB = getCorners(boxB, matB);

        // For safety, add a tiny epsilon to the tolerance in the OBB phase to avoid premature rejection
        const obbTolerance = tolerance + 0.0001;

        for (let axis of axes) {
            let minA = Infinity, maxA = -Infinity;
            for (let p of cornersA) {
                const dot = p.dot(axis);
                minA = Math.min(minA, dot);
                maxA = Math.max(maxA, dot);
            }
            let minB = Infinity, maxB = -Infinity;
            for (let p of cornersB) {
                const dot = p.dot(axis);
                minB = Math.min(minB, dot);
                maxB = Math.max(maxB, dot);
            }
            // Clearance check with epsilon
            if (maxA < minB - obbTolerance || maxB < minA - obbTolerance) return false;
        }
        return true;
    }

    _getBVH(geom) {
        if (geom.boundsTree) return geom.boundsTree;

        // Memory-Zero: Use direct views if possible
        if (!geom.attributes?.position && geom.vb) {
            const vb = geom.vb;
            const pos = (vb instanceof Float32Array) ? vb : new Float32Array(vb.buffer || vb);
            geom.setAttribute('position', new THREE.BufferAttribute(pos, geom.vbstsize || 3));
        }
        if (!geom.index && geom.ib) {
            const ib = geom.ib;
            const idx = (ib instanceof Uint32Array || ib instanceof Uint16Array) ? ib : new Uint32Array(ib.buffer || ib);
            geom.setIndex(new THREE.BufferAttribute(idx, 1));
        }

        // Use the global MeshBVH if available
        const MeshBVH = window.MeshBVH;
        if (MeshBVH) {
            try {
                geom.boundsTree = new MeshBVH(geom);
                return geom.boundsTree;
            } catch (e) {
                console.error('[DEBUG] Failed to build BVH:', e);
                return null;
            }
        }
        return null;
    }

    checkTriangleMeshIntersection(geomA, matrixA, geomB, matrixB, tolerance, hardOnly = false, strictHard = false) {
        const bvhA = this._getBVH(geomA);
        const bvhB = this._getBVH(geomB);

        // Fallback if BVH is not available
        if (!bvhA || !bvhB) {
            return this._checkTriangleMeshIntersectionSlow(geomA, matrixA, geomB, matrixB, tolerance, hardOnly, strictHard);
        }

        // Matrix for local space B -> local space A
        // Handle both older and newer Three.js versions for inversion
        const invA = new THREE.Matrix4();
        if (typeof invA.invert === 'function') {
            invA.copy(matrixA).invert();
        } else {
            invA.getInverse(matrixA);
        }
        const matBtoA = invA.multiply(matrixB);

        let minDistance = Infinity;
        let isHard = false;
        let intersectionPoint = null;
        const hardEpsilon = strictHard ? -0.0001 : -0.000001;

        bvhA.intersectsBVH(bvhB, matBtoA, (triA, triB) => {
            // triA is local A. triB was local B but now in local A coordinate space.
            // Transform back to world space for the SAT check (which uses world-scale tolerance)
            const a0 = triA.a.clone().applyMatrix4(matrixA);
            const a1 = triA.b.clone().applyMatrix4(matrixA);
            const a2 = triA.c.clone().applyMatrix4(matrixA);

            const b0 = triB.a.clone().applyMatrix4(matrixA);
            const b1 = triB.b.clone().applyMatrix4(matrixA);
            const b2 = triB.c.clone().applyMatrix4(matrixA);

            const res = this.trianglesIntersect(a0, a1, a2, b0, b1, b2, tolerance, hardEpsilon);
            if (res) {
                if (hardOnly && !res.isHard) return false;
                if (res.isHard) isHard = true;
                if (res.distance < minDistance) minDistance = res.distance;
                if (!intersectionPoint) {
                    intersectionPoint = a0.clone().add(a1).add(a2).add(b0).add(b1).add(b2).divideScalar(6);
                }
                if (isHard && minDistance === 0) return true; // Stop early
            }
            return false;
        });

        return minDistance <= tolerance ? { distance: minDistance, isHard, point: intersectionPoint } : null;
    }

    _checkTriangleMeshIntersectionSlow(geomA, matrixA, geomB, matrixB, tolerance, hardOnly = false, strictHard = false) {
        // Optimized extraction without full Vector3 object allocation
        const trianglesA = this._extractTriangles(geomA, matrixA);
        const trianglesB = this._extractTriangles(geomB, matrixB);

        const boxA = this._tempBoxA;
        const boxB = this._tempBoxB;
        let minDistance = Infinity;
        let isHard = false;
        let intersectionPoint = null;

        const hardEpsilon = strictHard ? -0.0001 : -0.000001; // -0.1mm if strict, else -1 micron

        for (let i = 0; i < trianglesA.length; i += 9) {
            const a0 = this._tempVecA.set(trianglesA[i], trianglesA[i + 1], trianglesA[i + 2]);
            const a1 = this._tempVecB.set(trianglesA[i + 3], trianglesA[i + 4], trianglesA[i + 5]);
            const a2 = this._tempVecC.set(trianglesA[i + 6], trianglesA[i + 7], trianglesA[i + 8]);

            boxA.makeEmpty();
            boxA.expandByPoint(a0).expandByPoint(a1).expandByPoint(a2);
            if (tolerance > 0) boxA.expandByScalar(tolerance + 0.0001);

            for (let j = 0; j < trianglesB.length; j += 9) {
                const b0 = this._tempVecD.set(trianglesB[j], trianglesB[j + 1], trianglesB[j + 2]);
                const b1 = this._tempVecE.set(trianglesB[j + 3], trianglesB[j + 4], trianglesB[j + 5]);
                const b2 = this._tempVecF.set(trianglesB[j + 6], trianglesB[j + 7], trianglesB[j + 8]);

                boxB.makeEmpty();
                boxB.expandByPoint(b0).expandByPoint(b1).expandByPoint(b2);
                if (!boxA.intersectsBox(boxB)) continue;

                const res = this.trianglesIntersect(a0, a1, a2, b0, b1, b2, tolerance, hardEpsilon);
                if (res) {
                    if (hardOnly && !res.isHard) continue;
                    if (res.isHard) isHard = true;
                    if (res.distance < minDistance) minDistance = res.distance;

                    // Capture a point near the center of the first discovered clash for this frag pair
                    if (!intersectionPoint) {
                        intersectionPoint = a0.clone().add(a1).add(a2).add(b0).add(b1).add(b2).divideScalar(6);
                    }

                    if (isHard && minDistance === 0) {
                        return { distance: 0, isHard: true, point: intersectionPoint };
                    }
                }
            }
        }

        return minDistance <= tolerance ? { distance: minDistance, isHard, point: intersectionPoint } : null;
    }


    trianglesIntersect(a0, a1, a2, b0, b1, b2, tolerance, hardEpsilon = 0.000001) {
        // 1. Ultra-Precise SAT (Hard Clash)
        // We use the provided epsilon (defaulting to 1 micron) to distinguish hard clashes from close proximity
        if (this._trianglesIntersectSAT(a0, a1, a2, b0, b1, b2, hardEpsilon)) {
            return { distance: 0, isHard: true };
        }

        // 2. Distance Check (Clearance)
        if (tolerance <= 0) return null;

        const tA = this._tempTriA.set(a0, a1, a2);
        const tB = this._tempTriB.set(b0, b1, b2);
        let minDist = Infinity;

        // Vertex to Face
        const ptsA = [a0, a1, a2];
        for (let p of ptsA) {
            tB.closestPointToPoint(p, this._tempVecA);
            minDist = Math.min(minDist, p.distanceTo(this._tempVecA));
        }
        const ptsB = [b0, b1, b2];
        for (let p of ptsB) {
            tA.closestPointToPoint(p, this._tempVecA);
            minDist = Math.min(minDist, p.distanceTo(this._tempVecA));
        }

        // Edge to Edge
        const edgesA = [[a0, a1], [a1, a2], [a2, a0]];
        const edgesB = [[b0, b1], [b1, b2], [b2, b0]];
        const lA = this._tempLine;
        const lB = new THREE.Line3();

        for (let eA of edgesA) {
            lA.set(eA[0], eA[1]);
            for (let eB of edgesB) {
                lB.set(eB[0], eB[1]);
                const distSq = this.closestDistanceBetweenLinesSq(lA, lB);
                minDist = Math.min(minDist, Math.sqrt(distSq));
            }
        }

        if (minDist <= tolerance) {
            return { distance: minDist, isHard: false };
        }
        return null;
    }

    _trianglesIntersectSAT(a0, a1, a2, b0, b1, b2, epsilon = 0) {
        // Pre-calculate edges
        const edgeA1 = a1.clone().sub(a0);
        const edgeA2 = a2.clone().sub(a1);
        const edgeA3 = a0.clone().sub(a2);

        const edgeB1 = b1.clone().sub(b0);
        const edgeB2 = b2.clone().sub(b1);
        const edgeB3 = b0.clone().sub(b2);

        // Face Normals
        const normA = edgeA1.clone().cross(edgeA2);
        const normB = edgeB1.clone().cross(edgeB2);

        // Skip degenerate triangles (zero area)
        if (normA.lengthSq() < 0.000000000001 || normB.lengthSq() < 0.000000000001) return false;

        // All 11 possible separating axes
        const axes = [
            normA, normB,
            edgeA1.clone().cross(edgeB1), edgeA1.clone().cross(edgeB2), edgeA1.clone().cross(edgeB3),
            edgeA2.clone().cross(edgeB1), edgeA2.clone().cross(edgeB2), edgeA2.clone().cross(edgeB3),
            edgeA3.clone().cross(edgeB1), edgeA3.clone().cross(edgeB2), edgeA3.clone().cross(edgeB3)
        ];

        for (const axis of axes) {
            const lenSq = axis.lengthSq();
            // Stricter check for degenerate or nearly-parallel axes to avoid numerical instability
            // But if it's a face normal, we must still respect it if it's valid
            if (lenSq < 0.00000000001) continue;

            axis.normalize();

            const project = (pts) => {
                let min = Infinity, max = -Infinity;
                for (const p of pts) {
                    const dot = p.dot(axis);
                    if (dot < min) min = dot;
                    if (dot > max) max = dot;
                }
                return [min, max];
            };

            const [minA, maxA] = project([a0, a1, a2]);
            const [minB, maxB] = project([b0, b1, b2]);

            // For hard clash intersection, a gap must be Larger than epsilon
            // If epsilon is negative (strict), we require that MUCH overlap.
            if (maxA < minB - epsilon || maxB < minA - epsilon) return false;
        }
        return true;
    }

    drawDebugBoxes(clash) {
        if (!clash || !clash.modelA || !clash.modelB) return;
        const sceneName = 'clash-debug';
        if (!this.viewer.impl.overlayScenes[sceneName]) {
            this.viewer.impl.createOverlayScene(sceneName);
        }

        const boxA = this.getWorldBoundingBox(clash.modelA, clash.idA);
        const boxB = this.getWorldBoundingBox(clash.modelB, clash.idB);

        const helperA = new THREE.Box3Helper(boxA, 0x00ffff);
        const helperB = new THREE.Box3Helper(boxB, 0xff00ff);

        // Ensure debug boxes don't Z-fight or get obscured by ghosted items
        if (helperA.material) helperA.material.depthTest = false;
        if (helperB.material) helperB.material.depthTest = false;

        this.viewer.impl.addOverlay(sceneName, helperA);
        this.viewer.impl.addOverlay(sceneName, helperB);
        this.viewer.impl.invalidate(true);
    }

    closestDistanceBetweenLinesSq(l1, l2) {
        const p1 = l1.start, p2 = l1.end;
        const p3 = l2.start, p4 = l2.end;
        const v12 = p2.clone().sub(p1);
        const v34 = p4.clone().sub(p3);
        const v13 = p1.clone().sub(p3);

        const a = v12.dot(v12);
        const b = v12.dot(v34);
        const c = v34.dot(v34);
        const d = v12.dot(v13);
        const e = v34.dot(v13);
        const D = a * c - b * b;
        let sc, sN, sD = D;
        let tc, tN, tD = D;

        if (D < 0.0000001) {
            sN = 0.0; sc = 0.0; sD = 1.0;
            tN = e; tD = c;
        } else {
            sN = (b * e - c * d);
            tN = (a * e - b * d);
            if (sN < 0.0) {
                sN = 0.0;
                tN = e; tD = c;
            } else if (sN > sD) {
                sN = sD;
                tN = e + b;
                tD = c;
            }
        }

        if (tN < 0.0) {
            tN = 0.0;
            if (-d < 0.0) sN = 0.0;
            else if (-d > a) sN = sD;
            else { sN = -d; sD = a; }
        } else if (tN > tD) {
            tN = tD;
            if ((-d + b) < 0.0) sN = 0;
            else if ((-d + b) > a) sN = sD;
            else { sN = (-d + b); sD = a; }
        }

        sc = (Math.abs(sD) < 0.0000001 ? 0.0 : sN / sD);
        tc = (Math.abs(tD) < 0.0000001 ? 0.0 : tN / tD);

        // Vector math without mutating inputs/locals unnecessarily
        const pA = p1.clone().add(v12.clone().multiplyScalar(sc));
        const pB = p3.clone().add(v34.clone().multiplyScalar(tc));
        return pA.distanceToSquared(pB);
    }

    _createClashIconTexture() {
        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 128;
        const ctx = canvas.getContext('2d');

        // Draw shadow/glow
        ctx.shadowBlur = 15;
        ctx.shadowColor = 'rgba(255, 0, 0, 0.8)';

        // Circular background (Premium Red)
        const gradient = ctx.createRadialGradient(64, 64, 10, 64, 64, 60);
        gradient.addColorStop(0, '#ff3b3b');
        gradient.addColorStop(1, '#990000');

        ctx.beginPath();
        ctx.arc(64, 64, 50, 0, Math.PI * 2);
        ctx.fillStyle = gradient;
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 4;
        ctx.stroke();

        // Draw 'X' symbol
        ctx.shadowBlur = 0;
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 12;
        ctx.lineCap = 'round';

        const padding = 34;
        ctx.beginPath();
        ctx.moveTo(padding, padding);
        ctx.lineTo(128 - padding, 128 - padding);
        ctx.moveTo(128 - padding, padding);
        ctx.lineTo(padding, 128 - padding);
        ctx.stroke();

        const texture = new THREE.Texture(canvas);
        texture.needsUpdate = true;
        return texture;
    }

    drawClashIcons() {
        if (!this.viewer.impl.overlayScenes['clash-markers']) {
            this.viewer.impl.createOverlayScene('clash-markers');
        } else {
            this.viewer.impl.clearOverlay('clash-markers');
        }

        const scene = this.viewer.impl.overlayScenes['clash-markers'].scene;
        const spriteMaterial = new THREE.SpriteMaterial({
            map: this._clashIconTexture,
            color: 0xffffff,
            transparent: true,
            opacity: 0.9,
            depthTest: false,
            depthWrite: false
        });

        this.clashResults.forEach(c => {
            if (c.point) {
                const sprite = new THREE.Sprite(spriteMaterial);
                // Adjust scale based on scene size or constant pixel size
                sprite.scale.set(1.5, 1.5, 1);
                sprite.position.copy(c.point);
                scene.add(sprite);
            }
        });
        this.viewer.impl.invalidate(true);
    }

    getWorldBoundingBox(model, dbId) {
        if (!model || !dbId) return new THREE.Box3();
        const fragList = model.getFragmentList();
        const box = new THREE.Box3();
        const tree = model.getInstanceTree();
        if (!tree) return box;

        tree.enumNodeFragments(dbId, (fragId) => {
            const fragBox = new THREE.Box3();
            fragList.getWorldBounds(fragId, fragBox);
            box.union(fragBox);
        }, true);
        return box;
    }

    zoomToClash(item) {
        if (!item) return;
        const viewer = this.viewer;

        // Calculate combined Box3 from all descendants if group
        let combinedBox = new THREE.Box3();
        const collectBounds = (it) => {
            if (it.type === 'group' && it.children) {
                it.children.forEach(collectBounds);
            } else {
                const m1 = it.modelA || it.model1;
                const id1 = it.idA || it.dbId1;
                const m2 = it.modelB || it.model2;
                const id2 = it.idB || it.dbId2;
                if (m1 && id1) combinedBox.union(this.getWorldBoundingBox(m1, id1));
                if (m2 && id2) combinedBox.union(this.getWorldBoundingBox(m2, id2));
            }
        };
        collectBounds(item);

        if (combinedBox.isEmpty()) return;

        viewer.clearSelection();
        viewer.navigation.fitBounds(false, combinedBox);

        // Set pivot point
        if (item.point) {
            viewer.navigation.setPivotPoint(item.point, true, true);
        } else if (item.type === 'group' && item.children && item.children.length > 0 && item.children[0].point) {
            viewer.navigation.setPivotPoint(item.children[0].point, true, true);
        }

        this.highlightClash(item);

        // Mark as Active
        const markActive = (it) => {
            if (it.type === 'group' && it.children) {
                it.children.forEach(markActive);
            } else if (it.status === 'New') {
                it.status = 'Active';
            }
        };
        markActive(item);

        this.saveTests();
        this.renderResults();
        viewer.impl.invalidate(true, true, true);
    }

    setHighlightStyle(model, dbId, enabled, colorVec, factor = -1, units = -1) {
        if (!model || !dbId) return;
        const it = model.getInstanceTree();
        if (!it) return;

        if (!this._originalMaterials) this._originalMaterials = new Map();

        it.enumNodeFragments(dbId, (fragId) => {
            const renderProxy = this.viewer.impl.getRenderProxy(model, fragId);
            if (renderProxy && renderProxy.material) {
                if (enabled) {
                    if (!this._originalMaterials.has(fragId)) {
                        this._originalMaterials.set(fragId, {
                            polygonOffset: renderProxy.material.polygonOffset,
                            polygonOffsetFactor: renderProxy.material.polygonOffsetFactor,
                            polygonOffsetUnits: renderProxy.material.polygonOffsetUnits,
                            transparent: renderProxy.material.transparent,
                            opacity: renderProxy.material.opacity,
                            depthTest: renderProxy.material.depthTest,
                            depthWrite: renderProxy.material.depthWrite
                        });
                    }

                    renderProxy.material.polygonOffset = true;
                    renderProxy.material.polygonOffsetFactor = factor;
                    renderProxy.material.polygonOffsetUnits = units;
                    renderProxy.material.transparent = false;
                    renderProxy.material.opacity = 1.0;
                    renderProxy.material.depthTest = true;
                    renderProxy.material.depthWrite = true;

                    this.viewer.setThemingColor(dbId, colorVec, model);
                } else {
                    const orig = this._originalMaterials.get(fragId);
                    if (orig) {
                        renderProxy.material.polygonOffset = orig.polygonOffset;
                        renderProxy.material.polygonOffsetFactor = orig.polygonOffsetFactor;
                        renderProxy.material.polygonOffsetUnits = orig.polygonOffsetUnits;
                        renderProxy.material.transparent = orig.transparent;
                        renderProxy.material.opacity = orig.opacity;
                        renderProxy.material.depthTest = orig.depthTest;
                        renderProxy.material.depthWrite = orig.depthWrite;
                    }
                    this.viewer.setThemingColor(dbId, null, model);
                }
                renderProxy.material.needsUpdate = true;
            }
        }, true);
    }

    clearAllPolygonOffsets() {
        if (this._originalMaterials) {
            this._originalMaterials.forEach((orig, fragId) => {
                // Approximate model/renderProxy retrieval
                const models = this.viewer.getAllModels();
                for (const model of models) {
                    const renderProxy = this.viewer.impl.getRenderProxy(model, fragId);
                    if (renderProxy && renderProxy.material) {
                        renderProxy.material.polygonOffset = orig.polygonOffset;
                        renderProxy.material.polygonOffsetFactor = orig.polygonOffsetFactor;
                        renderProxy.material.polygonOffsetUnits = orig.polygonOffsetUnits;
                        renderProxy.material.transparent = orig.transparent;
                        renderProxy.material.opacity = orig.opacity;
                        renderProxy.material.depthTest = orig.depthTest;
                        renderProxy.material.depthWrite = orig.depthWrite;
                        renderProxy.material.needsUpdate = true;
                    }
                }
            });
            this._originalMaterials.clear();
        }
        this.viewer.clearThemingColors();
    }

    highlightClash(item) {
        if (!item) return;
        const viewer = this.viewer;

        viewer.clearThemingColors();
        this.clearAllPolygonOffsets();

        const sceneName = 'clash-debug';
        if (viewer.impl.overlayScenes[sceneName]) viewer.impl.clearOverlay(sceneName);
        else viewer.impl.createOverlayScene(sceneName);

        const allModels = viewer.getAllModels();
        const isolationTargets = new Map(); // model -> Set of dbIds

        const highlightOne = (it) => {
            if (it.type === 'group' && it.children) {
                it.children.forEach(highlightOne);
            } else {
                const m1 = it.modelA || it.model1;
                const id1 = it.idA || it.id1 || it.dbId1;
                const m2 = it.modelB || it.model2;
                const id2 = it.idB || it.id2 || it.dbId2;

                if (m1 && id1) {
                    this.setHighlightStyle(m1, id1, true, new THREE.Vector4(1, 0, 0, 1), -2.0, -2.0);
                    if (!isolationTargets.has(m1)) isolationTargets.set(m1, new Set());
                    isolationTargets.get(m1).add(id1);
                }
                if (m2 && id2) {
                    this.setHighlightStyle(m2, id2, true, new THREE.Vector4(0, 1, 0, 1), -1.0, -1.0);
                    if (!isolationTargets.has(m2)) isolationTargets.set(m2, new Set());
                    isolationTargets.get(m2).add(id2);
                }

                viewer.setEdgesVisible(true);

                if (it.point) {
                    const halo = new THREE.Mesh(
                        new THREE.SphereGeometry(0.12, 16, 16),
                        new THREE.MeshBasicMaterial({ color: 0xffff00, transparent: true, opacity: 0.6, depthTest: false })
                    );
                    halo.position.copy(it.point);
                    viewer.impl.addOverlay(sceneName, halo);
                }
            }
        };
        highlightOne(item);

        const ghostingBtn = this.content.querySelector('#btnIsolationGhost');
        const hideBtn = this.content.querySelector('#btnIsolationHide');

        // Force Ghosting if nothing active
        if (ghostingBtn && hideBtn && !ghostingBtn.classList.contains('active') && !hideBtn.classList.contains('active')) {
            ghostingBtn.classList.add('active');
        }

        const ghosting = ghostingBtn?.classList.contains('active');
        const hide = hideBtn?.classList.contains('active');

        if (hide || ghosting) {
            viewer.setGhosting(ghosting);
            // Ultra-Transparent Ghosting
            if (viewer.impl.setGhostingIntensity) {
                viewer.impl.setGhostingIntensity(0.05);
            } else if (viewer.impl.visibilityManager) {
                viewer.impl.visibilityManager.setGhostingIntensity(0.05);
            }

            allModels.forEach(m => {
                const ids = isolationTargets.has(m) ? Array.from(isolationTargets.get(m)) : [];
                viewer.isolate(ids, m);
            });
        } else {
            viewer.setGhosting(false);
            viewer.showAll();
        }
        viewer.impl.invalidate(true, true, true);
    }

    renderResults() {
        this.resultsList.innerHTML = '';
        if (!this.clashResults || this.clashResults.length === 0) {
            this.resultsList.innerHTML = '<div class="navis-empty-placeholder">테스트를 먼저 실행해주세요.</div>';
            return;
        }

        const table = document.createElement('table');
        table.className = 'navis-res-table';
        const thead = document.createElement('thead');
        thead.innerHTML = `
    < tr >
                <th style="width: 45%; padding-left: 10px;">이름 / 객체</th>
                <th style="width: 25%;">상태</th>
                <th style="width: 30%;">찾은 항목</th>
            </tr >
    `;
        table.appendChild(thead);
        const tbody = document.createElement('tbody');
        table.appendChild(tbody);

        // Helper to get flat list of currently "visible" or at least "renderable" items for range selection
        const getFlatResults = (list) => {
            const flat = [];
            const traverse = (items) => {
                items.forEach(item => {
                    flat.push(item);
                    if (item.type === 'group' && item.expanded && item.children) {
                        traverse(item.children);
                    }
                });
            };
            traverse(list);
            return flat;
        };

        const renderItem = (item, depth = 0) => {
            const row = document.createElement('tr');
            row.className = 'navis-result-row' + (item.type === 'group' ? ' navis-group-row' : ' navis-child-row');
            if (this._activeResultId === item.id) row.classList.add('active');
            if (this.selectedClashIds.has(item.id)) row.classList.add('selected');

            if (!item.status) item.status = 'New';
            if (!item.dateStr) {
                const now = new Date();
                item.dateStr = `${now.getHours()}:${now.getMinutes().toString().padStart(2, '0')} ${now.getDate()} -${now.getMonth() + 1} `;
            }

            const toggleHtml = item.type === 'group'
                ? `< span class="navis-expand-toggle" > ${item.expanded ? '▼' : '▶'}</span > `
                : '';

            row.innerHTML = `
    < td style = "padding-left: ${depth * 15 + 10}px !important;" >
        <div style="display: flex; align-items: center; overflow: hidden;">
            ${toggleHtml}
            <div class="navis-clash-title-cell" style="overflow: hidden; text-overflow: ellipsis;">
                <span class="clash-name-text">${item.name} ${item.type === 'group' ? `(${item.children.length} hits)` : ''}</span>
                ${item.type !== 'group' ? `<div class="clash-objects-info">${item.nameA || (item.idA ? 'Object ' + item.idA : 'Unknown')} ↔ ${item.nameB || (item.idB ? 'Object ' + item.idB : 'Unknown')}</div>` : ''}
            </div>
        </div>
                </td >
                <td>
                    ${item.type === 'group' ? '' : `
                        <div style="font-size: 10px; color: ${item.isHard ? '#ff4d4d' : '#ffcc00'}; font-weight: bold; margin-bottom: 2px;">
                            ${item.isHard ? 'Hard Clash' : `Clearance: ${(item.distance * 1000).toFixed(1)}mm`}
                        </div>
                    `}
                    <select class="navis-status-select" style="width: 100%; font-size: 11px; background: transparent; color: inherit; border: 1px solid #444;">
                        <option ${item.status === 'New' ? 'selected' : ''}>New</option>
                        <option ${item.status === 'Active' ? 'selected' : ''}>Active</option>
                        <option ${item.status === 'Reviewed' ? 'selected' : ''}>Reviewed</option>
                        <option ${item.status === 'Approved' ? 'selected' : ''}>Approved</option>
                        <option ${item.status === 'Resolved' ? 'selected' : ''}>Resolved</option>
                    </select>
                </td>
                <td style="font-size: 10px; color: #777; text-align: right; padding-right: 8px;">${item.dateStr}</td>
`;

            row.onclick = (e) => {
                if (e.target.classList.contains('navis-expand-toggle') || e.target.tagName === 'SELECT') return;

                const flat = getFlatResults(this.clashResults);
                const isCtrl = e.ctrlKey || e.metaKey;
                const isShift = e.shiftKey;

                if (isShift && this._anchorId) {
                    // Range selection
                    const anchorIdx = flat.findIndex(f => f.id === this._anchorId);
                    const currentIdx = flat.findIndex(f => f.id === item.id);
                    if (anchorIdx !== -1 && currentIdx !== -1) {
                        const start = Math.min(anchorIdx, currentIdx);
                        const end = Math.max(anchorIdx, currentIdx);
                        if (!isCtrl) this.selectedClashIds.clear();
                        for (let i = start; i <= end; i++) {
                            this.selectedClashIds.add(flat[i].id);
                        }
                    }
                } else if (isCtrl) {
                    // Toggle selection
                    if (this.selectedClashIds.has(item.id)) {
                        this.selectedClashIds.delete(item.id);
                    } else {
                        this.selectedClashIds.add(item.id);
                        this._anchorId = item.id;
                    }
                } else {
                    // Single selection
                    this.selectedClashIds.clear();
                    this.selectedClashIds.add(item.id);
                    this._anchorId = item.id;
                    this._activeResultId = item.id;
                    this.zoomToClash(item);
                }

                this.renderResults();
                this.updateSelectionCount();
            };

            if (item.type === 'group') {
                const toggle = row.querySelector('.navis-expand-toggle');
                toggle.onclick = (e) => {
                    item.expanded = !item.expanded;
                    this.renderResults();
                    e.stopPropagation();
                };
            }

            const statusSelect = row.querySelector('.navis-status-select');
            statusSelect.onchange = (e) => {
                this.updateItemStatus(item, statusSelect.value);
                e.stopPropagation();
            };

            tbody.appendChild(row);
            if (item.type === 'group' && item.expanded && item.children) {
                item.children.forEach(child => renderItem(child, depth + 1));
            }
        };

        this.clashResults.forEach(item => renderItem(item));
        this.resultsList.appendChild(table);
        this.updateSelectionCount();
    }

    updateItemStatus(item, newStatus) {
        item.status = newStatus;
        if (item.type === 'group' && item.children) {
            item.children.forEach(child => this.updateItemStatus(child, newStatus));
        }
        this.saveTests();
        this.renderResults();
    }

    updateSelectionCount() {
        const countSpan = this.content.querySelector('#clashSelectionCount');
        if (countSpan) countSpan.textContent = `${this.selectedClashIds.size}개 선택됨`;
    }

    groupSelectedClashes() {
        if (this.selectedClashIds.size === 0) {
            alert('그룹화할 항목을 먼저 선택해주세요.');
            return;
        }

        const groupName = prompt('새 그룹 이름을 입력하세요:', `Group ${this.clashResults.length + 1} `);
        if (!groupName) return;

        const newGroup = {
            id: 'group-' + Date.now(),
            name: groupName,
            type: 'group',
            expanded: true,
            status: 'New',
            children: []
        };

        // 1. Find the earliest index among selected items in the top-level list
        let firstIndex = -1;
        for (let i = 0; i < this.clashResults.length; i++) {
            if (this.selectedClashIds.has(this.clashResults[i].id)) {
                firstIndex = i;
                break;
            }
        }

        // 2. Extract selected items recursively, preserving their relative order
        const extractItems = (list, ids) => {
            const extracted = [];
            // We iterate forwards to find them, then remove them
            const remaining = [];
            for (let i = 0; i < list.length; i++) {
                const item = list[i];
                if (ids.has(item.id)) {
                    extracted.push(item);
                } else {
                    if (item.type === 'group' && item.children) {
                        const subExtracted = extractItems(item.children, ids);
                        if (subExtracted.length > 0) {
                            extracted.push(...subExtracted);
                        }
                    }
                    remaining.push(item);
                }
            }
            // Update the list in place (mutating for recursion)
            list.length = 0;
            list.push(...remaining);
            return extracted;
        };

        const selectedItems = extractItems(this.clashResults, this.selectedClashIds);
        if (selectedItems.length > 0) {
            newGroup.children = selectedItems;
            newGroup.status = selectedItems[0].status;
        }

        // 3. Insert group at the firstIndex (or push if not found at top level)
        if (firstIndex !== -1) {
            this.clashResults.splice(firstIndex, 0, newGroup);
        } else {
            this.clashResults.push(newGroup);
        }

        this.selectedClashIds.clear();
        this.selectedClashIds.add(newGroup.id); // Auto-select the new group
        this._activeResultId = newGroup.id;
        this._anchorId = newGroup.id;

        this.saveTests();
        this.renderResults();

        // 4. Instant visual feedback: Zoom and Highlight the new group
        this.zoomToClash(newGroup);

        // 5. Scroll to new group
        setTimeout(() => {
            const row = this.resultsList.querySelector(`.navis - result - row.selected`);
            if (row) row.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }, 100);
    }

    renameSelectedGroup() {
        if (this.selectedClashIds.size !== 1) {
            alert('이름을 바꿀 그룹 하나만 선택해주세요.');
            return;
        }
        const id = Array.from(this.selectedClashIds)[0];
        const findItem = (list, targetId) => {
            for (const item of list) {
                if (item.id === targetId) return item;
                if (item.children) {
                    const found = findItem(item.children, targetId);
                    if (found) return found;
                }
            }
            return null;
        };
        const item = findItem(this.clashResults, id);
        if (!item || item.type !== 'group') {
            alert('그룹만 이름을 바꿀 수 있습니다.');
            return;
        }
        const newName = prompt('새 이름을 입력하세요:', item.name);
        if (newName) {
            item.name = newName;
            this.saveTests();
            this.renderResults();
        }
    }

    ungroupSelected() {
        if (this.selectedClashIds.size === 0) {
            alert('해제할 그룹을 선택해주세요.');
            return;
        }

        const idsToRemove = new Set(this.selectedClashIds);
        const dissolveGroups = (list) => {
            for (let i = list.length - 1; i >= 0; i--) {
                const item = list[i];
                if (item.type === 'group' && idsToRemove.has(item.id)) {
                    // Dissolve: Put children in item's place
                    list.splice(i, 1, ...item.children);
                } else if (item.children) {
                    dissolveGroups(item.children);
                }
            }
        };

        dissolveGroups(this.clashResults);
        this.selectedClashIds.clear();
        this.saveTests();
        this.renderResults();
    }

    async showModelBrowser(target) {
        this._browserTarget = target;
        this._browserModal.style.display = 'block';
        this._browserModal.querySelector('#modelSearchInput').value = '';

        // Ensure we have models to show
        if (!this._projectModelsCache) {
            this._browserModal.querySelector('#modelBrowserList').innerHTML = '<div style="padding:20px; color:#888;">Scanning project for models, please wait...</div>';
            await this.fetchProjectModels();
        }
        this.renderBrowserList();
    }

    renderBrowserList(search = '') {
        const body = this._browserModal.querySelector('#modelBrowserList');
        if (!this._projectModelsCache) return;

        const models = this._projectModelsCache.data;
        const filtered = search ? models.filter(m =>
            m.name.toLowerCase().includes(search.toLowerCase()) ||
            m.folderName.toLowerCase().includes(search.toLowerCase())
        ) : models;

        body.innerHTML = '';
        if (filtered.length === 0) {
            body.innerHTML = '<div style="padding:20px; color:#555;">No models found matching your search.</div>';
            return;
        }

        filtered.forEach(m => {
            const item = document.createElement('div');
            item.className = 'browser-item';
            const strippedName = m.name.replace(/\.rvt$/i, '').replace(/\.nwd$/i, '').trim();
            item.innerHTML = `
    < div class="item-name" > ${strippedName}</div >
        <div class="item-path">📂 ${m.folderName || 'Project Root'}</div>
                ${m.isLoaded ? '<div class="item-status">Already Loaded</div>' : ''}
`;
            item.onclick = () => this.selectFromBrowser(m);
            body.appendChild(item);
        });
    }

    selectFromBrowser(model) {
        const sel = this._browserTarget === 'A' ? this.modelASel : this.modelBSel;
        const cat = this._browserTarget === 'A' ? this.catAList : this.catBList;

        // Add to dropdown if not present
        if (!Array.from(sel.options).some(o => o.value === model.id)) {
            const prefix = model.isLoaded ? '✅' : '☁️';
            const opt = new Option(`${prefix} [${model.folderName}] ${model.name} `, model.id);
            if (!model.isLoaded) opt.style.color = '#888';
            sel.add(opt);
        }

        sel.value = model.id;
        this._browserModal.style.display = 'none';

        // Trigger sync and category refresh
        this.syncToActiveTest();
        this.refreshCategories(sel, cat);
        this.updateModelLists(); // Sync names and icons
    }

}

console.log('Registering NavisClashExtension...');
Autodesk.Viewing.theExtensionManager.registerExtension('NavisClashExtension', NavisClashExtension);
