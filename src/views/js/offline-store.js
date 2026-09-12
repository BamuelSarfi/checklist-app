// IndexedDB wrapper for offline form submissions and cached GET responses. Two stores:
//   pending_records - queued POSTs waiting to sync (see sync-engine.js for the replay logic)
//   app_cache        - last-known-good GET responses, served when the network is down
//
// app_cache is cleared whenever the logged-in employee changes (see clearCacheForNewSession
// and script.js) so a shared kiosk tablet can't show one employee's cached "today's data" to
// the next person who logs in. pending_records is intentionally NOT cleared on a session
// change - see the comment on clearCacheForNewSession below for why.
(function () {
    const DB_NAME = 'safecater-kiosk-offline';
    const DB_VERSION = 1;
    const PENDING_STORE = 'pending_records';
    const CACHE_STORE = 'app_cache';

    function isSupported() {
        return typeof indexedDB !== 'undefined';
    }

    let dbPromise = null;

    function openDb() {
        if (!isSupported()) {
            return Promise.reject(new Error('IndexedDB is not available in this browser'));
        }

        if (!dbPromise) {
            dbPromise = new Promise((resolve, reject) => {
                const request = indexedDB.open(DB_NAME, DB_VERSION);

                request.onupgradeneeded = () => {
                    const db = request.result;

                    if (!db.objectStoreNames.contains(PENDING_STORE)) {
                        const store = db.createObjectStore(PENDING_STORE, { keyPath: 'clientRecordId' });
                        store.createIndex('by_employee', 'employeeId');
                        store.createIndex('by_status', 'status');
                    }

                    if (!db.objectStoreNames.contains(CACHE_STORE)) {
                        db.createObjectStore(CACHE_STORE, { keyPath: 'cacheKey' });
                    }
                };

                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            });
        }

        return dbPromise;
    }

    function withStore(storeName, mode, work) {
        return openDb().then((db) => new Promise((resolve, reject) => {
            const tx = db.transaction(storeName, mode);
            const store = tx.objectStore(storeName);
            let result;

            Promise.resolve(work(store))
                .then((value) => { result = value; })
                .catch(reject);

            tx.oncomplete = () => resolve(result);
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error);
        }));
    }

    function requestToPromise(request) {
        return new Promise((resolve, reject) => {
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    function generateId() {
        if (typeof crypto !== 'undefined' && crypto.randomUUID) {
            return crypto.randomUUID();
        }
        return `client-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }

    function cacheKeyFor(endpoint, employeeId) {
        return `${employeeId || 'anon'}::${endpoint}`;
    }

    // --- pending_records --------------------------------------------------

    function queuePendingRecord({ endpoint, method = 'POST', body, formType, employeeId }) {
        const record = {
            clientRecordId: generateId(),
            endpoint,
            method,
            body,
            formType: formType || null,
            employeeId: employeeId || null,
            status: 'pending',
            retryCount: 0,
            lastError: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };

        return withStore(PENDING_STORE, 'readwrite', (store) => requestToPromise(store.add(record)))
            .then(() => record);
    }

    function listPendingRecords() {
        return withStore(PENDING_STORE, 'readonly', (store) => requestToPromise(store.getAll()));
    }

    function countPendingRecords() {
        return withStore(PENDING_STORE, 'readonly', (store) => requestToPromise(store.count()));
    }

    function updatePendingRecord(clientRecordId, patch) {
        return withStore(PENDING_STORE, 'readwrite', (store) => {
            return requestToPromise(store.get(clientRecordId)).then((existing) => {
                if (!existing) {
                    return null;
                }

                const updated = { ...existing, ...patch, updatedAt: new Date().toISOString() };
                return requestToPromise(store.put(updated)).then(() => updated);
            });
        });
    }

    function removePendingRecord(clientRecordId) {
        return withStore(PENDING_STORE, 'readwrite', (store) => requestToPromise(store.delete(clientRecordId)));
    }

    // --- app_cache -----------------------------------------------------

    function cacheResponse(endpoint, employeeId, data) {
        const entry = {
            cacheKey: cacheKeyFor(endpoint, employeeId),
            endpoint,
            employeeId: employeeId || null,
            data,
            updatedAt: new Date().toISOString(),
        };

        return withStore(CACHE_STORE, 'readwrite', (store) => requestToPromise(store.put(entry)));
    }

    function getCachedResponse(endpoint, employeeId) {
        const key = cacheKeyFor(endpoint, employeeId);
        return withStore(CACHE_STORE, 'readonly', (store) => requestToPromise(store.get(key)))
            .then((entry) => entry ? entry.data : null);
    }

    // --- session boundary -------------------------------------------------

    // Called whenever the logged-in employee changes (see script.js) so a shared kiosk
    // never serves one employee's cached "today's data" to the next person who logs in.
    // Deliberately does NOT touch pending_records: a queued-but-unsynced submission still
    // needs to reach the server regardless of who's currently driving the kiosk - wiping it
    // on a shift change would be data loss, not just a scoping fix.
    function clearCacheForNewSession() {
        return withStore(CACHE_STORE, 'readwrite', (store) => requestToPromise(store.clear()));
    }

    window.offlineStore = {
        isSupported,
        queuePendingRecord,
        listPendingRecords,
        countPendingRecords,
        updatePendingRecord,
        removePendingRecord,
        cacheResponse,
        getCachedResponse,
        clearCacheForNewSession,
    };
})();
