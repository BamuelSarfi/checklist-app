// help_overlay.js — reusable overlay helper (clean implementation)

// Map logical help keys to filenames (without extension). Case-sensitive to match files in help_images.
const helpMap = {
  'checklist_selection_info': 'Checklist_selection_info',
  'library_explanation_functions': 'Library_explanation_functions',
  'library_explanation_selection': 'Library_explanation_selection',
  'sc5_form_info': 'SC5_form_info',
  'sc1_info': 'SC1_form_info',

  // SC2 can now be multiple images (in display order)
  'sc2_info': [
    'SC2_initial_calendar_info',
    'SC2_record_filling_info',
    'SC2_saving_and_reopening_info',
  ],

  'sc3_info': 'SC3_form_info',
  'sc4_info': 'SC4_form_info'
};

function ensureOverlayExists() {
  let overlay = document.getElementById('help_overlay');
  if (overlay) {
    // Ensure close listener is attached even if overlay was added manually in the page
    if (!overlay.dataset.helpListener) {
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay || e.target.id === 'help_close') {
          closeHelp();
        }
      });
      overlay.dataset.helpListener = '1';
    }

    injectLanguageSelector(overlay);
    return overlay;
  }

  overlay = document.createElement('div');
  overlay.id = 'help_overlay';
  overlay.setAttribute('aria-hidden', 'true');
  overlay.innerHTML = `
    <div id="help_inner">
      <div id="help_header">
        <div id="help_title">Help</div>
        <div id="help_header_actions">
          <select id="language-select" aria-label="Language selector"></select>
          <button id="help_close" aria-label="Close">Close</button>
        </div>
      </div>
      <div id="help_body">
        <img id="help_image" src="" alt="Help image">
        <div id="help_thumb_container" style="display:none; width:100%;"></div>
        <div id="help_caption">Tap the image to view details. Tap outside to close.</div>
      </div>
    </div>`;

  document.body.appendChild(overlay);

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay || e.target.id === 'help_close') {
      closeHelp();
    }
  });
  overlay.dataset.helpListener = '1';

  injectLanguageSelector(overlay);

  return overlay;
}

function injectLanguageSelector(overlay) {
  if (!overlay || overlay.querySelector('#language-select')) {
    return;
  }

  const header = overlay.querySelector('#help_header');
  if (!header) {
    return;
  }

  let actions = overlay.querySelector('#help_header_actions');
  if (!actions) {
    actions = document.createElement('div');
    actions.id = 'help_header_actions';
    const closeButton = overlay.querySelector('#help_close');
    if (closeButton && closeButton.parentNode === header) {
      header.insertBefore(actions, closeButton);
      actions.appendChild(closeButton);
    } else {
      header.appendChild(actions);
    }
  }

  const languageSelect = document.createElement('select');
  languageSelect.id = 'language-select';
  languageSelect.setAttribute('aria-label', 'Language selector');

  const options = window.appI18n?.getLanguageOptions ? window.appI18n.getLanguageOptions() : [
    { value: 'en', label: 'English' },
    { value: 'es', label: 'Español' },
    { value: 'pl', label: 'Polski' },
    { value: 'bn', label: 'বাংলা' },
    { value: 'ar', label: 'العربية' },
  ];

  languageSelect.innerHTML = options.map(({ value, label }) => `<option value="${value}">${label}</option>`).join('');
  languageSelect.value = window.getAppLanguage ? window.getAppLanguage() : 'en';
  languageSelect.addEventListener('change', (event) => {
    if (window.setAppLanguage) {
      window.setAppLanguage(event.target.value);
    } else {
      try {
        sessionStorage.setItem('safecater_language_override_', event.target.value);
      } catch (_error) {
        // ignore
      }
    }

    window.location.reload();
  });

  actions.insertBefore(languageSelect, actions.firstChild);
}

function closeHelp() {
  const overlay = document.getElementById('help_overlay');
  if (overlay) overlay.classList.remove('visible');
  document.body.style.overflow = '';
}

function filenameForKey(key) {
  if (!key) return '';
  const trimmed = key.trim();
  if (helpMap[trimmed]) return helpMap[trimmed];
  return trimmed.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_\-]/g, '');
}

