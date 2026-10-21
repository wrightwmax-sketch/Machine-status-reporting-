/**
 * Student Projects Building — Machine Fault & Status Reporting System
 */

(function () {
  'use strict';

  // LocalStorage Keys
  const STORAGE_KEYS = {
    STATUS_OVERRIDES: 'spl_machine_status_overrides_v1',
    FAULT_LOG: 'spl_fault_history_log_v1',
    TEAMS_WEBHOOK: 'spl_teams_webhook_url',
    SYNC_ENDPOINT: 'spl_sync_api_url',
    GITHUB_TOKEN: 'spl_github_token',
    QR_BASE_URL: 'spl_qr_base_url'
  };

  // Fallback master registry of the 24 SPL workstations
  const FALLBACK_MACHINES = [
    { id: 'FAC-01', name: 'General Shop & Paint Booth', zone: 'Facility & Infrastructure', sourceSheet: 'General ' },
    { id: 'FAC-02', name: 'Shop Compressed Air System', zone: 'Facility & Infrastructure', sourceSheet: 'Air system ' },
    { id: 'MAC-01', name: 'Manual Mill #1 (Bridgeport)', zone: 'Manual Machining', sourceSheet: 'Manual Mill ' },
    { id: 'MAC-02', name: 'Manual Mill #2 (Bridgeport)', zone: 'Manual Machining', sourceSheet: 'Manual Mill ' },
    { id: 'MAC-03', name: 'Manual Mill #3 (Bridgeport)', zone: 'Manual Machining', sourceSheet: 'Manual Mill ' },
    { id: 'MAC-04', name: 'Manual Lathe', zone: 'Manual Machining', sourceSheet: 'Manual Lathe' },
    { id: 'CNC-01', name: 'CNC Mill', zone: 'CNC Machining', sourceSheet: 'CNC Mill ' },
    { id: 'CNC-02', name: 'Haas CNC Vertical Machining Center', zone: 'CNC Machining', sourceSheet: 'HAAS mill CNC ' },
    { id: 'CNC-03', name: 'CNC Lathe', zone: 'CNC Machining', sourceSheet: 'CNC Lathe ' },
    { id: 'SAW-01', name: 'Vertical Bandsaw', zone: 'Cutting & Saws', sourceSheet: 'Vertical Bandsaw ' },
    { id: 'SAW-02', name: 'Horizontal Bandsaw', zone: 'Cutting & Saws', sourceSheet: 'Horizontal Bandsaw ' },
    { id: 'SAW-03', name: 'Abrasive Chop Saw', zone: 'Cutting & Saws', sourceSheet: 'Chop Saw ' },
    { id: 'SAW-04', name: '10" Compound Miter Saw', zone: 'Cutting & Saws', sourceSheet: 'Miter saw ' },
    { id: 'FAB-01', name: '6" x 48" Belt Sander', zone: 'Abrasive & Finishing', sourceSheet: 'Belt Sander ' },
    { id: 'FAB-02', name: 'Tube & Pipe Notcher', zone: 'Fabrication & Prep', sourceSheet: 'Tube Notcher ' },
    { id: 'FAB-03', name: 'Bench Grinders', zone: 'Abrasive & Finishing', sourceSheet: 'Bench Grinders' },
    { id: 'FAB-04', name: 'Media Blast Cabinet (Sand Blaster)', zone: 'Abrasive & Finishing', sourceSheet: 'Sand Blaster ' },
    { id: 'WLD-01', name: 'TIG Welder #1', zone: 'Welding & Thermal', sourceSheet: 'TIG Welder' },
    { id: 'WLD-02', name: 'TIG Welder #2', zone: 'Welding & Thermal', sourceSheet: 'TIG Welder' },
    { id: 'WLD-03', name: 'MIG Welder Station', zone: 'Welding & Thermal', sourceSheet: 'MIG Welder' },
    { id: 'WLD-04', name: 'CNC Plasma Table', zone: 'Welding & Thermal', sourceSheet: 'Plazma Table ' },
    { id: 'WLD-05', name: 'Hand Plasma Cutter', zone: 'Welding & Thermal', sourceSheet: 'Hand Plasma ' },
    { id: 'WJT-01', name: 'WAZER Desktop Waterjet', zone: 'Waterjet Cutting', sourceSheet: 'Wazer Water Jet ' },
    { id: 'GEN-01', name: 'Briggs & Stratton 6500W Generator', zone: 'Mobile Power / Support', sourceSheet: 'Brigs Gen 6500 watt' },
    { id: 'GEN-02', name: 'Briggs & Stratton 5500W Generator', zone: 'Mobile Power / Support', sourceSheet: 'Biggs 5500 gen ' }
  ];

  // Application State
  const state = {
    machines: [],
    baseStatuses: {},
    statuses: {},
    currentView: 'board', // 'board' | 'updater' | 'qr'
    selectedMachineId: 'MAC-01',
    lockedViaQr: false,
    filters: {
      search: '',
      zone: 'ALL',
      status: 'ALL'
    }
  };

  // Status Metadata Helpers
  const STATUS_META = {
    OPERATIONAL: {
      label: 'OPERATIONAL',
      emoji: '🟢',
      pillText: '🟢 OPERATIONAL',
      pillClass: 'status-pill-operational',
      cardClass: 'card-status-operational',
      bannerClass: 'status-banner-operational',
      hex: '#10b981',
      adaptiveColor: 'Good'
    },
    DEGRADED: {
      label: 'DEGRADED',
      emoji: '🟡',
      pillText: '🟡 DEGRADED',
      pillClass: 'status-pill-degraded',
      cardClass: 'card-status-degraded',
      bannerClass: 'status-banner-degraded',
      hex: '#f59e0b',
      adaptiveColor: 'Warning'
    },
    DOWN: {
      label: 'DOWN',
      emoji: '🔴',
      pillText: '🔴 DOWN',
      pillClass: 'status-pill-down',
      cardClass: 'card-status-down',
      bannerClass: 'status-banner-down',
      hex: '#ef4444',
      adaptiveColor: 'Attention'
    }
  };

  /**
   * Default status entry factory
   */
  function createDefaultStatusEntry(timestamp) {
    return {
      status: 'OPERATIONAL',
      category: 'Cleared / Ready',
      team: 'Shop Staff',
      reporter: 'System Init',
      notes: 'Machine operational and cleared for student use.',
      updatedAt: timestamp || '2026-10-20T12:00:00.000Z'
    };
  }

  /**
   * Escape HTML special characters to prevent XSS
   */
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
   * Format ISO timestamp into human-friendly relative time
   */
  function formatRelativeTime(isoString) {
    if (!isoString) return 'Scheduled Ready';
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return isoString;

    const now = new Date();
    const diffSeconds = Math.floor((now - date) / 1000);

    if (diffSeconds < 5) return 'Just now';
    if (diffSeconds < 60) return `${diffSeconds}s ago`;
    const diffMinutes = Math.floor(diffSeconds / 60);
    if (diffMinutes < 60) return `${diffMinutes}m ago`;
    const diffHours = Math.floor(diffMinutes / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 30) return `${diffDays}d ago`;

    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  }

  /**
   * Load machines.json and status.json, then merge localStorage overrides
   */
  async function loadInitialData() {
    let machinesData = FALLBACK_MACHINES;
    let statusData = {};

    try {
      const machinesRes = await fetch('data/machines.json', { cache: 'no-store' });
      if (machinesRes.ok) {
        machinesData = await machinesRes.json();
      }
    } catch (err) {
      console.warn('Using fallback machines registry:', err);
    }

    try {
      const statusRes = await fetch('data/status.json', { cache: 'no-store' });
      if (statusRes.ok) {
        statusData = await statusRes.json();
      }
    } catch (err) {
      console.warn('Using default status ledger:', err);
    }

    state.machines = machinesData;

    // Ensure all 24 machines have a base status entry
    const mergedBase = {};
    for (const machine of state.machines) {
      mergedBase[machine.id] = statusData[machine.id] || createDefaultStatusEntry();
    }
    state.baseStatuses = mergedBase;

    syncStatusesWithLocalStorage();
  }

  /**
   * Merge localStorage status overrides on top of data/status.json
   */
  function syncStatusesWithLocalStorage() {
    let overrides = {};
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.STATUS_OVERRIDES);
      if (raw) {
        overrides = JSON.parse(raw);
      }
    } catch (err) {
      console.warn('Failed to parse localStorage overrides:', err);
    }

    const merged = {};
    for (const machine of state.machines) {
      merged[machine.id] = Object.assign(
        {},
        createDefaultStatusEntry(),
        state.baseStatuses[machine.id] || {},
        overrides[machine.id] || {}
      );
    }
    state.statuses = merged;
  }

  /**
   * Save a machine status update to localStorage and fault log
   */
  function saveMachineStatusOverride(machineId, statusPayload) {
    let overrides = {};
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.STATUS_OVERRIDES);
      if (raw) overrides = JSON.parse(raw);
    } catch (e) {
      overrides = {};
    }

    overrides[machineId] = statusPayload;
    localStorage.setItem(STORAGE_KEYS.STATUS_OVERRIDES, JSON.stringify(overrides));
    state.statuses[machineId] = statusPayload;

    // Append to historical fault log for CSV exports
    let history = [];
    try {
      const rawHistory = localStorage.getItem(STORAGE_KEYS.FAULT_LOG);
      if (rawHistory) history = JSON.parse(rawHistory);
    } catch (e) {
      history = [];
    }

    const machine = getMachineById(machineId);
    history.unshift({
      machineId,
      machineName: machine ? machine.name : machineId,
      zone: machine ? machine.zone : '',
      ...statusPayload
    });
    localStorage.setItem(STORAGE_KEYS.FAULT_LOG, JSON.stringify(history.slice(0, 500)));
  }

  /**
   * Lookup machine object by ID (case-insensitive)
   */
  function getMachineById(id) {
    if (!id) return null;
    const target = String(id).trim().toUpperCase();
    return state.machines.find((m) => m.id.toUpperCase() === target) || null;
  }

  /**
   * Populate the machine selector dropdown in View 2
   */
  function populateMachineSelector() {
    const selectEl = document.getElementById('machine-select');
    if (!selectEl) return;

    selectEl.innerHTML = state.machines
      .map(
        (m) =>
          `<option value="${escapeHtml(m.id)}">${escapeHtml(m.id)} — ${escapeHtml(m.name)}</option>`
      )
      .join('');
  }

  /**
   * Render KPI Summary Ribbon counters
   */
  function renderKpiRibbon() {
    let operationalCount = 0;
    let degradedCount = 0;
    let downCount = 0;

    for (const machine of state.machines) {
      const st = (state.statuses[machine.id] && state.statuses[machine.id].status) || 'OPERATIONAL';
      if (st === 'DOWN') downCount++;
      else if (st === 'DEGRADED') degradedCount++;
      else operationalCount++;
    }

    const totalEl = document.getElementById('kpi-total');
    const opEl = document.getElementById('kpi-operational');
    const degEl = document.getElementById('kpi-degraded');
    const downEl = document.getElementById('kpi-down');

    if (totalEl) totalEl.textContent = String(state.machines.length);
    if (opEl) opEl.textContent = String(operationalCount);
    if (degEl) degEl.textContent = String(degradedCount);
    if (downEl) downEl.textContent = String(downCount);
  }

  /**
   * Render View 1 Bento Equipment Grid
   */
  function renderEquipmentGrid() {
    const gridEl = document.getElementById('equipment-grid');
    const emptyEl = document.getElementById('empty-grid-state');
    if (!gridEl) return;

    const searchQuery = state.filters.search.trim().toLowerCase();
    const zoneFilter = state.filters.zone;
    const statusFilter = state.filters.status;

    const filtered = state.machines.filter((machine) => {
      const stObj = state.statuses[machine.id] || createDefaultStatusEntry();

      if (zoneFilter !== 'ALL' && machine.zone !== zoneFilter) {
        return false;
      }

      if (statusFilter !== 'ALL' && stObj.status !== statusFilter) {
        return false;
      }

      if (searchQuery) {
        const haystack = [
          machine.id,
          machine.name,
          machine.zone,
          stObj.status,
          stObj.category,
          stObj.notes,
          stObj.team,
          stObj.reporter
        ]
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(searchQuery)) {
          return false;
        }
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
      .map((machine) => {
        const stObj = state.statuses[machine.id] || createDefaultStatusEntry();
        const meta = STATUS_META[stObj.status] || STATUS_META.OPERATIONAL;
        const relTime = formatRelativeTime(stObj.updatedAt);

        return `
          <article
            class="machine-card ${meta.cardClass}"
            role="listitem"
            tabindex="0"
            data-machine-id="${escapeHtml(machine.id)}"
            aria-label="${escapeHtml(machine.id)} ${escapeHtml(machine.name)} — Status ${escapeHtml(meta.label)}"
          >
            <div>
              <div class="card-top-bar">
                <span class="asset-badge">${escapeHtml(machine.id)}</span>
                <span class="status-pill ${meta.pillClass}">${meta.pillText}</span>
              </div>
              <h3 class="card-machine-title">${escapeHtml(machine.name)}</h3>
              <div class="card-machine-zone">${escapeHtml(machine.zone)}</div>
            </div>

            <div class="card-note-box">
              <div class="card-category-tag">${escapeHtml(stObj.category || 'Cleared / Ready')}</div>
              <p class="card-note-text">${escapeHtml(stObj.notes)}</p>
            </div>

            <div class="card-footer-meta">
              <span class="card-team-badge">${escapeHtml(stObj.team)} • ${escapeHtml(stObj.reporter)}</span>
              <span class="card-time" title="${escapeHtml(stObj.updatedAt)}">${escapeHtml(relTime)}</span>
            </div>
          </article>
        `;
      })
      .join('');
  }

  /**
   * Update the Current Status Banner in View 2 (Mobile Updater)
   */
  function renderUpdaterStatusBanner(machineId) {
    const machine = getMachineById(machineId) || state.machines[0];
    if (!machine) return;

    state.selectedMachineId = machine.id;
    const stObj = state.statuses[machine.id] || createDefaultStatusEntry();
    const meta = STATUS_META[stObj.status] || STATUS_META.OPERATIONAL;

    const selectEl = document.getElementById('machine-select');
    if (selectEl && selectEl.value !== machine.id) {
      selectEl.value = machine.id;
    }

    const lockBadge = document.getElementById('machine-lock-badge');
    if (lockBadge) {
      if (state.lockedViaQr) {
        lockBadge.classList.remove('hidden');
      } else {
        lockBadge.classList.add('hidden');
      }
    }

    const bannerEl = document.getElementById('current-status-banner');
    if (bannerEl) {
      bannerEl.className = `current-status-banner ${meta.bannerClass}`;
    }

    const idEl = document.getElementById('banner-asset-id');
    const zoneEl = document.getElementById('banner-machine-zone');
    const pillEl = document.getElementById('banner-status-pill');
    const nameEl = document.getElementById('banner-machine-name');
    const notesEl = document.getElementById('banner-notes');
    const catEl = document.getElementById('banner-category');
    const teamEl = document.getElementById('banner-team');
    const updatedEl = document.getElementById('banner-updated');

    if (idEl) idEl.textContent = machine.id;
    if (zoneEl) zoneEl.textContent = machine.zone;
    if (pillEl) {
      pillEl.className = `status-pill ${meta.pillClass}`;
      pillEl.textContent = meta.pillText;
    }
    if (nameEl) nameEl.textContent = machine.name;
    if (notesEl) notesEl.textContent = stObj.notes;
    if (catEl) catEl.textContent = `Category: ${stObj.category || 'Cleared / Ready'}`;
    if (teamEl) teamEl.textContent = `Reported by: ${stObj.team} (${stObj.reporter})`;
    if (updatedEl) updatedEl.textContent = `Updated: ${formatRelativeTime(stObj.updatedAt)}`;
  }

  /**
   * Generate deterministic fallback SVG QR pattern if offline and CDN is unreachable
   */
  function createFallbackQrSvg(text) {
    const size = 21;
    let hash = 2166136261;
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }

    const isFinder = (r, c) =>
      (r < 7 && c < 7) || (r < 7 && c >= size - 7) || (r >= size - 7 && c < 7);

    const finderCell = (r, c, topR, leftC) => {
      const dr = r - topR;
      const dc = c - leftC;
      if (dr === 0 || dr === 6 || dc === 0 || dc === 6) return true;
      if (dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4) return true;
      return false;
    };

    let rects = '';
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        let dark = false;
        if (r < 7 && c < 7) dark = finderCell(r, c, 0, 0);
        else if (r < 7 && c >= size - 7) dark = finderCell(r, c, 0, size - 7);
        else if (r >= size - 7 && c < 7) dark = finderCell(r, c, size - 7, 0);
        else if (!isFinder(r, c)) {
          const seed = Math.imul(hash ^ (r * 31 + c * 17), 1597334677);
          dark = (seed & 1) === 1;
        }
        if (dark) {
          rects += `<rect x="${c}" y="${r}" width="1" height="1" fill="#000000" />`;
        }
      }
    }

    return `<svg viewBox="0 0 ${size} ${size}" width="160" height="160" shape-rendering="crispEdges" xmlns="http://www.w3.org/2000/svg"><rect width="${size}" height="${size}" fill="#ffffff"/>${rects}</svg>`;
  }

  /**
   * Get effective base URL for QR Code deep-linking
   */
  function getEffectiveQrBaseUrl() {
    const inputEl = document.getElementById('qr-base-url');
    if (inputEl && inputEl.value.trim()) {
      return inputEl.value.trim().replace(/\?.*$/, '');
    }
    const saved = localStorage.getItem(STORAGE_KEYS.QR_BASE_URL);
    if (saved && saved.trim()) {
      return saved.trim().replace(/\?.*$/, '');
    }
    return window.location.origin + window.location.pathname;
  }

  /**
   * Render View 3: Printable QR Code Placards for all 24 workstations
   */
  function renderQrPlacards() {
    const gridEl = document.getElementById('qr-placards-grid');
    const baseInputEl = document.getElementById('qr-base-url');
    if (!gridEl) return;

    const baseUrl = getEffectiveQrBaseUrl();
    if (baseInputEl && !baseInputEl.value) {
      baseInputEl.value = baseUrl;
    }

    gridEl.innerHTML = state.machines
      .map((machine) => {
        const targetUrl = `${baseUrl}?id=${encodeURIComponent(machine.id)}`;
        return `
          <div class="qr-placard" data-placard-id="${escapeHtml(machine.id)}">
            <div class="placard-header">
              STUDENT PROJECTS BUILDING — MACHINE STATUS
            </div>
            <div class="placard-body">
              <div class="placard-asset-id">${escapeHtml(machine.id)}</div>
              <div class="placard-machine-name">${escapeHtml(machine.name)}</div>
              <div class="placard-zone">${escapeHtml(machine.zone)}</div>
              <div class="placard-qr-box" id="qr-box-${escapeHtml(machine.id)}" data-qr-url="${escapeHtml(targetUrl)}"></div>
            </div>
            <div class="placard-footer">
              SCAN TO LOG BROKEN TOOLING, FAULT, OR UPDATE MACHINE STATUS
            </div>
          </div>
        `;
      })
      .join('');

    // Generate 160x160 QR code inside each placard
    for (const machine of state.machines) {
      const boxEl = document.getElementById(`qr-box-${machine.id}`);
      if (!boxEl) continue;
      const targetUrl = boxEl.getAttribute('data-qr-url');
      boxEl.innerHTML = '';

      if (typeof window.QRCode === 'function') {
        try {
          new window.QRCode(boxEl, {
            text: targetUrl,
            width: 160,
            height: 160,
            colorDark: '#000000',
            colorLight: '#ffffff',
            correctLevel: window.QRCode.CorrectLevel ? window.QRCode.CorrectLevel.M : 0
          });
        } catch (err) {
          boxEl.innerHTML = createFallbackQrSvg(targetUrl);
        }
      } else {
        boxEl.innerHTML = createFallbackQrSvg(targetUrl);
      }
    }
  }

  /**
   * Build a valid Microsoft Teams Adaptive Card (v1.4) payload
   */
  function buildTeamsAdaptiveCardPayload(machine, statusEntry) {
    const meta = STATUS_META[statusEntry.status] || STATUS_META.OPERATIONAL;
    const baseUrl = getEffectiveQrBaseUrl();
    const deepLinkUrl = `${baseUrl}?id=${encodeURIComponent(machine.id)}`;
    const formattedTime = new Date(statusEntry.updatedAt).toLocaleString('en-US', {
      dateStyle: 'medium',
      timeStyle: 'short'
    });

    return {
      type: 'message',
      attachments: [
        {
          contentType: 'application/vnd.microsoft.card.adaptive',
          contentUrl: null,
          content: {
            $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
            type: 'AdaptiveCard',
            version: '1.4',
            body: [
              {
                type: 'Container',
                style: meta.adaptiveColor,
                bleed: true,
                items: [
                  {
                    type: 'TextBlock',
                    text: 'STUDENT PROJECTS BUILDING — MACHINE ALERT',
                    weight: 'Bolder',
                    size: 'Small',
                    isSubtle: true
                  },
                  {
                    type: 'TextBlock',
                    text: `${meta.emoji} [${machine.id}] ${machine.name} — ${meta.label}`,
                    weight: 'Bolder',
                    size: 'Large',
                    wrap: true
                  }
                ]
              },
              {
                type: 'FactSet',
                facts: [
                  { title: 'Asset ID:', value: machine.id },
                  { title: 'Workstation:', value: machine.name },
                  { title: 'Shop Zone:', value: machine.zone },
                  { title: 'New Status:', value: `${meta.emoji} ${meta.label}` },
                  { title: 'Fault Category:', value: statusEntry.category },
                  { title: 'Student Team:', value: statusEntry.team },
                  { title: 'Reported By:', value: statusEntry.reporter },
                  { title: 'Timestamp:', value: formattedTime }
                ]
              },
              {
                type: 'TextBlock',
                text: 'Fault Details / Notes:',
                weight: 'Bolder',
                spacing: 'Medium'
              },
              {
                type: 'TextBlock',
                text: statusEntry.notes,
                wrap: true
              }
            ],
            actions: [
              {
                type: 'Action.OpenUrl',
                title: `Open ${machine.id} Status Updater`,
                url: deepLinkUrl
              }
            ]
          }
        }
      ]
    };
  }

  /**
   * Dispatch Adaptive Card to Microsoft Teams Incoming Webhook / Power Automate Workflow URL
   * and optional Shared State API / GitHub repository_dispatch endpoint
   */
  async function dispatchExternalWebhooks(machine, statusEntry) {
    const teamsWebhookUrl = (localStorage.getItem(STORAGE_KEYS.TEAMS_WEBHOOK) || '').trim();
    const syncEndpointUrl = (localStorage.getItem(STORAGE_KEYS.SYNC_ENDPOINT) || '').trim();
    const githubToken = (localStorage.getItem(STORAGE_KEYS.GITHUB_TOKEN) || '').trim();

    const adaptiveCardPayload = buildTeamsAdaptiveCardPayload(machine, statusEntry);

    // 1. Microsoft Teams Webhook dispatch
    if (teamsWebhookUrl) {
      try {
        await fetch(teamsWebhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(adaptiveCardPayload),
          mode: 'no-cors'
        });
      } catch (err) {
        console.warn('Teams webhook dispatch warning:', err);
      }
    }

    // 2. Optional Shared State / GitHub Actions repository_dispatch sync
    if (syncEndpointUrl) {
      try {
        const headers = {
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json'
        };
        if (githubToken) {
          headers.Authorization = `Bearer ${githubToken}`;
        }

        const dispatchBody = syncEndpointUrl.includes('api.github.com')
          ? {
              event_type: 'update_machine_status',
              client_payload: {
                machineId: machine.id,
                statusEntry,
                allStatuses: state.statuses
              }
            }
          : {
              machineId: machine.id,
              statusEntry,
              allStatuses: state.statuses
            };

        await fetch(syncEndpointUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify(dispatchBody)
        });
      } catch (err) {
        console.warn('Shared state sync warning:', err);
      }
    }
  }

  /**
   * Display a visual toast notification
   */
  function showToast(message) {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerHTML = `<span>✅</span><span>${escapeHtml(message)}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.25s ease';
      setTimeout(() => toast.remove(), 260);
    }, 4500);
  }

  /**
   * Switch active application view ('board' | 'updater' | 'qr')
   */
  function switchView(viewName, options = {}) {
    state.currentView = viewName;

    const boardSec = document.getElementById('view-board');
    const updaterSec = document.getElementById('view-updater');
    const qrSec = document.getElementById('view-qr');

    const navBoard = document.getElementById('nav-board');
    const navUpdater = document.getElementById('nav-updater');
    const navQr = document.getElementById('nav-qr');

    if (boardSec) boardSec.classList.toggle('hidden', viewName !== 'board');
    if (updaterSec) updaterSec.classList.toggle('hidden', viewName !== 'updater');
    if (qrSec) qrSec.classList.toggle('hidden', viewName !== 'qr');

    if (navBoard) navBoard.classList.toggle('active', viewName === 'board');
    if (navUpdater) navUpdater.classList.toggle('active', viewName === 'updater');
    if (navQr) navQr.classList.toggle('active', viewName === 'qr');

    if (viewName === 'board') {
      renderKpiRibbon();
      renderEquipmentGrid();
      if (options.updateUrl) {
        const url = new URL(window.location.href);
        url.search = '';
        window.history.pushState({}, '', url.toString());
      }
    } else if (viewName === 'updater') {
      const targetId = options.machineId || state.selectedMachineId || 'MAC-01';
      state.lockedViaQr = Boolean(options.lockedViaQr);
      renderUpdaterStatusBanner(targetId);
      if (options.updateUrl) {
        const url = new URL(window.location.href);
        url.search = `?id=${encodeURIComponent(targetId)}`;
        window.history.pushState({}, '', url.toString());
      }
    } else if (viewName === 'qr') {
      renderQrPlacards();
      if (options.updateUrl) {
        const url = new URL(window.location.href);
        url.search = '?view=qr';
        window.history.pushState({}, '', url.toString());
      }
    }

    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /**
   * Parse URL query parameters (?id= & ?view=) and route accordingly
   */
  function handleRouteFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const idParam = params.get('id');
    const viewParam = (params.get('view') || '').toLowerCase();

    if (idParam) {
      const matched = getMachineById(idParam);
      if (matched) {
        switchView('updater', {
          machineId: matched.id,
          lockedViaQr: true,
          updateUrl: false
        });
        return;
      }
    }

    if (viewParam === 'qr') {
      switchView('qr', { updateUrl: false });
      return;
    }

    if (viewParam === 'updater' || viewParam === 'update') {
      switchView('updater', {
        machineId: state.selectedMachineId,
        lockedViaQr: false,
        updateUrl: false
      });
      return;
    }

    switchView('board', { updateUrl: false });
  }

  /**
   * Export current statuses and historical fault log to CSV
   */
  function exportFaultLogToCsv() {
    const rows = [
      ['Asset ID', 'Machine Name', 'Shop Zone', 'Status', 'Category', 'Student Team', 'Reporter', 'Notes', 'Updated At']
    ];

    for (const machine of state.machines) {
      const st = state.statuses[machine.id] || createDefaultStatusEntry();
      rows.push([
        machine.id,
        machine.name,
        machine.zone,
        st.status,
        st.category,
        st.team,
        st.reporter,
        st.notes,
        st.updatedAt
      ]);
    }

    const csvContent = rows
      .map((row) =>
        row
          .map((cell) => {
            const val = cell === null || cell === undefined ? '' : String(cell);
            return `"${val.replace(/"/g, '""')}"`;
          })
          .join(',')
      )
      .join('\r\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const dateStamp = new Date().toISOString().slice(0, 10);
    link.setAttribute('download', `spl-machine-status-${dateStamp}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    showToast(`Exported ${state.machines.length} Workstation Status Ledger to CSV`);
  }

  /**
   * Reset all machines to OPERATIONAL
   */
  function resetAllToOperational() {
    localStorage.removeItem(STORAGE_KEYS.STATUS_OVERRIDES);
    const nowIso = new Date().toISOString();
    for (const machine of state.machines) {
      state.baseStatuses[machine.id] = createDefaultStatusEntry(nowIso);
    }
    syncStatusesWithLocalStorage();
    renderKpiRibbon();
    renderEquipmentGrid();
    renderUpdaterStatusBanner(state.selectedMachineId);
    showToast(`All ${state.machines.length} Machines Reset to OPERATIONAL`);
  }

  /**
   * Wire up DOM event listeners
   */
  function bindEvents() {
    // Header Navigation Buttons
    const navBoard = document.getElementById('nav-board');
    const navUpdater = document.getElementById('nav-updater');
    const navQr = document.getElementById('nav-qr');
    const brandHome = document.getElementById('brand-home-link');

    if (navBoard) {
      navBoard.addEventListener('click', () => switchView('board', { updateUrl: true }));
    }
    if (navUpdater) {
      navUpdater.addEventListener('click', () =>
        switchView('updater', {
          machineId: state.selectedMachineId,
          lockedViaQr: false,
          updateUrl: true
        })
      );
    }
    if (navQr) {
      navQr.addEventListener('click', () => switchView('qr', { updateUrl: true }));
    }
    if (brandHome) {
      brandHome.addEventListener('click', (e) => {
        e.preventDefault();
        switchView('board', { updateUrl: true });
      });
    }

    // Back to board button in Updater view
    const btnBack = document.getElementById('btn-back-to-board');
    if (btnBack) {
      btnBack.addEventListener('click', () => switchView('board', { updateUrl: true }));
    }

    // Search input
    const searchInput = document.getElementById('search-input');
    const clearSearchBtn = document.getElementById('btn-clear-search');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        state.filters.search = e.target.value;
        if (clearSearchBtn) {
          clearSearchBtn.classList.toggle('hidden', !state.filters.search);
        }
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

    // Zone Filter Pills
    const zoneBar = document.getElementById('zone-filter-bar');
    if (zoneBar) {
      zoneBar.addEventListener('click', (e) => {
        const btn = e.target.closest('.zone-pill');
        if (!btn) return;
        const zone = btn.getAttribute('data-zone') || 'ALL';
        state.filters.zone = zone;
        zoneBar.querySelectorAll('.zone-pill').forEach((el) => {
          el.classList.toggle('active', el === btn);
        });
        renderEquipmentGrid();
      });
    }

    // Status Filter Pills
    const statusPills = document.querySelectorAll('.status-pill-filter');
    statusPills.forEach((btn) => {
      btn.addEventListener('click', () => {
        const st = btn.getAttribute('data-status') || 'ALL';
        state.filters.status = st;
        statusPills.forEach((el) => el.classList.toggle('active', el === btn));
        renderEquipmentGrid();
      });
    });

    // KPI Ribbon Cards also act as quick status filters
    const kpiCards = document.querySelectorAll('.kpi-card');
    kpiCards.forEach((card) => {
      card.addEventListener('click', () => {
        const targetStatus = card.getAttribute('data-status-filter') || 'ALL';
        state.filters.status = targetStatus;
        statusPills.forEach((el) => {
          el.classList.toggle('active', el.getAttribute('data-status') === targetStatus);
        });
        renderEquipmentGrid();
      });
    });

    // Reset Filters button
    const resetFiltersBtn = document.getElementById('btn-reset-filters');
    if (resetFiltersBtn) {
      resetFiltersBtn.addEventListener('click', () => {
        state.filters.search = '';
        state.filters.zone = 'ALL';
        state.filters.status = 'ALL';
        if (searchInput) searchInput.value = '';
        if (clearSearchBtn) clearSearchBtn.classList.add('hidden');
        if (zoneBar) {
          zoneBar.querySelectorAll('.zone-pill').forEach((el) => {
            el.classList.toggle('active', el.getAttribute('data-zone') === 'ALL');
          });
        }
        statusPills.forEach((el) => {
          el.classList.toggle('active', el.getAttribute('data-status') === 'ALL');
        });
        renderEquipmentGrid();
      });
    }

    // Equipment Grid Card Click -> Open View 2 pre-selected to that machine
    const gridEl = document.getElementById('equipment-grid');
    if (gridEl) {
      gridEl.addEventListener('click', (e) => {
        const card = e.target.closest('.machine-card');
        if (!card) return;
        const machineId = card.getAttribute('data-machine-id');
        if (machineId) {
          switchView('updater', {
            machineId,
            lockedViaQr: true,
            updateUrl: true
          });
        }
      });

      gridEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          const card = e.target.closest('.machine-card');
          if (!card) return;
          e.preventDefault();
          const machineId = card.getAttribute('data-machine-id');
          if (machineId) {
            switchView('updater', {
              machineId,
              lockedViaQr: true,
              updateUrl: true
            });
          }
        }
      });
    }

    // Machine Selector Change in View 2
    const machineSelect = document.getElementById('machine-select');
    if (machineSelect) {
      machineSelect.addEventListener('change', (e) => {
        const newId = e.target.value;
        state.lockedViaQr = false;
        renderUpdaterStatusBanner(newId);
        const url = new URL(window.location.href);
        url.search = `?id=${encodeURIComponent(newId)}`;
        window.history.replaceState({}, '', url.toString());
      });
    }

    // Radio status change helper -> sync Fault Category default if helpful
    const statusRadios = document.querySelectorAll('input[name="status"]');
    const categorySelect = document.getElementById('fault-category');
    statusRadios.forEach((radio) => {
      radio.addEventListener('change', () => {
        if (!categorySelect) return;
        if (radio.value === 'OPERATIONAL' && radio.checked) {
          categorySelect.value = 'Cleared Fault / Returned to Service';
        } else if (
          (radio.value === 'DOWN' || radio.value === 'DEGRADED') &&
          radio.checked &&
          categorySelect.value === 'Cleared Fault / Returned to Service'
        ) {
          categorySelect.value = 'Broken Tooling / Blade / Insert';
        }
      });
    });

    // Status Update Form Submission
    const formEl = document.getElementById('status-update-form');
    const errorEl = document.getElementById('form-error-msg');
    if (formEl) {
      formEl.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (errorEl) errorEl.classList.add('hidden');

        const machineId = machineSelect ? machineSelect.value : state.selectedMachineId;
        const checkedRadio = formEl.querySelector('input[name="status"]:checked');
        const statusVal = checkedRadio ? checkedRadio.value : '';
        const categoryVal = categorySelect ? categorySelect.value : 'Broken Tooling / Blade / Insert';
        const teamSelect = document.getElementById('student-team');
        const teamVal = teamSelect ? teamSelect.value : '';
        const reporterInput = document.getElementById('reporter-input');
        const reporterVal = reporterInput ? reporterInput.value.trim() : '';
        const notesInput = document.getElementById('fault-notes');
        const notesVal = notesInput ? notesInput.value.trim() : '';

        if (!machineId || !statusVal || !categoryVal || !teamVal || !reporterVal || !notesVal) {
          if (errorEl) {
            errorEl.textContent =
              'Please complete all required fields (Machine Status, Fault Category, Student Team, Reporter Name/Email, and Fault Details).';
            errorEl.classList.remove('hidden');
          }
          return;
        }

        const updatedEntry = {
          status: statusVal,
          category: categoryVal,
          team: teamVal,
          reporter: reporterVal,
          notes: notesVal,
          updatedAt: new Date().toISOString()
        };

        saveMachineStatusOverride(machineId, updatedEntry);
        renderKpiRibbon();
        renderEquipmentGrid();
        renderUpdaterStatusBanner(machineId);

        const machine = getMachineById(machineId) || {
          id: machineId,
          name: machineId,
          zone: 'Student Projects Building'
        };

        // Fire async Teams Adaptive Card + optional state sync webhook
        dispatchExternalWebhooks(machine, updatedEntry);

        // Show visual toast confirmation
        showToast('Status Updated & Sent to Microsoft Teams');

        // Reset text inputs while keeping selected machine visible
        if (notesInput) notesInput.value = '';
      });
    }

    // QR View Controls
    const btnRegenerateQr = document.getElementById('btn-regenerate-qr');
    const qrBaseInput = document.getElementById('qr-base-url');
    const btnPrintQr = document.getElementById('btn-print-qr');

    if (btnRegenerateQr) {
      btnRegenerateQr.addEventListener('click', () => {
        if (qrBaseInput && qrBaseInput.value.trim()) {
          localStorage.setItem(STORAGE_KEYS.QR_BASE_URL, qrBaseInput.value.trim());
        }
        renderQrPlacards();
        showToast(`Updated All ${state.machines.length} QR Code Links`);
      });
    }
    if (qrBaseInput) {
      qrBaseInput.addEventListener('change', () => {
        if (qrBaseInput.value.trim()) {
          localStorage.setItem(STORAGE_KEYS.QR_BASE_URL, qrBaseInput.value.trim());
        }
        renderQrPlacards();
      });
    }
    if (btnPrintQr) {
      btnPrintQr.addEventListener('click', () => {
        window.print();
      });
    }

    // Supervisor Config Modal Controls
    const btnOpenConfig = document.getElementById('btn-supervisor-config');
    const modalBackdrop = document.getElementById('supervisor-modal-backdrop');
    const btnCloseModal = document.getElementById('btn-close-modal');
    const btnSaveConfig = document.getElementById('btn-save-config');
    const btnTestWebhook = document.getElementById('btn-test-webhook');
    const btnExportCsv = document.getElementById('btn-export-csv');
    const btnResetAll = document.getElementById('btn-reset-all');

    const inputTeamsWebhook = document.getElementById('config-teams-webhook');
    const inputSyncEndpoint = document.getElementById('config-sync-endpoint');
    const inputGithubToken = document.getElementById('config-github-token');

    function openSupervisorModal() {
      if (!modalBackdrop) return;
      if (inputTeamsWebhook) {
        inputTeamsWebhook.value = localStorage.getItem(STORAGE_KEYS.TEAMS_WEBHOOK) || '';
      }
      if (inputSyncEndpoint) {
        inputSyncEndpoint.value = localStorage.getItem(STORAGE_KEYS.SYNC_ENDPOINT) || '';
      }
      if (inputGithubToken) {
        inputGithubToken.value = localStorage.getItem(STORAGE_KEYS.GITHUB_TOKEN) || '';
      }
      modalBackdrop.classList.remove('hidden');
    }

    function closeSupervisorModal() {
      if (modalBackdrop) modalBackdrop.classList.add('hidden');
    }

    if (btnOpenConfig) {
      btnOpenConfig.addEventListener('click', openSupervisorModal);
    }
    if (btnCloseModal) {
      btnCloseModal.addEventListener('click', closeSupervisorModal);
    }
    if (modalBackdrop) {
      modalBackdrop.addEventListener('click', (e) => {
        if (e.target === modalBackdrop) closeSupervisorModal();
      });
    }

    if (btnSaveConfig) {
      btnSaveConfig.addEventListener('click', () => {
        if (inputTeamsWebhook) {
          localStorage.setItem(STORAGE_KEYS.TEAMS_WEBHOOK, inputTeamsWebhook.value.trim());
        }
        if (inputSyncEndpoint) {
          localStorage.setItem(STORAGE_KEYS.SYNC_ENDPOINT, inputSyncEndpoint.value.trim());
        }
        if (inputGithubToken) {
          localStorage.setItem(STORAGE_KEYS.GITHUB_TOKEN, inputGithubToken.value.trim());
        }
        closeSupervisorModal();
        showToast('Supervisor Integration Configuration Saved');
      });
    }

    if (btnTestWebhook) {
      btnTestWebhook.addEventListener('click', async () => {
        if (inputTeamsWebhook) {
          localStorage.setItem(STORAGE_KEYS.TEAMS_WEBHOOK, inputTeamsWebhook.value.trim());
        }
        const sampleMachine = getMachineById('CNC-02') || state.machines[0];
        const sampleStatus = {
          status: 'DEGRADED',
          category: 'Broken Tooling / Blade / Insert',
          team: 'Shop Staff / Lab Supervisor',
          reporter: 'Supervisor Webhook Test',
          notes: 'Diagnostic Adaptive Card v1.4 webhook test from Student Projects Building Machine Status System.',
          updatedAt: new Date().toISOString()
        };
        await dispatchExternalWebhooks(sampleMachine, sampleStatus);
        showToast('Status Updated & Sent to Microsoft Teams');
      });
    }

    if (btnExportCsv) {
      btnExportCsv.addEventListener('click', exportFaultLogToCsv);
    }

    if (btnResetAll) {
      btnResetAll.addEventListener('click', () => {
        resetAllToOperational();
        closeSupervisorModal();
      });
    }

    // Handle browser back/forward buttons
    window.addEventListener('popstate', handleRouteFromUrl);
  }

  /**
   * Initialize application
   */
  async function init() {
    await loadInitialData();
    populateMachineSelector();
    renderKpiRibbon();
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
