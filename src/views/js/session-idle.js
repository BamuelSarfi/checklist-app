// A kiosk tablet is shared, so a session left idle signs the next person's forms under this person's
// name. Signs out after 15 minutes without input (matching IDLE_MINUTES in sessions.js) and, while
// someone is actively filling in a long form, tells the server they're still there so they aren't
// signed out mid-form. The server enforces the limit either way; this just does it visibly.
(function () {
    const IDLE_LIMIT_MS = 15 * 60 * 1000;
    const HEARTBEAT_MS = 5 * 60 * 1000;
    let lastActivity = Date.now();
    let lastHeartbeat = Date.now();

    function signOut() {
        window.location.href = '/logout';
    }

    function noteActivity() {
        lastActivity = Date.now();
        if (Date.now() - lastHeartbeat > HEARTBEAT_MS && navigator.onLine) {
            lastHeartbeat = Date.now();
            fetch('/api/employee').catch(() => {});
        }
    }

    ['pointerdown', 'keydown', 'input', 'scroll'].forEach((type) => {
        document.addEventListener(type, noteActivity, { passive: true, capture: true });
    });

    setInterval(() => {
        // Offline, /logout couldn't load and the page would be lost, along with any unsaved entries.
        if (Date.now() - lastActivity >= IDLE_LIMIT_MS && navigator.onLine) {
            signOut();
        }
    }, 30 * 1000);

    // Any request answered with "your session has ended" goes back to the login page. Work already
    // queued offline stays queued (see sync-engine.js).
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (...args) => {
        const response = await originalFetch(...args);
        if (response.status === 401 && !window.__kioskQueueReplay) {
            const body = await response.clone().json().catch(() => null);
            if (body && body.session_expired) {
                window.location.href = '/login';
            }
        }
        return response;
    };
}());
