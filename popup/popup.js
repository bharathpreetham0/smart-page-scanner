(function attachPopup() {
  'use strict';

  const elements = {
    authDot: document.getElementById('auth-dot'),
    authText: document.getElementById('auth-text'),
    modeText: document.getElementById('mode-text'),
    customerText: document.getElementById('customer-text'),
    domainText: document.getElementById('domain-text'),
    domainAllowedText: document.getElementById('domain-allowed-text'),
    endpointText: document.getElementById('endpoint-text'),
    scanButton: document.getElementById('scan-btn'),
    toggleButton: document.getElementById('toggle-btn'),
    mockToggleButton: document.getElementById('mock-toggle-btn'),
    loginButton: document.getElementById('login-btn'),
    logoutButton: document.getElementById('logout-btn'),
    errorBox: document.getElementById('error-box')
  };

  function showError(message) {
    elements.errorBox.textContent = message;
    elements.errorBox.style.display = 'block';
  }

  function clearError() {
    elements.errorBox.textContent = '';
    elements.errorBox.style.display = 'none';
  }

  function sendRuntimeMessage(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        if (response && response.ok === false && response.error) {
          reject(new Error(response.error));
          return;
        }

        resolve(response || {});
      });
    });
  }

  async function getActiveTab() {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    return tabs[0] || null;
  }

  function isSecureEndpoint(endpoint) {
    try {
      const parsed = new URL(endpoint);
      return parsed.protocol === 'https:' || parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
    } catch (error) {
      return false;
    }
  }

  function normalizeDomain(domain) {
    return String(domain || '').trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^\*\./, '');
  }

  function domainAllowed(hostname, allowedDomains) {
    if (!allowedDomains || !allowedDomains.length) {
      return true;
    }

    const normalizedHostname = normalizeDomain(hostname);
    return allowedDomains.some((domain) => {
      const normalizedDomain = normalizeDomain(domain);
      return normalizedHostname === normalizedDomain || normalizedHostname.endsWith(`.${normalizedDomain}`);
    });
  }

  async function refreshUi() {
    clearError();

    const [config, authStatus, activeTab] = await Promise.all([
      SmartScannerStorage.getExtensionConfig(),
      sendRuntimeMessage({ type: 'GET_AUTH_STATUS' }),
      getActiveTab()
    ]);

    const hasSupportedUrl = Boolean(activeTab && activeTab.url && /^https?:/i.test(activeTab.url));
    const hostname = hasSupportedUrl ? new URL(activeTab.url).hostname : 'Unavailable';
    const endpointConfigured = config.apiEndpoint && config.apiEndpoint !== 'https://api.yourcompany.com' && isSecureEndpoint(config.apiEndpoint);
    const isAllowedDomain = hasSupportedUrl ? domainAllowed(hostname, config.allowedDomains) : false;
    const authSatisfied = config.mockMode || (authStatus.isLoggedIn && !authStatus.isExpired);
    const endpointSatisfied = config.mockMode || endpointConfigured;
    const canScan = hasSupportedUrl && authSatisfied && endpointSatisfied && isAllowedDomain;

    elements.customerText.textContent = config.customerId || 'default';
    elements.domainText.textContent = hostname;
    elements.domainAllowedText.textContent = isAllowedDomain ? 'Allowed' : 'Blocked';
    elements.endpointText.textContent = config.mockMode
      ? 'Local mock generator'
      : endpointConfigured ? 'Configured' : 'Needs setup';
    elements.authText.textContent = config.mockMode
      ? 'Not required in demo'
      : authStatus.isLoggedIn && !authStatus.isExpired ? 'Authenticated' : 'Sign-in required';
    elements.authDot.className = `dot ${authSatisfied ? 'success' : 'error'}`;
    elements.modeText.textContent = config.mockMode ? 'Local Demo' : 'Backend API';
    elements.modeText.className = `mode-badge ${config.mockMode ? 'demo' : ''}`.trim();

    elements.scanButton.disabled = !canScan;
    elements.toggleButton.disabled = !hasSupportedUrl || !isAllowedDomain;
    elements.mockToggleButton.textContent = config.mockMode ? 'Disable Local Demo Mode' : 'Enable Local Demo Mode';
    elements.loginButton.hidden = config.mockMode || (authStatus.isLoggedIn && !authStatus.isExpired);
    elements.logoutButton.hidden = config.mockMode || !(authStatus.isLoggedIn && !authStatus.isExpired);

    if (config.mockMode) {
      if (!hasSupportedUrl) {
        showError('Open a regular http or https page to use demo mode.');
      } else if (!isAllowedDomain) {
        showError('The current tab is outside the configured allow-list.');
      }
      return;
    }

    if (!endpointConfigured) {
      showError('Configure apiEndpoint and customerId in managed storage or chrome.storage.sync before scanning.');
    } else if (!hasSupportedUrl) {
      showError('Open a regular http or https page to use the extension.');
    } else if (!isAllowedDomain) {
      showError('The current tab is outside the configured allow-list.');
    } else if (!authStatus.isLoggedIn || authStatus.isExpired) {
      showError('Authenticate first to enable scanning.');
    }
  }

  elements.scanButton.addEventListener('click', async () => {
    try {
      await sendRuntimeMessage({ type: 'TRIGGER_ACTIVE_SCAN' });
      window.close();
    } catch (error) {
      showError(error.message);
    }
  });

  elements.toggleButton.addEventListener('click', async () => {
    try {
      await sendRuntimeMessage({ type: 'TOGGLE_ACTIVE_PANEL' });
      window.close();
    } catch (error) {
      showError(error.message);
    }
  });

  elements.mockToggleButton.addEventListener('click', async () => {
    try {
      const config = await SmartScannerStorage.getExtensionConfig();
      await SmartScannerStorage.setSyncValue({
        mockMode: !config.mockMode
      });
      await refreshUi();
    } catch (error) {
      showError(error.message);
    }
  });

  elements.loginButton.addEventListener('click', async () => {
    try {
      await sendRuntimeMessage({ type: 'LAUNCH_LOGIN' });
      await refreshUi();
    } catch (error) {
      showError(error.message);
    }
  });

  elements.logoutButton.addEventListener('click', async () => {
    try {
      await sendRuntimeMessage({ type: 'LOGOUT' });
      await refreshUi();
    } catch (error) {
      showError(error.message);
    }
  });

  refreshUi().catch((error) => {
    showError(error.message);
  });
})();
