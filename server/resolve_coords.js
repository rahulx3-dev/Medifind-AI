async function resolve(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    }
  });
  const html = await res.text();
  // Look for staticmap center
  const staticMatch = html.match(/center=([0-9\.\%2C\-]+)/) || html.match(/ll=([0-9\.\%2C\-]+)/);
  // Look for coordinates near 9.3 (Chengannur)
  const chengannurCoords = [...html.matchAll(/(9\.[0-9]{4,}),(76\.[0-9]{4,})/g)].map(m => [m[1], m[2]]);
  const revCoords = [...html.matchAll(/\[\s*(76\.[0-9]{4,})\s*,\s*(9\.[0-9]{4,})\s*\]/g)].map(m => [m[2], m[1]]);
  const fwdCoords = [...html.matchAll(/\[\s*(9\.[0-9]{4,})\s*,\s*(76\.[0-9]{4,})\s*\]/g)].map(m => [m[1], m[2]]);
  
  console.log('URL:', url);
  console.log('staticMatch:', staticMatch ? staticMatch[0] : null);
  console.log('chengannurCoords:', chengannurCoords.slice(0, 3));
  console.log('revCoords:', revCoords.slice(0, 3));
  console.log('fwdCoords:', fwdCoords.slice(0, 3));
}

async function main() {
  await resolve('https://maps.app.goo.gl/W5EYF7wtx33cLpfL7');
  await resolve('https://maps.app.goo.gl/jaszQixVujJRX9yc9?g_st=ac');
}

main();
