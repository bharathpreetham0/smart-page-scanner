(function attachApi(global) {
  'use strict';

  const SENSITIVE_URL_PATTERNS = [
    /\/login/i,
    /\/signin/i,
    /\/password/i,
    /\/payment/i,
    /\/checkout/i,
    /\/banking/i,
    /\/account\/security/i
  ];

  const SENSITIVE_TEXT_PATTERNS = [
    /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z]{2,}\b/gi,
    /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g,
    /\b\d{3}-\d{2}-\d{4}\b/g,
    /\b(?:\d{4}[ -]?){3}\d{4}\b/g,
    /Bearer\s+[A-Za-z0-9._-]+/gi,
    /(?:password|passwd|secret|api_key|apikey|token)\s*[:=]\s*\S+/gi
  ];

  function isLocalHost(hostname) {
    return hostname === 'localhost' || hostname === '127.0.0.1';
  }

  function isSecureEndpoint(endpoint) {
    try {
      const parsed = new URL(endpoint);
      return parsed.protocol === 'https:' || (parsed.protocol === 'http:' && isLocalHost(parsed.hostname));
    } catch (error) {
      return false;
    }
  }

  function joinUrl(base, path) {
    return `${String(base || '').replace(/\/+$/, '')}/${String(path || '').replace(/^\/+/, '')}`;
  }

  function ensureConfiguredEndpoint(config) {
    if (!config.apiEndpoint || config.apiEndpoint === 'https://api.yourcompany.com') {
      throw new Error('Configure apiEndpoint before scanning.');
    }

    if (!isSecureEndpoint(config.apiEndpoint)) {
      throw new Error('Non-HTTPS API endpoints are rejected outside localhost development.');
    }
  }

  function fetchWithTimeout(url, options, timeoutMs) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs || 15000);

    return fetch(url, {
      ...options,
      signal: controller.signal
    }).finally(() => clearTimeout(timeout));
  }

  function scrubSensitiveText(text) {
    let nextValue = String(text || '');

    SENSITIVE_TEXT_PATTERNS.forEach((pattern) => {
      nextValue = nextValue.replace(pattern, '[REDACTED]');
    });

    return nextValue;
  }

  function scrubStructuredValue(value) {
    if (Array.isArray(value)) {
      return value.map(scrubStructuredValue);
    }

    if (value && typeof value === 'object') {
      return Object.keys(value).reduce((accumulator, key) => {
        accumulator[key] = scrubStructuredValue(value[key]);
        return accumulator;
      }, {});
    }

    if (typeof value === 'string') {
      return scrubSensitiveText(value);
    }

    return value;
  }

  function scrubSensitiveContent(scanData) {
    return {
      ...scanData,
      text: scrubSensitiveText(scanData.text),
      metadata: scrubStructuredValue(scanData.metadata),
      headings: scrubStructuredValue(scanData.headings),
      tables: scrubStructuredValue(scanData.tables),
      forms: scrubStructuredValue(scanData.forms),
      keyElements: scrubStructuredValue(scanData.keyElements)
    };
  }

  async function sendRuntimeMessage(message) {
    if (!global.chrome || !chrome.runtime || !chrome.runtime.sendMessage) {
      return null;
    }

    return new Promise((resolve) => {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime && chrome.runtime.lastError) {
          resolve(null);
          return;
        }

        resolve(response || null);
      });
    });
  }

  async function ensureToken() {
    let token = await global.SmartScannerAuth.getValidToken();
    if (token) {
      return token;
    }

    await sendRuntimeMessage({ type: 'REFRESH_TOKEN' });
    token = await global.SmartScannerAuth.getValidToken();

    return token;
  }

  function buildScanPayload(scanData, config) {
    return {
      url: scanData.url,
      title: scanData.title,
      text: scanData.text,
      headings: scanData.headings,
      tables: scanData.tables,
      metadata: scanData.metadata,
      forms: scanData.forms,
      keyElements: scanData.keyElements,
      wordCount: scanData.wordCount,
      language: config.outputLanguage || scanData.language || 'en',
      summaryLength: config.summaryLength || 'medium',
      summaryStyle: config.summaryStyle || 'bullet'
    };
  }

  function wait(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  function unique(items) {
    const seen = new Set();

    return items.filter((item) => {
      const normalized = String(item || '').trim().toLowerCase();
      if (!normalized || seen.has(normalized)) {
        return false;
      }

      seen.add(normalized);
      return true;
    });
  }

  function splitIntoSentences(text) {
    return String(text || '')
      .replace(/\s+/g, ' ')
      .split(/(?<=[.!?])\s+/)
      .map((sentence) => sentence.trim())
      .filter(Boolean);
  }

  function clampLengthBySummaryPreference(summaryLength) {
    switch (summaryLength) {
      case 'short':
        return { sentences: 2, maxChars: 260, keyPoints: 3 };
      case 'long':
        return { sentences: 5, maxChars: 720, keyPoints: 6 };
      case 'medium':
      default:
        return { sentences: 3, maxChars: 440, keyPoints: 4 };
    }
  }

  function takeTextExcerpt(text, summaryLength) {
    const limits = clampLengthBySummaryPreference(summaryLength);
    const sentences = splitIntoSentences(text).slice(0, limits.sentences);
    const excerpt = sentences.join(' ');

    if (!excerpt) {
      return 'This page contains limited readable text, so the demo summary is based mostly on headings and structured elements.';
    }

    return excerpt.length > limits.maxChars
      ? `${excerpt.slice(0, limits.maxChars).trim()}...`
      : excerpt;
  }

  function gatherEntityCandidates(scanData) {
    const sourceText = [
      scanData.title || '',
      (scanData.headings || []).map((heading) => heading.text).join(' '),
      takeTextExcerpt(scanData.text || '', 'long')
    ].join(' ');

    const matches = sourceText.match(/\b(?:[A-Z][a-z0-9&.-]+|[A-Z]{2,})(?:\s+(?:[A-Z][a-z0-9&.-]+|[A-Z]{2,})){0,2}\b/g) || [];

    return unique(matches)
      .filter((match) => match.length > 2)
      .slice(0, 8);
  }

  function describeStructuredData(metadata) {
    const structuredData = Array.isArray(metadata && metadata.structuredData)
      ? metadata.structuredData
      : [];

    const types = unique(structuredData
      .map((entry) => {
        if (!entry || typeof entry !== 'object') {
          return '';
        }

        return entry['@type'] || '';
      })
      .filter(Boolean));

    if (!types.length) {
      return '';
    }

    return `Structured data detected: ${types.slice(0, 3).join(', ')}.`;
  }

  function buildMockKeyPoints(scanData, config, excerpt) {
    const limits = clampLengthBySummaryPreference(config.summaryLength);
    const headingTexts = (scanData.headings || [])
      .map((heading) => heading.text)
      .filter(Boolean)
      .slice(0, 3);
    const points = [
      'Generated locally in demo mode. No page content was sent to an external API.',
      `Primary extract covered about ${Number(scanData.wordCount || 0).toLocaleString()} words from ${window.location.hostname}.`
    ];

    if (headingTexts.length) {
      points.push(`Top sections detected: ${headingTexts.join(', ')}.`);
    }

    if ((scanData.tables || []).length) {
      points.push(`Detected ${scanData.tables.length} table${scanData.tables.length === 1 ? '' : 's'} that would be included in the scan payload.`);
    }

    if ((scanData.forms || []).length) {
      points.push(`Detected ${scanData.forms.length} form${scanData.forms.length === 1 ? '' : 's'} or form-like field groups.`);
    }

    const structured = describeStructuredData(scanData.metadata);
    if (structured) {
      points.push(structured);
    }

    if (excerpt) {
      points.push(`Opening excerpt: ${excerpt}`);
    }

    return unique(points).slice(0, limits.keyPoints);
  }

  function buildMockSummaryText(scanData, config, excerpt, keyPoints) {
    const title = scanData.title || 'Untitled page';
    const siteName = (scanData.metadata && scanData.metadata.domain) || window.location.hostname;

    if (config.summaryStyle === 'structured') {
      return [
        `Overview: ${title} on ${siteName}.`,
        `Content: ${excerpt}`,
        `Signals: ${keyPoints.slice(1, 3).join(' ')}`
      ].join('\n');
    }

    if (config.summaryStyle === 'bullet') {
      return [
        `• Local demo summary for ${title}.`,
        `• ${excerpt}`,
        `• ${keyPoints[1] || 'Structured extraction is available for this page.'}`
      ].join('\n');
    }

    return `Local demo summary for ${title} on ${siteName}. ${excerpt} ${keyPoints.slice(1, 3).join(' ')}`.trim();
  }

  async function generateMockSummary(scanData, config) {
    const latencyMs = Math.max(150, Number(config.mockLatencyMs || 900));
    const startedAt = Date.now();
    const excerpt = takeTextExcerpt(scanData.text, config.summaryLength);
    const keyPoints = buildMockKeyPoints(scanData, config, excerpt);
    const entities = gatherEntityCandidates(scanData);

    await wait(latencyMs);

    return {
      summary: buildMockSummaryText(scanData, config, excerpt, keyPoints),
      keyPoints,
      entities,
      confidence: 0.74,
      model: 'local-mock-v1',
      processingMs: Date.now() - startedAt,
      isMock: true
    };
  }

  async function performScanRequest(config, token, payload) {
    const response = await fetchWithTimeout(joinUrl(config.apiEndpoint, '/scan'), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-Customer-Id': config.customerId,
        'X-Extension-Version': (chrome.runtime && chrome.runtime.getManifest)
          ? chrome.runtime.getManifest().version
          : 'unknown'
      },
      body: JSON.stringify(payload)
    }, 15000);

    return response;
  }

  async function sendScanRequest(scanData, config) {
    const cleanedScanData = scrubSensitiveContent(scanData);

    if (config.mockMode) {
      return generateMockSummary(cleanedScanData, config);
    }

    ensureConfiguredEndpoint(config);

    let token = await ensureToken();
    if (!token) {
      throw new Error('Authentication required. Please log in and try again.');
    }

    const payload = buildScanPayload(cleanedScanData, config);

    let response = await performScanRequest(config, token, payload);

    if (response.status === 401) {
      await sendRuntimeMessage({ type: 'REFRESH_TOKEN' });
      token = await global.SmartScannerAuth.getValidToken();

      if (!token) {
        throw new Error('Session expired. Please sign in again.');
      }

      response = await performScanRequest(config, token, payload);
    }

    if (!response.ok) {
      const message = await response.text().catch(() => '');
      throw new Error(message || `API error: ${response.status}`);
    }

    return response.json();
  }

  function isSensitivePage(url) {
    return SENSITIVE_URL_PATTERNS.some((pattern) => pattern.test(String(url || '')));
  }

  global.SmartScannerAPI = {
    SENSITIVE_URL_PATTERNS,
    isSecureEndpoint,
    joinUrl,
    fetchWithTimeout,
    scrubSensitiveText,
    scrubSensitiveContent,
    buildScanPayload,
    generateMockSummary,
    sendScanRequest,
    sendRuntimeMessage,
    isSensitivePage
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
