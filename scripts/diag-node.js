// 임시 진단: 동일 헤더로 클라이언트별 응답 비교
const axios = require('axios');
const http2 = require('http2');
const { execFileSync } = require('child_process');
const URL_ = 'https://theqoo.net/square?page=1';
const H = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
};
const rows = (s) => (String(s).match(/class="no"/g) || []).length;
async function t(label, fn) {
  try { const [st, body, extra] = await fn(); console.log(`${label}: HTTP ${st} rows=${rows(body)} ${extra || ''}`); }
  catch (e) { console.log(`${label}: ERR ${e.response?.status || ''} ${e.response?.headers?.['cf-mitigated'] || ''} ${e.message}`); }
}
(async () => {
  console.log('node', process.version, 'openssl', process.versions.openssl);
  for (let i = 0; i < 2; i++) {
    await t('axios', async () => { const r = await axios.get(URL_, { headers: H, responseType: 'text' }); return [r.status, r.data]; });
    await t('fetch(undici)', async () => { const r = await fetch(URL_, { headers: H }); return [r.status, await r.text(), r.headers.get('cf-mitigated')]; });
    await t('http2', () => new Promise((res, rej) => {
      const c = http2.connect('https://theqoo.net');
      c.on('error', rej);
      const req = c.request({ ':path': '/square?page=1', 'user-agent': H['User-Agent'], accept: H.Accept, 'accept-language': H['Accept-Language'] });
      let st, b = ''; req.on('response', (h) => (st = h[':status'])); req.setEncoding('utf8');
      req.on('data', (d) => (b += d)); req.on('end', () => { c.close(); res([st, b]); }); req.on('error', rej); req.end();
    }));
    await t('curl', async () => {
      const out = execFileSync('curl', ['-sS', '--compressed', '-w', '\n%{http_code}', '-A', H['User-Agent'], '-H', `Accept: ${H.Accept}`, '-H', `Accept-Language: ${H['Accept-Language']}`, URL_], { encoding: 'utf8', maxBuffer: 1 << 24 });
      const i2 = out.lastIndexOf('\n'); return [out.slice(i2 + 1), out.slice(0, i2)];
    });
    await t('curl --http1.1', async () => {
      const out = execFileSync('curl', ['-sS', '--http1.1', '--compressed', '-w', '\n%{http_code}', '-A', H['User-Agent'], '-H', `Accept: ${H.Accept}`, '-H', `Accept-Language: ${H['Accept-Language']}`, URL_], { encoding: 'utf8', maxBuffer: 1 << 24 });
      const i2 = out.lastIndexOf('\n'); return [out.slice(i2 + 1), out.slice(0, i2)];
    });
  }
})();
