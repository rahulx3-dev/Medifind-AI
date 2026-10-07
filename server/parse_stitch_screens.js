const fs = require('fs');

const raw = JSON.parse(fs.readFileSync('C:\\Users\\HP\\.gemini\\antigravity-ide\\brain\\a12d4c75-ebc5-4d29-91f2-c4056e41fd9b\\.system_generated\\steps\\633\\output.txt', 'utf8'));

console.log(`Total Stitch Screens: ${raw.screens.length}\n`);

const screens = raw.screens.map((s, idx) => {
  const screenId = s.name.split('/').pop();
  return {
    index: idx + 1,
    title: s.title,
    screenId,
    device: s.deviceType || 'DESKTOP',
    width: s.width,
    height: s.height
  };
});

console.table(screens);
fs.writeFileSync('stitch_screens_manifest.json', JSON.stringify(screens, null, 2));
