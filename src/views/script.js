(function () {
document.getElementById('current_date').textContent = new Date().toLocaleDateString('en-GB');

// Register the offline service worker and start the sync engine on every page (both are
// safe no-ops if unsupported - offline-store.js/sync-engine.js/sw.js must load before this
// runs, which they do via <script> tags on each page).
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
        console.warn('Service worker registration failed:', err.message);
    });
}

if (window.syncEngine) {
    window.syncEngine.init();
}

// A shared kiosk tablet can have a different employee log in over the top of the previous
// one without ever hitting an explicit /logout (PIN login just overwrites the session
// cookies). Whenever the resolved employee differs from the last one this tab saw, clear
// the offline cache so employee B never sees employee A's cached "today's data". Queued
// pending_records are deliberately left alone - see offline-store.js.
const LAST_EMPLOYEE_KEY = 'safecater_last_employee_id';
function reconcileOfflineSessionScope(currentEmployeeId) {
    if (!window.offlineStore || !window.offlineStore.isSupported()) {
        return;
    }

    try {
        const lastEmployeeId = localStorage.getItem(LAST_EMPLOYEE_KEY);
        const normalizedCurrent = currentEmployeeId ? String(currentEmployeeId) : '';

        if (lastEmployeeId !== normalizedCurrent) {
            window.offlineStore.clearCacheForNewSession().catch(() => {});
            localStorage.setItem(LAST_EMPLOYEE_KEY, normalizedCurrent);
        }
    } catch (_err) {
        // localStorage unavailable (e.g. private browsing) - skip scoping, nothing to leak
        // to since nothing gets cached without it working either.
    }
}

// Non-blocking banner for "record saved locally, but didn't sync to SafeCater" warnings
// (e.g. the kitchen's subscription is inactive). Distinct from alert()-based error/success
// messages used elsewhere on these pages: it never interrupts the flow, and stays up until
// dismissed so a manager notices it without every submission popping a new dialog.
function showSyncWarning(message) {
    if (!message) {
        return;
    }

    let banner = document.getElementById('sync-warning-banner');
    if (!banner) {
        banner = document.createElement('div');
        banner.id = 'sync-warning-banner';
        Object.assign(banner.style, {
            position: 'fixed',
            top: '0',
            left: '0',
            right: '0',
            zIndex: '9999',
            background: '#fff3cd',
            color: '#856404',
            borderBottom: '1px solid #ffeeba',
            padding: '10px 40px 10px 16px',
            fontSize: '0.9rem',
            textAlign: 'center',
            boxShadow: '0 2px 6px rgba(0,0,0,0.08)',
        });

        const text = document.createElement('span');
        text.id = 'sync-warning-text';
        banner.appendChild(text);

        const closeBtn = document.createElement('button');
        closeBtn.textContent = '×';
        closeBtn.setAttribute('aria-label', 'Dismiss');
        closeBtn.type = 'button';
        Object.assign(closeBtn.style, {
            position: 'absolute',
            right: '12px',
            top: '50%',
            transform: 'translateY(-50%)',
            border: 'none',
            background: 'transparent',
            cursor: 'pointer',
            fontSize: '1.1rem',
            lineHeight: '1',
            color: '#856404',
        });
        closeBtn.addEventListener('click', () => banner.remove());
        banner.appendChild(closeBtn);

        document.body.prepend(banner);
    }

    banner.querySelector('#sync-warning-text').textContent = message;
}

// Several of these pages navigate to `/` immediately after a successful submission
// (see sc1/sc3/sc4/sc5's post-submit `window.location.href = '/'`), which would wipe out
// a banner shown on the current page before the user ever sees it. `notifySyncWarning`
// shows the banner immediately AND queues it in sessionStorage, so the boot check below
// (which runs on every page, including the one being redirected to) re-shows it if the
// current page navigates away before the user notices.
function notifySyncWarning(message) {
    if (!message) {
        return;
    }

    try {
        sessionStorage.setItem('pendingSyncWarning', message);
    } catch (_err) {
        // sessionStorage unavailable (e.g. private browsing) - the immediate banner still shows
    }

    showSyncWarning(message);
}

window.showSyncWarning = showSyncWarning;
window.notifySyncWarning = notifySyncWarning;

// Shared save/submit loading indicator, used by every SC form's save button. Swaps the
// button's normal content for a spinner + status text and disables it, restoring the
// original content on the next call with isLoading:false. The original content (usually a
// small <img> icon) is stashed on the element itself the first time, so this works whether
// the button holds text or an icon without each page needing its own bookkeeping.
function setButtonLoading(button, isLoading, loadingText = '') {
    if (!button) return;

    if (isLoading) {
        if (button.dataset.originalContent === undefined) {
            button.dataset.originalContent = button.innerHTML;
        }
        button.disabled = true;
        button.classList.add('is-loading');
        const labelMarkup = loadingText ? `<span class="btn_spinner_label">${loadingText}</span>` : '';
        button.innerHTML = `<span class="btn_spinner" aria-hidden="true"></span>${labelMarkup}`;
    } else {
        button.disabled = false;
        button.classList.remove('is-loading');
        if (button.dataset.originalContent !== undefined) {
            button.innerHTML = button.dataset.originalContent;
            delete button.dataset.originalContent;
        }
    }
}

