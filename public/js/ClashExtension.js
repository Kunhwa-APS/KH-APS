/**
 * ClashExtension.js
 * 
 * A self-contained APS Extension using Autodesk.Viewing.UI.DockingPanel.
 * Features a failsafe 500ms refresh mechanism for reliable model data binding.
 */

class ClashExtension extends Autodesk.Viewing.Extension {
    constructor(viewer, options) {
        super(viewer, options);
        this._group = null;
        this._button = null;
        this.panel = null;
    }

    load() {
        console.log('ClashExtension loaded');
        return true;
    }

    unload() {
        if (this.panel) {
            this.panel.uninitialize();
            this.panel = null;
        }
        if (this._group) {
            this._group.removeControl(this._button);
        }
        return true;
    }

    onToolbarCreated() {
        this._group = this.viewer.getToolbar(true).getControl('customExtensionsGroup') || new Autodesk.Viewing.UI.ControlGroup('customExtensionsGroup');
        this.viewer.getToolbar(true).addControl(this._group);

        this._button = new Autodesk.Viewing.UI.Button('clashButton');
        this._button.onClick = () => {
            if (!this.panel) {
                this.panel = new ClashPanel(this.viewer, 'clashPanel', 'Clash Detection UI');
            }
            this.panel.setVisible(!this.panel.isVisible());
        };
        this._button.setToolTip('Clash Detection');
        this._button.setIcon('adsk-viewing-icon-properties');
        this._group.addControl(this._button);
    }
}

class ClashPanel extends Autodesk.Viewing.UI.DockingPanel {
    constructor(viewer, id, title, options) {
        super(viewer.container, id, title, options);

        this.viewer = viewer;
        this.container.classList.add('clash-docking-panel');

        // Panel Dimensions and Styling
        this.container.style.top = '100px';
        this.container.style.right = '10px';
        this.container.style.width = '350px';
        this.container.style.height = '400px';
        this.container.style.backgroundColor = '#1e1e1e';
        this.container.style.color = '#ffffff';
        this.container.style.borderRadius = '12px';
        this.container.style.border = '1px solid #333';
        this.container.style.boxShadow = '0 8px 32px rgba(0,0,0,0.6)';

        this.initialize();
    }

    initialize() {
        this.title = this.createTitleBar(this.titleLabel || this.container.id);
        this.container.appendChild(this.title);
        this.container.appendChild(this.createCloseButton());

        this.content = document.createElement('div');
        this.content.style.padding = '20px';
        this.content.style.display = 'flex';
        this.content.style.flexDirection = 'column';
        this.content.style.gap = '15px';

        const style = document.createElement('style');
        style.innerHTML = `
            .clash-ui-label { font-size: 11px; font-weight: 600; color: #888; text-transform: uppercase; margin-bottom: 5px; }
            .clash-ui-select { 
                width: 100%; padding: 10px; background: #2b2b2b; color: #fff; 
                border: 1px solid #444; border-radius: 6px; font-size: 13px; cursor: pointer;
                transition: border-color 0.2s;
            }
            .clash-ui-select:focus { border-color: #0696d7; outline: none; }
            .clash-ui-info { font-size: 12px; color: #0696d7; margin-top: 10px; font-style: italic; }
        `;
        document.head.appendChild(style);

        this.content.innerHTML = `
            <div>
                <div class="clash-ui-label">Model A (Source)</div>
                <select id="selectModelA" class="clash-ui-select"><option>Loading models...</option></select>
            </div>
            <div>
                <div class="clash-ui-label">Model B (Target)</div>
                <select id="selectModelB" class="clash-ui-select"><option>Loading models...</option></select>
            </div>
            <div id="panelLog" class="clash-ui-info">Ready to detect models.</div>
        `;

        this.container.appendChild(this.content);

        this.modelASel = this.content.querySelector('#selectModelA');
        this.modelBSel = this.content.querySelector('#selectModelB');
        this.logDiv = this.content.querySelector('#panelLog');
    }

    // Overriding setVisible to trigger the refresh and failsafe
    setVisible(show) {
        super.setVisible(show);
        if (show) {
            this.refreshModels();
            // Failsafe: 0.5s secondary refresh to catch late-loading model data
            setTimeout(() => {
                this.refreshModels();
            }, 500);
        }
    }

    refreshModels() {
        const models = this.viewer.getAllModels();
        const count = models.length;

        // Logging as requested
        console.log(`[PANEL] Found ${count} models.`);
        this.logDiv.textContent = `[PANEL] ${count} models detected.`;

        this.modelASel.innerHTML = '';
        this.modelBSel.innerHTML = '';

        if (count === 0) {
            const opt = document.createElement('option');
            opt.textContent = 'No models detected yet...';
            this.modelASel.appendChild(opt);
            this.modelBSel.appendChild(opt.cloneNode(true));
            return;
        }

        models.forEach((model, index) => {
            // Priority Name Extraction
            const name = (model.getDocumentNode() && model.getDocumentNode().data && model.getDocumentNode().data.name) ||
                (model.getData() && model.getData().loadOptions && model.getData().loadOptions.bubbleNode ? model.getData().loadOptions.bubbleNode.name() : null) ||
                `Model ${model.id || index + 1}`;

            const optA = document.createElement('option');
            optA.value = model.id || index;
            optA.textContent = name;
            this.modelASel.appendChild(optA);

            const optB = document.createElement('option');
            optB.value = model.id || index;
            optB.textContent = name;
            this.modelBSel.appendChild(optB);
        });

        // Smart selection: if 2 models, pick different ones
        if (count > 1) {
            this.modelBSel.selectedIndex = 1;
        }
    }
}

Autodesk.Viewing.theExtensionManager.registerExtension('ClashExtension', ClashExtension);
