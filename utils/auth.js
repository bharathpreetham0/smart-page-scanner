(function attachAuth(global) {
  'use strict';

  const TOKEN_KEYS = ['authToken', 'refreshToken', 'tokenExpiry', 'tokenType'];

  function buildAuthConfig(config) {
    const baseUrl = (config.authBaseUrl || '').replace(/\/+$/, '');

    return {
      authorizeUrl: `${baseUrl}/oauth2/authorize`,
      tokenUrl: `${baseUrl}/oauth2/token`,
      scopes: Array.isArray(config.oauthScopes) && config.oauthScopes.length
        ? config.oauthScopes
        : ['openid', 'profile', 'scanner:read', 'scanner:write'],
      clientId: config.oauthClientId || 'smart-page-scanner'
    };
  }

  async function getStoredTokens() {
    return global.SmartScannerStorage.getSyncValue(TOKEN_KEYS);
  }

  async function setStoredTokens(tokenResponse) {
    const accessToken = tokenResponse.access_token || tokenResponse.authToken;
    const refreshToken = tokenResponse.refresh_token || tokenResponse.refreshToken || '';
    const expiresIn = Number(tokenResponse.expires_in || tokenResponse.expiresIn || 3600);
    const tokenType = tokenResponse.token_type || tokenResponse.tokenType || 'Bearer';

    await global.SmartScannerStorage.setSyncValue({
      authToken: accessToken,
      refreshToken,
      tokenType,
      tokenExpiry: Date.now() + expiresIn * 1000
    });

    return {
      authToken: accessToken,
      refreshToken,
      tokenType,
      tokenExpiry: Date.now() + expiresIn * 1000
    };
  }

  async function clearStoredTokens() {
    await global.SmartScannerStorage.removeSyncValue(TOKEN_KEYS);
  }

  async function getAuthStatus() {
    const tokens = await getStoredTokens();

    return {
      isLoggedIn: Boolean(tokens.authToken),
      isExpired: !tokens.tokenExpiry || Date.now() > Number(tokens.tokenExpiry),
      expiresAt: Number(tokens.tokenExpiry || 0)
    };
  }

  async function getValidToken() {
    const tokens = await getStoredTokens();

    if (!tokens.authToken) {
      return null;
    }

    if (tokens.tokenExpiry && Date.now() > Number(tokens.tokenExpiry) - 60000) {
      return null;
    }

    return tokens.authToken;
  }

  async function requestToken(config, body) {
    const authConfig = buildAuthConfig(config);
    const response = await fetch(authConfig.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams(body)
    });

    if (!response.ok) {
      const message = await response.text().catch(() => '');
      throw new Error(message || `OAuth token request failed with ${response.status}`);
    }

    return response.json();
  }

  async function launchOAuthFlow(config) {
    if (!global.chrome || !chrome.identity || !chrome.identity.launchWebAuthFlow) {
      throw new Error('Chrome identity API is unavailable in this context.');
    }

    const authConfig = buildAuthConfig(config);
    const redirectUri = chrome.identity.getRedirectURL('oauth2');
    const state = Math.random().toString(36).slice(2);
    const authorizeUrl = new URL(authConfig.authorizeUrl);

    authorizeUrl.searchParams.set('client_id', authConfig.clientId);
    authorizeUrl.searchParams.set('redirect_uri', redirectUri);
    authorizeUrl.searchParams.set('response_type', 'code');
    authorizeUrl.searchParams.set('scope', authConfig.scopes.join(' '));
    authorizeUrl.searchParams.set('state', state);

    const responseUrl = await chrome.identity.launchWebAuthFlow({
      url: authorizeUrl.toString(),
      interactive: true
    });

    const url = new URL(responseUrl);
    const code = url.searchParams.get('code');
    const returnedState = url.searchParams.get('state');

    if (!code) {
      throw new Error('Authorization flow completed without an authorization code.');
    }

    if (returnedState && returnedState !== state) {
      throw new Error('Authorization state mismatch.');
    }

    const tokenResponse = await requestToken(config, {
      grant_type: 'authorization_code',
      code,
      client_id: authConfig.clientId,
      redirect_uri: redirectUri
    });

    await setStoredTokens(tokenResponse);
    return { success: true };
  }

  async function refreshToken(config) {
    const tokens = await getStoredTokens();
    const authConfig = buildAuthConfig(config);

    if (!tokens.refreshToken) {
      throw new Error('No refresh token available.');
    }

    const tokenResponse = await requestToken(config, {
      grant_type: 'refresh_token',
      refresh_token: tokens.refreshToken,
      client_id: authConfig.clientId
    });

    await setStoredTokens({
      ...tokenResponse,
      refresh_token: tokenResponse.refresh_token || tokens.refreshToken
    });

    return { success: true };
  }

  global.SmartScannerAuth = {
    TOKEN_KEYS,
    buildAuthConfig,
    getStoredTokens,
    setStoredTokens,
    clearStoredTokens,
    getAuthStatus,
    getValidToken,
    launchOAuthFlow,
    refreshToken
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);

