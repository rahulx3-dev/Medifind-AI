const fs = require('fs');
const path = require('path');

const forbidden = [
  'live telemetry',
  'network telemetry',
  'real-time operational telemetry',
  'operational telemetry',
  'telemetry',
  'hipaa shield',
  'hipaa certified',
  'hipaa compliant',
  'hipaa',
  'dpdp certified',
  'dpdp & hipaa',
  'dpdp',
  'regulatory shield',
  'certified authenticity',
  'zero-knowledge',
  'cryptographic handoff',
  'cryptographic ledger',
  'enclave',
  'live courier',
  'live gps',
  'guaranteed stock',
  'guaranteed availability',
  'verified emergency node',
  'clinical journey',
  'medical diagnosis'
];

function searchDir(dir) {
  const files = fs.readdirSync(dir);
  for (const f of files) {
    const full = path.join(dir, f);
    if (fs.statSync(full).isDirectory()) {
      if (f !== 'node_modules' && f !== '.git' && f !== 'dist' && f !== 'stitch_screens') searchDir(full);
    } else if (f.endsWith('.jsx') || f.endsWith('.tsx') || f.endsWith('.js') || f.endsWith('.css')) {
      const content = fs.readFileSync(full, 'utf8');
      const lower = content.toLowerCase();
      forbidden.forEach(term => {
        if (lower.includes(term)) {
          const lines = content.split('\n');
          lines.forEach((l, idx) => {
            if (l.toLowerCase().includes(term)) {
              console.log(full + ':' + (idx + 1) + ' [' + term + ']: ' + l.trim().substring(0, 110));
            }
          });
        }
      });
    }
  }
}

searchDir('c:/Users/HP/mfai_web/client/src');
