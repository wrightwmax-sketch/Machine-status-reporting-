/**
 * Student Projects Laboratory (930 Kinnear Rd)
 * Printable 2" x 3" 3-in-1 QR Machine Decal Sheet Generator (js/qr-generator.js)
 */

(function (window) {
  'use strict';

  const STORAGE_KEY_QR_BASE = 'spl_shop_portal_qr_base_url_v2';

  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  /**
   * Deterministic SVG QR fallback if offline and CDN is unreachable
   */
  function createFallbackQrSvg(text, sizePx) {
    const modules = 21;
    let hash = 2166136261;
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }

    const isFinder = (r, c) =>
      (r < 7 && c < 7) || (r < 7 && c >= modules - 7) || (r >= modules - 7 && c < 7);

    const finderCell = (r, c, tr, lc) => {
      const dr = r - tr;
      const dc = c - lc;
      if (dr === 0 || dr === 6 || dc === 0 || dc === 6) return true;
      if (dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4) return true;
      return false;
    };

    let rects = '';
    for (let r = 0; r < modules; r++) {
      for (let c = 0; c < modules; c++) {
        let dark = false;
        if (isFinder(r, c)) {
          if (r < 7 && c < 7) dark = finderCell(r, c, 0, 0);
          else if (r < 7 && c >= modules - 7) dark = finderCell(r, c, 0, modules - 7);
          else dark = finderCell(r, c, modules - 7, 0);
        } else {
          const bitIdx = (r * modules + c) % 31;
          dark = (((hash >>> bitIdx) ^ (r * 17 + c * 31)) & 1) === 1;
        }
        if (dark) {
          rects += `<rect x="${c}" y="${r}" width="1" height="1" fill="#0f172a"/>`;
        }
      }
    }

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${modules} ${modules}" width="${sizePx}" height="${sizePx}" shape-rendering="crispEdges"><rect width="${modules}" height="${modules}" fill="#ffffff"/>${rects}</svg>`;
  }

  /**
   * Resolve base URL for QR code target links
   */
  function getPortalBaseUrl() {
    const saved = localStorage.getItem(STORAGE_KEY_QR_BASE);
    if (saved && saved.trim()) {
      return saved.trim().replace(/\?.*$/, '').replace(/qr-sheets\.html$/i, '');
    }
    const loc = window.location;
    let path = loc.pathname || '/';
    path = path.replace(/qr-sheets\.html$/i, '').replace(/index\.html$/i, '');
    if (!path.endsWith('/')) {
      path += '/';
    }
    return `${loc.origin}${path}`;
  }

  function saveBaseUrlOverride(url) {
    if (!url || !url.trim()) {
      localStorage.removeItem(STORAGE_KEY_QR_BASE);
      return;
    }
    localStorage.setItem(STORAGE_KEY_QR_BASE, url.trim());
  }

  /**
   * Render 2" x 3" industrial QR decals for all shop assets into #qr-decal-grid
   */
  function renderQrDecalSheet(assets, customBaseUrl) {
    const gridEl = document.getElementById('qr-decal-grid');
    if (!gridEl) return;

    const baseUrl = (customBaseUrl && customBaseUrl.trim())
      ? customBaseUrl.trim().replace(/\?.*$/, '').replace(/qr-sheets\.html$/i, '')
      : getPortalBaseUrl();

    const baseInput = document.getElementById('qr-base-url-input');
    if (baseInput && !baseInput.value) {
      baseInput.value = baseUrl;
    }

    const countEl = document.getElementById('qr-decal-total-count');
    if (countEl) {
      countEl.textContent = String((assets || []).length);
    }

    gridEl.innerHTML = '';

    (assets || []).forEach((asset) => {
      const separator = baseUrl.includes('?') ? '&' : '?';
      const targetUrl = `${baseUrl}${separator}asset=${encodeURIComponent(asset.id)}`;
      const qrBoxId = `qr-decal-box-${asset.id.replace(/[^a-zA-Z0-9_-]/g, '')}`;
      const tagLabel = asset.equipmentTag || 'N/A';

      const tile = document.createElement('article');
      tile.className = 'qr-decal-tile';
      tile.setAttribute('data-asset-id', asset.id);
      tile.setAttribute('data-zone-code', asset.zoneCode || '');

      tile.innerHTML = `
        <div class="qr-decal-banner">
          <span>STUDENT PROJECTS LAB • 930 KINNEAR RD</span>
          <span>${escapeHtml(asset.zoneCode || 'SHOP')}</span>
        </div>
        <div class="qr-decal-body">
          <div id="${qrBoxId}" class="qr-decal-code-box" aria-label="QR Code for ${escapeHtml(asset.id)}"></div>
          <div class="qr-decal-info">
            <div class="qr-decal-asset-id">${escapeHtml(asset.id)}</div>
            <div class="qr-decal-tag-id">TAG: ${escapeHtml(tagLabel)}</div>
            <div class="qr-decal-name">${escapeHtml(asset.name)}</div>
            <div class="qr-decal-zone">${escapeHtml(asset.zone)}</div>
          </div>
        </div>
        <div class="qr-decal-footer">
          SCAN FOR: 1. SOP &amp; PPE | 2. LOTO Procedure | 3. Report Fault / Log PM
        </div>
      `;

      gridEl.appendChild(tile);

      const qrContainer = document.getElementById(qrBoxId);
      if (!qrContainer) return;

      if (typeof window.QRCode === 'function') {
        try {
          new window.QRCode(qrContainer, {
            text: targetUrl,
            width: 96,
            height: 96,
            colorDark: '#0f172a',
            colorLight: '#ffffff',
            correctLevel: window.QRCode.CorrectLevel ? window.QRCode.CorrectLevel.M : 0
          });
        } catch (err) {
          qrContainer.innerHTML = createFallbackQrSvg(targetUrl, 96);
        }
      } else {
        qrContainer.innerHTML = createFallbackQrSvg(targetUrl, 96);
      }
    });
  }

  /**
   * Standalone initializer for qr-sheets.html
   */
  async function initStandaloneQrSheetsPage() {
    const standaloneMarker = document.getElementById('qr-sheets-standalone-page');
    if (!standaloneMarker) return;

    let allAssets = [];
    let activeZone = 'ALL';

    try {
      const resp = await fetch(`data/equipment_master.json?t=${Date.now()}`, { cache: 'no-store' });
      if (resp.ok) {
        const data = await resp.json();
        allAssets = Array.isArray(data.assets) ? data.assets : [];
      }
    } catch (err) {
      console.error('Failed to load equipment_master.json on qr-sheets.html:', err);
    }

    const baseInput = document.getElementById('qr-base-url-input');
    if (baseInput) {
      baseInput.value = getPortalBaseUrl();
    }

    const applyFilterAndRender = () => {
      const filtered = activeZone === 'ALL'
        ? allAssets
        : allAssets.filter((a) => a.zoneCode === activeZone);
      renderQrDecalSheet(filtered, baseInput ? baseInput.value : undefined);
    };

    applyFilterAndRender();

    const regenBtn = document.getElementById('btn-regenerate-qr');
    if (regenBtn && baseInput) {
      regenBtn.addEventListener('click', () => {
        saveBaseUrlOverride(baseInput.value);
        applyFilterAndRender();
      });
    }

    const printBtn = document.getElementById('btn-print-qr-sheet');
    if (printBtn) {
      printBtn.addEventListener('click', () => {
        window.print();
      });
    }

    document.querySelectorAll('.zone-decal-filter-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        activeZone = btn.getAttribute('data-zone') || 'ALL';
        document.querySelectorAll('.zone-decal-filter-btn').forEach((b) => {
          b.classList.toggle('active', b === btn);
        });
        applyFilterAndRender();
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initStandaloneQrSheetsPage);
  } else {
    initStandaloneQrSheetsPage();
  }

  window.ShopQrGenerator = {
    getPortalBaseUrl,
    saveBaseUrlOverride,
    renderQrDecalSheet
  };
})(window);
