/**
 * Student Projects Laboratory (930 Kinnear Rd)
 * Operations, Safety (SOP/LOTO) & Preventative Maintenance (PM) Portal
 * Main Application Controller (js/app.js)
 */

(function () {
  'use strict';

  const STORAGE_KEYS = {
    PENDING_OVERRIDES: 'pending_equipment_overrides',
    ASSET_OVERRIDES: 'spl_shop_portal_asset_overrides_v3',
    HISTORY_LOG: 'spl_shop_portal_history_log_v3',
    GITHUB_REPO: 'spl_shop_portal_github_repo_v3',
    TEAMS_WEBHOOK: 'spl_shop_portal_teams_webhook_v3'
  };

  const DEFAULT_GITHUB_REPO = 'wrightwmax-sketch/Machine-status-reporting-';
  const urlSyncTopicOverride = (() => {
    try {
      const p = new URLSearchParams(window.location.search).get('sync_topic');
      return p && /^[A-Za-z0-9_-]{8,64}$/.test(p) ? p : '';
    } catch (e) {
      return '';
    }
  })();

  const CLOUD_SYNC_CONFIG = {
    REST_OBJECT_URL: urlSyncTopicOverride
      ? ''
      : 'https://api.restful-api.dev/objects/ff808181a09d98f701a17a8043301cf6',
    NTFY_TOPIC: urlSyncTopicOverride || 'spl_930_kinnear_prod_sync_v7'
  };

  /**
   * Strict Security Policy & Allowlists (Anti-XSS, Anti-Prototype-Pollution, Anti-Mass-Assignment)
   */
  const SECURITY_POLICY = {
    VALID_ASSET_IDS: new Set([
      'MAC-01', 'MAC-02', 'MAC-03', 'MAC-04',
      'CNC-01', 'CNC-02', 'CNC-03',
      'WLD-01', 'WLD-02', 'WLD-03', 'WLD-04', 'WLD-05',
      'SAW-01', 'SAW-02', 'SAW-03', 'SAW-04', 'SAW-05',
      'FAB-01', 'FAB-02', 'FAB-03', 'FAB-04', 'FAB-05',
      'FAC-01', 'FAC-02'
    ]),
    VALID_STATUSES: new Set(['OPERATIONAL', 'DEGRADED', 'PM_DUE_SOON', 'PM_OVERDUE', 'DOWN']),
    VALID_PM_STATUSES: new Set(['COMPLIANT', 'DUE_SOON', 'OVERDUE', 'ATTENTION']),
    VALID_HISTORY_TYPES: new Set(['FAULT_REPORT', 'FAULT_RESOLVED', 'MONTHLY_PM']),
    FORBIDDEN_KEYS: new Set(['__proto__', 'constructor', 'prototype']),
    MAX_CLOCK_SKEW_MS: 10 * 60 * 1000, // Reject forged future timestamps > 10 min ahead
    MIN_VALID_EPOCH_MS: Date.parse('2025-01-01T00:00:00Z'),
    SUBMISSION_COOLDOWN_MS: 1500
  };

  let lastSubmissionEpochMs = 0;

  function fetchWithTimeout(url, options, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs || 8000);
    const mergedOptions = Object.assign({}, options || {}, { signal: controller.signal });
    return fetch(url, mergedOptions).finally(() => clearTimeout(timer));
  }

  const state = {
    metadata: {},
    assets: [],
    history: [],
    cloudOverrides: {},
    cloudHistory: [],
    activeAssetId: null,
    activeModalTab: 'fault', // 'fault' | 'sop' | 'loto' | 'pm'
    currentView: 'dashboard', // 'dashboard' | 'history' | 'qr'
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
      .replace(/'/g, '&#039;')
      .replace(/`/g, '&#096;');
  }

  /**
   * Sanitize untrusted plain-text input: strips null/control bytes, dangerous HTML/script patterns, and enforces max length
   */
  function sanitizePlainText(input, maxLen) {
    if (input === null || input === undefined) return '';
    const limit = typeof maxLen === 'number' && maxLen > 0 ? maxLen : 500;
    return String(input)
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
      .replace(/<\s*\/?\s*(script|iframe|object|embed|svg|math|style|link|meta|base|form|input|button|textarea)[^>]*>/gi, '')
      .replace(/javascript\s*:/gi, '')
      .replace(/vbscript\s*:/gi, '')
      .replace(/data\s*:\s*text\/html/gi, '')
      .replace(/\bon[a-z]+\s*=/gi, '')
      .trim()
      .slice(0, limit);
  }

  /**
   * Validate ISO-8601 timestamps so an attacker cannot inject a year-2099 timestamp to lock Last-Write-Wins
   */
  function clampAndValidateTimestamp(rawTs) {
    if (!rawTs || typeof rawTs !== 'string') return null;
    const parsed = Date.parse(rawTs.trim());
    if (Number.isNaN(parsed) || parsed < SECURITY_POLICY.MIN_VALID_EPOCH_MS) {
      return null;
    }
    const maxAllowed = Date.now() + SECURITY_POLICY.MAX_CLOCK_SKEW_MS;
    if (parsed > maxAllowed) {
      return null;
    }
    return new Date(parsed).toISOString();
  }

  function isValidDateYmd(str) {
    return typeof str === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(str.trim());
  }

  /**
   * Strictly validate & sanitize an asset override object.
   * Blocks prototype pollution and mass assignment (never allows overwriting sop_drive_url, loto_drive_url, name, etc.)
   */
  function sanitizeAssetOverride(assetId, rawOv) {
    const cleanId = String(assetId || '').trim().toUpperCase();
    if (
      !SECURITY_POLICY.VALID_ASSET_IDS.has(cleanId) ||
      SECURITY_POLICY.FORBIDDEN_KEYS.has(cleanId) ||
      !rawOv ||
      typeof rawOv !== 'object' ||
      Array.isArray(rawOv)
    ) {
      return null;
    }

    const rawStatus = String(rawOv.status || '').trim().toUpperCase();
    if (!SECURITY_POLICY.VALID_STATUSES.has(rawStatus)) {
      return null;
    }

    const validTs = clampAndValidateTimestamp(rawOv.last_updated || rawOv.updatedAt);
    if (!validTs) {
      return null;
    }

    const cleanNote = sanitizePlainText(
      rawOv.conditionNote !== undefined ? rawOv.conditionNote : rawOv.last_fault_notes,
      500
    );

    const safeRecord = {
      status: rawStatus,
      conditionNote: cleanNote,
      last_fault_notes: cleanNote,
      last_updated: validTs
    };

    if (rawOv.pmStatus) {
      const rawPmStatus = String(rawOv.pmStatus).trim().toUpperCase();
      if (SECURITY_POLICY.VALID_PM_STATUSES.has(rawPmStatus)) {
        safeRecord.pmStatus = rawPmStatus;
      }
    }
    if (isValidDateYmd(rawOv.lastPmDate)) {
      safeRecord.lastPmDate = rawOv.lastPmDate.trim();
    }
    if (isValidDateYmd(rawOv.nextPmDue)) {
      safeRecord.nextPmDue = rawOv.nextPmDue.trim();
    }
    if (rawOv.lastPmTech) {
      safeRecord.lastPmTech = sanitizePlainText(rawOv.lastPmTech, 80);
    }

    return safeRecord;
  }

  /**
   * Strictly validate & sanitize a history entry from local, cloud, or GitHub Issue sources
   */
  function sanitizeHistoryEntry(rawEntry) {
    if (!rawEntry || typeof rawEntry !== 'object' || Array.isArray(rawEntry)) return null;

    const cleanId = String(rawEntry.id || '').trim();
    if (!/^[A-Za-z0-9_-]{3,80}$/.test(cleanId)) return null;

    const cleanAssetId = String(rawEntry.assetId || '').trim().toUpperCase();
    if (!SECURITY_POLICY.VALID_ASSET_IDS.has(cleanAssetId)) return null;

    const validTs = clampAndValidateTimestamp(rawEntry.timestamp);
    if (!validTs) return null;

    const rawType = String(rawEntry.type || 'FAULT_REPORT').trim().toUpperCase();
    const safeType = SECURITY_POLICY.VALID_HISTORY_TYPES.has(rawType) ? rawType : 'FAULT_REPORT';

    const rawStatusAfter = String(rawEntry.statusAfter || 'OPERATIONAL').trim().toUpperCase();
    const safeStatusAfter = SECURITY_POLICY.VALID_STATUSES.has(rawStatusAfter)
      ? rawStatusAfter
      : 'OPERATIONAL';

    const rawPmAfter = String(rawEntry.pmStatusAfter || 'COMPLIANT').trim().toUpperCase();
    const safePmAfter = SECURITY_POLICY.VALID_PM_STATUSES.has(rawPmAfter) ? rawPmAfter : 'COMPLIANT';

    const safeMetrics = {};
    if (rawEntry.metrics && typeof rawEntry.metrics === 'object' && !Array.isArray(rawEntry.metrics)) {
      Object.entries(rawEntry.metrics)
        .slice(0, 10)
        .forEach(([k, v]) => {
          const cleanK = sanitizePlainText(k, 40);
          if (cleanK && !SECURITY_POLICY.FORBIDDEN_KEYS.has(cleanK)) {
            safeMetrics[cleanK] = sanitizePlainText(v, 60);
          }
        });
    }

    return {
      id: cleanId,
      timestamp: validTs,
      type: safeType,
      assetId: cleanAssetId,
      assetName: sanitizePlainText(rawEntry.assetName || cleanAssetId, 100),
      teamOrRole: sanitizePlainText(rawEntry.teamOrRole || 'Student Team', 80),
      technician: sanitizePlainText(rawEntry.technician || 'Shop User', 80),
      statusAfter: safeStatusAfter,
      pmStatusAfter: safePmAfter,
      metrics: safeMetrics,
      completedItemsCount: Math.max(0, Math.min(50, parseInt(rawEntry.completedItemsCount, 10) || 0)),
      totalItemsCount: Math.max(0, Math.min(50, parseInt(rawEntry.totalItemsCount, 10) || 0)),
      notes: sanitizePlainText(rawEntry.notes || '', 500)
    };
  }

  window.sanitizeAssetOverride = sanitizeAssetOverride;
  window.sanitizeHistoryEntry = sanitizeHistoryEntry;

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
    const saved = (localStorage.getItem(STORAGE_KEYS.GITHUB_REPO) || '').trim();
    if (saved && /^[A-Za-z0-9_.-]{1,64}\/[A-Za-z0-9_.-]{1,100}$/.test(saved)) {
      return saved;
    }
    return DEFAULT_GITHUB_REPO;
  }

  function getConfiguredTeamsWebhook() {
    const saved = (localStorage.getItem(STORAGE_KEYS.TEAMS_WEBHOOK) || '').trim();
    if (!saved) return '';
    try {
      const parsed = new URL(saved);
      if (parsed.protocol !== 'https:') return '';
      const host = parsed.hostname.toLowerCase();
      const allowedHost =
        host.endsWith('.logic.azure.com') ||
        host.endsWith('.webhook.office.com') ||
        host.endsWith('.api.powerplatform.com');
      return allowedHost ? parsed.toString() : '';
    } catch (e) {
      return '';
    }
  }

  /**
   * Merge pending/recent local updates and cross-device cloud updates over static JSON records.
   * Strictly sanitizes every candidate override so untrusted payloads can never alter SOP/LOTO URLs or execute XSS.
   */
  function getMergedEquipmentData(fetchedData, cloudOverrides, githubIssueOverrides) {
    let pendingOverrides = {};
    try {
      pendingOverrides = JSON.parse(localStorage.getItem(STORAGE_KEYS.PENDING_OVERRIDES) || '{}') || {};
    } catch (e) {
      pendingOverrides = {};
    }

    let legacyOverrides = {};
    try {
      legacyOverrides = JSON.parse(localStorage.getItem(STORAGE_KEYS.ASSET_OVERRIDES) || '{}') || {};
    } catch (e) {
      legacyOverrides = {};
    }

    const localMap = Object.assign({}, legacyOverrides, pendingOverrides);
    const cloudMap = cloudOverrides || state.cloudOverrides || {};
    const issueMap = githubIssueOverrides || {};

    return (fetchedData || []).map((asset) => {
      const rawCandidates = [issueMap[asset.id], cloudMap[asset.id], localMap[asset.id]].filter(Boolean);
      const candidates = rawCandidates
        .map((c) => sanitizeAssetOverride(asset.id, c))
        .filter(Boolean);

      if (candidates.length === 0) return asset;

      candidates.sort((a, b) => {
        const ta = Date.parse(a.last_updated || '1970-01-01T00:00:00Z') || 0;
        const tb = Date.parse(b.last_updated || '1970-01-01T00:00:00Z') || 0;
        return ta - tb;
      });

      let merged = Object.assign({}, asset);
      candidates.forEach((cleanOv) => {
        merged.status = cleanOv.status;
        merged.conditionNote = cleanOv.conditionNote;
        merged.last_fault_notes = cleanOv.last_fault_notes;
        merged.last_updated = cleanOv.last_updated;
        if (cleanOv.pmStatus) merged.pmStatus = cleanOv.pmStatus;
        if (cleanOv.lastPmDate) merged.lastPmDate = cleanOv.lastPmDate;
        if (cleanOv.nextPmDue) merged.nextPmDue = cleanOv.nextPmDue;
        if (cleanOv.lastPmTech) merged.lastPmTech = cleanOv.lastPmTech;
      });
      return merged;
    });
  }

  window.getMergedEquipmentData = getMergedEquipmentData;

  /**
   * Store the latest logged condition directly into localStorage ('pending_equipment_overrides')
   * for instant UI updates and sync with local asset overrides.
   */
  function logConditionLocally(assetId, newStatus, issueNotes, extraPatch) {
    let pending = {};
    try {
      pending = JSON.parse(localStorage.getItem(STORAGE_KEYS.PENDING_OVERRIDES) || '{}') || {};
    } catch (e) {
      pending = {};
    }
    const nowIso = new Date().toISOString();
    const rawRecord = Object.assign({}, pending[assetId] || {}, extraPatch || {}, {
      status: newStatus,
      conditionNote: issueNotes,
      last_fault_notes: issueNotes,
      last_updated: nowIso
    });
    const safeFallbackStatus = SECURITY_POLICY.VALID_STATUSES.has(String(newStatus || '').toUpperCase())
      ? String(newStatus).toUpperCase()
      : 'OPERATIONAL';
    const record = sanitizeAssetOverride(assetId, rawRecord) || {
      status: safeFallbackStatus,
      conditionNote: sanitizePlainText(issueNotes, 500),
      last_fault_notes: sanitizePlainText(issueNotes, 500),
      last_updated: nowIso
    };
    pending[assetId] = record;
    localStorage.setItem(STORAGE_KEYS.PENDING_OVERRIDES, JSON.stringify(pending));
    saveAssetOverride(assetId, record);
    return record;
  }

  window.logConditionLocally = logConditionLocally;

  /**
   * Fetch cross-device shared cloud state across Dual Redundant Cloud Backends:
   * 1) Backend A (REST Object Snapshot) — long-term multi-week persistence
   * 2) Backend B (ntfy Event Stream) — zero-conflict concurrent event log across any IP/MAC
   * Every record is strictly validated through sanitizeAssetOverride() and sanitizeHistoryEntry().
   */
  async function fetchCrossDeviceCloudState(options) {
    const opts = options || {};
    const cloudOverrides = opts.ntfyOnly ? Object.assign({}, state.cloudOverrides || {}) : {};
    const cloudHistory = opts.ntfyOnly ? (state.cloudHistory || []).slice() : [];

    const applyCandidateOverride = (assetId, rawPatch) => {
      const clean = sanitizeAssetOverride(assetId, rawPatch);
      if (!clean) return;
      const cleanId = String(assetId || '').trim().toUpperCase();
      const existing = cloudOverrides[cleanId];
      const existingTs = existing ? Date.parse(existing.last_updated || '') || 0 : 0;
      const incomingTs = Date.parse(clean.last_updated || '') || 0;
      if (incomingTs >= existingTs) {
        cloudOverrides[cleanId] = clean;
      }
    };

    const applyCandidateHistory = (rawEntry) => {
      const clean = sanitizeHistoryEntry(rawEntry);
      if (!clean) return;
      if (!cloudHistory.some((h) => h.id === clean.id)) {
        cloudHistory.push(clean);
      }
    };

    const restPromise =
      opts.ntfyOnly || !CLOUD_SYNC_CONFIG.REST_OBJECT_URL
        ? Promise.resolve(null)
        : (async () => {
            try {
              const resp = await fetchWithTimeout(
                `${CLOUD_SYNC_CONFIG.REST_OBJECT_URL}?t=${Date.now()}`,
                { cache: 'no-store' },
                8000
              );
              if (resp.ok) {
                const json = await resp.json();
                return (json && json.data) || null;
              }
            } catch (e) {
              // Non-fatal fallback
            }
            return null;
          })();

    const ntfyPromise = (async () => {
      try {
        const resp = await fetchWithTimeout(
          `https://ntfy.sh/${CLOUD_SYNC_CONFIG.NTFY_TOPIC}/json?poll=1&since=all&_cb=${Date.now()}`,
          { cache: 'no-store' },
          8000
        );
        if (resp.ok) {
          const text = await resp.text();
          return text.split('\n').filter((l) => l.trim());
        }
      } catch (e) {
        // Non-fatal fallback
      }
      return [];
    })();

    const [restResult, ntfyResult] = await Promise.allSettled([restPromise, ntfyPromise]);
    const restData = restResult.status === 'fulfilled' ? restResult.value : null;
    const ntfyLines = ntfyResult.status === 'fulfilled' ? ntfyResult.value || [] : [];

    // 1. Seed from persistent REST snapshot first
    if (restData) {
      if (restData.overrides && typeof restData.overrides === 'object') {
        Object.entries(restData.overrides).forEach(([id, ov]) => {
          applyCandidateOverride(id, ov);
        });
      }
      if (Array.isArray(restData.history)) {
        restData.history.forEach((h) => applyCandidateHistory(h));
      }
    }

    // 2. Replay chronological ntfy event stream on top of snapshot
    ntfyLines.forEach((line) => {
      try {
        const evt = JSON.parse(line);
        if (evt.event === 'message' && evt.message) {
          const payload = JSON.parse(evt.message);
          if (payload && payload.action === 'CLEAR_ALL') {
            const validClearIso = clampAndValidateTimestamp(payload.timestamp);
            const clearTs = validClearIso ? Date.parse(validClearIso) : 0;
            if (clearTs > 0) {
              Object.keys(cloudOverrides).forEach((k) => {
                const ovTs = Date.parse(cloudOverrides[k].last_updated || '') || 0;
                if (ovTs <= clearTs) delete cloudOverrides[k];
              });
              for (let i = cloudHistory.length - 1; i >= 0; i--) {
                const hTs = Date.parse(cloudHistory[i].timestamp || '') || 0;
                if (hTs <= clearTs) cloudHistory.splice(i, 1);
              }
            }
          } else if (payload && payload.assetId && payload.patch) {
            applyCandidateOverride(payload.assetId, payload.patch);
            if (payload.historyEntry) {
              applyCandidateHistory(payload.historyEntry);
            }
          }
        }
      } catch (innerErr) {
        // Ignore malformed event line
      }
    });

    cloudHistory.sort((a, b) => (Date.parse(b.timestamp) || 0) - (Date.parse(a.timestamp) || 0));

    state.cloudOverrides = cloudOverrides;
    state.cloudHistory = cloudHistory.slice(0, 40);
    return { cloudOverrides: state.cloudOverrides, cloudHistory: state.cloudHistory };
  }

  /**
   * Push a condition or PM update to both cross-device cloud stores immediately in parallel
   * with keepalive: true so all other devices on any IP/MAC address see the update right away.
   */
  async function publishCrossDeviceSync(assetId, patch, historyEntry) {
    const cleanId = String(assetId || '').trim().toUpperCase();
    const cleanPatch = sanitizeAssetOverride(cleanId, patch);
    if (!cleanPatch) return;
    const cleanHistory = historyEntry ? sanitizeHistoryEntry(historyEntry) : null;

    state.cloudOverrides = state.cloudOverrides || {};
    state.cloudOverrides[cleanId] = cleanPatch;
    if (cleanHistory) {
      state.cloudHistory = state.cloudHistory || [];
      if (!state.cloudHistory.some((h) => h && h.id === cleanHistory.id)) {
        state.cloudHistory.unshift(cleanHistory);
      }
      state.cloudHistory = state.cloudHistory.slice(0, 40);
    }

    // 1. Immediately fire append-only event to Backend B (ntfy.sh) with keepalive: true
    const eventPayload = {
      action: 'ASSET_UPDATE',
      timestamp: cleanPatch.last_updated,
      assetId: cleanId,
      patch: cleanPatch,
      historyEntry: cleanHistory
    };

    const ntfyTask = fetchWithTimeout(
      `https://ntfy.sh/${CLOUD_SYNC_CONFIG.NTFY_TOPIC}`,
      {
        method: 'POST',
        keepalive: true,
        body: JSON.stringify(eventPayload)
      },
      5000
    ).catch(() => {});

    // 2. Immediately update persistent snapshot in Backend A (restful-api.dev) in parallel
    const restTask = !CLOUD_SYNC_CONFIG.REST_OBJECT_URL
      ? Promise.resolve()
      : fetchWithTimeout(
          CLOUD_SYNC_CONFIG.REST_OBJECT_URL,
          {
            method: 'PUT',
            keepalive: true,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: 'spl_930_kinnear_prod_sync_v7',
              data: {
                updatedAt: cleanPatch.last_updated,
                overrides: state.cloudOverrides,
                history: state.cloudHistory
              }
            })
          },
          5000
        ).catch(() => {});

    await Promise.allSettled([ntfyTask, restTask]);
  }

  /**
   * Fetch open/recent GitHub Issues directly via GitHub REST API so any submitted issue
   * reflects immediately even before GitHub Actions or GitHub Pages CDN finishes deploying.
   */
  async function fetchLiveGithubIssues() {
    const issueOverrides = {};
    const issueHistory = [];
    const repo = getConfiguredGithubRepo();
    if (!repo) return { issueOverrides, issueHistory };

    try {
      const resp = await fetch(
        `https://api.github.com/repos/${repo}/issues?state=all&per_page=30&t=${Date.now()}`,
        { cache: 'no-store' }
      );
      if (!resp.ok) return { issueOverrides, issueHistory };
      const issues = await resp.json();
      if (!Array.isArray(issues)) return { issueOverrides, issueHistory };

      const extractSection = (body, heading) => {
        const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`###\\s+${escaped}\\s*\\n+([\\s\\S]*?)(?=\\n###\\s+|$)`, 'i');
        const m = (body || '').match(regex);
        return m ? m[1].trim() : '';
      };

      // Process oldest to newest so newer issues override older ones
      issues
        .slice()
        .reverse()
        .forEach((iss) => {
          if (!iss || iss.pull_request) return;
          const title = iss.title || '';
          const body = iss.body || '';
          let assetId = extractSection(body, 'Asset ID').toUpperCase();
          if (!assetId) {
            const m = title.toUpperCase().match(/(MAC-\d+|CNC-\d+|WLD-\d+|SAW-\d+|FAB-\d+|FAC-\d+)/);
            assetId = m ? m[1] : '';
          }
          if (!assetId) return;

          const createdAt = iss.created_at || new Date().toISOString();
          if (title.toUpperCase().includes('[PM-LOG]') || body.includes('Post-PM Operational Status')) {
            const statusRaw = extractSection(body, 'Post-PM Operational Status').toUpperCase();
            const statusAfter = statusRaw.includes('DOWN')
              ? 'DOWN'
              : statusRaw.includes('DUE')
              ? 'DEGRADED'
              : 'OPERATIONAL';
            const tech =
              extractSection(body, 'Technician / SRA Name & Initials') ||
              (iss.user && iss.user.login) ||
              'Shop Staff';
            const notes =
              extractSection(body, 'Inspection Notes, Parts Replaced, or Follow-Up Actions') || title;
            const pmDate = createdAt.slice(0, 10);
            const nextDue = new Date(Date.parse(createdAt) + 30 * 24 * 60 * 60 * 1000)
              .toISOString()
              .slice(0, 10);

            issueOverrides[assetId] = {
              status: statusAfter,
              pmStatus: statusAfter === 'OPERATIONAL' ? 'COMPLIANT' : 'ATTENTION',
              lastPmDate: pmDate,
              nextPmDue: nextDue,
              lastPmTech: tech,
              conditionNote: notes,
              last_fault_notes: notes,
              last_updated: createdAt
            };
            issueHistory.unshift({
              id: `GH-ISS-${iss.number}`,
              timestamp: createdAt,
              type: 'MONTHLY_PM',
              assetId: assetId,
              assetName: assetId,
              teamOrRole: 'Shop Staff',
              technician: tech,
              statusAfter: statusAfter,
              pmStatusAfter: statusAfter === 'OPERATIONAL' ? 'COMPLIANT' : 'ATTENTION',
              metrics: {},
              completedItemsCount: 0,
              totalItemsCount: 0,
              notes: notes
            });
          } else if (
            title.toUpperCase().includes('[FAULT]') ||
            body.includes('Machine Condition / Severity Level')
          ) {
            const sevRaw = extractSection(body, 'Machine Condition / Severity Level').toUpperCase();
            const statusAfter = sevRaw.includes('DOWN')
              ? 'DOWN'
              : sevRaw.includes('DEGRADED') || sevRaw.includes('CAUTION')
              ? 'DEGRADED'
              : 'OPERATIONAL';
            const reporter =
              extractSection(body, 'Reporter Name & Email') ||
              (iss.user && iss.user.login) ||
              'Shop Floor User';
            const team =
              extractSection(body, 'Student Team / Affiliation') ||
              extractSection(body, 'Student Team / Course Affiliation') ||
              'Student Team';
            const notes =
              extractSection(body, 'Fault Description, Broken Tooling, or Alarm Code') || title;

            issueOverrides[assetId] = {
              status: statusAfter,
              conditionNote: notes,
              last_fault_notes: notes,
              last_updated: createdAt
            };
            issueHistory.unshift({
              id: `GH-ISS-${iss.number}`,
              timestamp: createdAt,
              type: statusAfter === 'OPERATIONAL' ? 'FAULT_RESOLVED' : 'FAULT_REPORT',
              assetId: assetId,
              assetName: assetId,
              teamOrRole: team,
              technician: reporter,
              statusAfter: statusAfter,
              pmStatusAfter: 'COMPLIANT',
              metrics: {},
              completedItemsCount: 0,
              totalItemsCount: 0,
              notes: notes
            });
          }
        });
    } catch (e) {
      // Non-fatal fallback
    }

    return { issueOverrides, issueHistory };
  }

  function renderDashboard() {
    renderExecutiveKpis();
    renderEquipmentGrid();
    renderHistoryTable();
  }

  window.renderDashboard = renderDashboard;

  /**
   * Eliminate Browser Cache + CDN Edge Delay and merge local, cloud, and GitHub Issue state
   */
  async function loadEquipmentData() {
    try {
      const cacheBuster = `?t=${Date.now()}`;
      const repo = getConfiguredGithubRepo();

      // Fetch local static JSON, raw GitHub main branch JSON (bypasses Pages CDN delay),
      // live GitHub Issues API, and cross-device cloud store in parallel
      const [equipmentRes, historyRes, rawGitMainRes, rawGitHistRes, cloudState, issueState] =
        await Promise.all([
          fetch(`data/equipment_master.json${cacheBuster}`, { cache: 'no-store' }),
          fetch(`data/pm_history.json${cacheBuster}`, { cache: 'no-store' }),
          fetch(
            `https://raw.githubusercontent.com/${repo}/main/data/equipment_master.json${cacheBuster}`,
            { cache: 'no-store' }
          ).catch(() => null),
          fetch(
            `https://raw.githubusercontent.com/${repo}/main/data/pm_history.json${cacheBuster}`,
            { cache: 'no-store' }
          ).catch(() => null),
          fetchCrossDeviceCloudState(),
          fetchLiveGithubIssues()
        ]);

      if (!equipmentRes.ok && (!rawGitMainRes || !rawGitMainRes.ok)) {
        throw new Error(`HTTP error: ${equipmentRes.status}`);
      }

      let masterData = equipmentRes.ok ? await equipmentRes.json() : null;
      if (rawGitMainRes && rawGitMainRes.ok) {
        try {
          const rawMainData = await rawGitMainRes.json();
          const localTs = Date.parse((masterData && masterData.metadata && masterData.metadata.lastUpdated) || '') || 0;
          const mainTs = Date.parse((rawMainData && rawMainData.metadata && rawMainData.metadata.lastUpdated) || '') || 0;
          if (!masterData || mainTs >= localTs) {
            masterData = rawMainData;
          }
        } catch (e) {
          // Keep local masterData
        }
      }

      let baseHistory = historyRes && historyRes.ok ? await historyRes.json() : [];
      if (rawGitHistRes && rawGitHistRes.ok) {
        try {
          const rawMainHist = await rawGitHistRes.json();
          if (Array.isArray(rawMainHist) && rawMainHist.length >= baseHistory.length) {
            baseHistory = rawMainHist;
          }
        } catch (e) {
          // Keep local baseHistory
        }
      }

      state.metadata = (masterData && masterData.metadata) || {};
      const rawAssets = Array.isArray(masterData && masterData.assets) ? masterData.assets : [];
      rawAssets.forEach((a) => {
        if (a && a.id && /^[A-Z]{2,5}-\d{2,3}$/.test(String(a.id).toUpperCase())) {
          SECURITY_POLICY.VALID_ASSET_IDS.add(String(a.id).toUpperCase());
        }
      });

      state.assets = getMergedEquipmentData(
        rawAssets,
        cloudState && cloudState.cloudOverrides,
        issueState && issueState.issueOverrides
      );

      window.equipmentData = {
        metadata: state.metadata,
        assets: state.assets
      };

      let localHistory = [];
      try {
        localHistory = JSON.parse(localStorage.getItem(STORAGE_KEYS.HISTORY_LOG) || '[]') || [];
      } catch (e) {
        localHistory = [];
      }

      const seenIds = new Set();
      const mergedHistory = [];
      [
        ...localHistory,
        ...((cloudState && cloudState.cloudHistory) || []),
        ...((issueState && issueState.issueHistory) || []),
        ...(Array.isArray(baseHistory) ? baseHistory : [])
      ].forEach((rawEntry) => {
        const cleanEntry = sanitizeHistoryEntry(rawEntry);
        if (cleanEntry && cleanEntry.id && !seenIds.has(cleanEntry.id)) {
          seenIds.add(cleanEntry.id);
          mergedHistory.push(cleanEntry);
        }
      });

      mergedHistory.sort((a, b) => {
        const ta = Date.parse(a.timestamp || '') || 0;
        const tb = Date.parse(b.timestamp || '') || 0;
        return tb - ta;
      });

      state.history = mergedHistory;
      window.pmHistoryData = mergedHistory;

      renderDashboard();
    } catch (err) {
      console.warn('Live fetch failed, falling back to embedded baseline data:', err);
      if (typeof window.FALLBACK_EQUIPMENT_DATA !== 'undefined') {
        window.equipmentData = window.FALLBACK_EQUIPMENT_DATA;
        state.assets = getMergedEquipmentData(window.FALLBACK_EQUIPMENT_DATA.assets || []);
        renderDashboard();
      }
    }
  }

  const loadPortalData = loadEquipmentData;
  window.loadEquipmentData = loadEquipmentData;

  function saveAssetOverride(assetId, patch) {
    const nowIso = new Date().toISOString();
    const enrichedPatch = Object.assign({}, patch, {
      last_updated: patch.last_updated || nowIso
    });

    let overrides = {};
    try {
      overrides = JSON.parse(localStorage.getItem(STORAGE_KEYS.ASSET_OVERRIDES) || '{}') || {};
    } catch (e) {
      overrides = {};
    }
    overrides[assetId] = Object.assign({}, overrides[assetId] || {}, enrichedPatch);
    localStorage.setItem(STORAGE_KEYS.ASSET_OVERRIDES, JSON.stringify(overrides));

    let pending = {};
    try {
      pending = JSON.parse(localStorage.getItem(STORAGE_KEYS.PENDING_OVERRIDES) || '{}') || {};
    } catch (e) {
      pending = {};
    }
    pending[assetId] = Object.assign({}, pending[assetId] || {}, enrichedPatch);
    localStorage.setItem(STORAGE_KEYS.PENDING_OVERRIDES, JSON.stringify(pending));

    const idx = state.assets.findIndex((a) => a.id === assetId);
    if (idx !== -1) {
      state.assets[idx] = Object.assign({}, state.assets[idx], enrichedPatch);
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
   * Transform standard Google Drive file links into responsive single-document embed preview URLs,
   * full view URLs, and direct download URLs (never a folder list).
   */
  function isSafeDocumentUrl(url) {
    const clean = String(url || '').trim();
    if (!clean) return false;
    if (/^docs\/(sop|loto)\/[A-Za-z0-9_.-]+\.pdf$/i.test(clean)) return true;
    if (/^https:\/\/drive\.google\.com\/(file\/d\/[A-Za-z0-9_-]{10,80}\/(preview|view)|uc\?export=download&id=[A-Za-z0-9_-]{10,80})$/.test(clean)) {
      return true;
    }
    return false;
  }

  function transformGoogleDriveUrl(rawUrl) {
    const clean = String(rawUrl || '').trim();
    if (!clean) {
      return {
        docId: '',
        viewUrl: '',
        previewUrl: '',
        downloadUrl: ''
      };
    }

    const fileMatch = clean.match(/\/file\/d\/([a-zA-Z0-9_-]{10,80})/);
    const docMatch = clean.match(/\/document\/d\/([a-zA-Z0-9_-]{10,80})/);
    const idParamMatch = clean.match(/[?&]id=([a-zA-Z0-9_-]{10,80})/);
    const docId =
      (fileMatch && fileMatch[1]) ||
      (docMatch && docMatch[1]) ||
      (idParamMatch && idParamMatch[1]) ||
      '';

    if (docId) {
      return {
        docId: docId,
        viewUrl: `https://drive.google.com/file/d/${docId}/view`,
        previewUrl: `https://drive.google.com/file/d/${docId}/preview`,
        downloadUrl: `https://drive.google.com/uc?export=download&id=${docId}`
      };
    }

    if (/^docs\/(sop|loto)\/[A-Za-z0-9_.-]+\.pdf$/i.test(clean)) {
      return {
        docId: '',
        viewUrl: clean,
        previewUrl: clean,
        downloadUrl: clean
      };
    }

    return {
      docId: '',
      viewUrl: '',
      previewUrl: '',
      downloadUrl: ''
    };
  }

  window.transformGoogleDriveUrl = transformGoogleDriveUrl;

  function mountDocumentViewerFrame(prefix, targetUrl, docTitle) {
    if (!targetUrl || !isSafeDocumentUrl(targetUrl)) return;
    const mountEl = document.getElementById(`${prefix}-viewer-mount`);
    if (mountEl) {
      mountEl.innerHTML = `
        <iframe
          id="${prefix}-pdf-iframe"
          src="${escapeHtml(targetUrl)}"
          class="drive-pdf-iframe min-h-[620px] sm:min-h-[680px] w-full"
          title="${escapeHtml(docTitle || 'Official Machine Document')}"
          referrerpolicy="strict-origin-when-cross-origin"
          allow="autoplay"
        ></iframe>
      `;
    } else {
      const iframeEl = document.getElementById(`${prefix}-pdf-iframe`);
      if (iframeEl) iframeEl.setAttribute('src', targetUrl);
    }
  }

  /**
   * Populate the 4-Tab Unified Asset Hub Modal for a given asset
   */
  function openAssetHubModal(assetId, initialTab, pushUrl) {
    const asset = state.assets.find((a) => a.id.toUpperCase() === String(assetId || '').toUpperCase());
    if (!asset) return;

    state.activeAssetId = asset.id;
    state.activeModalTab = initialTab || 'fault';
    state.activeViewerUrls = state.activeViewerUrls || {};

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

    const bindDocumentViewer = (prefix, localPdfPath, rawDriveUrl, docTitle, docRev) => {
      const urls = transformGoogleDriveUrl(rawDriveUrl || localPdfPath);
      const effectiveTargetUrl = localPdfPath || urls.previewUrl;
      const effectiveOpenUrl = localPdfPath || urls.viewUrl;
      const effectiveDownloadUrl = localPdfPath || urls.downloadUrl;

      state.activeViewerUrls[prefix] = {
        targetUrl: effectiveTargetUrl,
        title: docTitle,
        renderedForAsset: null
      };

      const pathBadgeEl = document.getElementById(`${prefix}-local-path-badge`);
      const titleEl = document.getElementById(`${prefix}-doc-title`);
      const revEl = document.getElementById(`${prefix}-doc-rev`);
      const fullscreenBtn = document.getElementById(`${prefix}-fullscreen-btn`);
      const dlBtn = document.getElementById(`${prefix}-download-pdf-btn`);
      const openDriveBtn = document.getElementById(`${prefix}-open-drive-btn`);

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
        openDriveBtn.href = urls.viewUrl || effectiveOpenUrl;
        openDriveBtn.classList.remove('hidden');
      }
    };

    bindDocumentViewer(
      'sop',
      asset.sop_pdf_path || '',
      asset.sop_drive_url || '',
      asset.sop_doc_title || `Standard Operating Procedure (SOP) — ${asset.id}: ${asset.name}`,
      asset.sop_revision_date || 'Rev. 2026-10 • Official Shop Standard'
    );

    bindDocumentViewer(
      'loto',
      asset.loto_pdf_path || '',
      asset.loto_drive_url || '',
      asset.loto_doc_title || `Lockout / Tagout (LOTO) Procedure — ${asset.id}: ${asset.name}`,
      asset.loto_revision_date || 'Rev. 2026-10 • Official Shop Standard'
    );

    const bindRelatedDocsBar = (prefix, relatedDocs, labelPrefix, docRev) => {
      const relatedBar = document.getElementById(`${prefix}-related-docs-bar`);
      if (!relatedBar) return;
      const docs = Array.isArray(relatedDocs) ? relatedDocs : [];
      if (docs.length > 1) {
        relatedBar.classList.remove('hidden');
        relatedBar.innerHTML =
          `<span class="text-[11px] font-mono uppercase text-slate-400 font-bold mr-1">Select Unit ${prefix.toUpperCase()}:</span>` +
          docs
            .map(
              (doc, idx) => `
              <button
                type="button"
                class="${prefix}-unit-switch-btn px-3 py-1 rounded-lg text-xs font-bold border transition ${
                  idx === 0
                    ? 'bg-crimson text-white border-red-500'
                    : 'bg-slate-950 text-slate-300 border-slate-700 hover:bg-slate-800'
                }"
                data-unit-pdf="${escapeHtml(doc.pdf_path || '')}"
                data-unit-url="${escapeHtml(doc.url || '')}"
                data-unit-label="${escapeHtml(doc.label)}"
              >
                📄 ${escapeHtml(doc.label)}
              </button>
            `
            )
            .join('');

        relatedBar.querySelectorAll(`.${prefix}-unit-switch-btn`).forEach((btn) => {
          btn.addEventListener('click', () => {
            const unitPdf = btn.getAttribute('data-unit-pdf') || '';
            const unitUrl = btn.getAttribute('data-unit-url') || '';
            const unitLabel = btn.getAttribute('data-unit-label') || asset.name;
            relatedBar.querySelectorAll(`.${prefix}-unit-switch-btn`).forEach((b) => {
              b.className =
                b === btn
                  ? `${prefix}-unit-switch-btn px-3 py-1 rounded-lg text-xs font-bold border transition bg-crimson text-white border-red-500`
                  : `${prefix}-unit-switch-btn px-3 py-1 rounded-lg text-xs font-bold border transition bg-slate-950 text-slate-300 border-slate-700 hover:bg-slate-800`;
            });
            bindDocumentViewer(
              prefix,
              unitPdf,
              unitUrl,
              `${labelPrefix} — ${asset.id}: ${unitLabel}`,
              docRev
            );
            const info = state.activeViewerUrls[prefix];
            if (info) {
              mountDocumentViewerFrame(prefix, info.targetUrl, info.title);
              info.renderedForAsset = `${asset.id}:${unitPdf || unitUrl}`;
            }
          });
        });
      } else {
        relatedBar.classList.add('hidden');
        relatedBar.innerHTML = '';
      }
    };

    bindRelatedDocsBar(
      'sop',
      asset.sop_related_docs,
      'Standard Operating Procedure (SOP)',
      asset.sop_revision_date || 'Rev. 2026-10 • Official Shop Standard'
    );

    bindRelatedDocsBar(
      'loto',
      asset.loto_related_docs,
      'Lockout / Tagout (LOTO) Procedure',
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

    modalEl.classList.remove('hidden');
    switchModalTab(state.activeModalTab, pushUrl);
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

    if (state.activeViewerUrls) {
      ['sop', 'loto'].forEach((prefix) => {
        const info = state.activeViewerUrls[prefix];
        if (!info || !info.targetUrl) return;
        const iframeEl = document.getElementById(`${prefix}-pdf-iframe`);
        const currentSrc = iframeEl ? iframeEl.getAttribute('src') : '';
        if (prefix === normalized && info.renderedForAsset !== state.activeAssetId) {
          mountDocumentViewerFrame(prefix, info.targetUrl, info.title);
          info.renderedForAsset = state.activeAssetId;
        } else if (currentSrc !== info.targetUrl) {
          mountDocumentViewerFrame(prefix, info.targetUrl, info.title);
        }
      });
    }

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
   * Handle Fault Report Submission (Local + Dual-Cloud Cross-Device Sync + Optional GitHub Issue Window)
   */
  async function handleFaultSubmission(openGithubIssue) {
    const nowMs = Date.now();
    if (nowMs - lastSubmissionEpochMs < SECURITY_POLICY.SUBMISSION_COOLDOWN_MS) {
      showToast('Please wait a moment before submitting another report.');
      return;
    }
    lastSubmissionEpochMs = nowMs;

    const asset = state.assets.find((a) => a.id === state.activeAssetId);
    if (!asset) return;

    const checkedRadio = document.querySelector('input[name="fault-severity"]:checked');
    const rawSeverity = checkedRadio ? checkedRadio.value : 'DOWN';
    const severityVal = SECURITY_POLICY.VALID_STATUSES.has(rawSeverity) ? rawSeverity : 'DOWN';
    const teamSelect = document.getElementById('fault-team-select');
    const reporterInput = document.getElementById('fault-reporter-input');
    const descInput = document.getElementById('fault-description-input');

    const team = sanitizePlainText(teamSelect ? teamSelect.value : 'Formula Buckeyes', 80) || 'Formula Buckeyes';
    const reporter = sanitizePlainText(reporterInput && reporterInput.value, 80) || 'Shop Floor User';
    const description =
      sanitizePlainText(descInput && descInput.value, 500) ||
      `Status updated to ${severityVal} via Unified QR Hub.`;

    // Open GitHub Issue tab synchronously inside user gesture handler if requested
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

      window.open(issueUrl, '_blank', 'noopener,noreferrer');
    }

    const nowIso = new Date().toISOString();
    const patch = logConditionLocally(asset.id, severityVal, description);

    const entry = sanitizeHistoryEntry({
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
    });

    if (entry) {
      prependHistoryEntry(entry);
    }
    renderDashboard();
    openAssetHubModal(asset.id, 'fault', false);

    await Promise.all([
      publishCrossDeviceSync(asset.id, patch, entry),
      dispatchTeamsAlert('Machine Condition Alert', asset, severityVal, reporter, team, description)
    ]);

    if (openGithubIssue) {
      showToast(`Synced ${asset.id} (${severityVal}) across all devices & opened GitHub Fault Ticket`);
    } else {
      showToast(`Synced status for ${asset.id}: ${severityVal} across all shop screens & devices`);
    }
  }

  /**
   * Handle Monthly PM Checklist Submission (Local + Dual-Cloud Cross-Device Sync + Optional GitHub Issue Window)
   */
  async function handlePmSubmission(openGithubIssue) {
    const nowMs = Date.now();
    if (nowMs - lastSubmissionEpochMs < SECURITY_POLICY.SUBMISSION_COOLDOWN_MS) {
      showToast('Please wait a moment before submitting another report.');
      return;
    }
    lastSubmissionEpochMs = nowMs;

    const asset = state.assets.find((a) => a.id === state.activeAssetId);
    if (!asset) return;

    const techInput = document.getElementById('pm-tech-input');
    const postStatusSelect = document.getElementById('pm-post-status-select');
    const notesInput = document.getElementById('pm-notes-input');

    const technician = sanitizePlainText(techInput && techInput.value, 80) || 'Max Wright (MW)';
    const rawPostStatus = postStatusSelect ? postStatusSelect.value : 'OPERATIONAL';
    const postStatus = SECURITY_POLICY.VALID_STATUSES.has(rawPostStatus) ? rawPostStatus : 'OPERATIONAL';
    const notes =
      sanitizePlainText(notesInput && notesInput.value, 500) ||
      `Completed standardized monthly PM checklist for ${asset.id}.`;

    const checkedBoxes = Array.from(document.querySelectorAll('#pm-checklist-items .pm-check-item'));
    const completedLines = checkedBoxes.map((cb) => {
      const lbl = sanitizePlainText(cb.getAttribute('data-check-label') || '', 120);
      return `- [${cb.checked ? 'x' : ' '}] ${lbl}`;
    });
    const completedCount = checkedBoxes.filter((cb) => cb.checked).length;

    const metricInputs = Array.from(document.querySelectorAll('#pm-quantitative-fields .pm-metric-input'));
    const metricsObj = {};
    const metricsLines = [];
    metricInputs.forEach((inp) => {
      const key = sanitizePlainText(inp.getAttribute('data-metric-key'), 40);
      const unit = sanitizePlainText(inp.getAttribute('data-metric-unit') || '', 20);
      const val = sanitizePlainText(inp.value || '', 40);
      if (key && val && !SECURITY_POLICY.FORBIDDEN_KEYS.has(key)) {
        metricsObj[key] = unit && !val.includes(unit) ? `${val} ${unit}` : val;
        metricsLines.push(`${key}: ${metricsObj[key]}`);
      }
    });

    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);
    const nextDue = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    // Open GitHub Issue tab synchronously inside user gesture handler if requested
    if (openGithubIssue) {
      const issueUrl = buildGithubIssueUrl('monthly_pm_log.yml', {
        title: `[PM-LOG] ${asset.id} (${asset.name}) — ${todayStr}`,
        asset_id: asset.id,
        post_pm_status:
          postStatus === 'PM_DUE_SOON'
            ? 'PM DUE SOON'
            : postStatus === 'DOWN'
            ? 'DOWN - LOCKED OUT'
            : 'OPERATIONAL',
        technician: technician,
        checklist_summary: completedLines.join('\n'),
        quantitative_metrics: metricsLines.join('\n'),
        pm_notes: notes
      });
      window.open(issueUrl, '_blank', 'noopener,noreferrer');
    }

    const effectiveStatus =
      postStatus === 'DOWN' ? 'DOWN' : postStatus === 'PM_DUE_SOON' ? 'DEGRADED' : 'OPERATIONAL';
    const patch = logConditionLocally(asset.id, effectiveStatus, notes, {
      pmStatus: postStatus === 'OPERATIONAL' ? 'COMPLIANT' : 'ATTENTION',
      lastPmDate: todayStr,
      nextPmDue: nextDue,
      lastPmTech: technician
    });

    const entry = sanitizeHistoryEntry({
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
    });

    if (entry) {
      prependHistoryEntry(entry);
    }
    renderDashboard();
    openAssetHubModal(asset.id, 'pm', false);

    await Promise.all([
      publishCrossDeviceSync(asset.id, patch, entry),
      dispatchTeamsAlert('Monthly PM Logged', asset, postStatus, technician, 'Shop Staff', notes)
    ]);

    if (openGithubIssue) {
      showToast(`Monthly PM synced for ${asset.id} & opened GitHub PM Issue`);
    } else {
      showToast(`Monthly PM synced for ${asset.id} across all devices (Next due: ${nextDue})`);
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

    // Fault report form submissions: Primary submit syncs in-app across all screens; secondary also opens GitHub Issue
    const faultForm = document.getElementById('fault-report-form');
    if (faultForm) {
      faultForm.addEventListener('submit', (e) => {
        e.preventDefault();
        handleFaultSubmission(false);
      });
    }
    const faultLocalBtn = document.getElementById('btn-fault-local-save');
    if (faultLocalBtn) {
      faultLocalBtn.addEventListener('click', () => {
        if (faultForm && typeof faultForm.reportValidity === 'function' && !faultForm.reportValidity()) {
          return;
        }
        handleFaultSubmission(true);
      });
    }

    // Monthly PM form submissions: Primary submit syncs in-app across all screens; secondary also opens GitHub Issue
    const pmForm = document.getElementById('monthly-pm-form');
    if (pmForm) {
      pmForm.addEventListener('submit', (e) => {
        e.preventDefault();
        handlePmSubmission(false);
      });
    }
    const pmLocalBtn = document.getElementById('btn-pm-local-save');
    if (pmLocalBtn) {
      pmLocalBtn.addEventListener('click', () => {
        if (pmForm && typeof pmForm.reportValidity === 'function' && !pmForm.reportValidity()) {
          return;
        }
        handlePmSubmission(true);
      });
    }

    // CSV & JSON export buttons
    const csvBtn = document.getElementById('btn-export-csv');
    const jsonBtn = document.getElementById('btn-export-json');
    if (csvBtn) csvBtn.addEventListener('click', exportHistoryCsv);
    if (jsonBtn) jsonBtn.addEventListener('click', exportMasterJson);

    // QR Sheet controls
    const printQrBtn = document.getElementById('btn-print-qr-sheet');
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
        localStorage.removeItem(STORAGE_KEYS.PENDING_OVERRIDES);
        localStorage.removeItem(STORAGE_KEYS.ASSET_OVERRIDES);
        localStorage.removeItem(STORAGE_KEYS.HISTORY_LOG);
        state.cloudOverrides = {};
        state.cloudHistory = [];
        const clearIso = new Date().toISOString();
        try {
          const tasks = [
            fetchWithTimeout(
              `https://ntfy.sh/${CLOUD_SYNC_CONFIG.NTFY_TOPIC}`,
              {
                method: 'POST',
                keepalive: true,
                body: JSON.stringify({ action: 'CLEAR_ALL', timestamp: clearIso })
              },
              3500
            )
          ];
          if (CLOUD_SYNC_CONFIG.REST_OBJECT_URL) {
            tasks.push(
              fetchWithTimeout(
                CLOUD_SYNC_CONFIG.REST_OBJECT_URL,
                {
                  method: 'PUT',
                  keepalive: true,
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    name: 'spl_930_kinnear_prod_sync_v7',
                    data: { updatedAt: clearIso, overrides: {}, history: [] }
                  })
                },
                3500
              )
            );
          }
          await Promise.allSettled(tasks);
        } catch (e) {
          // Ignore network error
        }
        await loadEquipmentData();
        if (settingsModal) settingsModal.classList.add('hidden');
        showToast(`Reset all ${state.assets.length} assets to baseline equipment_master.json state`);
      });
    }
  }

  /**
   * Subscribe to cross-device updates on window focus, tab visibility change, and rate-limit-safe background poll
   */
  function startRealtimeCrossDeviceListener() {
    window.addEventListener('focus', () => {
      loadEquipmentData();
    });
    window.addEventListener('pageshow', () => {
      loadEquipmentData();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        loadEquipmentData();
      }
    });
    setInterval(async () => {
      if (document.visibilityState === 'visible') {
        try {
          const cloudState = await fetchCrossDeviceCloudState({ ntfyOnly: true });
          if (cloudState && cloudState.cloudOverrides) {
            state.assets = getMergedEquipmentData(state.assets, cloudState.cloudOverrides);
            if (Array.isArray(cloudState.cloudHistory) && cloudState.cloudHistory.length > 0) {
              const existingIds = new Set(state.history.map((h) => h.id));
              cloudState.cloudHistory.forEach((ch) => {
                if (ch && ch.id && !existingIds.has(ch.id)) {
                  existingIds.add(ch.id);
                  state.history.unshift(ch);
                }
              });
              state.history.sort((a, b) => (Date.parse(b.timestamp) || 0) - (Date.parse(a.timestamp) || 0));
            }
            renderDashboard();
          }
        } catch (e) {
          // Non-fatal background poll
        }
      }
    }, 15000);
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
      await loadEquipmentData();
      bindEvents();
      handleInitialDeepLink();
      startRealtimeCrossDeviceListener();
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
