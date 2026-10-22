/**
 * Student Projects Laboratory (930 Kinnear Rd)
 * Operations, Safety (SOP/LOTO) & Preventative Maintenance (PM) Portal
 * Main Application Controller (js/app.js)
 */

(function () {
  'use strict';

  const STORAGE_KEYS = {
    ASSET_OVERRIDES: 'spl_shop_portal_asset_overrides_v3',
    HISTORY_LOG: 'spl_shop_portal_history_log_v3',
    GITHUB_REPO: 'spl_shop_portal_github_repo_v3',
    TEAMS_WEBHOOK: 'spl_shop_portal_teams_webhook_v3'
  };

  const DEFAULT_GITHUB_REPO = 'wrightwmax-sketch/Machine-status-reporting-';

  const state = {
    metadata: {},
    assets: [],
    history: [],
    currentView: 'dashboard', // 'dashboard' | 'history' | 'qr'
    activeAssetId: null,
    activeModalTab: 'fault', // 'fault' | 'sop' | 'loto' | 'pm'
    filters: {
      search: '',
      zone: 'ALL',
      status: 'ALL'
    }
  };

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
   * Determine effective operational/PM bucket for an asset
   * Returns one of: 'OPERATIONAL' | 'PM_DUE_SOON' | 'PM_OVERDUE' | 'DOWN'
   */
  function getEffectiveAssetBucket(asset) {
    const rawStatus = (asset.status || 'OPERATIONAL').toUpperCase();
    if (rawStatus.includes('DOWN')) {
      return 'DOWN';
    }

    if (asset.nextPmDue) {
      const dueDate = new Date(asset.nextPmDue + 'T23:59:59');
      const now = new Date();
      const diffDays = (dueDate - now) / (1000 * 60 * 60 * 24);
      if (diffDays < 0 || (asset.pmStatus || '').toUpperCase() === 'OVERDUE') {
        return 'PM_OVERDUE';
      }
      if (diffDays <= 7 || rawStatus.includes('DEGRADED') || rawStatus.includes('DUE')) {
        return 'PM_DUE_SOON';
      }
    }

    if (rawStatus.includes('DEGRADED') || rawStatus.includes('DUE')) {
      return 'PM_DUE_SOON';
    }

    return 'OPERATIONAL';
  }

  function getStatusBadgeMarkup(bucket, customLabel) {
    if (bucket === 'DOWN') {
      return `<span class="status-badge status-badge-down">🔴 ${escapeHtml(customLabel || 'DOWN / LOCKED OUT')}</span>`;
    }
    if (bucket === 'PM_OVERDUE') {
      return `<span class="status-badge status-badge-down">⚠️ ${escapeHtml(customLabel || 'PM OVERDUE')}</span>`;
    }
    if (bucket === 'PM_DUE_SOON') {
      return `<span class="status-badge status-badge-due">🟡 ${escapeHtml(customLabel || 'DEGRADED / PM DUE')}</span>`;
    }
    return `<span class="status-badge status-badge-operational">🟢 ${escapeHtml(customLabel || 'OPERATIONAL')}</span>`;
  }

  function showToast(message) {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className =
      'pointer-events-auto bg-slate-900 border border-emerald-500/60 text-white px-4 py-3 rounded-xl shadow-2xl text-xs font-bold flex items-center gap-2.5';
    toast.innerHTML = `<span class="text-emerald-400 text-base">✓</span><span>${escapeHtml(message)}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.25s ease';
      setTimeout(() => toast.remove(), 260);
    }, 4200);
  }

  function getConfiguredGithubRepo() {
    const saved = localStorage.getItem(STORAGE_KEYS.GITHUB_REPO);
    return saved && saved.trim() ? saved.trim() : DEFAULT_GITHUB_REPO;
  }

  function getConfiguredTeamsWebhook() {
    const saved = localStorage.getItem(STORAGE_KEYS.TEAMS_WEBHOOK);
    return saved && saved.trim() ? saved.trim() : '';
  }

  /**
   * Load equipment_master.json and pm_history.json and merge client localStorage overrides
   */
  async function loadPortalData() {
    const [masterResp, historyResp] = await Promise.all([
      fetch(`data/equipment_master.json?t=${Date.now()}`, { cache: 'no-store' }),
      fetch(`data/pm_history.json?t=${Date.now()}`, { cache: 'no-store' })
    ]);

    if (!masterResp.ok) {
      throw new Error(`Failed to load data/equipment_master.json (${masterResp.status})`);
    }

    const masterData = await masterResp.json();
    const baseHistory = historyResp.ok ? await historyResp.json() : [];

    state.metadata = masterData.metadata || {};
    const rawAssets = Array.isArray(masterData.assets) ? masterData.assets : [];

    // Apply local overrides if present
    let overrides = {};
    try {
      overrides = JSON.parse(localStorage.getItem(STORAGE_KEYS.ASSET_OVERRIDES) || '{}') || {};
    } catch (e) {
      overrides = {};
    }

    state.assets = rawAssets.map((asset) => {
      const ov = overrides[asset.id];
      if (!ov) return asset;
      return Object.assign({}, asset, ov);
    });

    let localHistory = [];
    try {
      localHistory = JSON.parse(localStorage.getItem(STORAGE_KEYS.HISTORY_LOG) || '[]') || [];
    } catch (e) {
      localHistory = [];
    }

    // Merge localHistory + baseHistory deduplicated by id
    const seenIds = new Set();
    const mergedHistory = [];
    [...localHistory, ...baseHistory].forEach((entry) => {
      if (entry && entry.id && !seenIds.has(entry.id)) {
        seenIds.add(entry.id);
        mergedHistory.push(entry);
      }
    });

    state.history = mergedHistory;
  }

  function saveAssetOverride(assetId, patch) {
    let overrides = {};
    try {
      overrides = JSON.parse(localStorage.getItem(STORAGE_KEYS.ASSET_OVERRIDES) || '{}') || {};
    } catch (e) {
      overrides = {};
    }
    overrides[assetId] = Object.assign({}, overrides[assetId] || {}, patch);
    localStorage.setItem(STORAGE_KEYS.ASSET_OVERRIDES, JSON.stringify(overrides));

    const idx = state.assets.findIndex((a) => a.id === assetId);
    if (idx !== -1) {
      state.assets[idx] = Object.assign({}, state.assets[idx], patch);
    }
  }

  function prependHistoryEntry(entry) {
    let localHistory = [];
    try {
      localHistory = JSON.parse(localStorage.getItem(STORAGE_KEYS.HISTORY_LOG) || '[]') || [];
    } catch (e) {
      localHistory = [];
    }
    localHistory.unshift(entry);
    localStorage.setItem(STORAGE_KEYS.HISTORY_LOG, JSON.stringify(localHistory));
    state.history.unshift(entry);
  }

  /**
   * Dispatch optional Microsoft Teams Alert Message via configured Incoming Webhook
   */
  async function dispatchTeamsAlert(title, asset, statusLabel, reporter, team, notes) {
    const webhookUrl = getConfiguredTeamsWebhook();
    if (!webhookUrl) return false;

    const payload = {
      type: 'message',
      summary: `${title}: ${asset.id} — ${asset.name}`,
      sections: [
        {
          activityTitle: `${title}: ${asset.id} — ${asset.name}`,
          activitySubtitle: 'Student Projects Laboratory (930 Kinnear Rd)',
          facts: [
            { name: 'Facility:', value: 'Student Projects Laboratory (930 Kinnear Rd)' },
            { name: 'Asset ID / Tag:', value: `${asset.id} (Tag: ${asset.equipmentTag || 'N/A'})` },
            { name: 'Zone:', value: asset.zone },
            { name: 'Status:', value: statusLabel },
            { name: 'Team / Role:', value: team },
            { name: 'Submitted By:', value: reporter }
          ],
          text: notes || 'No additional notes.'
        }
      ]
    };

    try {
      await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      return true;
    } catch (err) {
      console.warn('Teams webhook dispatch warning:', err);
      return false;
    }
  }

  /**
   * Update KPI Executive Banner metrics
   */
  function renderExecutiveKpis() {
    const total = state.assets.length || 1;
    let countOperational = 0;
    let countDueSoon = 0;
    let countOverdue = 0;
    let countDown = 0;
    let countPmCompliant = 0;

    state.assets.forEach((asset) => {
      const bucket = getEffectiveAssetBucket(asset);
      if (bucket === 'OPERATIONAL') countOperational++;
      else if (bucket === 'PM_DUE_SOON') countDueSoon++;
      else if (bucket === 'PM_OVERDUE') countOverdue++;
      else if (bucket === 'DOWN') countDown++;

      if (bucket !== 'PM_OVERDUE') {
        countPmCompliant++;
      }
    });

    const pmCompliancePct = Math.round((countPmCompliant / total) * 100);
    const readinessPct = Math.round(((total - countDown) / total) * 100);

    const elPmCompliance = document.getElementById('kpi-pm-compliance');
    const elPmSub = document.getElementById('kpi-pm-count-sub');
    const elPmBar = document.getElementById('kpi-pm-bar');
    const elReadinessPct = document.getElementById('kpi-readiness-pct');
    const elOp = document.getElementById('kpi-count-operational');
    const elDue = document.getElementById('kpi-count-due-soon');
    const elOverdue = document.getElementById('kpi-count-overdue');
    const elDown = document.getElementById('kpi-count-down');
    const elAllCount = document.getElementById('count-all-assets');

    if (elPmCompliance) elPmCompliance.textContent = `${pmCompliancePct}%`;
    if (elPmSub) elPmSub.textContent = `(${countPmCompliant} / ${state.assets.length} Compliant)`;
    if (elPmBar) elPmBar.style.width = `${pmCompliancePct}%`;
    if (elReadinessPct) elReadinessPct.textContent = `${readinessPct}%`;
    if (elOp) elOp.textContent = String(countOperational);
    if (elDue) elDue.textContent = String(countDueSoon);
    if (elOverdue) elOverdue.textContent = String(countOverdue);
    if (elDown) elDown.textContent = String(countDown);
    if (elAllCount) elAllCount.textContent = String(state.assets.length);
  }

  /**
   * Render Equipment Matrix Grid
   */
  function renderEquipmentGrid() {
    const gridEl = document.getElementById('equipment-grid');
    const emptyEl = document.getElementById('empty-filter-state');
    if (!gridEl) return;

    const searchQuery = (state.filters.search || '').trim().toLowerCase();
    const zoneFilter = state.filters.zone || 'ALL';
    const statusFilter = state.filters.status || 'ALL';

    const filtered = state.assets.filter((asset) => {
      const bucket = getEffectiveAssetBucket(asset);
      if (zoneFilter !== 'ALL' && asset.zoneCode !== zoneFilter) {
        return false;
      }
      if (statusFilter !== 'ALL' && bucket !== statusFilter) {
        return false;
      }
      if (searchQuery) {
        const haystack = [
          asset.id,
          asset.name,
          asset.equipmentTag,
          asset.zone,
          asset.conditionNote,
          ...(asset.sop && (asset.sop.ppe || asset.sop.requiredPpe) ? (asset.sop.ppe || asset.sop.requiredPpe) : [])
        ]
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(searchQuery)) {
          return false;
        }
      }
      return true;
    });

    gridEl.innerHTML = '';

    if (filtered.length === 0) {
      if (emptyEl) emptyEl.classList.remove('hidden');
      return;
    }
    if (emptyEl) emptyEl.classList.add('hidden');

    filtered.forEach((asset) => {
      const bucket = getEffectiveAssetBucket(asset);
      let tileStateClass = 'tile-operational';
      if (bucket === 'DOWN' || bucket === 'PM_OVERDUE') tileStateClass = 'tile-down';
      else if (bucket === 'PM_DUE_SOON') tileStateClass = 'tile-due';

      const noGlovesBadge =
        asset.sop && asset.sop.noGlovesWarning
          ? `<span class="px-2 py-0.5 rounded bg-red-950/90 border border-red-500/60 text-[10px] font-mono font-bold text-red-300">🚫 NO GLOVES</span>`
          : '';

      const energySummary =
        asset.loto && Array.isArray(asset.loto.energySources)
          ? asset.loto.energySources.map((e) => e.type).join(' + ')
          : 'Electrical';

      const tile = document.createElement('article');
      tile.className = `asset-tile ${tileStateClass}`;
      tile.setAttribute('data-asset-id', asset.id);

      tile.innerHTML = `
        <div>
          <div class="flex items-center justify-between gap-2 mb-2.5">
            <div class="flex items-center gap-2">
              <span class="px-2.5 py-1 rounded-md bg-crimson text-white font-mono text-xs font-extrabold tracking-wider">${escapeHtml(asset.id)}</span>
              <span class="text-[11px] font-mono text-slate-400">TAG: ${escapeHtml(asset.equipmentTag || 'N/A')}</span>
            </div>
            ${getStatusBadgeMarkup(bucket)}
          </div>

          <h3 class="text-base font-extrabold text-white leading-snug mb-1">${escapeHtml(asset.name)}</h3>
          <p class="text-xs font-medium text-slate-400 mb-3">${escapeHtml(asset.zone)}</p>

          <div class="flex flex-wrap items-center gap-1.5 mb-3">
            ${noGlovesBadge}
            <span class="px-2 py-0.5 rounded bg-slate-900 border border-slate-700 text-[10px] font-mono text-slate-300">⚡ LOTO: ${escapeHtml(energySummary)}</span>
            <span class="px-2 py-0.5 rounded bg-slate-900 border border-slate-700 text-[10px] font-mono text-emerald-300">📅 Next PM: ${escapeHtml(asset.nextPmDue || 'TBD')}</span>
          </div>

          <div class="bg-slate-950/80 border border-slate-800/90 rounded-lg p-2.5 mb-3.5">
            <div class="text-[10px] font-mono uppercase text-slate-400 mb-0.5">Latest Condition / PM Note</div>
            <p class="text-xs text-slate-200 line-clamp-2">${escapeHtml(asset.conditionNote || 'No active faults reported.')}</p>
            <div class="mt-1.5 flex items-center justify-between text-[10px] font-mono text-slate-400">
              <span>Last PM: ${escapeHtml(asset.lastPmDate || 'N/A')}</span>
              <span>Tech: ${escapeHtml(asset.lastPmTech || 'M. Wright')}</span>
            </div>
          </div>
        </div>

        <div class="pt-2 border-t border-slate-800/80">
          <div class="text-[10px] font-mono uppercase tracking-wider text-slate-400 mb-1.5">Unified QR Asset Hub Tabs:</div>
          <div class="grid grid-cols-4 gap-1.5">
            <button type="button" class="tile-tab-btn" data-open-asset="${escapeHtml(asset.id)}" data-open-tab="fault">🚨 Fault</button>
            <button type="button" class="tile-tab-btn" data-open-asset="${escapeHtml(asset.id)}" data-open-tab="sop">🦺 SOP</button>
            <button type="button" class="tile-tab-btn" data-open-asset="${escapeHtml(asset.id)}" data-open-tab="loto">🔒 LOTO</button>
            <button type="button" class="tile-tab-btn" data-open-asset="${escapeHtml(asset.id)}" data-open-tab="pm">🛠️ PM Log</button>
          </div>
        </div>
      `;

      gridEl.appendChild(tile);
    });

    // Attach click handlers to open modal at requested tab
    gridEl.querySelectorAll('[data-open-asset]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const assetId = btn.getAttribute('data-open-asset');
        const tab = btn.getAttribute('data-open-tab') || 'fault';
        openAssetHubModal(assetId, tab, true);
      });
    });
  }

  /**
   * Render Historical PM & Condition Log Table
   */
  function renderHistoryTable() {
    const tbody = document.getElementById('history-table-body');
    if (!tbody) return;

    tbody.innerHTML = '';

    state.history.forEach((entry) => {
      const tr = document.createElement('tr');
      tr.className = 'hover:bg-slate-900/50 transition';

      const dateStr = (entry.timestamp || '').replace('T', ' ').replace('Z', ' UTC');
      const isPm = entry.type === 'MONTHLY_PM';
      const typePill = isPm
        ? `<span class="px-2 py-0.5 rounded bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 font-mono text-[10px] font-bold">MONTHLY PM</span>`
        : `<span class="px-2 py-0.5 rounded bg-amber-500/15 border border-amber-500/40 text-amber-300 font-mono text-[10px] font-bold">${escapeHtml(entry.type || 'FAULT')}</span>`;

      const metricsEntries = entry.metrics ? Object.entries(entry.metrics) : [];
      const metricsHtml =
        metricsEntries.length > 0
          ? metricsEntries
              .map(([k, v]) => `<span class="inline-block mr-1.5 mb-1 px-1.5 py-0.5 rounded bg-slate-900 border border-slate-700 font-mono text-[10px] text-slate-300">${escapeHtml(k)}: <strong>${escapeHtml(v)}</strong></span>`)
              .join('')
          : '<span class="text-slate-500 font-mono text-[11px]">—</span>';

      const bucket = (entry.statusAfter || '').includes('DOWN')
        ? 'DOWN'
        : (entry.statusAfter || '').includes('DEGRADED') || (entry.statusAfter || '').includes('DUE')
        ? 'PM_DUE_SOON'
        : 'OPERATIONAL';

      tr.innerHTML = `
        <td class="px-4 py-3 font-mono text-xs text-slate-300 whitespace-nowrap">${escapeHtml(dateStr)}</td>
        <td class="px-4 py-3 whitespace-nowrap">${typePill}</td>
        <td class="px-4 py-3">
          <div class="font-mono font-bold text-white text-xs">${escapeHtml(entry.assetId)}</div>
          <div class="text-[11px] text-slate-400">${escapeHtml(entry.assetName || '')}</div>
        </td>
        <td class="px-4 py-3">
          <div class="text-xs font-semibold text-slate-200">${escapeHtml(entry.technician || '')}</div>
          <div class="text-[11px] text-slate-400">${escapeHtml(entry.teamOrRole || '')}</div>
        </td>
        <td class="px-4 py-3 whitespace-nowrap">${getStatusBadgeMarkup(bucket, entry.statusAfter)}</td>
        <td class="px-4 py-3">${metricsHtml}</td>
        <td class="px-4 py-3 text-xs text-slate-300 max-w-md">${escapeHtml(entry.notes || '')}</td>
      `;

      tbody.appendChild(tr);
    });
  }

  /**
   * Transform standard Google Drive sharing or folder links into responsive embed preview URLs,
   * full view URLs, and direct download URLs.
   */
  function transformGoogleDriveUrl(rawUrl) {
    const clean = String(rawUrl || '').trim();
    if (!clean) {
      return {
        docId: '',
        viewUrl: 'https://drive.google.com/drive/u/0/folders/1dak3rYNFcNR9rRcwcjyfqcOymIxjqfNr',
        previewUrl: 'https://drive.google.com/embeddedfolderview?id=1dak3rYNFcNR9rRcwcjyfqcOymIxjqfNr#list',
        downloadUrl: 'https://drive.google.com/drive/u/0/folders/1dak3rYNFcNR9rRcwcjyfqcOymIxjqfNr'
      };
    }

    const folderMatch = clean.match(/\/folders\/([a-zA-Z0-9_-]+)/);
    if (folderMatch && folderMatch[1]) {
      const folderId = folderMatch[1];
      return {
        docId: folderId,
        viewUrl: `https://drive.google.com/drive/u/0/folders/${folderId}`,
        previewUrl: `https://drive.google.com/embeddedfolderview?id=${folderId}#list`,
        downloadUrl: `https://drive.google.com/drive/u/0/folders/${folderId}`
      };
    }

    const fileMatch = clean.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
    const idParamMatch = clean.match(/[?&]id=([a-zA-Z0-9_-]+)/);
    const docId = (fileMatch && fileMatch[1]) || (idParamMatch && idParamMatch[1]) || '';

    if (docId) {
      return {
        docId: docId,
        viewUrl: `https://drive.google.com/file/d/${docId}/view`,
        previewUrl: `https://drive.google.com/file/d/${docId}/preview`,
        downloadUrl: `https://drive.google.com/uc?export=download&id=${docId}`
      };
    }

    const fallbackPreview = clean.replace(/\/view(\?.*)?$/i, '/preview');
    return {
      docId: '',
      viewUrl: clean,
      previewUrl: fallbackPreview,
      downloadUrl: clean
    };
  }

  window.transformGoogleDriveUrl = transformGoogleDriveUrl;

  /**
   * Populate the 4-Tab Unified Asset Hub Modal for a given asset
   */
  function openAssetHubModal(assetId, initialTab, pushUrl) {
    const asset = state.assets.find((a) => a.id.toUpperCase() === String(assetId || '').toUpperCase());
    if (!asset) return;

    state.activeAssetId = asset.id;
    state.activeModalTab = initialTab || 'fault';

    const modalEl = document.getElementById('asset-hub-modal');
    if (!modalEl) return;

    const bucket = getEffectiveAssetBucket(asset);

    // Header fields
    const elId = document.getElementById('modal-asset-id');
    const elTagId = document.getElementById('modal-equipment-tag');
    const elZone = document.getElementById('modal-asset-zone');
    const elStatusPill = document.getElementById('modal-asset-status-pill');
    const elName = document.getElementById('modal-asset-name');
    const elConditionNote = document.getElementById('modal-asset-condition-note');
    const elLastPm = document.getElementById('modal-asset-last-pm');
    const elNextPm = document.getElementById('modal-asset-next-pm');
    const elPmTech = document.getElementById('modal-asset-pm-tech');

    if (elId) elId.textContent = asset.id;
    if (elTagId) elTagId.textContent = `TAG: ${asset.equipmentTag || 'N/A'}`;
    if (elZone) elZone.textContent = asset.zone;
    if (elStatusPill) elStatusPill.innerHTML = getStatusBadgeMarkup(bucket);
    if (elName) elName.textContent = asset.name;
    if (elConditionNote) elConditionNote.textContent = asset.conditionNote || 'Operational.';
    if (elLastPm) elLastPm.textContent = `Last PM: ${asset.lastPmDate || 'N/A'}`;
    if (elNextPm) elNextPm.textContent = `Next Due: ${asset.nextPmDue || 'N/A'}`;
    if (elPmTech) elPmTech.textContent = `Tech: ${asset.lastPmTech || 'M. Wright'}`;

    // Populate Official Document Viewer for SOP & LOTO (uses official Google Drive LOTO folder or configured PDF path)
    const officialLotoFolderUrl = 'https://drive.google.com/drive/u/0/folders/1dak3rYNFcNR9rRcwcjyfqcOymIxjqfNr';

    const bindDocumentViewer = (prefix, localPdfPath, rawDriveUrl, docTitle, docRev) => {
      const urls = transformGoogleDriveUrl(rawDriveUrl || officialLotoFolderUrl);
      const effectiveTargetUrl = localPdfPath || urls.previewUrl;
      const effectiveOpenUrl = localPdfPath || urls.viewUrl;
      const effectiveDownloadUrl = localPdfPath || urls.downloadUrl;

      const pathBadgeEl = document.getElementById(`${prefix}-local-path-badge`);
      const titleEl = document.getElementById(`${prefix}-doc-title`);
      const revEl = document.getElementById(`${prefix}-doc-rev`);
      const fullscreenBtn = document.getElementById(`${prefix}-fullscreen-btn`);
      const dlBtn = document.getElementById(`${prefix}-download-pdf-btn`);
      const openDriveBtn = document.getElementById(`${prefix}-open-drive-btn`);
      const objectEl = document.getElementById(`${prefix}-pdf-object`);
      const iframeEl = document.getElementById(`${prefix}-pdf-iframe`);
      const fallbackLinkEl = document.getElementById(`${prefix}-pdf-fallback-link`);

      if (pathBadgeEl) pathBadgeEl.textContent = localPdfPath || urls.viewUrl;
      if (titleEl) titleEl.textContent = docTitle;
      if (revEl) revEl.textContent = docRev;
      if (fullscreenBtn) fullscreenBtn.href = effectiveOpenUrl;
      if (dlBtn) {
        dlBtn.href = effectiveDownloadUrl;
        if (localPdfPath) {
          dlBtn.setAttribute('download', localPdfPath.split('/').pop() || `${prefix}.pdf`);
        } else {
          dlBtn.removeAttribute('download');
        }
      }
      if (openDriveBtn) {
        openDriveBtn.href = urls.viewUrl;
        openDriveBtn.classList.remove('hidden');
      }
      if (objectEl) objectEl.setAttribute('data', effectiveTargetUrl);
      if (iframeEl) iframeEl.setAttribute('src', effectiveTargetUrl);
      if (fallbackLinkEl) fallbackLinkEl.setAttribute('href', effectiveOpenUrl);
    };

    bindDocumentViewer(
      'sop',
      asset.sop_pdf_path || '',
      asset.sop_drive_url || officialLotoFolderUrl,
      asset.sop_doc_title || `Standard Operating Procedure (SOP) — ${asset.id}: ${asset.name}`,
      asset.sop_revision_date || 'Rev. 2026-10 • Official Shop Standard'
    );

    bindDocumentViewer(
      'loto',
      asset.loto_pdf_path || '',
      asset.loto_drive_url || officialLotoFolderUrl,
      asset.loto_doc_title || `Lockout / Tagout (LOTO) Procedure — ${asset.id}: ${asset.name}`,
      asset.loto_revision_date || 'Rev. 2026-10 • Official Shop Standard'
    );

    // Populate Tab 2: SOP
    const sop = asset.sop || {};
    const noGlovesBanner = document.getElementById('sop-no-gloves-banner');
    if (noGlovesBanner) {
      if (sop.noGlovesWarning) {
        noGlovesBanner.classList.remove('hidden');
      } else {
        noGlovesBanner.classList.add('hidden');
      }
    }

    const ppeContainer = document.getElementById('sop-ppe-badges');
    if (ppeContainer) {
      const ppeItems = sop.ppe || sop.requiredPpe || [];
      ppeContainer.innerHTML = ppeItems
        .map(
          (item) =>
            `<span class="px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-xs font-bold text-slate-100 flex items-center gap-1.5"><span>🦺</span><span>${escapeHtml(item)}</span></span>`
        )
        .join('');
    }

    const hazardsList = document.getElementById('sop-hazards-list');
    if (hazardsList) {
      hazardsList.innerHTML = (sop.hazards || [])
        .map(
          (h) =>
            `<li class="flex items-start gap-2"><span class="text-amber-400 font-bold">•</span><span>${escapeHtml(h)}</span></li>`
        )
        .join('');
    }

    const fillStepList = (elIdStr, items, bulletColor) => {
      const listEl = document.getElementById(elIdStr);
      if (!listEl) return;
      listEl.innerHTML = (items || [])
        .map(
          (step, idx) =>
            `<li class="flex items-start gap-2"><span class="${bulletColor} font-mono font-bold text-xs">${idx + 1}.</span><span>${escapeHtml(step)}</span></li>`
        )
        .join('');
    };

    fillStepList('sop-before-list', sop.beforeUse, 'text-sky-400');
    fillStepList('sop-during-list', sop.duringUse, 'text-amber-400');
    fillStepList('sop-after-list', sop.afterUse, 'text-emerald-400');

    const emergencyEl = document.getElementById('sop-emergency-text');
    if (emergencyEl) {
      emergencyEl.textContent =
        sop.emergencyProtocol ||
        'Depress emergency stop immediately and notify Max Wright via Microsoft Teams or Text Message.';
    }

    // Populate Tab 3: LOTO
    const loto = asset.loto || {};
    const lotoAuthEl = document.getElementById('loto-authorized');
    const lotoNotifyEl = document.getElementById('loto-notify');
    const lotoShutdownEl = document.getElementById('loto-normal-shutdown');
    const lotoReliefEl = document.getElementById('loto-stored-energy');
    const lotoVerifyEl = document.getElementById('loto-verification');
    const lotoSourcesContainer = document.getElementById('loto-energy-sources');

    if (lotoAuthEl) {
      lotoAuthEl.textContent =
        loto.authorizedPersonnel ||
        'Sr. Instructional Lab Supervisor (Max Wright) & Student Research Assistants (SRAs)';
    }
    if (lotoNotifyEl) {
      lotoNotifyEl.textContent = loto.notificationMethod || 'Max Wright - Teams / Text Message';
    }
    if (lotoShutdownEl) {
      lotoShutdownEl.textContent = loto.normalShutdown || '';
    }
    if (lotoReliefEl) {
      lotoReliefEl.textContent = loto.storedEnergyRelief || '';
    }
    if (lotoVerifyEl) {
      lotoVerifyEl.textContent = loto.zeroEnergyVerification || '';
    }

    if (lotoSourcesContainer) {
      lotoSourcesContainer.innerHTML = (loto.energySources || [])
        .map(
          (src, idx) => `
          <div class="bg-slate-900/80 border border-red-500/30 rounded-xl p-4">
            <div class="flex flex-wrap items-center justify-between gap-2 mb-2">
              <span class="px-2.5 py-0.5 rounded bg-red-500/20 border border-red-500/40 font-mono text-xs font-extrabold text-red-300">
                ENERGY SOURCE #${idx + 1}: ${escapeHtml(src.type)}
              </span>
              <span class="font-mono text-xs font-bold text-amber-300">Magnitude: ${escapeHtml(src.magnitude)}</span>
            </div>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs mt-2">
              <div class="bg-slate-950/70 border border-slate-800 rounded-lg p-2.5">
                <div class="font-mono text-[10px] uppercase text-slate-400 mb-0.5">Isolation Device Location</div>
                <div class="text-slate-100 font-medium">${escapeHtml(src.isolationLocation)}</div>
              </div>
              <div class="bg-slate-950/70 border border-slate-800 rounded-lg p-2.5">
                <div class="font-mono text-[10px] uppercase text-slate-400 mb-0.5">Lockout Application Procedure</div>
                <div class="text-slate-100 font-medium">${escapeHtml(src.isolationProcedure)}</div>
              </div>
            </div>
          </div>
        `
        )
        .join('');
    }

    // Populate Tab 4: Monthly PM Checklist & Quantitative Metrics
    const pm = asset.monthlyPm || {};
    const freqBadge = document.getElementById('pm-frequency-badge');
    if (freqBadge) {
      freqBadge.textContent = `${pm.frequency || 'Monthly'} (30-Day Interval)`;
    }

    const checklistContainer = document.getElementById('pm-checklist-items');
    if (checklistContainer) {
      checklistContainer.innerHTML = (pm.checklist || [])
        .map(
          (item, idx) => `
          <label class="flex items-start gap-3 p-3 rounded-lg bg-slate-950/80 border border-slate-800 hover:border-slate-700 cursor-pointer transition">
            <input type="checkbox" class="pm-check-item mt-0.5 rounded border-slate-600 text-emerald-500 focus:ring-emerald-500" data-check-label="${escapeHtml(item)}" checked />
            <span class="text-xs text-slate-200 leading-relaxed"><strong class="font-mono text-emerald-400 mr-1">#${idx + 1}</strong> ${escapeHtml(item)}</span>
          </label>
        `
        )
        .join('');
    }

    const metricsContainer = document.getElementById('pm-quantitative-fields');
    if (metricsContainer) {
      const qMetrics = pm.metrics || pm.quantitativeMetrics || [];
      if (qMetrics.length === 0) {
        metricsContainer.innerHTML =
          '<p class="text-xs text-slate-400 col-span-3">No numerical wear fields required for this asset.</p>';
      } else {
        metricsContainer.innerHTML = qMetrics
          .map(
            (m) => `
            <div class="bg-slate-950/80 border border-slate-800 rounded-lg p-3">
              <label class="block text-[11px] font-bold text-slate-200 mb-1">
                ${escapeHtml(m.label)} <span class="font-mono text-amber-400">(${escapeHtml(m.unit || '')})</span>
              </label>
              <input
                type="text"
                class="pm-metric-input w-full bg-slate-900 border border-slate-700 rounded-md px-2.5 py-1.5 text-xs font-mono text-white focus:outline-none focus:border-amber-500"
                data-metric-key="${escapeHtml(m.key)}"
                data-metric-unit="${escapeHtml(m.unit || '')}"
                placeholder="${escapeHtml(m.placeholder || '')}"
                value="${escapeHtml(m.placeholder || '')}"
              />
              <div class="text-[10px] font-mono text-slate-400 mt-1">Target Spec: ${escapeHtml(m.targetRange || m.placeholder || 'Standard')}</div>
            </div>
          `
          )
          .join('');
      }
    }

    switchModalTab(state.activeModalTab, pushUrl);
    modalEl.classList.remove('hidden');
  }

  function switchModalTab(tabName, updateUrl) {
    const validTabs = ['fault', 'sop', 'loto', 'pm'];
    const normalized = validTabs.includes(tabName) ? tabName : 'fault';
    state.activeModalTab = normalized;

    document.querySelectorAll('.modal-tab-btn').forEach((btn) => {
      const t = btn.getAttribute('data-modal-tab');
      btn.classList.toggle('active', t === normalized);
    });

    validTabs.forEach((t) => {
      const panel = document.getElementById(`modal-tab-${t}`);
      if (panel) {
        panel.classList.toggle('hidden', t !== normalized);
      }
    });

    if (updateUrl && state.activeAssetId && window.history && window.history.replaceState) {
      const url = new URL(window.location.href);
      url.searchParams.set('asset', state.activeAssetId);
      url.searchParams.set('tab', normalized);
      window.history.replaceState({}, '', url.toString());
    }
  }

  function closeAssetHubModal() {
    const modalEl = document.getElementById('asset-hub-modal');
    if (modalEl) modalEl.classList.add('hidden');
    state.activeAssetId = null;

    if (window.history && window.history.replaceState) {
      const url = new URL(window.location.href);
      url.searchParams.delete('asset');
      url.searchParams.delete('tab');
      window.history.replaceState({}, '', url.toString());
    }
  }

  /**
   * Build pre-filled GitHub Issue URL for Fault Report or Monthly PM Log
   */
  function buildGithubIssueUrl(templateFile, paramsObj) {
    const repo = getConfiguredGithubRepo();
    const searchParams = new URLSearchParams();
    searchParams.set('template', templateFile);
    Object.entries(paramsObj).forEach(([k, v]) => {
      if (v !== undefined && v !== null && String(v).trim() !== '') {
        searchParams.set(k, String(v));
      }
    });
    return `https://github.com/${repo}/issues/new?${searchParams.toString()}`;
  }

  /**
   * Handle Fault Report Submission (Local + Optional GitHub Issue Window)
   */
  async function handleFaultSubmission(openGithubIssue) {
    const asset = state.assets.find((a) => a.id === state.activeAssetId);
    if (!asset) return;

    const checkedRadio = document.querySelector('input[name="fault-severity"]:checked');
    const severityVal = checkedRadio ? checkedRadio.value : 'DOWN';
    const teamSelect = document.getElementById('fault-team-select');
    const reporterInput = document.getElementById('fault-reporter-input');
    const descInput = document.getElementById('fault-description-input');

    const team = teamSelect ? teamSelect.value : 'Formula Buckeyes';
    const reporter = (reporterInput && reporterInput.value.trim()) || 'Shop Floor User';
    const description =
      (descInput && descInput.value.trim()) ||
      `Status updated to ${severityVal} via Unified QR Hub.`;

    const nowIso = new Date().toISOString();
    saveAssetOverride(asset.id, {
      status: severityVal,
      conditionNote: description
    });

    const entry = {
      id: `FLT-${Date.now()}-${asset.id.replace('-', '')}`,
      timestamp: nowIso,
      type: severityVal === 'OPERATIONAL' ? 'FAULT_RESOLVED' : 'FAULT_REPORT',
      assetId: asset.id,
      assetName: asset.name,
      teamOrRole: team,
      technician: reporter,
      statusAfter: severityVal,
      pmStatusAfter: asset.pmStatus || 'COMPLIANT',
      metrics: {},
      completedItemsCount: 0,
      totalItemsCount: 0,
      notes: description
    };

    prependHistoryEntry(entry);
    renderExecutiveKpis();
    renderEquipmentGrid();
    renderHistoryTable();
    openAssetHubModal(asset.id, 'fault', false);

    await dispatchTeamsAlert('Machine Condition Alert', asset, severityVal, reporter, team, description);

    if (openGithubIssue) {
      const severityDropdownText =
        severityVal === 'DOWN'
          ? 'DOWN - LOCKED OUT (Red Tag / Do Not Operate)'
          : severityVal === 'DEGRADED'
          ? 'DEGRADED / CAUTION (Yellow Tag / Needs Tooling or Minor Attention)'
          : 'OPERATIONAL (Cleared / Returned to Service)';

      const issueUrl = buildGithubIssueUrl('unscheduled_downtime_fault.yml', {
        title: `[FAULT] ${asset.id} (${asset.name}) — ${severityVal}`,
        asset_id: asset.id,
        student_team: team,
        severity_status: severityDropdownText,
        reporter: reporter,
        fault_description: description
      });

      window.open(issueUrl, '_blank', 'noopener');
      showToast(`Updated ${asset.id} (${severityVal}) & opened GitHub Fault Ticket`);
    } else {
      showToast(`Status updated for ${asset.id}: ${severityVal}`);
    }
  }

  /**
   * Handle Monthly PM Checklist Submission (Local + Optional GitHub Issue Window)
   */
  async function handlePmSubmission(openGithubIssue) {
    const asset = state.assets.find((a) => a.id === state.activeAssetId);
    if (!asset) return;

    const techInput = document.getElementById('pm-tech-input');
    const postStatusSelect = document.getElementById('pm-post-status-select');
    const notesInput = document.getElementById('pm-notes-input');

    const technician = (techInput && techInput.value.trim()) || 'Max Wright (MW)';
    const postStatus = postStatusSelect ? postStatusSelect.value : 'OPERATIONAL';
    const notes =
      (notesInput && notesInput.value.trim()) ||
      `Completed standardized monthly PM checklist for ${asset.id}.`;

    const checkedBoxes = Array.from(document.querySelectorAll('#pm-checklist-items .pm-check-item'));
    const completedLines = checkedBoxes.map((cb) => {
      const lbl = cb.getAttribute('data-check-label') || '';
      return `- [${cb.checked ? 'x' : ' '}] ${lbl}`;
    });
    const completedCount = checkedBoxes.filter((cb) => cb.checked).length;

    const metricInputs = Array.from(document.querySelectorAll('#pm-quantitative-fields .pm-metric-input'));
    const metricsObj = {};
    const metricsLines = [];
    metricInputs.forEach((inp) => {
      const key = inp.getAttribute('data-metric-key');
      const unit = inp.getAttribute('data-metric-unit') || '';
      const val = (inp.value || '').trim();
      if (key && val) {
        metricsObj[key] = unit && !val.includes(unit) ? `${val} ${unit}` : val;
        metricsLines.push(`${key}: ${metricsObj[key]}`);
      }
    });

    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);
    const nextDue = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    saveAssetOverride(asset.id, {
      status: postStatus === 'DOWN' ? 'DOWN' : postStatus === 'PM_DUE_SOON' ? 'DEGRADED' : 'OPERATIONAL',
      pmStatus: postStatus === 'OPERATIONAL' ? 'COMPLIANT' : 'ATTENTION',
      lastPmDate: todayStr,
      nextPmDue: nextDue,
      lastPmTech: technician,
      conditionNote: notes
    });

    const entry = {
      id: `PM-${Date.now()}-${asset.id.replace('-', '')}`,
      timestamp: now.toISOString(),
      type: 'MONTHLY_PM',
      assetId: asset.id,
      assetName: asset.name,
      teamOrRole: 'Shop Staff',
      technician: technician,
      statusAfter: postStatus,
      pmStatusAfter: postStatus === 'OPERATIONAL' ? 'COMPLIANT' : 'ATTENTION',
      metrics: metricsObj,
      completedItemsCount: completedCount,
      totalItemsCount: checkedBoxes.length,
      notes: notes
    };

    prependHistoryEntry(entry);
    renderExecutiveKpis();
    renderEquipmentGrid();
    renderHistoryTable();
    openAssetHubModal(asset.id, 'pm', false);

    await dispatchTeamsAlert('Monthly PM Logged', asset, postStatus, technician, 'Shop Staff', notes);

    if (openGithubIssue) {
      const issueUrl = buildGithubIssueUrl('monthly_pm_log.yml', {
        title: `[PM-LOG] ${asset.id} (${asset.name}) — ${todayStr}`,
        asset_id: asset.id,
        post_pm_status: postStatus === 'PM_DUE_SOON' ? 'PM DUE SOON' : postStatus === 'DOWN' ? 'DOWN - LOCKED OUT' : 'OPERATIONAL',
        technician: technician,
        checklist_summary: completedLines.join('\n'),
        quantitative_metrics: metricsLines.join('\n'),
        pm_notes: notes
      });
      window.open(issueUrl, '_blank', 'noopener');
      showToast(`Monthly PM logged for ${asset.id} & opened GitHub PM Issue`);
    } else {
      showToast(`Monthly PM recorded for ${asset.id} (Next due: ${nextDue})`);
    }
  }

  /**
   * Switch Top-Level Portal View ('dashboard' | 'history' | 'qr')
   */
  function switchPortalView(viewName, updateUrl) {
    const validViews = ['dashboard', 'history', 'qr'];
    const target = validViews.includes(viewName) ? viewName : 'dashboard';
    state.currentView = target;

    const elDash = document.getElementById('view-dashboard');
    const elHist = document.getElementById('view-history');
    const elQr = document.getElementById('view-qr');

    if (elDash) elDash.classList.toggle('hidden', target !== 'dashboard');
    if (elHist) elHist.classList.toggle('hidden', target !== 'history');
    if (elQr) elQr.classList.toggle('hidden', target !== 'qr');

    const navDash = document.getElementById('nav-btn-dashboard');
    const navHist = document.getElementById('nav-btn-history');
    const navQr = document.getElementById('nav-btn-qr');

    if (navDash) navDash.classList.toggle('active', target === 'dashboard');
    if (navHist) navHist.classList.toggle('active', target === 'history');
    if (navQr) navQr.classList.toggle('active', target === 'qr');

    if (target === 'qr' && window.ShopQrGenerator) {
      window.ShopQrGenerator.renderQrDecalSheet(state.assets);
    }

    if (updateUrl && window.history && window.history.replaceState) {
      const url = new URL(window.location.href);
      if (target === 'dashboard') {
        url.searchParams.delete('view');
      } else {
        url.searchParams.set('view', target);
      }
      window.history.replaceState({}, '', url.toString());
    }
  }

  /**
   * Export PM & Condition History to CSV
   */
  function exportHistoryCsv() {
    const headers = [
      'RecordID',
      'TimestampUTC',
      'Type',
      'AssetID',
      'AssetName',
      'TeamOrRole',
      'TechnicianOrReporter',
      'StatusAfter',
      'PMStatusAfter',
      'CompletedChecklistItems',
      'TotalChecklistItems',
      'QuantitativeMetrics',
      'Notes'
    ];

    const escapeCsv = (val) => {
      const s = val === null || val === undefined ? '' : String(val);
      return `"${s.replace(/"/g, '""')}"`;
    };

    const rows = state.history.map((h) => [
      h.id,
      h.timestamp,
      h.type,
      h.assetId,
      h.assetName,
      h.teamOrRole,
      h.technician,
      h.statusAfter,
      h.pmStatusAfter,
      h.completedItemsCount,
      h.totalItemsCount,
      JSON.stringify(h.metrics || {}),
      h.notes
    ]);

    const csvContent =
      headers.map(escapeCsv).join(',') +
      '\n' +
      rows.map((r) => r.map(escapeCsv).join(',')).join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `student_projects_shop_pm_history_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    showToast('Exported PM & Condition History CSV');
  }

  function exportMasterJson() {
    const payload = {
      metadata: Object.assign({}, state.metadata, {
        lastUpdated: new Date().toISOString()
      }),
      assets: state.assets
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json;charset=utf-8;'
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'equipment_master.json';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    showToast('Downloaded updated equipment_master.json');
  }

  /**
   * Bind all UI event listeners
   */
  function bindEvents() {
    // Top view navigation
    const navDash = document.getElementById('nav-btn-dashboard');
    const navHist = document.getElementById('nav-btn-history');
    const navQr = document.getElementById('nav-btn-qr');

    if (navDash) navDash.addEventListener('click', () => switchPortalView('dashboard', true));
    if (navHist) navHist.addEventListener('click', () => switchPortalView('history', true));
    if (navQr) navQr.addEventListener('click', () => switchPortalView('qr', true));

    // Search input
    const searchInput = document.getElementById('asset-search-input');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        state.filters.search = e.target.value || '';
        renderEquipmentGrid();
      });
    }

    // Status filter pills
    document.querySelectorAll('.status-filter-pill').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.filters.status = btn.getAttribute('data-status') || 'ALL';
        document.querySelectorAll('.status-filter-pill').forEach((b) => {
          b.classList.toggle('active', b === btn);
        });
        renderEquipmentGrid();
      });
    });

    // Quick KPI mini-pill filters
    document.querySelectorAll('[data-status-quick]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const targetStatus = btn.getAttribute('data-status-quick') || 'ALL';
        state.filters.status = state.filters.status === targetStatus ? 'ALL' : targetStatus;
        document.querySelectorAll('.status-filter-pill').forEach((b) => {
          b.classList.toggle('active', b.getAttribute('data-status') === state.filters.status);
        });
        switchPortalView('dashboard', true);
        renderEquipmentGrid();
      });
    });

    // Zone filter pills
    document.querySelectorAll('.zone-filter-pill').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.filters.zone = btn.getAttribute('data-zone') || 'ALL';
        document.querySelectorAll('.zone-filter-pill').forEach((b) => {
          b.classList.toggle('active', b === btn);
        });
        renderEquipmentGrid();
      });
    });

    // Reset filters
    const resetBtn = document.getElementById('btn-reset-filters');
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        state.filters = { search: '', zone: 'ALL', status: 'ALL' };
        if (searchInput) searchInput.value = '';
        document.querySelectorAll('.status-filter-pill').forEach((b) => {
          b.classList.toggle('active', b.getAttribute('data-status') === 'ALL');
        });
        document.querySelectorAll('.zone-filter-pill').forEach((b) => {
          b.classList.toggle('active', b.getAttribute('data-zone') === 'ALL');
        });
        renderEquipmentGrid();
      });
    }

    // Modal tab buttons
    document.querySelectorAll('.modal-tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const tab = btn.getAttribute('data-modal-tab') || 'fault';
        switchModalTab(tab, true);
      });
    });

    // Close modal buttons
    const closeBtn = document.getElementById('btn-close-asset-modal');
    const backdrop = document.getElementById('asset-hub-modal-backdrop');
    if (closeBtn) closeBtn.addEventListener('click', closeAssetHubModal);
    if (backdrop) backdrop.addEventListener('click', closeAssetHubModal);

    // Save custom Google Drive SOP / LOTO PDF links per asset
    const saveSopDriveBtn = document.getElementById('btn-save-sop-drive-url');
    if (saveSopDriveBtn) {
      saveSopDriveBtn.addEventListener('click', () => {
        const inp = document.getElementById('sop-drive-url-input');
        if (!state.activeAssetId || !inp || !inp.value.trim()) return;
        saveAssetOverride(state.activeAssetId, { sop_drive_url: inp.value.trim() });
        openAssetHubModal(state.activeAssetId, 'sop', false);
        showToast(`Bound Google Drive SOP PDF for ${state.activeAssetId}`);
      });
    }

    const saveLotoDriveBtn = document.getElementById('btn-save-loto-drive-url');
    if (saveLotoDriveBtn) {
      saveLotoDriveBtn.addEventListener('click', () => {
        const inp = document.getElementById('loto-drive-url-input');
        if (!state.activeAssetId || !inp || !inp.value.trim()) return;
        saveAssetOverride(state.activeAssetId, { loto_drive_url: inp.value.trim() });
        openAssetHubModal(state.activeAssetId, 'loto', false);
        showToast(`Bound Google Drive LOTO PDF for ${state.activeAssetId}`);
      });
    }

    // Fault report form submissions
    const faultForm = document.getElementById('fault-report-form');
    if (faultForm) {
      faultForm.addEventListener('submit', (e) => {
        e.preventDefault();
        handleFaultSubmission(true);
      });
    }
    const faultLocalBtn = document.getElementById('btn-fault-local-save');
    if (faultLocalBtn) {
      faultLocalBtn.addEventListener('click', () => {
        handleFaultSubmission(false);
      });
    }

    // Monthly PM form submissions
    const pmForm = document.getElementById('monthly-pm-form');
    if (pmForm) {
      pmForm.addEventListener('submit', (e) => {
        e.preventDefault();
        handlePmSubmission(true);
      });
    }
    const pmLocalBtn = document.getElementById('btn-pm-local-save');
    if (pmLocalBtn) {
      pmLocalBtn.addEventListener('click', () => {
        handlePmSubmission(false);
      });
    }

    // CSV & JSON export buttons
    const csvBtn = document.getElementById('btn-export-csv');
    const jsonBtn = document.getElementById('btn-export-json');
    if (csvBtn) csvBtn.addEventListener('click', exportHistoryCsv);
    if (jsonBtn) jsonBtn.addEventListener('click', exportMasterJson);

    // QR Sheet controls
    const regenQrBtn = document.getElementById('btn-regenerate-qr');
    const qrBaseInput = document.getElementById('qr-base-url-input');
    const printQrBtn = document.getElementById('btn-print-qr-sheet');

    if (regenQrBtn && qrBaseInput) {
      regenQrBtn.addEventListener('click', () => {
        if (window.ShopQrGenerator) {
          window.ShopQrGenerator.saveBaseUrlOverride(qrBaseInput.value);
          window.ShopQrGenerator.renderQrDecalSheet(state.assets, qrBaseInput.value);
          showToast(`Regenerated all ${state.assets.length} 2"×3" QR Machine Decals`);
        }
      });
    }
    if (printQrBtn) {
      printQrBtn.addEventListener('click', () => {
        window.print();
      });
    }

    // Settings Modal
    const settingsBtn = document.getElementById('nav-btn-settings');
    const settingsModal = document.getElementById('settings-modal');
    const closeSettingsBtn = document.getElementById('btn-close-settings');
    const settingsBackdrop = document.getElementById('settings-modal-backdrop');
    const settingsForm = document.getElementById('portal-settings-form');
    const clearOverridesBtn = document.getElementById('btn-clear-local-overrides');

    if (settingsBtn && settingsModal) {
      settingsBtn.addEventListener('click', () => {
        const repoInp = document.getElementById('settings-github-repo');
        const webhookInp = document.getElementById('settings-teams-webhook');
        if (repoInp) repoInp.value = getConfiguredGithubRepo();
        if (webhookInp) webhookInp.value = getConfiguredTeamsWebhook();
        settingsModal.classList.remove('hidden');
      });
    }

    if (closeSettingsBtn && settingsModal) {
      closeSettingsBtn.addEventListener('click', () => settingsModal.classList.add('hidden'));
    }
    if (settingsBackdrop && settingsModal) {
      settingsBackdrop.addEventListener('click', () => settingsModal.classList.add('hidden'));
    }

    if (settingsForm) {
      settingsForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const repoInp = document.getElementById('settings-github-repo');
        const webhookInp = document.getElementById('settings-teams-webhook');
        if (repoInp) localStorage.setItem(STORAGE_KEYS.GITHUB_REPO, repoInp.value.trim());
        if (webhookInp) localStorage.setItem(STORAGE_KEYS.TEAMS_WEBHOOK, webhookInp.value.trim());
        if (settingsModal) settingsModal.classList.add('hidden');
        showToast('Saved GitHub & Teams integration settings');
      });
    }

    if (clearOverridesBtn) {
      clearOverridesBtn.addEventListener('click', async () => {
        localStorage.removeItem(STORAGE_KEYS.ASSET_OVERRIDES);
        localStorage.removeItem(STORAGE_KEYS.HISTORY_LOG);
        await loadPortalData();
        renderExecutiveKpis();
        renderEquipmentGrid();
        renderHistoryTable();
        if (settingsModal) settingsModal.classList.add('hidden');
        showToast(`Reset all ${state.assets.length} assets to baseline equipment_master.json state`);
      });
    }
  }

  /**
   * Parse URL query parameters (?asset=MAC-01&tab=sop or ?view=qr)
   */
  function handleInitialDeepLink() {
    const params = new URLSearchParams(window.location.search);
    const viewParam = (params.get('view') || '').toLowerCase();
    const assetParam = (params.get('asset') || params.get('id') || '').toUpperCase();
    const tabParam = (params.get('tab') || 'fault').toLowerCase();

    if (viewParam === 'qr' || viewParam === 'history') {
      switchPortalView(viewParam, false);
    } else {
      switchPortalView('dashboard', false);
    }

    if (assetParam) {
      openAssetHubModal(assetParam, tabParam, false);
    }
  }

  async function init() {
    try {
      await loadPortalData();
      renderExecutiveKpis();
      renderEquipmentGrid();
      renderHistoryTable();
      bindEvents();
      handleInitialDeepLink();
    } catch (err) {
      console.error('Portal initialization error:', err);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
