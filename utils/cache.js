/**
 * Tiny in-memory TTL cache + inflight deduplication
 * -----------------------------------------------------
 *  - set/get/del/clear
 *  - wrap(key, ttlSec, loader) : 캐시 미스시 loader 실행 후 저장
 *    동일 key로 동시에 여러 요청이 들어와도 loader 는 한 번만 실행됩니다.
 *
 * ⚠ 프로세스 로컬 캐시 — 멀티 인스턴스 환경에서는 Redis 등 교체 권장.
 */

class TTLCache {
    constructor() {
        this.store = new Map();   // key -> { value, expiresAt }
        this.inflight = new Map(); // key -> Promise
    }

    get(key) {
        const entry = this.store.get(key);
        if (!entry) return undefined;
        if (entry.expiresAt <= Date.now()) {
            this.store.delete(key);
            return undefined;
        }
        return entry.value;
    }

    set(key, value, ttlSec = 60) {
        this.store.set(key, { value, expiresAt: Date.now() + ttlSec * 1000 });
    }

    del(key) { this.store.delete(key); this.inflight.delete(key); }
    clear()  { this.store.clear();    this.inflight.clear(); }

    async wrap(key, ttlSec, loader) {
        const hit = this.get(key);
        if (hit !== undefined) return hit;

        if (this.inflight.has(key)) return this.inflight.get(key);

        const p = Promise.resolve()
            .then(() => loader())
            .then((value) => { this.set(key, value, ttlSec); return value; })
            .finally(() => this.inflight.delete(key));

        this.inflight.set(key, p);
        return p;
    }

    stats() {
        return { size: this.store.size, inflight: this.inflight.size };
    }
}

const cache = new TTLCache();

// 주기적 만료 청소 (10분마다)
setInterval(() => {
    const now = Date.now();
    for (const [k, v] of cache.store) {
        if (v.expiresAt <= now) cache.store.delete(k);
    }
}, 10 * 60 * 1000).unref?.();

module.exports = { cache, TTLCache };
