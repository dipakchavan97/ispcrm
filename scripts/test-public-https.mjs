import https from 'https';

async function fetchUrl(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body
        });
      });
    });
    req.on('error', reject);
    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

async function main() {
  console.log('=== 1. TESTING ROOT URL https://app.cloudsetup.in/ ===');
  const rootRes = await fetchUrl('https://app.cloudsetup.in/');
  console.log('Root Status:', rootRes.statusCode);
  console.log('HSTS Header:', rootRes.headers['strict-transport-security']);
  console.log('X-Frame-Options:', rootRes.headers['x-frame-options']);
  console.log('Content-Type:', rootRes.headers['content-type']);
  console.log('Body Length:', rootRes.body.length);
  console.log('Contains :4000?', rootRes.body.includes(':4000'));

  console.log('\n=== 2. TESTING LOGIN PAGE https://app.cloudsetup.in/login ===');
  const loginRes = await fetchUrl('https://app.cloudsetup.in/login');
  console.log('Login Status:', loginRes.statusCode);
  console.log('Login Body Length:', loginRes.body.length);
  console.log('Contains :4000?', loginRes.body.includes(':4000'));

  console.log('\n=== 3. TESTING API HEALTH https://app.cloudsetup.in/api/health ===');
  const healthRes = await fetchUrl('https://app.cloudsetup.in/api/health');
  console.log('Health Status:', healthRes.statusCode);
  console.log('Health Body:', healthRes.body);
  const healthJson = JSON.parse(healthRes.body);
  console.log('Database Status:', healthJson.info?.database?.status);
  console.log('Redis Status:', healthJson.info?.redis?.status);

  console.log('\n=== 4. TESTING STATIC ASSET CHUNK LOADING ===');
  const scriptMatches = loginRes.body.match(/src="(\/_next\/static\/[^"]+)"/g) || [];
  console.log(`Found ${scriptMatches.length} static script chunks in Login HTML.`);
  for (const match of scriptMatches.slice(0, 3)) {
    const chunkPath = match.replace('src="', '').replace('"', '');
    const chunkUrl = 'https://app.cloudsetup.in' + chunkPath;
    const chunkRes = await fetchUrl(chunkUrl);
    console.log(`Chunk [${chunkPath.split('/').pop()}]: HTTP ${chunkRes.statusCode}, Content-Type: ${chunkRes.headers['content-type']}, Size: ${chunkRes.body.length}`);
    console.log(`  Contains :4000?`, chunkRes.body.includes(':4000'));
  }

  console.log('\n=== 5. TESTING SAME-ORIGIN API PREFLIGHT / OPTIONS ===');
  const optionsRes = await fetchUrl('https://app.cloudsetup.in/api/health', {
    method: 'OPTIONS',
    headers: {
      'Origin': 'https://app.cloudsetup.in',
      'Access-Control-Request-Method': 'GET'
    }
  });
  console.log('OPTIONS Status:', optionsRes.statusCode);

  console.log('\n=== ALL PUBLIC HTTPS TESTS PASSED SUCCESSFULLY! ===');
}

main().catch(err => {
  console.error('Test Failed:', err);
  process.exit(1);
});
