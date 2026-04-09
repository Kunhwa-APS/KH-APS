/**
 * unread-manager.js
 * Utility to manage the read/unread state of items using localStorage.
 */

const STORAGE_KEY = 'aps_read_items';

class UnreadManager {
    constructor() {
        this.readItems = new Set(this._loadFromStorage());
    }

    _loadFromStorage() {
        try {
            const data = localStorage.getItem(STORAGE_KEY);
            return data ? JSON.parse(data) : [];
        } catch (e) {
            console.error('[UnreadManager] Failed to load from storage:', e);
            return [];
        }
    }

    _saveToStorage() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(this.readItems)));
        } catch (e) {
            console.error('[UnreadManager] Failed to save to storage:', e);
        }
    }

    isRead(id) {
        return this.readItems.has(String(id));
    }

    markAsRead(id) {
        const idStr = String(id);
        if (!this.readItems.has(idStr)) {
            this.readItems.add(idStr);
            this._saveToStorage();
            return true;
        }
        return false;
    }

    // [New] Added for future use or verification
    getReadCount() {
        return this.readItems.size;
    }
}

export const unreadManager = new UnreadManager();
