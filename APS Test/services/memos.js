const fs = require('fs');
const path = require('path');

const MEMO_FILE = path.join(__dirname, '..', 'data', 'memos.json');

/**
 * Ensures the data directory and memos.json file exist.
 */
function ensureFile() {
    try {
        const dir = path.dirname(MEMO_FILE);
        if (!fs.existsSync(dir)) {
            console.log('[Memos Service] Creating data directory:', dir);
            fs.mkdirSync(dir, { recursive: true });
        }
        if (!fs.existsSync(MEMO_FILE)) {
            console.log('[Memos Service] Creating empty memos.json');
            fs.writeFileSync(MEMO_FILE, JSON.stringify({}));
        }
    } catch (err) {
        console.error('[Memos Service] ensureFile Error:', err.message);
    }
}

/**
 * Reads all memos from the JSON file.
 */
function readMemos() {
    ensureFile();
    try {
        if (!fs.existsSync(MEMO_FILE)) return {};
        const data = fs.readFileSync(MEMO_FILE, 'utf8');
        return data ? JSON.parse(data) : {};
    } catch (err) {
        console.error('[Memos Service] Parse Error:', err.message);
        return {};
    }
}

/**
 * Writes memos to the JSON file.
 */
function writeMemos(memos) {
    ensureFile();
    try {
        fs.writeFileSync(MEMO_FILE, JSON.stringify(memos, null, 2));
    } catch (err) {
        console.error('[Memos Service] Write Error:', err.message);
    }
}

/**
 * Saves a memo for a specific version.
 */
function saveMemo(versionUrn, memoText) {
    const memos = readMemos();
    memos[versionUrn] = {
        text: memoText,
        updatedAt: new Date().toISOString()
    };
    writeMemos(memos);
    return memos[versionUrn];
}

/**
 * Gets a memo for a specific version.
 */
function getMemo(versionUrn) {
    const memos = readMemos();
    return memos[versionUrn] || { text: '' };
}

module.exports = {
    saveMemo,
    getMemo
};
