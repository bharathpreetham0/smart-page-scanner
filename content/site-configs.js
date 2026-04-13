(function attachSiteConfigs(global) {
  'use strict';

  const DEFAULT_SITE_CONFIG = {
    name: 'Generic Page',
    scanTargets: [
      'main',
      'article',
      '[role="main"]',
      '.content',
      '.main-content',
      '#content',
      '#main'
    ],
    excludeSelectors: [
      'nav',
      'header',
      'footer',
      'aside',
      '.sidebar',
      '.advertisement',
      '.cookie-banner',
      '[role="navigation"]',
      '[role="banner"]',
      '[role="complementary"]',
      'script',
      'style',
      'noscript',
      'iframe'
    ],
    tableSelectors: ['table', 'dl'],
    formSelectors: ['form'],
    headingSelectors: ['h1', 'h2', 'h3', 'h4'],
    autoScan: false,
    maxTextLength: 8000,
    includeMetadata: true,
    includeTables: true,
    includeForms: false
  };

  const BUILTIN_SITE_CONFIGS = {
    _default: DEFAULT_SITE_CONFIG,
    'github.com': {
      name: 'GitHub',
      scanTargets: [
        '[data-pjax-container]',
        '.repository-content',
        '#readme',
        '.markdown-body',
        '.js-issue-title',
        '.comment-body'
      ],
      excludeSelectors: [
        '.Header',
        '.footer',
        '.sidebar',
        '.discussion-sidebar'
      ]
    },
    'confluence.atlassian.net': {
      name: 'Confluence',
      scanTargets: [
        '#main-content',
        '.wiki-content',
        '[data-testid="content-body"]'
      ],
      excludeSelectors: [
        '#navigation',
        '.page-metadata-sidebar',
        '.breadcrumb-section'
      ],
      autoScan: true
    },
    'salesforce.com': {
      name: 'Salesforce',
      scanTargets: [
        '.slds-grid',
        '[data-aura-rendered-by]',
        '.forceRecordLayout',
        '.uiOutputText'
      ],
      excludeSelectors: [
        '.navMenu',
        '.branding-actions'
      ],
      includeForms: true
    },
    'notion.so': {
      name: 'Notion',
      scanTargets: [
        '.notion-page-content',
        '[data-block-id]',
        '.notion-column-block'
      ],
      excludeSelectors: [
        '.notion-sidebar',
        '.notion-topbar',
        '.notion-peek-renderer'
      ]
    },
    'linear.app': {
      name: 'Linear',
      scanTargets: [
        '.issue-detail',
        '[class*="IssueDetail"]',
        '[class*="issueTitle"]',
        '[class*="description"]'
      ],
      excludeSelectors: [
        '[class*="sidebar"]',
        '[class*="navigation"]'
      ]
    },
    'jira.atlassian.com': {
      name: 'Jira',
      scanTargets: [
        '#summary-val',
        '#description-val',
        '#priority-val',
        '#status-val',
        '.issue-main-column',
        '[data-testid="issue.views.issue-base.foundation.summary.heading"]'
      ],
      excludeSelectors: [
        '#jira-frontend-navigation',
        '.aui-sidebar'
      ],
      includeForms: true
    },
    'servicenow.com': {
      name: 'ServiceNow',
      scanTargets: [
        '.form-group',
        '[id*="body"]',
        '.ticket-description',
        'sn-record-field'
      ],
      excludeSelectors: [
        '.header-row',
        '.tab-section'
      ],
      includeForms: true
    }
  };

  function normalizeDomain(domain) {
    return String(domain || '')
      .trim()
      .replace(/^https?:\/\//, '')
      .replace(/\/.*$/, '')
      .replace(/^\*\./, '');
  }

  function isHostnameMatch(hostname, domain) {
    const normalizedHost = normalizeDomain(hostname);
    const normalizedDomain = normalizeDomain(domain);

    if (!normalizedDomain) {
      return false;
    }

    return normalizedHost === normalizedDomain || normalizedHost.endsWith(`.${normalizedDomain}`);
  }

  function findBestDomainMatch(hostname, configMap) {
    return Object.keys(configMap || {})
      .filter((key) => key !== '_default' && isHostnameMatch(hostname, key))
      .sort((left, right) => right.length - left.length)[0];
  }

  function resolveSiteConfig(hostname, extensionConfig) {
    const overrides = extensionConfig.siteConfigOverrides || {};
    const builtInKey = findBestDomainMatch(hostname, BUILTIN_SITE_CONFIGS);
    const overrideKey = findBestDomainMatch(hostname, overrides);
    const builtInConfig = builtInKey ? BUILTIN_SITE_CONFIGS[builtInKey] : {};
    const overrideConfig = overrideKey ? overrides[overrideKey] : {};
    const merged = global.SmartScannerStorage.deepMerge(
      DEFAULT_SITE_CONFIG,
      builtInConfig,
      overrideConfig
    );

    const features = extensionConfig.features || {};

    merged.includeTables = features.enableTableExtraction !== false && merged.includeTables !== false;
    merged.includeForms = features.enableFormExtraction === true && merged.includeForms !== false;
    merged.autoScan = merged.autoScan || (extensionConfig.autoScanDomains || []).some((domain) => {
      return isHostnameMatch(hostname, domain);
    });
    merged.name = merged.name || hostname;

    return merged;
  }

  global.SITE_CONFIGS = BUILTIN_SITE_CONFIGS;
  global.SmartScannerSiteConfigs = {
    DEFAULT_SITE_CONFIG,
    BUILTIN_SITE_CONFIGS,
    isHostnameMatch,
    resolveSiteConfig
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);

