(function attachContentScript(global) {
  'use strict';

  const NAVIGATION_DEBOUNCE_MS = 700;
  const TOAST_ID = 'smart-page-scanner-toast-host';
  let currentScanResult = null;
  let scanInFlight = false;
  let lastUrl = window.location.href;
  let navigationTimer = null;

  function buildSubtitle(siteConfig) {
    const parts = [
      siteConfig.name || window.location.hostname,
      window.location.hostname
    ];

    return parts.filter(Boolean).join(' on ');
  }

  function describePanelSubtitle(siteConfig, extensionConfig) {
    const base = buildSubtitle(siteConfig);
    return extensionConfig.mockMode
      ? `${base}. Local demo mode keeps summarization inside the browser.`
      : base;
  }

  function showToast(message, tone) {
    const existing = document.getElementById(TOAST_ID);
    if (existing) {
      existing.remove();
    }

    const host = document.createElement('div');
    host.id = TOAST_ID;
    const shadow = host.attachShadow({ mode: 'closed' });
    const backgroundByTone = {
      info: '#10355e',
      warning: '#b4622a',
      error: '#a63a2b'
    };

    const style = document.createElement('style');
    style.textContent = `
      .toast {
        position: fixed;
        right: 20px;
        bottom: 24px;
        z-index: 2147483647;
        max-width: 320px;
        padding: 11px 14px;
        border-radius: 14px;
        background: ${backgroundByTone[tone] || backgroundByTone.info};
        color: #ffffff;
        font: 600 12px/1.45 "Segoe UI", Arial, sans-serif;
        box-shadow: 0 16px 28px rgba(9, 26, 49, 0.26);
      }
    `;

    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;

    shadow.appendChild(style);
    shadow.appendChild(toast);
    document.documentElement.appendChild(host);

    window.setTimeout(() => host.remove(), 2600);
  }

  async function getContext() {
    const extensionConfig = await global.SmartScannerStorage.getExtensionConfig();
    const siteConfig = global.SmartScannerSiteConfigs.resolveSiteConfig(window.location.hostname, extensionConfig);

    return { extensionConfig, siteConfig };
  }

  function isDomainAllowed(allowedDomains) {
    if (!Array.isArray(allowedDomains) || !allowedDomains.length) {
      return true;
    }

    return allowedDomains.some((domain) => {
      return global.SmartScannerSiteConfigs.isHostnameMatch(window.location.hostname, domain);
    });
  }

  async function cacheSummary(summary, scanData) {
    await global.SmartScannerStorage.setSessionValue({
      lastScan: {
        url: scanData.url,
        title: scanData.title,
        timestamp: scanData.timestamp,
        summary: {
          summary: summary.summary || '',
          keyPoints: summary.keyPoints || [],
          entities: summary.entities || [],
          confidence: summary.confidence,
          model: summary.model || ''
        },
        scanMeta: {
          wordCount: scanData.wordCount,
          tableCount: scanData.tables.length,
          headingCount: scanData.headings.length
        }
      }
    });
  }

  function buildCachedScanData(lastScan) {
    return {
      wordCount: lastScan.scanMeta ? lastScan.scanMeta.wordCount : 0,
      tableCount: lastScan.scanMeta ? lastScan.scanMeta.tableCount : 0,
      headingCount: lastScan.scanMeta ? lastScan.scanMeta.headingCount : 0,
      tables: [],
      headings: []
    };
  }

  async function updateBadge(hasResult) {
    await global.SmartScannerAPI.sendRuntimeMessage({
      type: 'SET_BADGE',
      text: hasResult ? 'OK' : '',
      color: '#1a5f8c'
    });
  }

  function downloadJsonFile(data, filename) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function exportCurrentResult() {
    if (!currentScanResult) {
      showToast('There is no in-memory scan payload to export yet.', 'warning');
      return;
    }

    const hostname = window.location.hostname.replace(/[^a-z0-9.-]/gi, '-');
    downloadJsonFile(currentScanResult, `smart-page-scan-${hostname}-${Date.now()}.json`);
    global.SmartScannerPanel.showToast('Exported');
  }

  async function copyCurrentSummary() {
    if (!currentScanResult) {
      return;
    }

    const lines = [
      currentScanResult.summary.summary || '',
      '',
      ...(currentScanResult.summary.keyPoints || [])
    ];

    await navigator.clipboard.writeText(lines.join('\n'));
    global.SmartScannerPanel.showToast('Copied');
  }

  async function renderCurrentResult() {
    const { extensionConfig, siteConfig } = await getContext();

    global.SmartScannerPanel.setHandlers({
      onCopy: copyCurrentSummary,
      onExport: extensionConfig.features && extensionConfig.features.enableExport === false ? null : exportCurrentResult,
      onRescan: () => triggerScan({ silent: false, forcePrompt: false }),
      onClose: () => {}
    });

    await global.SmartScannerPanel.showResult(currentScanResult.summary, currentScanResult.scanData, {
      subtitle: describePanelSubtitle(siteConfig, extensionConfig),
      enableExport: !(extensionConfig.features && extensionConfig.features.enableExport === false)
    });
  }

  async function renderCachedResult() {
    const { extensionConfig, siteConfig } = await getContext();
    const cached = await global.SmartScannerStorage.getSessionValue(['lastScan']);
    const lastScan = cached.lastScan;

    if (!lastScan || lastScan.url !== window.location.href) {
      return false;
    }

    global.SmartScannerPanel.setHandlers({
      onRescan: () => triggerScan({ silent: false, forcePrompt: false }),
      onClose: () => {}
    });

    await global.SmartScannerPanel.showResult(lastScan.summary, buildCachedScanData(lastScan), {
      subtitle: `${describePanelSubtitle(siteConfig, extensionConfig)} Cached summary; export requires a fresh scan.`,
      enableExport: false
    });

    return true;
  }

  async function maybeWarnSensitivePage() {
    const { extensionConfig } = await getContext();
    if (extensionConfig.mockMode) {
      return true;
    }

    if (!global.SmartScannerAPI.isSensitivePage(window.location.href)) {
      return true;
    }

    return window.confirm(
      'This page may contain sensitive information.\n\nSmart Page Scanner redacts common sensitive patterns before sending the scan payload, but you should still confirm that you want to continue.'
    );
  }

  async function triggerScan(options) {
    const settings = options || {};

    if (scanInFlight) {
      if (!settings.silent) {
        showToast('A scan is already running for this page.', 'info');
      }
      return;
    }

    const startedAt = performance.now();
    const { extensionConfig, siteConfig } = await getContext();

    if (!isDomainAllowed(extensionConfig.allowedDomains)) {
      if (!settings.silent) {
        showToast('This domain is not in your current allow-list.', 'warning');
      }
      return;
    }

    if (!settings.silent) {
      const proceed = await maybeWarnSensitivePage();
      if (!proceed) {
        return;
      }
    }

    scanInFlight = true;

    if (!settings.silent) {
      global.SmartScannerPanel.showLoading({
        subtitle: describePanelSubtitle(siteConfig, extensionConfig)
      });
    }

    try {
      await global.SmartScanner.waitForContentStability(siteConfig.scanTargets[0] || 'main', 3000);

      const scanData = global.SmartScanner.scan(siteConfig);
      let summary;

      try {
        summary = await global.SmartScannerAPI.sendScanRequest(scanData, extensionConfig);
      } catch (error) {
        const authError = /Authentication required|Session expired/i.test(error.message || '');
        if (!settings.silent && authError && !settings.retriedAfterLogin) {
          await global.SmartScannerAPI.sendRuntimeMessage({ type: 'LAUNCH_LOGIN' });
          scanInFlight = false;
          await triggerScan({ silent: false, retriedAfterLogin: true });
          return;
        }

        throw error;
      }

      currentScanResult = { scanData, summary };
      await cacheSummary(summary, scanData);
      await updateBadge(true);

      await global.SmartScannerTelemetry.trackEvent('scan_completed', {
        domain: window.location.hostname,
        mode: settings.silent ? 'auto' : 'manual',
        wordCount: scanData.wordCount,
        tableCount: scanData.tables.length,
        headingCount: scanData.headings.length,
        processingMs: Math.round(performance.now() - startedAt)
      });

      if (!settings.silent) {
        await renderCurrentResult();
      }
    } catch (error) {
      await global.SmartScannerTelemetry.trackEvent('scan_failed', {
        domain: window.location.hostname,
        mode: settings.silent ? 'auto' : 'manual',
        errorMessage: error.message
      });

      if (!settings.silent) {
        await global.SmartScannerPanel.showError(error.message || 'Scan failed. Please try again.', {
          subtitle: describePanelSubtitle(siteConfig, extensionConfig)
        });
      } else {
        if (!/Authentication required|Session expired/i.test(error.message || '')) {
          showToast('Auto-scan failed on this page.', 'error');
        }
      }
    } finally {
      scanInFlight = false;
    }
  }

  async function togglePanel() {
    if (global.SmartScannerPanel.isOpen()) {
      global.SmartScannerPanel.close();
      return;
    }

    if (currentScanResult) {
      await renderCurrentResult();
      return;
    }

    const restored = await renderCachedResult();
    if (restored) {
      return;
    }

    await triggerScan({ silent: false, forcePrompt: false });
  }

  async function onRouteChange() {
    window.clearTimeout(navigationTimer);
    navigationTimer = window.setTimeout(async () => {
      const currentUrl = window.location.href;
      if (currentUrl === lastUrl) {
        return;
      }

      lastUrl = currentUrl;
      currentScanResult = null;
      global.SmartScannerPanel.close();
      await updateBadge(false);

      const { extensionConfig, siteConfig } = await getContext();
      if (siteConfig.autoScan && isDomainAllowed(extensionConfig.allowedDomains)) {
        await triggerScan({ silent: true });
      }
    }, NAVIGATION_DEBOUNCE_MS);
  }

  function installNavigationObservers() {
    const observer = new MutationObserver(() => onRouteChange());
    observer.observe(document.body, { childList: true, subtree: true });

    window.addEventListener('popstate', onRouteChange);

    const originalPushState = history.pushState.bind(history);
    history.pushState = function pushStatePatched() {
      originalPushState.apply(history, arguments);
      onRouteChange();
    };

    const originalReplaceState = history.replaceState.bind(history);
    history.replaceState = function replaceStatePatched() {
      originalReplaceState.apply(history, arguments);
      onRouteChange();
    };
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'TRIGGER_SCAN') {
      triggerScan({ silent: false })
        .then(() => sendResponse({ ok: true }))
        .catch((error) => sendResponse({ ok: false, error: error.message }));
      return true;
    }

    if (message.type === 'TOGGLE_PANEL') {
      togglePanel()
        .then(() => sendResponse({ ok: true }))
        .catch((error) => sendResponse({ ok: false, error: error.message }));
      return true;
    }

    if (message.type === 'GET_SCAN_STATUS') {
      sendResponse({
        hasCurrentResult: Boolean(currentScanResult),
        isScanning: scanInFlight
      });
    }

    return false;
  });

  async function init() {
    const { extensionConfig, siteConfig } = await getContext();
    installNavigationObservers();

    if (!isDomainAllowed(extensionConfig.allowedDomains)) {
      return;
    }

    if (siteConfig.autoScan) {
      await triggerScan({ silent: true });
    }
  }

  init().catch((error) => {
    console.error('[SmartScanner] Initialization failed', error);
  });
})(typeof globalThis !== 'undefined' ? globalThis : self);
