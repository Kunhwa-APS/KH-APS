/* ============================================================
   viewer.js — APS Viewer (ES6 Module)
   Tutorial: hubs-browser/viewer — Viewer logic
   ============================================================ */

async function getAccessToken(callback) {
    try {
        const resp = await fetch('/api/auth/token');
        if (!resp.ok) throw new Error(await resp.text());
        const { access_token, expires_in } = await resp.json();
        callback(access_token, expires_in);
    } catch (err) {
        console.error('Could not obtain access token:', err);
    }
}

// Global initialization promise to avoid multiple calls to Autodesk.Viewing.Initializer
let _initializerPromise = null;

function ensureInitialized() {
    if (!_initializerPromise) {
        _initializerPromise = new Promise((resolve) => {
            Autodesk.Viewing.Initializer({ env: 'AutodeskProduction', getAccessToken }, () => {
                resolve();
            });
        });
    }
    return _initializerPromise;
}

export async function initViewer(container) {
    await ensureInitialized();
    const config = {
        extensions: ['Autodesk.DocumentBrowser']
    };
    const viewer = new Autodesk.Viewing.GuiViewer3D(container, config);
    viewer.start();
    viewer.setTheme('dark-theme');
    return viewer;
}

export function loadModel(viewer, urn) {
    return new Promise((resolve, reject) => {
        function onDocumentLoadSuccess(doc) {
            const viewable = doc.getRoot().getDefaultGeometry();

            // Wait for the object tree to be created before resolving
            const onTreeCreated = () => {
                viewer.removeEventListener(Autodesk.Viewing.OBJECT_TREE_CREATED_EVENT, onTreeCreated);
                console.log(`[Viewer] Object tree created for ${urn}`);
                resolve(doc);
            };
            viewer.addEventListener(Autodesk.Viewing.OBJECT_TREE_CREATED_EVENT, onTreeCreated);

            viewer.loadDocumentNode(doc, viewable);
        }
        function onDocumentLoadFailure(code, message, errors) {
            console.error('Could not load model:', message, errors);
            reject(new Error(message));
        }
        Autodesk.Viewing.Document.load('urn:' + urn, onDocumentLoadSuccess, onDocumentLoadFailure);
    });
}
