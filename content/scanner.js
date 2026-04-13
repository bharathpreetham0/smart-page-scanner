(function attachScanner(global) {
  'use strict';

  const SEMANTIC_SELECTORS = [
    'main',
    'article',
    '[role="main"]',
    '[role="article"]',
    '.content',
    '.main-content',
    '#content',
    '#main'
  ];

  const CHROME_PATTERNS = [
    'nav',
    'header',
    'footer',
    'sidebar',
    'menu',
    'toolbar',
    'breadcrumb',
    'pagination',
    'advertisement',
    'banner',
    'share',
    'social',
    'comment'
  ];

  function safeQueryOne(selector, root) {
    try {
      return (root || document).querySelector(selector);
    } catch (error) {
      return null;
    }
  }

  function safeQueryAll(selector, root) {
    try {
      return Array.from((root || document).querySelectorAll(selector));
    } catch (error) {
      return [];
    }
  }

  function normalizeWhitespace(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function getWordCount(text) {
    return normalizeWhitespace(text).split(/\s+/).filter(Boolean).length;
  }

  function isVisible(element) {
    if (!element || !element.isConnected) {
      return false;
    }

    const style = window.getComputedStyle(element);
    return (
      style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      style.opacity !== '0' &&
      element.getClientRects().length > 0
    );
  }

  function isLikelyChrome(element) {
    if (!element) {
      return false;
    }

    const text = [
      element.tagName || '',
      element.className || '',
      element.id || '',
      element.getAttribute('role') || ''
    ].join(' ').toLowerCase();

    return CHROME_PATTERNS.some((pattern) => text.includes(pattern));
  }

  function isExcluded(element, config) {
    return (config.excludeSelectors || []).some((selector) => {
      try {
        return Boolean(element.closest(selector));
      } catch (error) {
        return false;
      }
    });
  }

  function hasMeaningfulContent(element) {
    return getWordCount(element.textContent) >= 50;
  }

  function contentDensityScore(element) {
    const textLength = normalizeWhitespace(element.textContent).length;
    const htmlLength = (element.innerHTML || '').length || 1;
    const density = textLength / htmlLength;
    const paragraphCount = element.querySelectorAll('p').length;
    const headingCount = element.querySelectorAll('h1, h2, h3').length;
    const childPenalty = element.children.length * 8;

    return textLength + paragraphCount * 120 + headingCount * 160 + density * 300 - childPenalty;
  }

  function selectPrimaryContent(config) {
    const configuredSelectors = config.scanTargets || [];

    for (const selector of configuredSelectors) {
      const element = safeQueryOne(selector);
      if (element && isVisible(element) && !isExcluded(element, config) && hasMeaningfulContent(element)) {
        return element;
      }
    }

    for (const selector of SEMANTIC_SELECTORS) {
      const element = safeQueryOne(selector);
      if (element && isVisible(element) && !isExcluded(element, config) && hasMeaningfulContent(element)) {
        return element;
      }
    }

    const candidates = safeQueryAll('main, article, section, div')
      .filter((element) => isVisible(element) && !isExcluded(element, config) && !isLikelyChrome(element))
      .filter(hasMeaningfulContent)
      .slice(0, 500);

    if (!candidates.length) {
      return document.body;
    }

    candidates.sort((left, right) => contentDensityScore(right) - contentDensityScore(left));
    return candidates[0] || document.body;
  }

  function extractVisibleText(root, config) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent) {
          return NodeFilter.FILTER_SKIP;
        }
        if (isExcluded(parent, config) || !isVisible(parent)) {
          return NodeFilter.FILTER_SKIP;
        }

        const text = normalizeWhitespace(node.textContent);
        if (!text) {
          return NodeFilter.FILTER_SKIP;
        }

        return NodeFilter.FILTER_ACCEPT;
      }
    });

    const chunks = [];
    let nextNode;

    while ((nextNode = walker.nextNode())) {
      chunks.push(normalizeWhitespace(nextNode.textContent));
    }

    return normalizeWhitespace(chunks.join(' '));
  }

  function extractMetadata() {
    const metadata = {
      title: document.title || '',
      url: window.location.href,
      domain: window.location.hostname,
      description: '',
      keywords: '',
      openGraph: {},
      structuredData: []
    };

    const description = safeQueryOne('meta[name="description"]');
    const keywords = safeQueryOne('meta[name="keywords"]');

    metadata.description = description ? description.getAttribute('content') || '' : '';
    metadata.keywords = keywords ? keywords.getAttribute('content') || '' : '';

    safeQueryAll('meta[property^="og:"]').forEach((element) => {
      const key = String(element.getAttribute('property') || '').replace(/^og:/, '');
      metadata.openGraph[key] = element.getAttribute('content') || '';
    });

    safeQueryAll('script[type="application/ld+json"]').forEach((script) => {
      try {
        metadata.structuredData.push(JSON.parse(script.textContent));
      } catch (error) {
        // Ignore invalid JSON-LD blocks.
      }
    });

    safeQueryAll('[itemscope]').forEach((item) => {
      const entry = {};
      const type = item.getAttribute('itemtype');

      if (type) {
        entry['@type'] = type.split('/').pop();
      }

      safeQueryAll('[itemprop]', item).forEach((property) => {
        const name = property.getAttribute('itemprop');
        if (!name) {
          return;
        }

        entry[name] = property.getAttribute('content') || normalizeWhitespace(property.textContent);
      });

      if (Object.keys(entry).length) {
        metadata.structuredData.push(entry);
      }
    });

    return metadata;
  }

  function extractHeadings(config) {
    const selector = (config.headingSelectors || ['h1', 'h2', 'h3']).join(', ');

    return safeQueryAll(selector)
      .filter((element) => !isExcluded(element, config))
      .map((element) => ({
        level: Number(String(element.tagName || 'H0').replace('H', '')) || 0,
        text: normalizeWhitespace(element.textContent)
      }))
      .filter((heading) => heading.text);
  }

  function extractText(config) {
    const primaryContent = selectPrimaryContent(config);
    return extractVisibleText(primaryContent || document.body, config);
  }

  function parseHtmlTable(table, index, config) {
    if (!isVisible(table) || isExcluded(table, config)) {
      return null;
    }

    const headers = [];
    const rows = [];

    safeQueryAll('thead th, thead td, tr:first-child th', table).forEach((cell) => {
      headers.push(normalizeWhitespace(cell.textContent));
    });

    safeQueryAll('tbody tr, tr', table).forEach((row, rowIndex) => {
      if (rowIndex === 0 && headers.length > 0 && row.querySelector('th')) {
        return;
      }

      const cells = safeQueryAll('td, th', row)
        .map((cell) => normalizeWhitespace(cell.textContent))
        .filter(Boolean);

      if (cells.length) {
        rows.push(cells.slice(0, 12));
      }
    });

    if (rows.length < 2 && headers.length < 2) {
      return null;
    }

    return {
      type: 'html-table',
      index,
      caption: table.caption ? normalizeWhitespace(table.caption.textContent) : '',
      headers: headers.slice(0, 12),
      rows: rows.slice(0, 50),
      rowCount: rows.length,
      colCount: headers.length || (rows[0] ? rows[0].length : 0)
    };
  }

  function parseDefinitionList(list, index, config) {
    if (!isVisible(list) || isExcluded(list, config)) {
      return null;
    }

    const terms = safeQueryAll('dt', list);
    const definitions = safeQueryAll('dd', list);
    const rows = terms.map((term, rowIndex) => {
      return [
        normalizeWhitespace(term.textContent),
        normalizeWhitespace(definitions[rowIndex] ? definitions[rowIndex].textContent : '')
      ];
    }).filter((row) => row.some(Boolean));

    if (rows.length < 2) {
      return null;
    }

    return {
      type: 'definition-list',
      index,
      caption: '',
      headers: ['Field', 'Value'],
      rows: rows.slice(0, 50),
      rowCount: rows.length,
      colCount: 2
    };
  }

  function extractTables(config) {
    const selectors = Array.isArray(config.tableSelectors) && config.tableSelectors.length
      ? config.tableSelectors
      : ['table', 'dl'];
    const uniqueSelectors = Array.from(new Set(selectors.concat(['table', 'dl'])));
    const htmlTables = uniqueSelectors.includes('table')
      ? safeQueryAll('table').map((table, index) => parseHtmlTable(table, index, config)).filter(Boolean)
      : [];
    const definitionLists = uniqueSelectors.includes('dl')
      ? safeQueryAll('dl').map((list, index) => parseDefinitionList(list, index, config)).filter(Boolean)
      : [];

    return htmlTables.concat(definitionLists);
  }

  function findLabel(field) {
    if (field.id) {
      const escapedId = global.CSS && CSS.escape ? CSS.escape(field.id) : field.id.replace(/"/g, '\\"');
      const linkedLabel = safeQueryOne(`label[for="${escapedId}"]`);
      if (linkedLabel) {
        return normalizeWhitespace(linkedLabel.textContent);
      }
    }

    const wrappingLabel = field.closest('label');
    if (wrappingLabel) {
      return normalizeWhitespace(wrappingLabel.textContent.replace(field.value || '', ''));
    }

    return field.getAttribute('aria-label') || field.getAttribute('placeholder') || field.name || field.id || 'Unknown field';
  }

  function parseField(field) {
    if (['hidden', 'submit', 'button', 'reset', 'file', 'image', 'password'].includes(field.type)) {
      return null;
    }

    let value = '';
    if (field.tagName === 'SELECT') {
      value = field.options[field.selectedIndex] ? field.options[field.selectedIndex].text : field.value;
    } else if (field.type === 'checkbox' || field.type === 'radio') {
      value = field.checked ? 'checked' : 'unchecked';
    } else {
      value = field.value || '';
    }

    return {
      label: findLabel(field),
      type: field.type || field.tagName.toLowerCase(),
      value,
      name: field.name || '',
      id: field.id || ''
    };
  }

  function extractForms(config) {
    const forms = safeQueryAll((config.formSelectors || ['form']).join(', '))
      .filter((form) => !isExcluded(form, config))
      .map((form, index) => {
        const fields = safeQueryAll('input, select, textarea', form)
          .map(parseField)
          .filter(Boolean);

        return {
          type: 'html-form',
          index,
          action: form.action || '',
          method: form.method || 'get',
          fields
        };
      })
      .filter((form) => form.fields.length);

    const orphanFields = safeQueryAll('input, select, textarea')
      .filter((field) => !field.closest('form'))
      .map(parseField)
      .filter(Boolean);

    if (orphanFields.length) {
      forms.push({
        type: 'orphan-fields',
        index: -1,
        action: '',
        method: 'get',
        fields: orphanFields
      });
    }

    return forms;
  }

  function extractKeyElements(config) {
    const selectors = [
      '[class*="stat"]',
      '[class*="metric"]',
      '[class*="count"]',
      '[class*="badge"]',
      'button',
      'a[role="button"]'
    ].join(', ');

    return safeQueryAll(selectors)
      .filter((element) => !isExcluded(element, config) && isVisible(element))
      .map((element) => ({
        type: element.tagName.toLowerCase() === 'button' ? 'action' : 'signal',
        text: normalizeWhitespace(element.textContent)
      }))
      .filter((entry) => entry.text && entry.text.length < 120)
      .slice(0, 20);
  }

  async function waitForContentStability(targetSelector, maxWaitMs) {
    const timeout = Number(maxWaitMs || 3000);
    const startedAt = Date.now();
    let lastText = '';
    let stableChecks = 0;

    return new Promise((resolve) => {
      const interval = window.setInterval(() => {
        const target = safeQueryOne(targetSelector) || document.body;
        const currentText = normalizeWhitespace(target ? target.textContent : '');

        if (currentText && currentText === lastText) {
          stableChecks += 1;
        } else {
          stableChecks = 0;
          lastText = currentText;
        }

        if (stableChecks >= 3 || Date.now() - startedAt >= timeout) {
          window.clearInterval(interval);
          resolve(target || document.body);
        }
      }, 100);
    });
  }

  function scan(config) {
    const text = extractText(config);
    const truncatedText = text.length > (config.maxTextLength || 8000)
      ? `${text.slice(0, config.maxTextLength)}\n[...truncated]`
      : text;

    const result = {
      url: window.location.href,
      title: document.title,
      timestamp: new Date().toISOString(),
      metadata: config.includeMetadata === false ? {} : extractMetadata(config),
      headings: extractHeadings(config),
      text: truncatedText,
      tables: config.includeTables ? extractTables(config) : [],
      forms: config.includeForms ? extractForms(config) : [],
      keyElements: extractKeyElements(config),
      wordCount: getWordCount(text),
      language: document.documentElement.lang || 'unknown'
    };

    return result;
  }

  global.SmartScanner = {
    scan,
    waitForContentStability
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
