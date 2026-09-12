// Kiosk header sync-status badge. Injected into #header (present on every page except
// login.html). States mirror docs/offline-sync-kiosk-plan.md §4: Synced / Pending /
// Syncing / Error - derived directly from IndexedDB queue state (see offline-store.js)
// rather than tracked separately, so the badge can never drift from what's actually queued.
(function () {
    function t(key) {
        return window.appI18n ? window.appI18n.t(key) : key;
    }

    function buildBadge() {
        // Chip chrome (padding/border-radius/background/color/font) is now owned entirely
        // by KitchenDS.StatusBadge's own CSS - this button stays a transparent, unstyled
        // structural/click wrapper around the React-rendered chip.
        const badge = document.createElement('button');
        badge.id = 'sync-status-badge';
        badge.type = 'button';
        Object.assign(badge.style, {
            display: 'inline-flex',
            alignItems: 'center',
            cursor: 'pointer',
            marginLeft: '8px',
            height: '100%',
            border: 'none',
            background: 'transparent',
            padding: '0',
        });
        return badge;
    }

    function buildDrawer() {
        const drawer = document.createElement('div');
        drawer.id = 'sync-status-drawer';
        Object.assign(drawer.style, {
            position: 'absolute',
            top: '100%',
            right: '0',
            marginTop: '6px',
            minWidth: '260px',
            maxWidth: '320px',
            background: '#fff',
            color: '#222',
            border: '1px solid #ddd',
            borderRadius: '8px',
            boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
            padding: '12px',
            fontSize: '0.85rem',
            display: 'none',
            zIndex: '10000',
        });
        return drawer;
    }

    const STATE_STYLES = {
        synced: { bg: '#d4edda', color: '#155724', icon: '🟢', label: () => t('Synced') },
        pending: { bg: '#fff3cd', color: '#856404', icon: '🟡', label: (n) => `${n} ${t('Records Pending Sync (Offline)')}` },
        syncing: { bg: '#cfe2ff', color: '#084298', icon: '🔵', label: (n) => `${t('Syncing')} ${n}...` },
        error: { bg: '#f8d7da', color: '#842029', icon: '🔴', label: (n) => `${n} ${t('Record(s) Failed to Sync')}` },
    };

    function renderBadge(badgeRoot, badge, state, count) {
        const style = STATE_STYLES[state];
        const label = `${style.icon} ${style.label(count)}`;
        badgeRoot.render(
            window.KitchenDS.React.createElement(window.KitchenDS.StatusBadge, { state, label })
        );
        badge.title = state === 'synced'
            ? t('All temperature checks and records are safely saved to the server.')
            : t('Tap to view pending records.');
    }

    async function renderDrawer(drawer) {
        drawer.innerHTML = '';

        const records = await window.offlineStore.listPendingRecords();

        if (records.length === 0) {
            const empty = document.createElement('div');
            empty.textContent = t('All temperature checks and records are safely saved to the server.');
            drawer.appendChild(empty);
            return;
        }

        const list = document.createElement('div');
        records.forEach((record) => {
            const row = document.createElement('div');
            Object.assign(row.style, {
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '6px 0',
                borderBottom: '1px solid #eee',
            });

            const label = document.createElement('span');
            const statusLabel = record.status === 'error' ? t('Failed') : record.status === 'syncing' ? t('Syncing') : t('Pending');
            label.textContent = `${record.formType || t('Record')} - ${statusLabel}`;
            row.appendChild(label);

            if (record.status === 'error') {
                const retryBtn = document.createElement('button');
                retryBtn.textContent = t('Retry');
                retryBtn.type = 'button';
                Object.assign(retryBtn.style, { border: 'none', background: '#0d6efd', color: '#fff', borderRadius: '4px', padding: '2px 8px', cursor: 'pointer' });
                retryBtn.addEventListener('click', async () => {
                    await window.offlineStore.updatePendingRecord(record.clientRecordId, { status: 'pending', retryCount: 0, lastError: null });
                    window.syncEngine.processQueue();
                });
                row.appendChild(retryBtn);
            }

            list.appendChild(row);
        });
        drawer.appendChild(list);

        const syncNowBtn = document.createElement('button');
        syncNowBtn.textContent = t('Sync Now');
        syncNowBtn.type = 'button';
        Object.assign(syncNowBtn.style, {
            marginTop: '10px',
            width: '100%',
            border: 'none',
            background: '#198754',
            color: '#fff',
            borderRadius: '6px',
            padding: '8px',
            cursor: 'pointer',
            fontWeight: '600',
        });
        syncNowBtn.addEventListener('click', () => window.syncEngine.processQueue());
        drawer.appendChild(syncNowBtn);
    }

    async function computeState() {
        if (!window.offlineStore || !window.offlineStore.isSupported()) {
            return { state: 'synced', count: 0 };
        }

        const records = await window.offlineStore.listPendingRecords();
        const errorCount = records.filter((r) => r.status === 'error').length;
        const syncingCount = records.filter((r) => r.status === 'syncing').length;
        const pendingCount = records.filter((r) => r.status === 'pending').length;

        if (errorCount > 0) return { state: 'error', count: errorCount };
        if (syncingCount > 0) return { state: 'syncing', count: syncingCount };
        if (pendingCount > 0) return { state: 'pending', count: pendingCount };
        return { state: 'synced', count: 0 };
    }

    function init() {
        const header = document.getElementById('header');
        if (!header || !window.offlineStore) {
            return;
        }

        const wrapper = document.createElement('div');
        wrapper.style.position = 'relative';
        wrapper.style.display = 'inline-block';

        const badge = buildBadge();
        const drawer = buildDrawer();
        wrapper.appendChild(badge);
        wrapper.appendChild(drawer);
        header.appendChild(wrapper);

        const badgeRoot = window.KitchenDS.ReactDOM.createRoot(badge);

        let open = false;
        badge.addEventListener('click', async () => {
            open = !open;
            drawer.style.display = open ? 'block' : 'none';
            if (open) {
                await renderDrawer(drawer);
            }
        });

        document.addEventListener('click', (event) => {
            if (open && !wrapper.contains(event.target)) {
                open = false;
                drawer.style.display = 'none';
            }
        });

        async function refresh() {
            const { state, count } = await computeState();
            renderBadge(badgeRoot, badge, state, count);
            if (open) {
                await renderDrawer(drawer);
            }
        }

        window.addEventListener('safecater-queue-changed', refresh);
        refresh();
    }

    window.addEventListener('DOMContentLoaded', init);
})();
