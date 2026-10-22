/**
 * Student Projects Laboratory (930 Kinnear Rd)
 * Day / Night Theme Switcher Architecture (js/theme.js)
 * Persists theme preference in localStorage under key 'shop_portal_theme'
 */

(function (window) {
  'use strict';

  const THEME_STORAGE_KEY = 'shop_portal_theme';

  /**
   * Update all #theme-toggle-btn controls in the document
   */
  function updateThemeToggleButtons(themeName) {
    const isDark = themeName === 'dark';
    const btn = document.getElementById('theme-toggle-btn');
    if (btn) {
      btn.setAttribute('aria-pressed', String(isDark));
      btn.setAttribute(
        'title',
        isDark
          ? 'Current: Night Mode — Click to switch to High-Contrast Day Mode'
          : 'Current: Day Mode — Click to switch to Low-Glare Night Mode'
      );
      btn.innerHTML = isDark
        ? '<span class="theme-icon" aria-hidden="true">☀️</span><span class="theme-label">Day Mode</span><span class="theme-status-pill">NIGHT ACTIVE</span>'
        : '<span class="theme-icon" aria-hidden="true">🌙</span><span class="theme-label">Night Mode</span><span class="theme-status-pill">DAY ACTIVE</span>';
    }
  }

  /**
   * Apply 'light' or 'dark' theme to root <html> element and persist in localStorage
   */
  function setTheme(themeName) {
    const normalized = themeName === 'light' ? 'light' : 'dark';
    const rootEl = document.documentElement;

    rootEl.setAttribute('data-theme', normalized);
    if (normalized === 'dark') {
      rootEl.classList.add('dark');
      rootEl.classList.remove('light');
    } else {
      rootEl.classList.remove('dark');
      rootEl.classList.add('light');
    }

    try {
      localStorage.setItem(THEME_STORAGE_KEY, normalized);
    } catch (err) {
      // Ignore storage errors in restricted contexts
    }

    updateThemeToggleButtons(normalized);
    return normalized;
  }

  /**
   * Read saved theme from localStorage (defaulting to 'dark') and apply before DOM paint
   */
  function initTheme() {
    let savedTheme = 'dark';
    try {
      const stored = localStorage.getItem(THEME_STORAGE_KEY);
      if (stored === 'light' || stored === 'dark') {
        savedTheme = stored;
      }
    } catch (err) {
      savedTheme = 'dark';
    }

    const rootEl = document.documentElement;
    rootEl.setAttribute('data-theme', savedTheme);
    if (savedTheme === 'dark') {
      rootEl.classList.add('dark');
      rootEl.classList.remove('light');
    } else {
      rootEl.classList.remove('dark');
      rootEl.classList.add('light');
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () {
        updateThemeToggleButtons(savedTheme);
        const btn = document.getElementById('theme-toggle-btn');
        if (btn && !btn.hasAttribute('data-theme-bound')) {
          btn.setAttribute('data-theme-bound', 'true');
          btn.addEventListener('click', toggleTheme);
        }
      });
    } else {
      updateThemeToggleButtons(savedTheme);
      const btn = document.getElementById('theme-toggle-btn');
      if (btn && !btn.hasAttribute('data-theme-bound')) {
        btn.setAttribute('data-theme-bound', 'true');
        btn.addEventListener('click', toggleTheme);
      }
    }

    return savedTheme;
  }

  /**
   * Flip between 'light' (Day Mode) and 'dark' (Night Mode)
   */
  function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme') || 'dark';
    const next = current === 'dark' ? 'light' : 'dark';
    return setTheme(next);
  }

  // Expose functions globally for inline FOUC prevention & external callers
  window.initTheme = initTheme;
  window.setTheme = setTheme;
  window.toggleTheme = toggleTheme;

  // Execute immediately to eliminate flash of unstyled content
  initTheme();
})(window);
