(function attachStandalonePanel() {
  'use strict';

  const output = document.getElementById('output');

  async function render() {
    const { lastScan } = await SmartScannerStorage.getSessionValue(['lastScan']);

    if (!lastScan) {
      output.textContent = 'No cached summary is available yet. Run a scan first.';
      output.className = 'empty';
      return;
    }

    output.textContent = JSON.stringify(lastScan, null, 2);
    output.className = '';
  }

  render().catch((error) => {
    output.textContent = error.message;
    output.className = 'empty';
  });
})();
