// tutorials.js - short video tutorials for the kitchen forms, playable offline.
//
// - Adds a "How to" button to the header of every page that has a tutorial (and to the home
//   page, where it opens the series for this kitchen's pack).
// - Plays the videos in an overlay with the rest of the series listed underneath.
// - Asks the service worker (sw.js) to keep this kitchen's series in its own cache, so the
//   videos still play when the tablet is offline. sw.js serves byte ranges from that cache,
//   which <video> needs for seeking.
//
// Video files live in /tutorials/. When a video is re-rendered, bump TUTORIAL_VERSION: the
// URLs change, the service worker fetches the new files and drops the old ones. When this file
// itself changes, bump STATIC_CACHE in sw.js too - static assets are served cache-first.
(function () {
    const TUTORIAL_VERSION = '1';

    const SERIES = {
        sfbb: {
            title: 'SFBB diary tutorials',
            items: [
                { id: 'sfbb-1', file: 'sfbb-1-opening-checks', title: 'Opening checks', seconds: 24 },
                { id: 'sfbb-2', file: 'sfbb-2-prove-it', title: 'Prove it checks', seconds: 24 },
                { id: 'sfbb-3', file: 'sfbb-3-closing-and-sign-off', title: 'Closing and sign-off', seconds: 21 },
                { id: 'sfbb-4', file: 'sfbb-4-4-weekly-review', title: 'The 4-weekly review', seconds: 24 },
            ],
        },
        safecatering: {
            title: 'Safe Catering form tutorials',
            items: [
                { id: 'sc-1', file: 'sc1-food-delivery', title: 'SC1 Food delivery records', seconds: 24 },
                { id: 'sc-2', file: 'sc2-fridge-temperatures', title: 'SC2 Fridge temperatures', seconds: 24 },
                { id: 'sc-3', file: 'sc3-cooking-cooling-reheating', title: 'SC3 Cooking, cooling, reheating', seconds: 24 },
                { id: 'sc-4', file: 'sc4-hot-hold-display', title: 'SC4 Hot hold and display', seconds: 21 },
                { id: 'sc-5', file: 'sc5-hygiene-checklist', title: 'SC5 Hygiene checklist', seconds: 21 },
            ],
        },
    };

    // Which tutorial a page opens on. The diary covers three tutorials, so it goes by the
    // section in the URL hash (the home cards link straight to #opening, #prove-it, ...).
    const DIARY_BY_HASH = { opening: 'sfbb-1', 'prove-it': 'sfbb-2', extra: 'sfbb-2', problems: 'sfbb-2', closing: 'sfbb-3', signoff: 'sfbb-3' };
    const PAGES = {
        '/sfbb/diary': () => DIARY_BY_HASH[window.location.hash.slice(1)] || 'sfbb-1',
        '/sfbb/review': () => 'sfbb-4',
        '/sc1': () => 'sc-1',
        '/sc2': () => 'sc-2',
        '/sc3': () => 'sc-3',
        '/sc4': () => 'sc-4',
        '/sc5': () => 'sc-5',
    };

    const t = (key, vars) => (window.appI18n ? window.appI18n.t(key, vars) : key);
    const videoUrl = (item) => `/tutorials/${item.file}.mp4?v=${TUTORIAL_VERSION}`;
    const posterUrl = (item) => `/tutorials/${item.file}.jpg?v=${TUTORIAL_VERSION}`;

    function findItem(id) {
        for (const key of Object.keys(SERIES)) {
            const index = SERIES[key].items.findIndex((item) => item.id === id);
            if (index >= 0) return { seriesKey: key, index };
        }
        return null;
    }

    // ---------- offline cache ----------
    function allUrls() {
        return Object.values(SERIES).flatMap((series) => series.items.flatMap((item) => [videoUrl(item), posterUrl(item)]));
    }

    function warmCache(seriesKey) {
        const series = SERIES[seriesKey];
        if (!series || !('serviceWorker' in navigator)) return;
        if (navigator.connection && navigator.connection.saveData) return;
        const urls = series.items.flatMap((item) => [posterUrl(item), videoUrl(item)]);
        navigator.serviceWorker.ready.then((registration) => {
            const worker = navigator.serviceWorker.controller || registration.active;
            if (worker) worker.postMessage({ type: 'safecater-cache-tutorials', urls, keep: allUrls() });
        }).catch(() => { /* no service worker - the videos just stream */ });
    }

    async function isCached(url) {
        try {
            return !!(window.caches && await window.caches.match(url));
        } catch (_error) {
            return false;
        }
    }

    // ---------- overlay ----------
    let overlay = null;
    let current = null;

    function buildOverlay() {
        if (overlay) return overlay;
        overlay = document.createElement('div');
        overlay.id = 'tutorial_overlay';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.setAttribute('aria-labelledby', 'tutorial_title');
        overlay.innerHTML = `
            <div id="tutorial_inner">
                <div id="tutorial_header">
                    <div id="tutorial_title"></div>
                    <button type="button" id="tutorial_close" class="kiosk-small-btn"></button>
                </div>
                <div id="tutorial_body">
                    <video id="tutorial_video" controls playsinline preload="none"></video>
                    <div id="tutorial_now"></div>
                    <div id="tutorial_series_label"></div>
                    <div id="tutorial_list"></div>
                </div>
            </div>`;
        document.body.appendChild(overlay);
        overlay.querySelector('#tutorial_close').textContent = t('Close');
        overlay.querySelector('#tutorial_close').addEventListener('click', closeTutorials);
        overlay.addEventListener('click', (event) => { if (event.target === overlay) closeTutorials(); });
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && overlay.classList.contains('visible')) closeTutorials();
        });
        // Play the rest of the series in order.
        overlay.querySelector('#tutorial_video').addEventListener('ended', () => {
            const series = SERIES[current.seriesKey];
            if (current.index + 1 < series.items.length) show(current.seriesKey, current.index + 1, true);
        });
        return overlay;
    }

    function formatSeconds(seconds) {
        return `0:${String(seconds).padStart(2, '0')}`;
    }

    function show(seriesKey, index, autoplay) {
        const series = SERIES[seriesKey];
        const item = series.items[index];
        current = { seriesKey, index };

        overlay.querySelector('#tutorial_title').textContent = t(item.title);
        overlay.querySelector('#tutorial_now').textContent = t('Tutorial {n} of {total}', { n: index + 1, total: series.items.length });
        overlay.querySelector('#tutorial_series_label').textContent = t(series.title);

        const video = overlay.querySelector('#tutorial_video');
        video.poster = posterUrl(item);
        video.src = videoUrl(item);
        if (autoplay) video.play().catch(() => { /* the person can press play */ });

        const list = overlay.querySelector('#tutorial_list');
        list.innerHTML = '';
        series.items.forEach((entry, i) => {
            const row = document.createElement('button');
            row.type = 'button';
            row.className = `tutorial-row${i === index ? ' is-current' : ''}`;
            row.setAttribute('aria-current', i === index ? 'true' : 'false');

            const thumb = document.createElement('img');
            thumb.src = posterUrl(entry);
            thumb.alt = '';
            thumb.loading = 'lazy';

            const text = document.createElement('span');
            text.className = 'tutorial-row-text';
            const title = document.createElement('span');
            title.className = 'tutorial-row-title';
            title.textContent = `${i + 1}. ${t(entry.title)}`;
            const meta = document.createElement('span');
            meta.className = 'tutorial-row-meta';
            meta.textContent = formatSeconds(entry.seconds);
            text.append(title, meta);

            row.append(thumb, text);
            row.addEventListener('click', () => show(seriesKey, i, true));
            list.appendChild(row);

            isCached(videoUrl(entry)).then((cached) => {
                if (cached) meta.textContent = `${formatSeconds(entry.seconds)} · ${t('Saved for offline')}`;
            });
        });
    }

    function openTutorial(id) {
        const found = findItem(id);
        if (!found) return;
        buildOverlay();
        show(found.seriesKey, found.index, true);
        overlay.classList.add('visible');
        document.body.style.overflow = 'hidden';
        overlay.querySelector('#tutorial_close').focus({ preventScroll: true });
    }

    function openSeries(seriesKey) {
        const series = SERIES[seriesKey];
        if (series) openTutorial(series.items[0].id);
    }

    function closeTutorials() {
        if (!overlay) return;
        const video = overlay.querySelector('#tutorial_video');
        video.pause();
        overlay.classList.remove('visible');
        document.body.style.overflow = '';
    }

    // ---------- header button ----------
    function addHeaderButton(onClick) {
        const header = document.querySelector('.kiosk-header');
        if (!header || document.getElementById('tutorial_button')) return;
        const row = header.lastElementChild;
        const button = document.createElement('button');
        button.type = 'button';
        button.id = 'tutorial_button';
        button.className = 'kiosk-watch-btn';
        button.title = t('Watch how it works');
        button.setAttribute('aria-label', t('Watch how it works'));
        button.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4l15 8-15 8z" fill="currentColor"></path></svg><span></span>';
        button.querySelector('span').textContent = t('How to');
        button.addEventListener('click', onClick);
        const info = row.querySelector('#info');
        if (info) row.insertBefore(button, info); else row.appendChild(button);
    }

    async function kitchenSeries() {
        try {
            const response = await fetch('/api/brand');
            if (!response.ok) return 'safecatering';
            const data = await response.json();
            return (data?.pack?.module_type || data?.kitchen?.module_type) === 'sfbb' ? 'sfbb' : 'safecatering';
        } catch (_error) {
            return 'safecatering';
        }
    }

    function init() {
        const path = window.location.pathname.replace(/\/+$/, '') || '/';
        const later = (fn) => setTimeout(fn, 4000);

        if (PAGES[path]) {
            addHeaderButton(() => openTutorial(PAGES[path]()));
            later(() => warmCache(findItem(PAGES[path]()).seriesKey));
            return;
        }

        if (path === '/') {
            let seriesKey = 'safecatering';
            addHeaderButton(() => openSeries(seriesKey));
            kitchenSeries().then((key) => {
                seriesKey = key;
                later(() => warmCache(key));
            });
        }
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();

    window.openTutorial = openTutorial;
    window.openTutorialSeries = openSeries;
    window.closeTutorials = closeTutorials;
})();
