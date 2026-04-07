/* ============================================================
   sidebar.js — InspireTree based Hubs/Projects/Folders browser
   Tutorial: hubs-browser/viewer — Sidebar logic
   ============================================================ */
import { openVersionModal } from './version-manager.js';

window.findNodeById = function (nodes, id) {
    if (!nodes || (!Array.isArray(nodes) && typeof nodes[Symbol.iterator] !== 'function')) return null;

    for (let node of nodes) {
        // [ENHANCED] Search by ID, URN, or ItemID (and check partials for versioned IDs)
        const isMatch = (
            node.id === id ||
            node.urn === id ||
            (node.itemId && node.itemId === id) ||
            (typeof node.id === 'string' && node.id.includes(id))
        );

        if (isMatch) return node;

        if (node.children && (Array.isArray(node.children) || typeof node.children[Symbol.iterator] === 'function')) {
            const found = window.findNodeById(node.children, id);
            if (found) return found;
        }
    }
    return null;
};

let _treeInstance = null;
window.urnToNameMap = {}; // [NEW] Global lookup for URN -> FileName

async function getJSON(url) {
    const resp = await fetch(url);
    if (!resp.ok) {
        console.warn(`[Sidebar] Failed to load ${url}: ${resp.status}`);
        return [];
    }
    return resp.json();
}

function createTreeNode(id, text, icon, children = false, metadata = {}) {
    return { id, text, children, itree: { icon }, ...metadata };
}

async function getHubs() {
    const hubs = await getJSON('/api/hubs');
    if (!hubs || hubs.length === 0) {
        return [createTreeNode('hub|error|connection', '⚠️ Hub Loading Failed (Click to Retry)', 'icon-hub', false)];
    }
    return hubs.map(hub => createTreeNode(`hub|${hub.id}`, hub.name, 'icon-hub', true));
}

async function getProjects(hubId) {
    const projects = await getJSON(`/api/hubs/${hubId}/projects`);
    return projects.map(project =>
        createTreeNode(`project|${hubId}|${project.id}|${project.region || 'US'}`, project.name, 'icon-project', true)
    );
}

async function getContents(hubId, projectId, region, folderId = null) {
    const url = `/api/hubs/${hubId}/projects/${projectId}/contents` +
        (folderId ? `?folder_id=${folderId}` : '');
    const contents = await getJSON(url);
    return contents.map(item => {
        if (!item.folder && item.urn && item.name) {
            window.urnToNameMap[item.urn] = item.name;
        }
        if (item.folder) {
            return createTreeNode(
                `folder|${hubId}|${projectId}|${region}|${item.id}`,
                item.name,
                'icon-my-folder',
                true
            );
        } else {
            return createTreeNode(
                `item|${hubId}|${projectId}|${region}|${item.id}`,
                item.name,
                'icon-item',
                false,
                { vNumber: item.vNumber, urn: item.urn }
            );
        }
    });
}

async function getVersions(hubId, projectId, region, itemId) {
    const versions = await getJSON(
        `/api/hubs/${hubId}/projects/${projectId}/contents/${encodeURIComponent(itemId)}/versions`
    );
    return versions.map(version => {
        const vNum = (version.vNumber !== undefined && version.vNumber !== null) ? version.vNumber : '?';
        const vUrn = Buffer.from(version.id).toString('base64').replace(/=/g, '');
        const displayText = `V${vNum} - ${version.displayName || version.name}`;

        // Populate map for both full URN and base64 version
        window.urnToNameMap[vUrn] = version.displayName || version.name;
        if (version.id) window.urnToNameMap[version.id] = version.displayName || version.name;

        // version|hubId|projectId|region|urn|name|itemId
        return createTreeNode(`version|${hubId}|${projectId}|${region}|${vUrn}|${displayText}|${itemId}`, displayText, 'icon-version');
    });
}

export function initTree(selector, onSelectionChanged) {
    const tree = new InspireTree({
        data: function (node) {
            if (!node || !node.id) {
                return getHubs();
            } else {
                const tokens = node.id.split('|');
                switch (tokens[0]) {
                    case 'hub':
                        if (tokens[1] === 'error') {
                            // Manual reload if the error node is clicked
                            setTimeout(() => {
                                if (_treeInstance) _treeInstance.reload();
                            }, 100);
                            return [];
                        }
                        return getProjects(tokens[1]);
                    case 'project': return getContents(tokens[1], tokens[2], tokens[3]); // hubId, projectId, region
                    case 'folder': return getContents(tokens[1], tokens[2], tokens[3], tokens[4]); // hubId, projectId, region, folderId
                    case 'item': return getVersions(tokens[1], tokens[2], tokens[3], tokens[4]); // hubId, projectId, region, itemId
                    default: return [];
                }
            }
        }
    });

    // ── FIX: Ensure HTML is rendered as innerHTML ──
    tree.on('node.rendered', function (node) {
        const li = node.itree.ref;
        if (!li) return;
        const title = li.querySelector('.title');
        if (title && node.text.includes('<')) {
            title.innerHTML = node.text;
        }
    });

    tree.on('node.click', function (event, node) {
        onSelectionChanged(node);
    });

    _treeInstance = tree;
    return new InspireTreeDOM(tree, { target: selector });
}

/**
 * Programmatically selects and highlights a node in the tree based on its URN.
 * This is used for syncing the tree when navigating through issues.
 */
window.syncTreeHighlight = function (targetUrn) {
    if (!_treeInstance || !targetUrn) return;

    console.log('[Sidebar] Syncing tree highlight for URN:', targetUrn);

    // Find the node with the matching URN
    // We search all nodes (including collapsed ones)
    const nodes = _treeInstance.nodes();
    const targetNode = window.findNodeById(nodes, targetUrn);

    if (targetNode) {
        console.log('[Sidebar] Found matching node, selecting:', targetNode.text);

        // Deselect all existing selections first
        _treeInstance.deselectDeep();

        // Select and expand parents to ensure it's visible
        targetNode.select();
        targetNode.expandParents();

        // Trigger scroll into view if possible (InspireTreeDOM might handle visibility)
        setTimeout(() => {
            const li = targetNode.itree.ref;
            if (li) li.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }, 300);
        return true;
    } else {
        console.warn('[Sidebar] No matching node found in tree for URN:', targetUrn);
        return false;
    }
};
