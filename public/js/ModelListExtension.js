/**
 * ModelListExtension.js
 * 
 * Focused Extension: Monitoring model loads and listing names in a dropdown.
 */

class ModelListExtension extends Autodesk.Viewing.Extension {
    constructor(viewer, options) {
        super(viewer, options);
        this._button = null;
        this._group = null;
        this.panel = null;
        this.onModelLoaded = this.onModelLoaded.bind(this);
    }

    load() {
        console.log('ModelListExtension loaded');
        this.viewer.addEventListener(Autodesk.Viewing.GEOMETRY_LOADED_EVENT, this.onModelLoaded);
        return true;
    }

    unload() {
        this.viewer.removeEventListener(Autodesk.Viewing.GEOMETRY_LOADED_EVENT, this.onModelLoaded);
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

        this._button = new Autodesk.Viewing.UI.Button('modelListButton');
        this._button.onClick = () => {
            if (!this.panel) {
                this.panel = new ModelListPanel(this.viewer, 'modelListPanel', 'Loaded Model List');
            }
            this.panel.setVisible(!this.panel.isVisible());
            if (this.panel.isVisible()) {
                this.refreshModelList();
            }
        };
        this._button.setToolTip('Show Model List');
        this._button.setIcon('adsk-viewing-icon-properties');
        this._group.addControl(this._button);
    }

    onModelLoaded(event) {
        console.log('Geometry Loaded Event detected');
        this.refreshModelList();
    }

    refreshModelList() {
        const models = this.viewer.getAllModels();
        const modelNames = models.map(model => {
            let name = model.getDocumentNode()?.data?.name ||
                model.getData()?.loadOptions?.bubbleNode?.name() ||
                'Model ' + model.id;

            console.log(`[CHECK] Found Model: ${name}`);
            return name;
        });

        if (this.panel) {
            this.panel.updateDropdown(modelNames);
        }
    }
}

class ModelListPanel extends Autodesk.Viewing.UI.DockingPanel {
    constructor(viewer, id, title, options) {
        super(viewer.container, id, title, options);

        this.viewer = viewer;
        this.container.style.top = '100px';
        this.container.style.right = '10px';
        this.container.style.width = '300px';
        this.container.style.height = '150px';
        this.container.style.backgroundColor = '#2c2c2c';
        this.container.style.color = '#eee';
        this.container.style.borderRadius = '8px';

        this.createUI();
    }

    createUI() {
        this.content = document.createElement('div');
        this.content.style.padding = '20px';
        this.content.style.display = 'flex';
        this.content.style.flexDirection = 'column';
        this.content.style.gap = '10px';

        const label = document.createElement('div');
        label.textContent = '현재 로드된 모델 목록:';
        label.style.fontSize = '12px';
        label.style.color = '#aaa';

        this.dropdown = document.createElement('select');
        this.dropdown.style.width = '100%';
        this.dropdown.style.padding = '8px';
        this.dropdown.style.background = '#1a1a1a';
        this.dropdown.style.color = '#fff';
        this.dropdown.style.border = '1px solid #444';
        this.dropdown.style.borderRadius = '4px';

        const placeholder = document.createElement('option');
        placeholder.textContent = '모델 로드 대기 중...';
        this.dropdown.appendChild(placeholder);

        this.content.appendChild(label);
        this.content.appendChild(this.dropdown);
        this.container.appendChild(this.content);
    }

    updateDropdown(names) {
        this.dropdown.innerHTML = '';
        if (names.length === 0) {
            const opt = document.createElement('option');
            opt.textContent = '모델 로드 대기 중...';
            this.dropdown.appendChild(opt);
        } else {
            names.forEach(name => {
                const opt = document.createElement('option');
                opt.textContent = name;
                this.dropdown.appendChild(opt);
            });
        }
    }
}

Autodesk.Viewing.theExtensionManager.registerExtension('ModelListExtension', ModelListExtension);
