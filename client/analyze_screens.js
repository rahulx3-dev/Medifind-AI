const fs = require('fs');
const path = require('path');

const dir = path.resolve(__dirname, 'stitch_screens');
const files = fs.readdirSync(dir);
console.log('Found', files.length, 'screen files.');

const fontSet = new Set();
let sampleConfig = null;

for (const file of files) {
  const content = fs.readFileSync(path.join(dir, file), 'utf8');
  const fontMatches = content.match(/fonts\.googleapis\.com[^\"]+/g);
  if (fontMatches) {
    fontMatches.forEach(f => fontSet.add(f));
  }
  const twMatch = content.match(/tailwind\.config\s*=\s*({[^<]+})/);
  if (twMatch && !sampleConfig) {
    sampleConfig = twMatch[1];
  }
}

console.log('Fonts:', Array.from(fontSet));
if (sampleConfig) {
  try {
    const parsed = JSON.parse(sampleConfig);
    console.log('Tailwind config colors:', Object.keys(parsed.theme?.extend?.colors || {}));
  } catch (e) {
    console.log('Config snippet:', sampleConfig.slice(0, 100));
  }
}