window.setButtonLoading = setButtonLoading;

// Shared notification modal - the standard replacement for native alert() across every
// page's save/submit/delete flows. Returns a Promise that resolves when the user dismisses
// it, so a call site that used to read `alert('Saved'); window.location.href = '/';` becomes
// `await showAppModal('Saved'); window.location.href = '/';` - same sequencing (the redirect
// still waits for the user to dismiss the message), just non-blocking under the hood instead
// of a native, unstyled alert() box.
let appModalRoot = null;

function ensureAppModalRoot() {
    if (appModalRoot) return appModalRoot;

    const container = document.createElement('div');
    container.id = 'app-modal-root';
    document.body.appendChild(container);
    appModalRoot = window.KitchenDS.ReactDOM.createRoot(container);
    return appModalRoot;
}

function showAppModal(message, { type = 'info' } = {}) {
    const root = ensureAppModalRoot();
    return new Promise((resolve) => {
        const close = () => {
            root.render(
                window.KitchenDS.React.createElement(window.KitchenDS.Modal, {
                    open: false,
                    message,
                    onOk: () => {},
                })
            );
            resolve();
        };
        root.render(
            window.KitchenDS.React.createElement(window.KitchenDS.Modal, {
                open: true,
                type,
                message,
                onOk: close,
            })
        );
    });
}

window.showAppModal = showAppModal;

try {
    const pendingSyncWarning = sessionStorage.getItem('pendingSyncWarning');
    if (pendingSyncWarning) {
        sessionStorage.removeItem('pendingSyncWarning');
        showSyncWarning(pendingSyncWarning);
    }
} catch (_err) {
    // ignore - sessionStorage unavailable
}

function escapeHtml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

// Initialize employee data
let employee_id = null;
let employeeData = null;

const initializeEmployee = async () => {
    // Try to get from sessionStorage first
    const stored = sessionStorage.getItem('employeeData');
    if (stored) {
        employeeData = JSON.parse(stored);
    } else {
        // Fallback to API call
        try {
            const response = await fetch('/api/employee');
            const data = await response.json();
            if (data.success) {
                employeeData = data.employee;
                sessionStorage.setItem('employeeData', JSON.stringify(employeeData));
            }
        } catch (err) {
            console.error('Error fetching employee data:', err);
        }
    }

    // Display employee name
    if (employeeData) {
        employee_id = employeeData.id;
        const employeeDisplay = document.getElementById('employee_name_display');
        if (employeeDisplay) {
            employeeDisplay.textContent = employeeData.name || "Employee";
        }
    } else {
        const employeeDisplay = document.getElementById('employee_name_display');
        if (employeeDisplay) {
            employeeDisplay.textContent = "Employee";
        }
    }

    reconcileOfflineSessionScope(employee_id);
};

initializeEmployee();

const initializeBranding = async () => {
    try {
        const response = await fetch('/api/brand');
        if (!response.ok) {
            return;
        }

        const data = await response.json();
        const brandName = data?.brand_name || data?.business?.display_name || data?.business?.legal_name || data?.kitchen?.name || 'Safe Catering';
        const logoSrc = data?.logo_src || data?.business?.logo_src || data?.kitchen?.logo_src || '/asset2.png';

        document.querySelectorAll('#logo_section img, #title img').forEach((img) => {
            img.src = logoSrc;
            img.alt = brandName;
        });

        document.querySelectorAll('#logo_section h1, #title h1').forEach((heading) => {
            if (!heading.dataset.baseText) {
                heading.dataset.baseText = heading.textContent || '';
            }

            const baseText = heading.dataset.baseText || heading.textContent || '';
            heading.innerHTML = `<span style="display:block; font-size:0.62em; line-height:1.1; letter-spacing:0.02em;">${escapeHtml(brandName)}</span><span style="display:block;">${escapeHtml(baseText)}</span>`;
        });
    } catch (_err) {
        // Brand rendering is optional; the page should continue without it.
    }
};

initializeBranding();

// Set up date
const date_n = new Date().toLocaleDateString('en-GB');
const date_input = date_n;

// Library button
document.getElementById('library_section')?.addEventListener('click', () => {
    window.location.href = '/library';
});

if (window.applyTranslations) {
    window.addEventListener('DOMContentLoaded', () => {
        window.applyTranslations(document.body);
    });
}

// Toggle checklist for SC5 page
document.querySelectorAll('.button_checklist_container').forEach(container => {
    container.addEventListener('click', () => {
        const img = container.querySelector('.check_img');
        const input = container.parentElement.querySelector('input');

        if (img.style.display === 'none') {
            img.style.display = 'block';
            input.value = 'yes';
        } else {
            img.style.display = 'none';
            input.value = 'no';
        }
    });
});

// Library button
document.getElementById('library_section')?.addEventListener('click', () => {
    window.location.href = '/library';
});

// // Initialize table when DOM is loaded
// if (document.getElementById('table_body')) {
//     initializeSC5Table();
// }

})();

