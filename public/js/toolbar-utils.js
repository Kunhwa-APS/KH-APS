/**
 * public/js/toolbar-utils.js
 * Shared utility functions for adding custom buttons to the APS Viewer toolbar.
 */
// Removed legacy clash imports

/**
 * Modularized function to add Issue and Clash buttons to any viewer instance.
 */
export function addCustomButtons(viewer) {
    if (!viewer) return;

    // 1. Clash Button is now handled by NavisClashExtension.js

    // 2. Add Issue Button
    addIssueToolbarButton(viewer, () => {
        // Use global handle for IssueManager
        if (window._issueManager) {
            window._issueManager.toggleCreationMode();
        }
    });

    console.log('[ToolbarUtils] Custom buttons added to viewer instance.');
}

/**
 * Adds a custom button to the viewer toolbar for issue management.
 */
export function addIssueToolbarButton(viewer, onClick) {
    const toolbar = viewer.getToolbar(true);
    if (!toolbar) return;

    let navControl = toolbar.getControl('settingsControl');
    if (!navControl) {
        navControl = new Autodesk.Viewing.UI.ControlGroup('custom-issue-group');
        toolbar.addControl(navControl);
    }

    const btn = new Autodesk.Viewing.UI.Button('add-issue-tool-btn');

    // Custom SVG Location Pin for a premium look
    btn.icon.innerHTML = `
        <svg viewBox="0 0 24 24" width="20" height="20" style="margin-top: 4px;">
            <path fill="currentColor" d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
        </svg>
    `;
    btn.addClass('adsk-viewing-viewer-toolbar-record-button');
    btn.setToolTip('Add Issue (Click on model)');
    btn.onClick = onClick;
    navControl.addControl(btn);
    return btn;
}
