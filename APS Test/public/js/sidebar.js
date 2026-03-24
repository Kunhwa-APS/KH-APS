/* ============================================================
   sidebar.js — InspireTree based Hubs/Projects/Folders browser
   Tutorial: hubs-browser/viewer — Sidebar logic
   ============================================================ */

async function getJSON(url) {
    const resp = await fetch(url);
    if (!resp.ok) {
        alert('Could not load tree data. See console for more details.');
        console.error(await resp.text());
        return [];
    }
    return resp.json();
}

function createTreeNode(id, text, icon, children = false) {
    return { id, text, children, itree: { icon } };
}

async function getHubs() {
    const hubs = await getJSON('/api/hubs');
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
                true
            );
        }
    });
}

async function getVersions(hubId, projectId, region, itemId) {
    const versions = await getJSON(
        `/api/hubs/${hubId}/projects/${projectId}/contents/${encodeURIComponent(itemId)}/versions`
    );
    console.log(`[Sidebar] Versions received for ${itemId}:`, versions);
    return versions.map(version => {
        const vNum = (version.vNumber !== undefined && version.vNumber !== null) ? version.vNumber : '?';
        const displayText = `V${vNum} - ${version.displayName || version.name}`;
        if (vNum === '?' || vNum === undefined) console.warn('[Sidebar] vNumber missing in JSON:', version);
        return createTreeNode(`version|${projectId}|${version.id}|${displayText}|${region}`, displayText, 'icon-version');
    });
}

export function initTree(selector, onSelectionChanged) {
    // See http://inspire-tree.com
    const tree = new InspireTree({
        data: function (node) {
            if (!node || !node.id) {
                return getHubs();
            } else {
                const tokens = node.id.split('|');
                switch (tokens[0]) {
                    case 'hub': return getProjects(tokens[1]);
                    case 'project': return getContents(tokens[1], tokens[2], tokens[3]); // hubId, projectId, region
                    case 'folder': return getContents(tokens[1], tokens[2], tokens[3], tokens[4]); // hubId, projectId, region, folderId
                    case 'item': return getVersions(tokens[1], tokens[2], tokens[3], tokens[4]); // hubId, projectId, region, itemId
                    default: return [];
                }
            }
        }
    });

    tree.on('node.click', function (event, node) {
        event.preventTreeDefault();
        onSelectionChanged(node);
    });

    return new InspireTreeDOM(tree, { target: selector });
}
