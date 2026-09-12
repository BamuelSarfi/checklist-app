// Replays queued offline form submissions (see offline-store.js) once connectivity is
// back. Three wake-up sources, in order of how much they're actually relied on:
//   1. `online` window event - fires immediately when the browser regains a connection.
//   2. Service Worker `sync` event, relayed via postMessage (see sw.js) - native
//      OS/browser-scheduled retry, but iOS/WebKit has never implemented the Background
//      Sync API at all, so this simply never fires there.
//   3. A polling timer - the PRIMARY path on iOS, not a rare fallback for "unsupported
//      browsers". Every browser gets this as a safety net regardless of (1)/(2) firing.
(function () {
    const POLL_INTERVAL_MS = 30000;
    const MAX_RETRIES = 5;

    let processing = false;

    function hasOfflineStore() {
        return typeof window.offlineStore !== 'undefined' && window.offlineStore.isSupported();
    }

    function notifyQueueChanged() {
        if (!hasOfflineStore()) return;
        window.offlineStore.countPendingRecords().then((count) => {
            window.dispatchEvent(new CustomEvent('safecater-queue-changed', { detail: { count } }));
        }).catch(() => {});
    }

    function registerBackgroundSync() {
        if (!('serviceWorker' in navigator) || !navigator.serviceWorker.ready) {
            return;
        }

        navigator.serviceWorker.ready.then((registration) => {
            if (registration.sync && typeof registration.sync.register === 'function') {
                registration.sync.register('sync-checklists').catch(() => {
                    // Background Sync unsupported/denied - the polling timer covers it.
                });
            }
        }).catch(() => {});
    }

    // Attempts a request; if it fails due to a genuine network error (not an HTTP error
    // status, which still returns a normal response), queues it for later replay instead.
    // This is what each form's submit handler should call instead of a raw fetch().
    async function submitOrQueue(url, options = {}, meta = {}) {
        try {
            const response = await fetch(url, options);
            return { ok: true, response };
        } catch (networkError) {
            if (!hasOfflineStore()) {
                throw networkError;
            }

            let body = null;
            try {
                body = options.body ? JSON.parse(options.body) : null;
            } catch (_err) {
                body = options.body || null;
            }

            const record = await window.offlineStore.queuePendingRecord({
                endpoint: url,
                method: options.method || 'POST',
                body,
                formType: meta.formType || null,
                employeeId: meta.employeeId || null,
            });

            notifyQueueChanged();
            registerBackgroundSync();

            return { ok: false, queued: true, clientRecordId: record.clientRecordId };
        }
    }

    async function replayRecord(record) {
        await window.offlineStore.updatePendingRecord(record.clientRecordId, { status: 'syncing' });

        try {
            const response = await fetch(record.endpoint, {
                method: record.method || 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: record.body !== null ? JSON.stringify(record.body) : undefined,
            });

            if (!response.ok) {
                throw new Error(`Sync failed with status ${response.status}`);
            }

            await window.offlineStore.removePendingRecord(record.clientRecordId);
            return { ok: true };
        } catch (err) {
            const retryCount = (record.retryCount || 0) + 1;
            const status = retryCount >= MAX_RETRIES ? 'error' : 'pending';
            await window.offlineStore.updatePendingRecord(record.clientRecordId, {
                status,
                retryCount,
                lastError: err.message,
            });
            return { ok: false, status };
        }
    }

    async function processQueue() {
        if (processing || !hasOfflineStore() || !navigator.onLine) {
            return;
        }

        processing = true;
        try {
            const pending = await window.offlineStore.listPendingRecords();
            const toReplay = pending.filter((record) => record.status === 'pending');

            for (const record of toReplay) {
                await replayRecord(record);
            }
        } finally {
            processing = false;
            notifyQueueChanged();
        }
    }

    function init() {
        window.addEventListener('online', () => processQueue());

        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.addEventListener('message', (event) => {
                if (event.data?.type === 'safecater-sync-wakeup') {
                    processQueue();
                }
            });
        }

        setInterval(() => processQueue(), POLL_INTERVAL_MS);

        // Catch up on anything queued from a previous page load.
        processQueue();
        notifyQueueChanged();
    }

    window.syncEngine = {
        init,
        submitOrQueue,
        processQueue,
        registerBackgroundSync,
    };
})();
