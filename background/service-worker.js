'use strict';

importScripts('../utils/storage.js', '../utils/auth.js');

const REFRESH_ALARM_NAME = 'smart-page-scanner-refresh-token';

async function queryActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0] || null;
}

async function relayToActiveTab(message) {
  const tab = await queryActiveTab();
  if (!tab || typeof tab.id !== 'number') {
    throw new Error('No active tab is available.');
  }

  return chrome.tabs.sendMessage(tab.id, message);
}

async function scheduleTokenRefresh() {
  const status = await SmartScannerAuth.getAuthStatus();
  if (!status.expiresAt) {
    return;
  }

  const refreshAt = Math.max(Date.now() + 60000, status.expiresAt - 5 * 60 * 1000);
  await chrome.alarms.create(REFRESH_ALARM_NAME, { when: refreshAt });
}

async function clearBadgeForTab(tabId) {
  if (typeof tabId !== 'number') {
    return;
  }

  await chrome.action.setBadgeText({ tabId, text: '' });
}

chrome.runtime.onInstalled.addListener(async () => {
  await SmartScannerStorage.seedSyncDefaults();
});

chrome.commands.onCommand.addListener(async (command) => {
  try {
    if (command === 'trigger-scan') {
      await relayToActiveTab({ type: 'TRIGGER_SCAN' });
      return;
    }

    if (command === 'toggle-panel') {
      await relayToActiveTab({ type: 'TOGGLE_PANEL' });
    }
  } catch (error) {
    console.error('[SmartScanner] Command relay failed', error);
  }
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (changeInfo.status === 'loading') {
    await clearBadgeForTab(tabId);
  }
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== REFRESH_ALARM_NAME) {
    return;
  }

  try {
    const config = await SmartScannerStorage.getExtensionConfig();
    await SmartScannerAuth.refreshToken(config);
    await scheduleTokenRefresh();
  } catch (error) {
    console.warn('[SmartScanner] Token refresh alarm failed', error);
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    switch (message.type) {
      case 'TRIGGER_ACTIVE_SCAN':
        await relayToActiveTab({ type: 'TRIGGER_SCAN' });
        sendResponse({ ok: true });
        return;

      case 'TOGGLE_ACTIVE_PANEL':
        await relayToActiveTab({ type: 'TOGGLE_PANEL' });
        sendResponse({ ok: true });
        return;

      case 'LAUNCH_LOGIN': {
        const config = await SmartScannerStorage.getExtensionConfig();
        const result = await SmartScannerAuth.launchOAuthFlow(config);
        await scheduleTokenRefresh();
        sendResponse(result);
        return;
      }

      case 'REFRESH_TOKEN': {
        const config = await SmartScannerStorage.getExtensionConfig();
        const result = await SmartScannerAuth.refreshToken(config);
        await scheduleTokenRefresh();
        sendResponse(result);
        return;
      }

      case 'GET_AUTH_STATUS': {
        const status = await SmartScannerAuth.getAuthStatus();
        sendResponse(status);
        return;
      }

      case 'LOGOUT':
        await chrome.alarms.clear(REFRESH_ALARM_NAME);
        await SmartScannerAuth.clearStoredTokens();
        sendResponse({ ok: true });
        return;

      case 'SET_BADGE': {
        const tabId = sender && sender.tab ? sender.tab.id : message.tabId;
        if (typeof tabId === 'number') {
          await chrome.action.setBadgeText({ tabId, text: message.text || '' });
          await chrome.action.setBadgeBackgroundColor({ tabId, color: message.color || '#1a5f8c' });
        }
        sendResponse({ ok: true });
        return;
      }

      default:
        sendResponse({ ok: false, error: `Unknown message type: ${message.type}` });
    }
  })().catch((error) => {
    sendResponse({ ok: false, error: error.message });
  });

  return true;
});

