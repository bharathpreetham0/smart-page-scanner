(function attachStorage(global) {
  'use strict';

  const DEFAULT_EXTENSION_CONFIG = {
    mockMode: false,
    mockLatencyMs: 900,
    apiEndpoint: 'https://api.yourcompany.com',
    authBaseUrl: 'https://login.yourcompany.com',
    oauthClientId: 'smart-page-scanner',
    oauthScopes: ['openid', 'profile', 'scanner:read', 'scanner:write'],
    customerId: 'default',
    allowedDomains: [],
    summaryLength: 'medium',
    summaryStyle: 'bullet',
    outputLanguage: 'en',
    autoScanDomains: [],
    siteConfigOverrides: {},
    features: {
      enableExport: true,
      enableHistory: false,
      enableTableExtraction: true,
      enableFormExtraction: false,
      enableTelemetry: true
    }
  };

  function isPlainObject(value) {
    return Object.prototype.toString.call(value) === '[object Object]';
  }

  function deepMerge() {
    const result = {};

    Array.from(arguments)
      .filter(Boolean)
      .forEach((source) => {
        Object.keys(source).forEach((key) => {
          const nextValue = source[key];
          const previousValue = result[key];

          if (Array.isArray(nextValue)) {
            result[key] = nextValue.slice();
            return;
          }

          if (isPlainObject(nextValue) && isPlainObject(previousValue)) {
            result[key] = deepMerge(previousValue, nextValue);
            return;
          }

          if (isPlainObject(nextValue)) {
            result[key] = deepMerge({}, nextValue);
            return;
          }

          result[key] = nextValue;
        });
      });

    return result;
  }

  function storageGet(areaName, keys) {
    return new Promise((resolve) => {
      if (!global.chrome || !chrome.storage || !chrome.storage[areaName]) {
        resolve({});
        return;
      }

      chrome.storage[areaName].get(keys, (value) => {
        if (chrome.runtime && chrome.runtime.lastError) {
          resolve({});
          return;
        }

        resolve(value || {});
      });
    });
  }

  function storageSet(areaName, value) {
    return new Promise((resolve, reject) => {
      if (!global.chrome || !chrome.storage || !chrome.storage[areaName]) {
        resolve();
        return;
      }

      chrome.storage[areaName].set(value, () => {
        if (chrome.runtime && chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        resolve();
      });
    });
  }

  function storageRemove(areaName, keys) {
    return new Promise((resolve, reject) => {
      if (!global.chrome || !chrome.storage || !chrome.storage[areaName]) {
        resolve();
        return;
      }

      chrome.storage[areaName].remove(keys, () => {
        if (chrome.runtime && chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        resolve();
      });
    });
  }

  async function getManagedConfig() {
    return storageGet('managed', null);
  }

  async function getSyncConfig() {
    return storageGet('sync', null);
  }

  async function getExtensionConfig() {
    const [syncConfig, managedConfig] = await Promise.all([
      getSyncConfig(),
      getManagedConfig()
    ]);

    return deepMerge(DEFAULT_EXTENSION_CONFIG, syncConfig, managedConfig);
  }

  async function seedSyncDefaults() {
    const current = await getSyncConfig();
    const seeded = deepMerge(DEFAULT_EXTENSION_CONFIG, current);
    await storageSet('sync', seeded);
    return seeded;
  }

  global.SmartScannerStorage = {
    DEFAULT_EXTENSION_CONFIG,
    deepMerge,
    getManagedConfig,
    getSyncConfig,
    getExtensionConfig,
    getSessionValue(keys) {
      return storageGet('session', keys);
    },
    setSessionValue(value) {
      return storageSet('session', value);
    },
    getSyncValue(keys) {
      return storageGet('sync', keys);
    },
    setSyncValue(value) {
      return storageSet('sync', value);
    },
    removeSyncValue(keys) {
      return storageRemove('sync', keys);
    },
    seedSyncDefaults
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
