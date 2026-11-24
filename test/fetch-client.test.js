/**
 * 수집 방식(request.client: axios / curl) 테스트
 *
 * 로컬 HTTP 서버를 띄워 실제 curl / axios 요청을 검증합니다.
 * 실행: node test/fetch-client.test.js
 */

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const zlib = require('zlib');
const yaml = require('js-yaml');
const iconv = require('iconv-lite');
const { fetchPage, buildCurlArgs, parseCurlOutput, SUPPORTED_CLIENTS } = require('../src/scraper-engine');

// 로컬 서버 요청이 프록시를 타지 않도록
process.env.NO_PROXY = process.env.no_proxy = '127.0.0.1,localhost';

const config = yaml.load(
  fs.readFileSync(path.resolve(__dirname, '..', 'config', 'feeds.yaml'), 'utf-8')
);

let passed = 0;
let failed = 0;

async function runTest(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    failed++;
  }
}

const HTML = '<html><body><table class="theqoo_board"><tr><td class="title"><a href="/square/1">한글 제목</a></td></tr></table></body></html>';
let lastHeaders = null;

const server = http.createServer((req, res) => {
  lastHeaders = req.headers;
  if (req.url.startsWith('/ok')) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(HTML);
  }
  if (req.url.startsWith('/gzip')) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Encoding': 'gzip' });
    return res.end(zlib.gzipSync(HTML));
  }
  if (req.url.startsWith('/euckr')) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=euc-kr' });
    return res.end(iconv.encode('<p>클리앙 게시판</p>', 'euc-kr'));
  }
  if (req.url.startsWith('/redirect')) {
    res.writeHead(302, { Location: '/ok' });
    return res.end();
  }
  if (req.url.startsWith('/blocked')) {
    res.writeHead(403, { 'Content-Type': 'text/html', 'cf-mitigated': 'challenge' });
    return res.end('<title>보안 검사중</title>');
  }
  res.writeHead(404);
  res.end();
});

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const REQ = { retries: 1, retryDelay: 0, timeout: 5000 };

  console.log('\n── 수집 방식(client) 테스트 ──\n');

  await runTest('curl 인자: UA·헤더 전달, URL은 -- 뒤 (옵션 주입 방지)', () => {
    const args = buildCurlArgs({
      url: '-o/etc/passwd',
      timeout: 15000,
      headers: { 'User-Agent': 'UA/1', Accept: 'text/html', Referer: 'https://x' },
    });
    assert.deepStrictEqual(args.slice(args.indexOf('--user-agent'), args.indexOf('--user-agent') + 2), ['--user-agent', 'UA/1']);
    assert.ok(args.includes('Accept: text/html') && args.includes('Referer: https://x'));
    assert.strictEqual(args[args.indexOf('--max-time') + 1], '15');
    assert.deepStrictEqual(args.slice(-2), ['--', '-o/etc/passwd']);
  });

  await runTest('curl 출력 파싱: 본문/상태 분리, 4xx는 status 포함 오류', () => {
    const ok = parseCurlOutput(Buffer.from('<p>본문</p>\n__FEEDFORGE_HTTP_STATUS__:200'));
    assert.strictEqual(ok.toString(), '<p>본문</p>');
    assert.throws(() => parseCurlOutput(Buffer.from('x\n__FEEDFORGE_HTTP_STATUS__:403')), (e) => e.status === 403);
    assert.throws(() => parseCurlOutput(Buffer.from('no marker')), /상태 코드/);
  });

  await runTest('client=curl: 실제 curl 요청, UTF-8 본문 + 설정 헤더 전송', async () => {
    const html = await fetchPage(`${base}/ok`, { ...REQ, client: 'curl', userAgent: 'FeedForgeTest/1.0', headers: { Referer: 'https://theqoo.net' } });
    assert.strictEqual(html, HTML);
    assert.strictEqual(lastHeaders['user-agent'], 'FeedForgeTest/1.0');
    assert.strictEqual(lastHeaders.referer, 'https://theqoo.net');
    assert.ok(lastHeaders['accept-language'].startsWith('ko-KR'));
  });

  await runTest('client=curl: gzip 응답 해제', async () => {
    assert.strictEqual(await fetchPage(`${base}/gzip`, { ...REQ, client: 'curl' }), HTML);
  });

  await runTest('client=curl: 리다이렉트 추적', async () => {
    assert.strictEqual(await fetchPage(`${base}/redirect`, { ...REQ, client: 'curl' }), HTML);
  });

  await runTest('client=curl: euc-kr 인코딩 변환', async () => {
    assert.strictEqual(await fetchPage(`${base}/euckr`, { ...REQ, client: 'curl', encoding: 'euc-kr' }), '<p>클리앙 게시판</p>');
  });

  await runTest('client=curl: HTTP 403 → 재시도 후 오류', async () => {
    await assert.rejects(fetchPage(`${base}/blocked`, { ...REQ, client: 'curl' }), /403/);
  });

  await runTest('client 미지정(axios 기본): 기존 동작 유지 (UTF-8 / euc-kr / 403)', async () => {
    assert.strictEqual(await fetchPage(`${base}/ok`, REQ), HTML);
    assert.strictEqual(await fetchPage(`${base}/euckr`, { ...REQ, encoding: 'euc-kr' }), '<p>클리앙 게시판</p>');
    await assert.rejects(fetchPage(`${base}/blocked`, REQ), /403/);
  });

  await runTest('지원하지 않는 client → 즉시 오류', async () => {
    await assert.rejects(fetchPage(`${base}/ok`, { ...REQ, client: 'wget' }), /지원하지 않는 request.client/);
  });

  await runTest('설정: theqoo는 curl, 그 외는 axios, 모든 값이 지원 목록 내', () => {
    const globalClient = config.global.request.client;
    const clientOf = (name) => config.feeds.find((f) => f.name === name).request?.client ?? globalClient;
    assert.strictEqual(clientOf('theqoo-square'), 'curl');
    assert.strictEqual(clientOf('clien-all'), 'axios');
    config.feeds.forEach((f) => assert.ok(SUPPORTED_CLIENTS.includes(f.request?.client ?? globalClient)));
  });

  server.close();
  console.log(`\n── 결과: ${passed}개 통과, ${failed}개 실패 ──\n`);
  process.exit(failed > 0 ? 1 : 0);
})();