function resolveImageSrc(file) {
  const candidates = [`help_images/${file}.png`, `help_images/${file}.svg`];
  return candidates;
}

function buildThumbnails(keys, imgEl) {
  const container = document.getElementById('help_thumb_container');
  if (!container) return;
  container.innerHTML = '';
  if (!keys || keys.length <= 1) {
    container.style.display = 'none';
    return;
  }
  container.style.display = 'flex';
  container.style.gap = '8px';
  container.style.flexWrap = 'wrap';

  keys.forEach((k) => {
    const file = filenameForKey(k);
    const thumb = document.createElement('img');
    const candidates = [`help_images/${file}.png`, `help_images/${file}.svg`];
    let attempt = 0;
    const loadThumb = () => {
      if (attempt >= candidates.length) {
        thumb.style.display = 'none';
        return;
      }
      thumb.src = candidates[attempt];
      thumb.onerror = () => {
        attempt += 1;
        loadThumb();
      };
    };
    loadThumb();
    thumb.alt = k;
    thumb.style.width = '72px';
    thumb.style.height = 'auto';
    thumb.style.border = '1pt solid #ccc';
    thumb.style.cursor = 'pointer';
    thumb.addEventListener('click', () => {
      imgEl.src = thumb.src;
      const titleEl = document.getElementById('help_title');
      if (titleEl) titleEl.textContent = k.replace(/[-_]/g, ' ');
    });
    container.appendChild(thumb);
  });
}

function expandHelpKeys(input) {
  const tokens = String(input || '')
    .split(',')
    .map(k => k.trim())
    .filter(Boolean);

  const out = [];
  tokens.forEach((token) => {
    const mapped = helpMap[token];

    if (Array.isArray(mapped)) {
      mapped.forEach(v => out.push(String(v).trim()));
      return;
    }

    if (typeof mapped === 'string' && mapped.includes(',')) {
      mapped.split(',').map(v => v.trim()).filter(Boolean).forEach(v => out.push(v));
      return;
    }

    if (typeof mapped === 'string' && mapped.length) {
      out.push(mapped.trim());
      return;
    }

    out.push(token);
  });

  return [...new Set(out)];
}

function openHelp(pageKey) {
  const overlay = ensureOverlayExists();
  const img = document.getElementById('help_image');
  const title = document.getElementById('help_title');
  const caption = document.getElementById('help_caption');

  // CHANGED: expand logical key(s) into concrete image keys
  const keys = expandHelpKeys(pageKey);
  const primary = keys[0] || 'help';

  if (title) title.textContent = String(pageKey || primary).replace(/[-_]/g, ' ');

  const file = filenameForKey(primary);
  if (img) {
    img.style.display = '';
    const candidates = resolveImageSrc(file);
    let attempt = 0;
    const tryLoad = () => {
      if (attempt >= candidates.length) {
        if (caption) caption.textContent = 'Help image not found.';
        img.style.display = 'none';
        return;
      }
      img.src = candidates[attempt];
      img.onerror = () => {
        attempt += 1;
        tryLoad();
      };
      img.onload = () => {
        if (caption) caption.textContent = '';
      };
    };
    tryLoad();
  }

  buildThumbnails(keys, img || document.createElement('img'));

  if (window.applyTranslations) {
    window.applyTranslations(overlay);
  }

  overlay.classList.add('visible');
  document.body.style.overflow = 'hidden';

  if (window.appI18n?.refreshLanguageSelect) {
    window.appI18n.refreshLanguageSelect();
  }
}

// Mobile one-time welcome tour: a floating FAB that auto-opens a short onboarding
// walkthrough on first visit (persisted via localStorage), and can be re-opened anytime.
// Kept separate from openHelp()'s image-based per-field help above since this is plain-text
// onboarding copy with no corresponding help_images/ assets - reuses the same visual
// language and i18n hook (window.applyTranslations) rather than the image-loading plumbing.
const MOBILE_TOUR_STORAGE_KEY = 'safecater_kitchen_tour_seen';

