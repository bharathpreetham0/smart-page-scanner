(function attachPanel(global) {
  'use strict';

  const PANEL_HOST_ID = 'smart-page-scanner-host';
  const state = {
    handlers: {},
    lastView: null,
    stylesPromise: null
  };

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function getHost() {
    return document.getElementById(PANEL_HOST_ID);
  }

  function ensureHost() {
    let host = getHost();
    if (host) {
      return host;
    }

    host = document.createElement('div');
    host.id = PANEL_HOST_ID;
    host.style.all = 'initial';
    document.documentElement.appendChild(host);
    host.attachShadow({ mode: 'open' });

    return host;
  }

  async function loadStyles() {
    if (!state.stylesPromise) {
      state.stylesPromise = fetch(chrome.runtime.getURL('styles/panel.css'))
        .then((response) => response.text())
        .catch(() => '.sps-panel{position:fixed;inset:0 0 0 auto;width:420px;background:#fff;}');
    }

    return state.stylesPromise;
  }

  async function renderFrame(innerHtml) {
    const host = ensureHost();
    const styles = await loadStyles();
    const shadow = host.shadowRoot;

    shadow.innerHTML = `
      <style>${styles}</style>
      ${innerHtml}
    `;

    const panel = shadow.querySelector('.sps-panel');
    if (panel) {
      requestAnimationFrame(() => panel.classList.add('is-open'));
    }

    wireEvents(shadow);
  }

  function buildHeader(subtitle) {
    return `
      <header class="sps-header">
        <p class="sps-kicker">Smart Page Scanner</p>
        <div class="sps-title-row">
          <h2 class="sps-title">Page Summary</h2>
          <button class="sps-close" id="sps-close" aria-label="Close panel">x</button>
        </div>
        <p class="sps-subtitle">${escapeHtml(subtitle || 'Structured page intelligence for the current tab.')}</p>
      </header>
    `;
  }

  function buildSummarySection(summary, scanData) {
    const tableCount = Number(scanData.tableCount != null ? scanData.tableCount : (scanData.tables || []).length || 0);
    const headingCount = Number(scanData.headingCount != null ? scanData.headingCount : (scanData.headings || []).length || 0);
    const metrics = [
      `${Number(scanData.wordCount || 0).toLocaleString()} words`,
      `${tableCount} tables`,
      `${headingCount} headings`
    ];

    return `
      <section class="sps-card">
        <h3 class="sps-card-title">Summary</h3>
        <p class="sps-summary">${escapeHtml(summary.summary || 'No summary was returned by the API.')}</p>
        <div class="sps-metrics">
          ${metrics.map((metric) => `<span class="sps-metric">${escapeHtml(metric)}</span>`).join('')}
          ${summary.model ? `<span class="sps-metric">${escapeHtml(summary.model)}</span>` : ''}
          ${summary.confidence != null ? `<span class="sps-metric">${Math.round(Number(summary.confidence) * 100)}% confidence</span>` : ''}
        </div>
      </section>
    `;
  }

  function buildKeyPointsSection(summary) {
    if (!Array.isArray(summary.keyPoints) || !summary.keyPoints.length) {
      return '';
    }

    return `
      <section class="sps-card">
        <h3 class="sps-card-title">Key Points</h3>
        <ul class="sps-list">
          ${summary.keyPoints.map((point) => `
            <li class="sps-list-item">
              <span class="sps-bullet">•</span>
              <span>${escapeHtml(point)}</span>
            </li>
          `).join('')}
        </ul>
      </section>
    `;
  }

  function buildEntitiesSection(summary) {
    if (!Array.isArray(summary.entities) || !summary.entities.length) {
      return '';
    }

    return `
      <section class="sps-card">
        <h3 class="sps-card-title">Entities</h3>
        <div class="sps-tags">
          ${summary.entities.map((entity) => `<span class="sps-tag">${escapeHtml(entity)}</span>`).join('')}
        </div>
      </section>
    `;
  }

  function buildTableSection(scanData) {
    if (!Array.isArray(scanData.tables) || !scanData.tables.length) {
      return '';
    }

    const preview = scanData.tables[0];
    const headers = (preview.headers || []).slice(0, 4);
    const rows = (preview.rows || []).slice(0, 3);

    return `
      <section class="sps-card">
        <h3 class="sps-card-title">Table Preview</h3>
        <div class="sps-table-wrap">
          <table class="sps-table">
            ${headers.length ? `
              <thead>
                <tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join('')}</tr>
              </thead>
            ` : ''}
            <tbody>
              ${rows.map((row) => `
                <tr>${row.slice(0, 4).map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </section>
    `;
  }

  function buildFooter(options) {
    return `
      <footer class="sps-footer">
        <button class="sps-button sps-button-primary" id="sps-copy">Copy Summary</button>
        ${options.enableExport === false ? '' : '<button class="sps-button sps-button-secondary" id="sps-export">Export JSON</button>'}
        <button class="sps-button sps-button-secondary" id="sps-rescan">Re-scan</button>
      </footer>
    `;
  }

  function wireEvents(shadow) {
    const closeButton = shadow.getElementById('sps-close');
    const copyButton = shadow.getElementById('sps-copy');
    const exportButton = shadow.getElementById('sps-export');
    const rescanButton = shadow.getElementById('sps-rescan');

    if (closeButton) {
      closeButton.addEventListener('click', () => {
        if (typeof state.handlers.onClose === 'function') {
          state.handlers.onClose();
        }
        close();
      });
    }

    if (copyButton) {
      copyButton.addEventListener('click', async () => {
        if (typeof state.handlers.onCopy === 'function') {
          await state.handlers.onCopy();
          return;
        }

        if (state.lastView && state.lastView.type === 'result') {
          const text = [
            state.lastView.summary.summary || '',
            '',
            ...(state.lastView.summary.keyPoints || [])
          ].join('\n');

          await navigator.clipboard.writeText(text);
          showToast('Copied');
        }
      });
    }

    if (exportButton) {
      exportButton.addEventListener('click', async () => {
        if (typeof state.handlers.onExport === 'function') {
          await state.handlers.onExport();
        }
      });
    }

    if (rescanButton) {
      rescanButton.addEventListener('click', async () => {
        if (typeof state.handlers.onRescan === 'function') {
          await state.handlers.onRescan();
        }
      });
    }
  }

  async function showLoading(options) {
    state.lastView = {
      type: 'loading',
      options: options || {}
    };

    await renderFrame(`
      <div class="sps-shell">
        <section class="sps-panel">
          ${buildHeader(options && options.subtitle)}
          <main class="sps-body">
            <section class="sps-card sps-loading">
              <div class="sps-loading-ring" aria-hidden="true"></div>
              <div>
                <h3 class="sps-card-title">Scanning</h3>
                <p class="sps-empty">Extracting page content, cleaning it, and waiting for your backend summary.</p>
              </div>
            </section>
          </main>
        </section>
      </div>
    `);
  }

  async function showError(message, options) {
    state.lastView = {
      type: 'error',
      message,
      options: options || {}
    };

    await renderFrame(`
      <div class="sps-shell">
        <section class="sps-panel">
          ${buildHeader(options && options.subtitle)}
          <main class="sps-body">
            <section class="sps-error">${escapeHtml(message)}</section>
          </main>
        </section>
      </div>
    `);
  }

  async function showResult(summary, scanData, options) {
    const finalOptions = options || {};
    state.lastView = {
      type: 'result',
      summary,
      scanData,
      options: finalOptions
    };

    await renderFrame(`
      <div class="sps-shell">
        <section class="sps-panel">
          ${buildHeader(finalOptions.subtitle)}
          <main class="sps-body">
            ${buildSummarySection(summary, scanData)}
            ${buildKeyPointsSection(summary)}
            ${buildEntitiesSection(summary)}
            ${buildTableSection(scanData)}
          </main>
          ${buildFooter(finalOptions)}
        </section>
      </div>
    `);
  }

  function showToast(message) {
    const host = getHost();
    if (!host || !host.shadowRoot) {
      return;
    }

    const existing = host.shadowRoot.querySelector('.sps-toast');
    if (existing) {
      existing.remove();
    }

    const toast = document.createElement('div');
    toast.className = 'sps-toast';
    toast.textContent = message;
    host.shadowRoot.appendChild(toast);

    window.setTimeout(() => toast.remove(), 1800);
  }

  function close() {
    const host = getHost();
    const panel = host && host.shadowRoot ? host.shadowRoot.querySelector('.sps-panel') : null;

    if (panel) {
      panel.classList.remove('is-open');
    }

    window.setTimeout(() => {
      const nextHost = getHost();
      if (nextHost) {
        nextHost.remove();
      }
    }, 200);
  }

  function isOpen() {
    return Boolean(getHost());
  }

  function setHandlers(handlers) {
    state.handlers = handlers || {};
  }

  global.SmartScannerPanel = {
    setHandlers,
    showLoading,
    showError,
    showResult,
    showToast,
    close,
    isOpen
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);

