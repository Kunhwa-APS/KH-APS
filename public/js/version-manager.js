/* ============================================================
   version-manager.js
   Manages the Version Management Modal logic.
   ============================================================ */

export function openVersionModal(itemId, itemName) {
    if (window.explorer) {
        window.explorer.handleVersionClick(null, itemId, itemName);
    }
}