const MOBILE_TOUR_CARDS = [
  { icon: '📲', title: 'Select Your Checklist', text: 'Tap a checklist card to choose the morning, afternoon, or evening SC form you need to fill in.' },
  { icon: '✍️', title: 'Log Temperatures & Sign', text: 'Enter your readings, then sign using your 6-digit staff PIN to confirm the entry is yours.' },
  { icon: '☁️', title: 'PDF Generation & Sync', text: 'Once complete, your form automatically turns into a compliance PDF and syncs for your manager.' },
];

function ensureMobileFabExists() {
  let fab = document.getElementById('mobile-help-fab');
  if (fab) return fab;

  fab = document.createElement('button');
  fab.id = 'mobile-help-fab';
  fab.type = 'button';
  fab.setAttribute('aria-label', 'Help');
  fab.textContent = '?';
  fab.addEventListener('click', openMobileTour);

  document.body.appendChild(fab);
  return fab;
}

function buildMobileTourOverlay() {
  let overlay = document.getElementById('mobile-tour-overlay');
  if (overlay) return overlay;

  overlay = document.createElement('div');
  overlay.id = 'mobile-tour-overlay';
  overlay.setAttribute('aria-hidden', 'true');

  const modal = document.createElement('div');
  modal.id = 'mobile-tour-modal';

  const closeBtn = document.createElement('button');
  closeBtn.id = 'mobile-tour-close';
  closeBtn.type = 'button';
  closeBtn.setAttribute('aria-label', 'Close');
  closeBtn.textContent = 'Close';
  modal.appendChild(closeBtn);

  const cardsWrap = document.createElement('div');
  cardsWrap.id = 'mobile-tour-cards';
  MOBILE_TOUR_CARDS.forEach((card) => {
    const cardEl = document.createElement('div');
    cardEl.className = 'mobile-tour-card';

    const iconEl = document.createElement('div');
    iconEl.className = 'mobile-tour-card-icon';
    iconEl.textContent = card.icon;

    const titleEl = document.createElement('h3');
    titleEl.textContent = card.title;

    const textEl = document.createElement('p');
    textEl.textContent = card.text;

    cardEl.appendChild(iconEl);
    cardEl.appendChild(titleEl);
    cardEl.appendChild(textEl);
    cardsWrap.appendChild(cardEl);
  });
  modal.appendChild(cardsWrap);

  const doneBtn = document.createElement('button');
  doneBtn.id = 'mobile-tour-done';
  doneBtn.type = 'button';
  doneBtn.textContent = 'Got it';
  modal.appendChild(doneBtn);

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  closeBtn.addEventListener('click', closeMobileTour);
  doneBtn.addEventListener('click', closeMobileTour);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeMobileTour();
  });

  return overlay;
}

function openMobileTour() {
  const overlay = buildMobileTourOverlay();

  if (window.applyTranslations) {
    window.applyTranslations(overlay);
  }

  overlay.classList.add('visible');
  document.body.style.overflow = 'hidden';
}

function closeMobileTour() {
  const overlay = document.getElementById('mobile-tour-overlay');
  if (overlay) overlay.classList.remove('visible');
  document.body.style.overflow = '';

  try {
    localStorage.setItem(MOBILE_TOUR_STORAGE_KEY, 'true');
  } catch (_error) {
    // localStorage unavailable (private mode etc.) - the FAB stays reachable regardless,
    // it'll just auto-open again next visit.
  }
}

window.addEventListener('DOMContentLoaded', () => {
  ensureOverlayExists();

  // help_overlay.js/css are shared across index.html and every sc1-5/library page, but the
  // mobile welcome FAB + one-time tour is scoped to the kitchen index page only - the SC
  // forms stay free of an extra floating control while someone's mid-entry.
  const isIndexPage = document.getElementById('welcome_section') !== null;
  if (!isIndexPage) {
    return;
  }

  ensureMobileFabExists();

  let tourSeen = false;
  try {
    tourSeen = localStorage.getItem(MOBILE_TOUR_STORAGE_KEY) === 'true';
  } catch (_error) {
    tourSeen = false;
  }

  if (!tourSeen) {
    openMobileTour();
  }
});

// Expose public API
window.openHelp = openHelp;
window.closeHelp = closeHelp;
window.openMobileTour = openMobileTour;
window.closeMobileTour = closeMobileTour;
