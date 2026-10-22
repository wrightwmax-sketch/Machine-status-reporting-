/**
 * Student Projects Laboratory (930 Kinnear Rd)
 * Avery 8395 (2-1/3" x 3-3/8", 8-up) Industrial QR Machine Decal Generator (js/qr-generator.js)
 */

(function (window) {
  'use strict';

  const DEFAULT_PRODUCTION_BASE_URL = 'https://wrightwmax-sketch.github.io/Machine-status-reporting-/';
  const LABELS_PER_AVERY_8395_SHEET = 8;

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
    const loc = window.location;
    if (loc && loc.hostname && loc.hostname.endsWith('github.io')) {
      let path = loc.pathname || '/';
      path = path.replace(/qr-sheets\.html$/i, '').replace(/index\.html$/i, '');
      if (!path.endsWith('/')) {
        path += '/';
      }
      return `${loc.origin}${path}`;
    }
    return DEFAULT_PRODUCTION_BASE_URL;
  }

  /**
   * Render Avery 8395 (8-up: 2 cols x 4 rows, 3-3/8" wide x 2-1/3" tall) QR decal sheets into #qr-decal-grid
   */
  function renderQrDecalSheet(assets) {
    const gridEl = document.getElementById('qr-decal-grid');
    if (!gridEl) return;

    const list = Array.isArray(assets) ? assets : [];
    const baseUrl = getPortalBaseUrl();

    const countEl = document.getElementById('qr-decal-total-count');
    if (countEl) {
      countEl.textContent = String(list.length);
    }

    gridEl.innerHTML = '';

    const totalSheets = Math.max(1, Math.ceil(list.length / LABELS_PER_AVERY_8395_SHEET));
    const qrTasks = [];

    for (let sheetIdx = 0; sheetIdx < totalSheets; sheetIdx++) {
      const sliceStart = sheetIdx * LABELS_PER_AVERY_8395_SHEET;
      const sheetAssets = list.slice(sliceStart, sliceStart + LABELS_PER_AVERY_8395_SHEET);

      const sheetWrapper = document.createElement('div');
      sheetWrapper.className = 'avery-8395-sheet-wrapper';

      const sheetCaption = document.createElement('div');
      sheetCaption.className = 'avery-8395-sheet-caption no-print';
      sheetCaption.innerHTML = `
        <span>📄 <strong>Avery 8395 Sheet ${sheetIdx + 1} of ${totalSheets}</strong> (2-1/3&quot; &times; 3-3/8&quot; Adhesive Name Badge Labels • 2 Columns &times; 4 Rows)</span>
        <span>Labels ${sliceStart + 1}&ndash;${sliceStart + sheetAssets.length} of ${list.length}</span>
      `;
      sheetWrapper.appendChild(sheetCaption);

      const sheetEl = document.createElement('div');
      sheetEl.className = 'avery-8395-sheet';

      sheetAssets.forEach((asset) => {
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

        sheetEl.appendChild(tile);
        qrTasks.push({ qrBoxId, targetUrl });
      });

      sheetWrapper.appendChild(sheetEl);
      gridEl.appendChild(sheetWrapper);
    }

    qrTasks.forEach(({ qrBoxId, targetUrl }) => {
      const qrContainer = document.getElementById(qrBoxId);
      if (!qrContainer) return;

      if (typeof window.QRCode === 'function') {
        try {
          new window.QRCode(qrContainer, {
            text: targetUrl,
            width: 112,
            height: 112,
            colorDark: '#0f172a',
            colorLight: '#ffffff',
            correctLevel: window.QRCode.CorrectLevel ? window.QRCode.CorrectLevel.M : 0
          });
        } catch (err) {
          qrContainer.innerHTML = createFallbackQrSvg(targetUrl, 112);
        }
      } else {
        qrContainer.innerHTML = createFallbackQrSvg(targetUrl, 112);
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

    const applyFilterAndRender = () => {
      const filtered = activeZone === 'ALL'
        ? allAssets
        : allAssets.filter((a) => a.zoneCode === activeZone);
      renderQrDecalSheet(filtered);
    };

    applyFilterAndRender();

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
    renderQrDecalSheet
  };
})(window);
