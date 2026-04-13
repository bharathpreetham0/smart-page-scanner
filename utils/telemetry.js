(function attachTelemetry(global) {
  'use strict';

  const BLOCKED_KEYS = ['text', 'summary', 'html', 'content', 'body', 'scanData'];

  function sanitizeProperties(properties) {
    return Object.keys(properties || {}).reduce((accumulator, key) => {
      if (BLOCKED_KEYS.includes(key)) {
        return accumulator;
      }

      accumulator[key] = properties[key];
      return accumulator;
    }, {});
  }

  async function trackEvent(eventName, properties) {
    try {
      const config = await global.SmartScannerStorage.getExtensionConfig();
      if (!config.features || config.features.enableTelemetry === false) {
        return;
      }

      if (!config.apiEndpoint || config.apiEndpoint === 'https://api.yourcompany.com') {
        return;
      }

      if (!global.SmartScannerAPI.isSecureEndpoint(config.apiEndpoint)) {
        return;
      }

      const payload = {
        event: eventName,
        timestamp: new Date().toISOString(),
        customerId: config.customerId,
        extensionVersion: chrome.runtime.getManifest().version,
        properties: sanitizeProperties(properties || {})
      };

      await fetch(global.SmartScannerAPI.joinUrl(config.apiEndpoint, '/telemetry/extension'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload),
        keepalive: true
      });
    } catch (error) {
      // Telemetry must never break the product flow.
    }
  }

  global.SmartScannerTelemetry = {
    trackEvent
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
