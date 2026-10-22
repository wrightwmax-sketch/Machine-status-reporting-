/**
 * CAR Student Projects Shop (930 Kinnear Rd)
 * Operations, Safety (SOP/LOTO) & Preventative Maintenance (PM) Portal
 * Main Application Controller (js/app.js)
 */

(function () {
  'use strict';

  const STORAGE_KEYS = {
    ASSET_OVERRIDES: 'car_shop_portal_asset_overrides_v2',
    HISTORY_LOG: 'car_shop_portal_history_log_v2',
    GITHUB_REPO: 'car_shop_portal_github_repo_v2',
    TEAMS_WEBHOOK: 'car_shop_portal_teams_webhook_v2'
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

  function getStatusMeta(bucket, rawStatus) {
    switch (bucket) {
      case 'DOWN':
        return {
          label: '🔴 DOWN - LOCKED OUT',
          badgeClass: 'status-badge status-down',
          borderTopClass: 'border-t-4 border-t-red-500'
        };
      case 'PM_OVERDUE':
        return {
          label: '🟠 PM OVERDUE',
          badgeClass: 'status-badge status-overdue',
          borderTopClass: 'border-t-4 border-t-orange-500'
        };
      case 'PM_DUE_SOON':
        return {
          label:
            rawStatus && rawStatus.toUpperCase().includes('DEGRADED')
              ? '🟡 DEGRADED / CAUTION'
              : '🟡 PM DUE SOON',
          badgeClass: 'status-badge status-due-soon',
          borderTopClass: 'border-t-4 border-t-amber-500'
        };
      default:
        return {
          label: '🟢 OPERATIONAL',
          badgeClass: 'status-badge status-operational',
          borderTopClass: 'border-t-4 border-t-emerald-500'
        };
    }
  }

  /**
   * Load equipment_master.json & pm_history.json and merge localStorage overrides
   */
  async function loadPortalData() {
    try {
      const masterRes = await fetch('data/equipment_master.json', { cache: 'no-store' });
      if (masterRes.ok) {
        const masterJson = await masterRes.json();
        state.metadata = masterJson.metadata || {};
        state.assets = Array.isArray(masterJson.assets) ? masterJson.assets : [];
      }
    } catch (err) {
      console.warn('Error loading equipment_master.json:', err);
    }

    let baseHistory = [];
    try {
      const histRes = await fetch('data/pm_history.json', { cache: 'no-store' });
      if (histRes.ok) {
        baseHistory = await histRes.json();
      }
    } catch (err) {
      console.warn('Error loading pm_history.json:', err);
    }

    // Apply local asset overrides
    let overrides = {};
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.ASSET_OVERRIDES);
      if (raw) overrides = JSON.parse(raw);
    } catch (e) {
      overrides = {};
    }

    state.assets = state.assets.map((asset) => {
      if (overrides[asset.id]) {
        return Object.assign({}, asset, overrides[asset.id]);
      }
      return asset;
    });

    // Merge local history entries
    let localHistory = [];
    try {
      const rawHist = localStorage.getItem(STORAGE_KEYS.HISTORY_LOG);
      if (rawHist) localHistory = JSON.parse(rawHist);
    } catch (e) {
      localHistory = [];
    }

    const seenIds = new Set(localHistory.map((h) => h.id));
    state.history = [
      ...localHistory,
      ...baseHistory.filter((h) => !seenIds.has(h.id))
    ];
  }

  function findAssetById(assetId) {
    if (!assetId) return null;
    const clean = String(assetId).trim().toUpperCase();
    return state.assets.find((a) => a.id.toUpperCase() === clean) || null;
  }

  function saveAssetOverride(assetId, patch) {
    let overrides = {};
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.ASSET_OVERRIDES);
      if (raw) overrides = JSON.parse(raw);
    } catch (e) {
      overrides = {};
    }

    overrides[assetId] = Object.assign({}, overrides[assetId] || {}, patch);
    localStorage.setItem(STORAGE_KEYS.ASSET_OVERRIDES, JSON.stringify(overrides));

    state.assets = state.assets.map((asset) =>
      asset.id === assetId ? Object.assign({}, asset, patch) : asset
    );
  }

  function prependHistoryEntry(entry) {
    let localHistory = [];
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.HISTORY_LOG);
      if (raw) localHistory = JSON.parse(raw);
    } catch (e) {
      localHistory = [];
    }

    localHistory.unshift(entry);
    localStorage.setItem(STORAGE_KEYS.HISTORY_LOG, JSON.stringify(localHistory.slice(0, 300)));
    state.history.unshift(entry);
  }

  /**
   * Render Executive KPI & March 2027 Milestone Banner
   */
  function renderExecutiveKpis() {
    const total = state.assets.length || 1;
    let operationalCount = 0;
    let dueSoonCount = 0;
    let overdueCount = 0;
    let downCount = 0;
    let pmCompliantCount = 0;

    for (const asset of state.assets) {
      const bucket = getEffectiveAssetBucket(asset);
      if (bucket === 'DOWN') downCount++;
      else if (bucket === 'PM_OVERDUE') overdueCount++;
      else if (bucket === 'PM_DUE_SOON') dueSoonCount++;
      else operationalCount++;

      if (bucket !== 'PM_OVERDUE') {
        pmCompliantCount++;
      }
    }

    const pmCompliancePct = Math.round((pmCompliantCount / total) * 100);
    const readinessPct = Math.round(((total - downCount) / total) * 100);

    const pmPctEl = document.getElementById('kpi-pm-compliance');
    const pmSubEl = document.getElementById('kpi-pm-count-sub');
    const readyPctEl = document.getElementById('kpi-readiness-pct');
    const cOpEl = document.getElementById('kpi-count-operational');
    const cDueEl = document.getElementById('kpi-count-due-soon');
    const cOverEl = document.getElementById('kpi-count-overdue');
    const cDownEl = document.getElementById('kpi-count-down');
    const allCountEl = document.getElementById('count-all-assets');

    if (pmPctEl) pmPctEl.textContent = `${pmCompliancePct}%`;
    if (pmSubEl) pmSubEl.textContent = `(${pmCompliantCount} / ${state.assets.length} Compliant)`;
    if (readyPctEl) readyPctEl.textContent = `${readinessPct}%`;
    if (cOpEl) cOpEl.textContent = String(operationalCount);
    if (cDueEl) cDueEl.textContent = String(dueSoonCount);
    if (cOverEl) cOverEl.textContent = String(overdueCount);
    if (cDownEl) cDownEl.textContent = String(downCount);
    if (allCountEl) allCountEl.textContent = String(state.assets.length);
  }

  /**
   * Render Equipment & PM Matrix Grid
   */
  function renderEquipmentGrid() {
    const gridEl = document.getElementById('equipment-grid');
    const emptyEl = document.getElementById('empty-grid-state');
    if (!gridEl) return;

    const q = state.filters.search.trim().toLowerCase();
    const zoneFilter = state.filters.zone;
    const statusFilter = state.filters.status;

    const filtered = state.assets.filter((asset) => {
      const bucket = getEffectiveAssetBucket(asset);

      if (zoneFilter !== 'ALL' && asset.zoneCode !== zoneFilter) {
        return false;
      }

      if (statusFilter !== 'ALL' && bucket !== statusFilter) {
        return false;
      }

      if (q) {
        const energyText = (asset.loto && asset.loto.energySources || [])
          .map((e) => `${e.type} ${e.magnitude} ${e.isolationLocation}`)
          .join(' ');
        const sopText = asset.sop
          ? [...(asset.sop.ppe || []), ...(asset.sop.beforeUse || [])].join(' ')
          : '';
        const haystack = [
          asset.id,
          asset.name,
          asset.osuEquipmentId,
          asset.zone,
          asset.status,
          asset.conditionNote,
          energyText,
          sopText
        ]
          .join(' ')
          .toLowerCase();

        if (!haystack.includes(q)) return false;
      }

      return true;
    });

    if (filtered.length === 0) {
      gridEl.innerHTML = '';
      if (emptyEl) emptyEl.classList.remove('hidden');
      return;
    }

    if (emptyEl) emptyEl.classList.add('hidden');

    gridEl.innerHTML = filtered
      .map((asset) => {
        const bucket = getEffectiveAssetBucket(asset);
        const meta = getStatusMeta(bucket, asset.status);
        const noGlovesBadge =
          asset.sop && asset.sop.noGlovesWarning
            ? `<span class="px-2 py-0.5 rounded bg-red-500/20 border border-red-500/50 text-red-300 font-mono text-[10px] font-bold">🚫 NO GLOVES</span>`
            : '';

        const primaryEnergy =
          asset.loto && asset.loto.energySources && asset.loto.energySources[0]
            ? `${asset.loto.energySources[0].type}: ${asset.loto.energySources[0].magnitude}`
            : 'LOTO Spec Ready';

        return `
          <article
            class="bg-shopCard border border-slate-800 hover:border-slate-600 rounded-2xl p-4 shadow-xl flex flex-col justify-between gap-3.5 transition-all hover:-translate-y-0.5 cursor-pointer ${meta.borderTopClass}"
            role="listitem"
            data-card-asset="${escapeHtml(asset.id)}"
          >
            <div class="space-y-2">
              <div class="flex items-center justify-between gap-2 flex-wrap">
                <div class="flex items-center gap-1.5">
                  <span class="px-2.5 py-0.5 rounded-md bg-slate-800 border border-slate-600 text-white font-mono font-extrabold text-xs">
                    ${escapeHtml(asset.id)}
                  </span>
                  <span class="px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-slate-400 font-mono text-[11px]">
                    ID: ${escapeHtml(asset.osuEquipmentId)}
                  </span>
                </div>
                <span class="${meta.badgeClass}">${meta.label}</span>
              </div>

              <div>
                <h3 class="text-base font-extrabold text-white leading-snug">${escapeHtml(asset.name)}</h3>
                <div class="text-[11px] font-mono text-slate-400 mt-0.5">${escapeHtml(asset.zone)}</div>
              </div>

              <div class="flex flex-wrap items-center gap-1.5">
                ${noGlovesBadge}
                <span class="px-2 py-0.5 rounded bg-slate-900 border border-slate-700 text-slate-300 font-mono text-[10px]">
                  ⚡ ${escapeHtml(primaryEnergy)}
                </span>
              </div>

              <div class="p-2.5 rounded-xl bg-shopBg border border-slate-800/90 text-xs text-slate-200 space-y-1">
                <div class="text-[10px] font-mono uppercase text-slate-400 flex items-center justify-between">
                  <span>Latest Condition / PM Note</span>
                  <span class="text-emerald-400">Tech: ${escapeHtml(asset.lastPmTech || 'M. Wright')}</span>
                </div>
                <p class="leading-relaxed text-slate-200">${escapeHtml(asset.conditionNote)}</p>
              </div>
            </div>

            <div class="space-y-2.5 pt-2 border-t border-slate-800/80">
              <div class="flex items-center justify-between text-[11px] font-mono text-slate-400">
                <span>Last PM: <strong class="text-slate-200">${escapeHtml(asset.lastPmDate)}</strong></span>
                <span>Next Due: <strong class="text-emerald-400">${escapeHtml(asset.nextPmDue)}</strong></span>
              </div>

              <!-- 4 Direct Tab Launch Buttons -->
              <div class="grid grid-cols-4 gap-1.5">
                <button
                  type="button"
                  data-open-asset="${escapeHtml(asset.id)}"
                  data-open-tab="fault"
                  class="py-1.5 px-1 rounded-lg bg-red-600/20 hover:bg-red-600 text-red-200 hover:text-white border border-red-500/40 font-mono font-bold text-[10px] transition text-center"
                >
                  🚨 Fault
                </button>
                <button
                  type="button"
                  data-open-asset="${escapeHtml(asset.id)}"
                  data-open-tab="sop"
                  class="py-1.5 px-1 rounded-lg bg-sky-600/20 hover:bg-sky-600 text-sky-200 hover:text-white border border-sky-500/40 font-mono font-bold text-[10px] transition text-center"
                >
                  🛡️ SOP
                </button>
                <button
                  type="button"
                  data-open-asset="${escapeHtml(asset.id)}"
                  data-open-tab="loto"
                  class="py-1.5 px-1 rounded-lg bg-amber-600/20 hover:bg-amber-600 text-amber-200 hover:text-white border border-amber-500/40 font-mono font-bold text-[10px] transition text-center"
                >
                  🔒 LOTO
                </button>
                <button
                  type="button"
                  data-open-asset="${escapeHtml(asset.id)}"
                  data-open-tab="pm"
                  class="py-1.5 px-1 rounded-lg bg-emerald-600/20 hover:bg-emerald-600 text-emerald-200 hover:text-white border border-emerald-500/40 font-mono font-bold text-[10px] transition text-center"
                >
                  📋 Log PM
                </button>
              </div>
            </div>
          </article>
        `;
      })
      .join('');
  }

  /**
   * Render Historical PM & Fault Log Table
   */
  function renderHistoryTable() {
    const tbody = document.getElementById('history-table-body');
    if (!tbody) return;

    tbody.innerHTML = state.history
      .map((entry) => {
        const isPm = entry.type === 'MONTHLY_PM';
        const typeBadge = isPm
          ? `<span class="px-2 py-0.5 rounded bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 font-mono text-[10px] font-bold">MONTHLY PM</span>`
          : `<span class="px-2 py-0.5 rounded bg-red-500/20 border border-red-500/40 text-red-300 font-mono text-[10px] font-bold">FAULT REPORT</span>`;

        const metricsStr = entry.metrics
          ? Object.entries(entry.metrics)
              .map(([k, v]) => `${k}: ${v}`)
              .join(' | ')
          : '';

        return `
          <tr class="hover:bg-shopElevated/60 transition">
            <td class="py-3 px-4 font-mono text-xs text-slate-400 whitespace-nowrap">${escapeHtml((entry.timestamp || '').slice(0, 16).replace('T', ' '))}</td>
            <td class="py-3 px-4">${typeBadge}</td>
            <td class="py-3 px-4">
              <button type="button" data-open-asset="${escapeHtml(entry.assetId)}" data-open-tab="${isPm ? 'pm' : 'fault'}" class="font-mono font-bold text-white hover:text-red-400 underline">
                ${escapeHtml(entry.assetId)}
              </button>
              <div class="text-xs text-slate-400">${escapeHtml(entry.assetName || '')}</div>
            </td>
            <td class="py-3 px-4 text-xs text-slate-300">${escapeHtml(entry.teamOrRole || '')}</td>
            <td class="py-3 px-4 text-xs font-semibold text-white">${escapeHtml(entry.technician || '')}</td>
            <td class="py-3 px-4 font-mono text-xs text-emerald-400">${escapeHtml(entry.statusAfter || '')}</td>
            <td class="py-3 px-4 text-xs text-slate-200">
              ${metricsStr ? `<div class="font-mono text-[11px] text-amber-300 mb-0.5">${escapeHtml(metricsStr)}</div>` : ''}
              <div>${escapeHtml(entry.notes || '')}</div>
            </td>
          </tr>
        `;
      })
      .join('');
  }

  /**
   * Open the Unified 4-Tab QR Asset Hub Modal for a given asset & tab
   */
  function openAssetHubModal(assetId, tabName = 'fault', updateHistoryUrl = true) {
    const asset = findAssetById(assetId);
    if (!asset) return;

    state.activeAssetId = asset.id;
    const validTabs = ['fault', 'sop', 'loto', 'pm'];
    const targetTab = validTabs.includes((tabName || '').toLowerCase())
      ? tabName.toLowerCase()
      : 'fault';
    state.activeModalTab = targetTab;

    const modalEl = document.getElementById('asset-hub-modal');
    if (!modalEl) return;

    // Populate Modal Header
    const bucket = getEffectiveAssetBucket(asset);
    const meta = getStatusMeta(bucket, asset.status);

    document.getElementById('modal-asset-id').textContent = asset.id;
    document.getElementById('modal-osu-id').textContent = `OSU ID: ${asset.osuEquipmentId}`;
    document.getElementById('modal-zone-badge').textContent = asset.zone;
    document.getElementById('modal-asset-name').textContent = asset.name;

    const pillEl = document.getElementById('modal-status-pill');
    if (pillEl) {
      pillEl.className = meta.badgeClass;
      pillEl.textContent = meta.label;
    }

    // Tab 1: Report Condition / Fault summary
    document.getElementById('fault-tab-current-note').textContent = asset.conditionNote;
    document.getElementById('fault-tab-last-pm').textContent = asset.lastPmDate || 'N/A';
    document.getElementById('fault-tab-next-pm').textContent = asset.nextPmDue || 'N/A';

    // Tab 2: SOP
    const sop = asset.sop || {};
    const noGlovesBanner = document.getElementById('sop-no-gloves-banner');
    if (noGlovesBanner) {
      noGlovesBanner.classList.toggle('hidden', !sop.noGlovesWarning);
    }

    const renderList = (id, arr) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.innerHTML = (arr || []).map((item) => `<li>${escapeHtml(item)}</li>`).join('');
    };

    renderList('sop-ppe-list', sop.ppe);
    renderList('sop-hazards-list', sop.hazards);
    renderList('sop-before-list', sop.beforeUse);
    renderList('sop-during-list', sop.duringUse);
    renderList('sop-after-list', sop.afterUse);

    const emergEl = document.getElementById('sop-emergency-text');
    if (emergEl) emergEl.textContent = sop.emergencyProtocol || '';

    // Tab 3: LOTO
    const loto = asset.loto || {};
    document.getElementById('loto-authorized').textContent =
      loto.authorizedPersonnel || 'Sr. Instructional Lab Supervisor (Max Wright) & SRAs';
    document.getElementById('loto-notify').textContent =
      loto.notificationMethod || 'Max Wright - Teams / Text Message';
    document.getElementById('loto-normal-shutdown').textContent = loto.normalShutdown || '';
    document.getElementById('loto-stored-energy').textContent = loto.storedEnergyRelief || '';
    document.getElementById('loto-verification').textContent = loto.zeroEnergyVerification || '';

    const energyListEl = document.getElementById('loto-energy-sources-list');
    if (energyListEl) {
      energyListEl.innerHTML = (loto.energySources || [])
        .map(
          (src, idx) => `
          <div class="p-3 rounded-lg bg-shopCard border border-slate-700 space-y-1">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <span class="font-mono text-xs font-extrabold text-amber-300">
                ENERGY SOURCE #${idx + 1}: ${escapeHtml(src.type)}
              </span>
              <span class="px-2 py-0.5 rounded bg-red-500/20 border border-red-500/40 font-mono text-xs font-bold text-red-300">
                Magnitude: ${escapeHtml(src.magnitude)}
              </span>
            </div>
            <div class="text-xs text-slate-300">
              <strong class="text-slate-100">Isolation Device Location:</strong> ${escapeHtml(src.isolationLocation)}
            </div>
            <div class="text-xs text-emerald-300">
              <strong class="text-white">Lockout Procedure:</strong> ${escapeHtml(src.isolationProcedure)}
            </div>
          </div>
        `
        )
        .join('');
    }

    // Tab 4: Monthly PM Checklist & Quantitative Metrics
    const pm = asset.monthlyPm || { checklist: [], metrics: [] };
    const checklistContainer = document.getElementById('pm-checklist-container');
    if (checklistContainer) {
      checklistContainer.innerHTML = (pm.checklist || [])
        .map(
          (task, i) => `
          <label class="flex items-start gap-3 p-2.5 rounded-xl bg-shopBg border border-slate-800 hover:border-slate-600 cursor-pointer">
            <input type="checkbox" name="pm_task" value="${escapeHtml(task)}" checked class="mt-0.5 w-4 h-4 accent-emerald-500 rounded" id="pm-task-${i}" />
            <span class="text-xs sm:text-sm text-slate-200">${escapeHtml(task)}</span>
          </label>
        `
        )
        .join('');
    }

    const metricsContainer = document.getElementById('pm-metrics-container');
    if (metricsContainer) {
      metricsContainer.innerHTML = (pm.metrics || [])
        .map(
          (m) => `
          <div class="p-2.5 rounded-xl bg-shopBg border border-slate-800">
            <label class="block text-[11px] font-mono text-slate-400 mb-1">${escapeHtml(m.label)}</label>
            <input
              type="text"
              data-metric-key="${escapeHtml(m.key)}"
              data-metric-unit="${escapeHtml(m.unit || '')}"
              value="${escapeHtml(m.placeholder || '')}"
              placeholder="${escapeHtml(m.placeholder || '')}"
              class="w-full bg-shopCard border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs font-mono text-white"
            />
          </div>
        `
        )
        .join('');
    }

    switchModalTab(targetTab, false);
    modalEl.classList.remove('hidden');

    if (updateHistoryUrl) {
      const url = new URL(window.location.href);
      url.searchParams.set('asset', asset.id);
      url.searchParams.set('tab', targetTab);
      window.history.pushState({}, '', url.toString());
    }
  }

  function switchModalTab(tabName, updateUrl = true) {
    state.activeModalTab = tabName;

    document.querySelectorAll('[data-hub-tab]').forEach((btn) => {
      btn.classList.toggle('active', btn.getAttribute('data-hub-tab') === tabName);
    });

    const panels = {
      fault: document.getElementById('hub-panel-fault'),
      sop: document.getElementById('hub-panel-sop'),
      loto: document.getElementById('hub-panel-loto'),
      pm: document.getElementById('hub-panel-pm')
    };

    Object.entries(panels).forEach(([key, panel]) => {
      if (panel) panel.classList.toggle('hidden', key !== tabName);
    });

    if (updateUrl && state.activeAssetId) {
      const url = new URL(window.location.href);
      url.searchParams.set('asset', state.activeAssetId);
      url.searchParams.set('tab', tabName);
      window.history.replaceState({}, '', url.toString());
    }
  }

  function closeAssetHubModal() {
    const modalEl = document.getElementById('asset-hub-modal');
    if (modalEl) modalEl.classList.add('hidden');
    state.activeAssetId = null;

    const url = new URL(window.location.href);
    url.searchParams.delete('asset');
    url.searchParams.delete('id');
    url.searchParams.delete('tab');
    window.history.pushState({}, '', url.toString());
  }

  /**
   * Switch top-level portal view ('dashboard' | 'history' | 'qr')
   */
  function switchPortalView(viewName, updateUrl = true) {
    state.currentView = viewName;

    const views = {
      dashboard: document.getElementById('view-dashboard'),
      history: document.getElementById('view-history'),
      qr: document.getElementById('view-qr')
    };

    Object.entries(views).forEach(([k, el]) => {
      if (el) el.classList.toggle('hidden', k !== viewName);
    });

    document.querySelectorAll('[data-view]').forEach((btn) => {
      btn.classList.toggle('active', btn.getAttribute('data-view') === viewName);
    });

    if (viewName === 'qr' && window.ShopQrGenerator) {
      window.ShopQrGenerator.renderQrDecalSheet(state.assets);
    } else if (viewName === 'history') {
      renderHistoryTable();
    } else {
      renderExecutiveKpis();
      renderEquipmentGrid();
    }

    if (updateUrl) {
      const url = new URL(window.location.href);
      if (viewName === 'dashboard') {
        url.searchParams.delete('view');
      } else {
        url.searchParams.set('view', viewName);
      }
      window.history.pushState({}, '', url.toString());
    }
  }

  /**
   * Build pre-filled GitHub Issue URL for Fault or Monthly PM
   */
  function buildGitHubIssueUrl(templateFile, title, paramsObj) {
    const repo =
      (localStorage.getItem(STORAGE_KEYS.GITHUB_REPO) || DEFAULT_GITHUB_REPO).trim() ||
      DEFAULT_GITHUB_REPO;
    const url = new URL(`https://github.com/${repo}/issues/new`);
    url.searchParams.set('template', templateFile);
    url.searchParams.set('title', title);
    Object.entries(paramsObj).forEach(([k, v]) => {
      if (v !== undefined && v !== null && String(v).trim() !== '') {
        url.searchParams.set(k, String(v));
      }
    });
    return url.toString();
  }

  function showToast(message) {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className =
      'p-3.5 rounded-xl bg-slate-900 border-l-4 border-emerald-500 border border-slate-700 text-white text-xs sm:text-sm font-bold shadow-2xl flex items-center gap-2.5';
    toast.innerHTML = `<span>✅</span><span>${escapeHtml(message)}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.25s ease';
      setTimeout(() => toast.remove(), 260);
    }, 4200);
  }

  /**
   * Export full Equipment & PM Matrix to CSV
   */
  function exportEquipmentMatrixCsv() {
    const rows = [
      [
        'Asset ID',
        'OSU Equipment ID',
        'Machine Name',
        'Shop Zone',
        'Status',
        'PM Status',
        'Last PM Date',
        'Next PM Due',
        'Last PM Technician',
        'No Gloves Required',
        'Condition Note'
      ]
    ];

    for (const a of state.assets) {
      rows.push([
        a.id,
        a.osuEquipmentId,
        a.name,
        a.zone,
        a.status,
        getEffectiveAssetBucket(a),
        a.lastPmDate,
        a.nextPmDue,
        a.lastPmTech,
        a.sop && a.sop.noGlovesWarning ? 'YES - NO GLOVES' : 'Standard PPE',
        a.conditionNote
      ]);
    }

    downloadCsv(rows, `car-shop-pm-matrix-${new Date().toISOString().slice(0, 10)}.csv`);
    showToast('Exported 930 Kinnear Rd Equipment & PM Matrix to CSV');
  }

  function exportHistoryCsv() {
    const rows = [
      ['Event ID', 'Timestamp', 'Type', 'Asset ID', 'Asset Name', 'Team/Role', 'Technician/Reporter', 'Status After', 'Notes']
    ];
    for (const h of state.history) {
      rows.push([
        h.id,
        h.timestamp,
        h.type,
        h.assetId,
        h.assetName,
        h.teamOrRole,
        h.technician,
        h.statusAfter,
        h.notes
      ]);
    }
    downloadCsv(rows, `car-shop-pm-history-${new Date().toISOString().slice(0, 10)}.csv`);
    showToast('Exported Historical PM & Condition Ledger to CSV');
  }

  function downloadCsv(rows, filename) {
    const csv = rows
      .map((r) =>
        r
          .map((cell) => `"${String(cell === null || cell === undefined ? '' : cell).replace(/"/g, '""')}"`)
          .join(',')
      )
      .join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function downloadJsonFile(obj, filename) {
    const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /**
   * Handle URL routing (?asset=MAC-01&tab=sop or ?id=MAC-01 or ?view=qr)
   */
  function handleRouteFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const viewParam = (params.get('view') || '').toLowerCase();
    const assetParam = params.get('asset') || params.get('id');
    const tabParam = (params.get('tab') || 'fault').toLowerCase();

    if (viewParam === 'qr') {
      switchPortalView('qr', false);
    } else if (viewParam === 'history') {
      switchPortalView('history', false);
    } else {
      switchPortalView('dashboard', false);
    }

    if (assetParam) {
      const target = findAssetById(assetParam);
      if (target) {
        openAssetHubModal(target.id, tabParam, false);
      }
    }
  }

  /**
   * Bind DOM events
   */
  function bindEvents() {
    // Top navigation
    document.querySelectorAll('[data-view]').forEach((btn) => {
      btn.addEventListener('click', () => {
        switchPortalView(btn.getAttribute('data-view'), true);
      });
    });

    const homeLink = document.getElementById('brand-home-link');
    if (homeLink) {
      homeLink.addEventListener('click', (e) => {
        e.preventDefault();
        closeAssetHubModal();
        switchPortalView('dashboard', true);
      });
    }

    // Search input
    const searchInput = document.getElementById('search-input');
    const clearSearchBtn = document.getElementById('btn-clear-search');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        state.filters.search = e.target.value;
        if (clearSearchBtn) clearSearchBtn.classList.toggle('hidden', !state.filters.search);
        renderEquipmentGrid();
      });
    }
    if (clearSearchBtn) {
      clearSearchBtn.addEventListener('click', () => {
        state.filters.search = '';
        if (searchInput) searchInput.value = '';
        clearSearchBtn.classList.add('hidden');
        renderEquipmentGrid();
      });
    }

    // Status Filter Pills
    document.querySelectorAll('.status-filter-pill').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.filters.status = btn.getAttribute('data-status') || 'ALL';
        document.querySelectorAll('.status-filter-pill').forEach((el) => {
          el.classList.toggle('active', el === btn);
        });
        renderEquipmentGrid();
      });
    });

    // KPI mini status pills
    document.querySelectorAll('[data-status-quick]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const st = btn.getAttribute('data-status-quick') || 'ALL';
        state.filters.status = st;
        document.querySelectorAll('.status-filter-pill').forEach((el) => {
          el.classList.toggle('active', el.getAttribute('data-status') === st);
        });
        renderEquipmentGrid();
      });
    });

    // Zone Filter Pills
    document.querySelectorAll('.zone-filter-pill').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.filters.zone = btn.getAttribute('data-zone') || 'ALL';
        document.querySelectorAll('.zone-filter-pill').forEach((el) => {
          el.classList.toggle('active', el === btn);
        });
        renderEquipmentGrid();
      });
    });

    // Reset filters
    const resetFiltersBtn = document.getElementById('btn-reset-filters');
    if (resetFiltersBtn) {
      resetFiltersBtn.addEventListener('click', () => {
        state.filters = { search: '', zone: 'ALL', status: 'ALL' };
        if (searchInput) searchInput.value = '';
        if (clearSearchBtn) clearSearchBtn.classList.add('hidden');
        document.querySelectorAll('.status-filter-pill').forEach((el) => {
          el.classList.toggle('active', el.getAttribute('data-status') === 'ALL');
        });
        document.querySelectorAll('.zone-filter-pill').forEach((el) => {
          el.classList.toggle('active', el.getAttribute('data-zone') === 'ALL');
        });
        renderEquipmentGrid();
      });
    }

    // Delegated click for opening Asset Hub Modal from cards or history table
    document.addEventListener('click', (e) => {
      const tabTrigger = e.target.closest('[data-open-asset]');
      if (tabTrigger) {
        e.stopPropagation();
        const assetId = tabTrigger.getAttribute('data-open-asset');
        const tab = tabTrigger.getAttribute('data-open-tab') || 'fault';
        openAssetHubModal(assetId, tab, true);
        return;
      }

      const cardEl = e.target.closest('[data-card-asset]');
      if (cardEl) {
        const assetId = cardEl.getAttribute('data-card-asset');
        openAssetHubModal(assetId, 'fault', true);
      }
    });

    // Modal Tab Switching
    document.querySelectorAll('[data-hub-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        switchModalTab(btn.getAttribute('data-hub-tab'), true);
      });
    });

    // Close Asset Modal
    const closeAssetBtn = document.getElementById('btn-close-asset-modal');
    const assetModal = document.getElementById('asset-hub-modal');
    if (closeAssetBtn) closeAssetBtn.addEventListener('click', closeAssetHubModal);
    if (assetModal) {
      assetModal.addEventListener('click', (e) => {
        if (e.target === assetModal) closeAssetHubModal();
      });
    }

    // Copy Asset Deep-Link
    const copyLinkBtn = document.getElementById('btn-copy-asset-link');
    if (copyLinkBtn) {
      copyLinkBtn.addEventListener('click', () => {
        const url = window.location.href;
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(url);
        }
        showToast(`Copied deep link for ${state.activeAssetId} (${state.activeModalTab.toUpperCase()} tab)`);
      });
    }

    // Tab 1: Fault Report Submission (Local + GitHub Issue)
    const faultForm = document.getElementById('fault-report-form');
    const btnFaultGithub = document.getElementById('btn-fault-github-issue');

    function processFaultSubmission(openGithubIssue) {
      const errEl = document.getElementById('fault-form-error');
      if (errEl) errEl.classList.add('hidden');

      const asset = findAssetById(state.activeAssetId);
      if (!asset) return;

      const team = document.getElementById('fault-team-select').value;
      const severity = document.getElementById('fault-severity-select').value;
      const reporter = document.getElementById('fault-reporter-input').value.trim();
      const desc = document.getElementById('fault-desc-input').value.trim();

      if (!team || !severity || !reporter || !desc) {
        if (errEl) {
          errEl.textContent = 'Please complete Student Team, Severity, Reporter Name/Email, and Fault Description.';
          errEl.classList.remove('hidden');
        }
        return;
      }

      saveAssetOverride(asset.id, {
        status: severity,
        conditionNote: `[${team}] ${desc} (Reported by ${reporter})`
      });

      const entry = {
        id: `FLT-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${asset.id.replace('-', '')}`,
        timestamp: new Date().toISOString(),
        type: 'FAULT_REPORT',
        assetId: asset.id,
        assetName: asset.name,
        teamOrRole: team,
        technician: reporter,
        statusAfter: severity,
        pmStatusAfter: asset.pmStatus || 'COMPLIANT',
        metrics: {},
        notes: desc
      };
      prependHistoryEntry(entry);

      renderExecutiveKpis();
      renderEquipmentGrid();
      openAssetHubModal(asset.id, 'fault', false);
      document.getElementById('fault-desc-input').value = '';

      showToast(`Condition updated for ${asset.id} (${severity})`);

      if (openGithubIssue) {
        const issueUrl = buildGitHubIssueUrl(
          'unscheduled_downtime_fault.yml',
          `[FAULT] ${asset.id}: ${asset.name} — ${severity}`,
          {
            asset_id: asset.id,
            student_team: team,
            severity_status:
              severity === 'DOWN - LOCKED OUT'
                ? 'DOWN - LOCKED OUT (Red Tag / Do Not Operate)'
                : severity === 'DEGRADED'
                ? 'DEGRADED / CAUTION (Yellow Tag / Needs Tooling or Minor Attention)'
                : 'OPERATIONAL (Cleared / Returned to Service)',
            reporter,
            fault_description: desc
          }
        );
        window.open(issueUrl, '_blank', 'noopener');
      }
    }

    if (faultForm) {
      faultForm.addEventListener('submit', (e) => {
        e.preventDefault();
        processFaultSubmission(false);
      });
    }
    if (btnFaultGithub) {
      btnFaultGithub.addEventListener('click', () => {
        processFaultSubmission(true);
      });
    }

    // Tab 4: Monthly PM Submission
    const btnCheckAllPm = document.getElementById('btn-check-all-pm');
    if (btnCheckAllPm) {
      btnCheckAllPm.addEventListener('click', () => {
        document.querySelectorAll('#pm-checklist-container input[type="checkbox"]').forEach((cb) => {
          cb.checked = true;
        });
      });
    }

    const pmForm = document.getElementById('monthly-pm-form');
    const btnPmGithub = document.getElementById('btn-pm-github-issue');
    const btnPmJson = document.getElementById('btn-pm-download-json');

    function collectAndSavePm(mode) {
      const errEl = document.getElementById('pm-form-error');
      if (errEl) errEl.classList.add('hidden');

      const asset = findAssetById(state.activeAssetId);
      if (!asset) return;

      const tech = document.getElementById('pm-tech-input').value.trim();
      const postStatus = document.getElementById('pm-status-select').value;
      const notes = document.getElementById('pm-notes-input').value.trim();
      const checkedBoxes = [
        ...document.querySelectorAll('#pm-checklist-container input[type="checkbox"]:checked')
      ];

      if (!tech || !notes || checkedBoxes.length === 0) {
        if (errEl) {
          errEl.textContent =
            'Please check completed PM tasks, enter Technician Name/Initials, and provide PM Notes.';
          errEl.classList.remove('hidden');
        }
        return;
      }

      const metricsObj = {};
      document.querySelectorAll('#pm-metrics-container input[data-metric-key]').forEach((inp) => {
        const key = inp.getAttribute('data-metric-key');
        const unit = inp.getAttribute('data-metric-unit');
        const val = inp.value.trim();
        if (key && val) {
          metricsObj[key] = unit && !val.includes(unit) ? `${val} ${unit}` : val;
        }
      });

      const now = new Date();
      const todayIso = now.toISOString().slice(0, 10);
      const nextDueIso = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10);

      saveAssetOverride(asset.id, {
        status: postStatus === 'PM_DUE_SOON' ? 'DEGRADED' : postStatus,
        pmStatus: postStatus === 'OPERATIONAL' ? 'COMPLIANT' : 'DUE_SOON',
        lastPmDate: todayIso,
        nextPmDue: nextDueIso,
        lastPmTech: tech,
        conditionNote: notes
      });

      const pmRecord = {
        id: `PM-${todayIso.replace(/-/g, '')}-${asset.id.replace('-', '')}`,
        timestamp: now.toISOString(),
        type: 'MONTHLY_PM',
        assetId: asset.id,
        assetName: asset.name,
        teamOrRole: 'Shop Staff / SRA',
        technician: tech,
        statusAfter: postStatus,
        pmStatusAfter: 'COMPLIANT',
        metrics: metricsObj,
        completedItemsCount: checkedBoxes.length,
        totalItemsCount: (asset.monthlyPm && asset.monthlyPm.checklist || []).length,
        notes
      };

      prependHistoryEntry(pmRecord);
      renderExecutiveKpis();
      renderEquipmentGrid();
      openAssetHubModal(asset.id, 'pm', false);

      showToast(`Logged Monthly PM for ${asset.id} — Next Due: ${nextDueIso}`);

      if (mode === 'json') {
        downloadJsonFile(pmRecord, `${pmRecord.id}.json`);
      } else if (mode === 'github') {
        const checklistMd = checkedBoxes.map((cb) => `- [x] ${cb.value}`).join('\n');
        const metricsMd = Object.entries(metricsObj)
          .map(([k, v]) => `${k}: ${v}`)
          .join('\n');
        const issueUrl = buildGitHubIssueUrl(
          'monthly_pm_log.yml',
          `[PM-LOG] ${asset.id}: ${asset.name} (${todayIso})`,
          {
            asset_id: asset.id,
            post_pm_status: postStatus === 'PM_DUE_SOON' ? 'PM DUE SOON' : postStatus,
            technician: tech,
            checklist_summary: checklistMd,
            quantitative_metrics: metricsMd,
            pm_notes: notes
          }
        );
        window.open(issueUrl, '_blank', 'noopener');
      }
    }

    if (pmForm) {
      pmForm.addEventListener('submit', (e) => {
        e.preventDefault();
        collectAndSavePm('local');
      });
    }
    if (btnPmGithub) {
      btnPmGithub.addEventListener('click', () => collectAndSavePm('github'));
    }
    if (btnPmJson) {
      btnPmJson.addEventListener('click', () => collectAndSavePm('json'));
    }

    // QR Decal Controls
    const btnUpdateQrUrl = document.getElementById('btn-update-qr-url');
    const qrBaseInput = document.getElementById('qr-base-url-input');
    const btnPrintDecals = document.getElementById('btn-print-decals');

    if (btnUpdateQrUrl) {
      btnUpdateQrUrl.addEventListener('click', () => {
        if (window.ShopQrGenerator && qrBaseInput) {
          window.ShopQrGenerator.saveBaseUrlOverride(qrBaseInput.value);
          window.ShopQrGenerator.renderQrDecalSheet(state.assets);
          showToast(`Regenerated all ${state.assets.length} 2"×3" QR Machine Decals`);
        }
      });
    }
    if (btnPrintDecals) {
      btnPrintDecals.addEventListener('click', () => window.print());
    }

    // Export Buttons
    const btnExportCsv = document.getElementById('btn-export-csv');
    const btnExportHistCsv = document.getElementById('btn-export-history-csv');
    const btnExportHistJson = document.getElementById('btn-export-history-json');
    const btnExportMasterJson = document.getElementById('btn-export-master-json');

    if (btnExportCsv) btnExportCsv.addEventListener('click', exportEquipmentMatrixCsv);
    if (btnExportHistCsv) btnExportHistCsv.addEventListener('click', exportHistoryCsv);
    if (btnExportHistJson) {
      btnExportHistJson.addEventListener('click', () =>
        downloadJsonFile(state.history, 'pm_history.json')
      );
    }
    if (btnExportMasterJson) {
      btnExportMasterJson.addEventListener('click', () =>
        downloadJsonFile(
          { metadata: state.metadata, assets: state.assets },
          'equipment_master.json'
        )
      );
    }

    // Settings Modal
    const btnOpenSettings = document.getElementById('btn-open-settings');
    const btnCloseSettings = document.getElementById('btn-close-settings');
    const settingsModal = document.getElementById('settings-modal');
    const btnSaveSettings = document.getElementById('btn-save-settings');
    const btnResetPortal = document.getElementById('btn-reset-portal');

    if (btnOpenSettings && settingsModal) {
      btnOpenSettings.addEventListener('click', () => {
        document.getElementById('config-github-repo').value =
          localStorage.getItem(STORAGE_KEYS.GITHUB_REPO) || DEFAULT_GITHUB_REPO;
        document.getElementById('config-teams-webhook').value =
          localStorage.getItem(STORAGE_KEYS.TEAMS_WEBHOOK) || '';
        settingsModal.classList.remove('hidden');
      });
    }
    if (btnCloseSettings && settingsModal) {
      btnCloseSettings.addEventListener('click', () => settingsModal.classList.add('hidden'));
    }
    if (btnSaveSettings && settingsModal) {
      btnSaveSettings.addEventListener('click', () => {
        localStorage.setItem(
          STORAGE_KEYS.GITHUB_REPO,
          document.getElementById('config-github-repo').value.trim() || DEFAULT_GITHUB_REPO
        );
        localStorage.setItem(
          STORAGE_KEYS.TEAMS_WEBHOOK,
          document.getElementById('config-teams-webhook').value.trim()
        );
        settingsModal.classList.add('hidden');
        showToast('Saved Portal Sync & Repository Configuration');
      });
    }
    if (btnResetPortal) {
      btnResetPortal.addEventListener('click', async () => {
        localStorage.removeItem(STORAGE_KEYS.ASSET_OVERRIDES);
        localStorage.removeItem(STORAGE_KEYS.HISTORY_LOG);
        await loadPortalData();
        renderExecutiveKpis();
        renderEquipmentGrid();
        if (settingsModal) settingsModal.classList.add('hidden');
        showToast(`Reset all ${state.assets.length} assets to baseline equipment_master.json state`);
      });
    }

    window.addEventListener('popstate', handleRouteFromUrl);
  }

  async function init() {
    await loadPortalData();
    renderExecutiveKpis();
    renderEquipmentGrid();
    bindEvents();
    handleRouteFromUrl();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
