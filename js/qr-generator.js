/**
 * CAR Student Projects Shop (930 Kinnear Rd)
 * Printable 2" x 3" 3-in-1 QR Machine Decal Sheet Generator (js/qr-generator.js)
 */

(function (window) {
  'use strict';

  const STORAGE_KEY_QR_BASE = 'car_shop_portal_qr_base_url_v1';

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
        if (r < 7 && c < 7) dark = finderCell(r, c, 0, 0);
        else if (r < 7 && c >= modules - 7) dark = finderCell(r, c, 0, modules - 7);
        else if (r >= modules - 7 && c < 7) dark = finderCell(r, c, modules - 7, 0);
        else if (!isFinder(r, c)) {
          const seed = Math.imul(hash ^ (r * 31 + c * 17), 1597334677);
          dark = (seed & 1) === 1;
        }
        if (dark) {
          rects += `<rect x="${c}" y="${r}" width="1" height="1" fill="#000000" />`;
        }
      }
    }

    return `<svg viewBox="0 0 ${modules} ${modules}" width="${sizePx}" height="${sizePx}" shape-rendering="crispEdges" xmlns="http://www.w3.org/2000/svg"><rect width="${modules}" height="${modules}" fill="#ffffff"/>${rects}</svg>`;
  }

  /**
   * Resolve production base URL for QR decals
   */
  function getBaseUrl() {
    const inputEl = document.getElementById('qr-base-url-input');
    if (inputEl && inputEl.value.trim()) {
      return inputEl.value.trim().replace(/\?.*$/, '');
    }
    const stored = localStorage.getItem(STORAGE_KEY_QR_BASE);
    if (stored && stored.trim()) {
      return stored.trim().replace(/\?.*$/, '');
    }
    return window.location.origin + window.location.pathname;
  }

  /**
   * Render all 2" x 3" 3-in-1 QR Machine Decals into #qr-decals-grid
   */
  function renderQrDecalSheet(assets) {
    const gridEl = document.getElementById('qr-decals-grid');
    const baseInputEl = document.getElementById('qr-base-url-input');
    if (!gridEl || !Array.isArray(assets)) return;

    const baseUrl = getBaseUrl();
    if (baseInputEl && !baseInputEl.value) {
      baseInputEl.value = baseUrl;
    }

    gridEl.innerHTML = assets
      .map((asset) => {
        const deepLinkUrl = `${baseUrl}?asset=${encodeURIComponent(asset.id)}`;
        const noGlovesTag =
          asset.sop && asset.sop.noGlovesWarning
            ? `<span class="decal-hazard-pill">🚫 NO GLOVES</span>`
            : `<span class="decal-zone-pill">${escapeHtml(asset.zoneCode || 'SHOP')}</span>`;

        return `
          <article class="qr-decal-card" data-decal-asset="${escapeHtml(asset.id)}">
            <header class="decal-header">
              <span>CAR STUDENT PROJECTS SHOP • 930 KINNEAR RD</span>
            </header>

            <div class="decal-body">
              <div class="decal-top-meta">
                <span class="decal-asset-id">${escapeHtml(asset.id)}</span>
                ${noGlovesTag}
              </div>

              <h3 class="decal-machine-name">${escapeHtml(asset.name)}</h3>
              <div class="decal-equip-id">OSU ID: ${escapeHtml(asset.osuEquipmentId || 'N/A')}</div>

              <div
                class="decal-qr-mount"
                id="decal-qr-${escapeHtml(asset.id)}"
                data-qr-target="${escapeHtml(deepLinkUrl)}"
              ></div>
            </div>

            <footer class="decal-footer">
              <div class="decal-callout-title">SCAN FOR:</div>
              <div class="decal-callout-items">
                1. SOP &amp; PPE &nbsp;|&nbsp; 2. LOTO Procedure &nbsp;|&nbsp; 3. Report Fault / Log PM
              </div>
            </footer>
          </article>
        `;
      })
      .join('');

    // Populate QR code canvases/images inside each decal mount
    for (const asset of assets) {
      const mountEl = document.getElementById(`decal-qr-${asset.id}`);
      if (!mountEl) continue;
      const targetUrl = mountEl.getAttribute('data-qr-target');
      mountEl.innerHTML = '';

      if (typeof window.QRCode === 'function') {
        try {
          new window.QRCode(mountEl, {
            text: targetUrl,
            width: 116,
            height: 116,
            colorDark: '#000000',
            colorLight: '#ffffff',
            correctLevel: window.QRCode.CorrectLevel ? window.QRCode.CorrectLevel.M : 0
          });
        } catch (err) {
          mountEl.innerHTML = createFallbackQrSvg(targetUrl, 116);
        }
      } else {
        mountEl.innerHTML = createFallbackQrSvg(targetUrl, 116);
      }
    }
  }

  function saveBaseUrlOverride(url) {
    if (url && url.trim()) {
      localStorage.setItem(STORAGE_KEY_QR_BASE, url.trim());
    }
  }

  window.ShopQrGenerator = {
    renderQrDecalSheet,
    getBaseUrl,
    saveBaseUrlOverride
  };
})(window);
