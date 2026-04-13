# Smart Page Scanner

Smart Page Scanner is a Manifest V3 Chrome extension that scans the active page, extracts structured DOM content, sends a cleaned payload to your backend summarization API, and renders the result in an isolated in-page panel.

For local demos, the extension also supports a built-in mock mode that generates summaries in the browser without calling your backend.

## What is included

- Manifest V3 extension scaffold with dev and prod manifests
- DOM scanner with text, headings, table, form, and structured data extraction
- Shadow DOM result panel with copy, export, and re-scan actions
- Background service worker for auth, commands, badge updates, and message routing
- Managed storage schema and sample enterprise policy payload
- Build scripts for local development and packaging

## Local setup

### Fast demo mode

1. Load the repo root or [dist/dev](/Users/bharath/smart-page-scanner/dist/dev) as an unpacked extension in `chrome://extensions`.
2. Open the popup.
3. Click `Enable Local Demo Mode`.
4. Visit any allowed page and run a scan.

Demo mode skips auth, does not require `apiEndpoint`, and generates a synthetic summary locally so you can validate the end-to-end UX quickly.

### Real backend mode

1. Update the managed policy or `chrome.storage.sync` values with your real:
   - `apiEndpoint`
   - `customerId`
   - `authBaseUrl`
   - `oauthClientId`
2. Load the repo root as an unpacked extension in `chrome://extensions`.
3. Open the popup and authenticate.
4. Visit an allowed page and run a scan from the popup or `Ctrl+Shift+S`.

## Build

```bash
./scripts/build.sh dev
./scripts/build.sh prod
./scripts/pack-extension.sh
```

## Managed configuration

The extension reads tenant config from `chrome.storage.managed` first and falls back to `chrome.storage.sync` for local development. See [policies/managed-storage-schema.json](/Users/bharath/smart-page-scanner/policies/managed-storage-schema.json) and [policies/sample-gpo-policy.json](/Users/bharath/smart-page-scanner/policies/sample-gpo-policy.json).

## Notes

- Raw page text is never written to extension storage.
- Passwords, hidden inputs, bearer tokens, and common PII patterns are scrubbed before API submission.
- HTTP endpoints are rejected except for localhost development targets.
- In `mockMode`, summaries are generated locally and no scan payload is sent to an external API.
