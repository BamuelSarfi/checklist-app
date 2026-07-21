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
    return overlay;
  }

  overlay = document.createElement('div');
  overlay.id = 'help_overlay';
  overlay.setAttribute('aria-hidden', 'true');
  overlay.innerHTML = `
    <div id="help_inner">
      <div id="help_header">
        <div id="help_title">Help</div>
        <button id="help_close" aria-label="Close">Close</button>
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

  return overlay;
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

  overlay.classList.add('visible');
  document.body.style.overflow = 'hidden';
}

window.addEventListener('DOMContentLoaded', () => {
  ensureOverlayExists();
});

// Expose public API
window.openHelp = openHelp;
window.closeHelp = closeHelp;
