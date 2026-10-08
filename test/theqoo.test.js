/**
 * 더쿠 피드 날짜 파싱 / 본문 수집 테스트
 *
 * 실행: node test/theqoo.test.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const yaml = require('js-yaml');
const { parseDate } = require('../src/extractors');
const { extractContent, fillContents } = require('../src/content-fetcher');
const { generateRSS } = require('../src/rss-generator');

const config = yaml.load(
  fs.readFileSync(path.resolve(__dirname, '..', 'config', 'feeds.yaml'), 'utf-8')
);
const theqoo = config.feeds.find((f) => f.name === 'theqoo-square');
const dateCfg = theqoo.selectors.date;
const postHtml = fs.readFileSync(path.join(__dirname, 'fixtures', 'theqoo-post-body.html'), 'utf-8');
const POST_URL = 'https://theqoo.net/square/4369549137';

// 2026-10-09 07:24 KST
const NOW = new Date('2026-10-08T22:24:00Z');

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

(async () => {
  console.log('\n── 더쿠 날짜 파싱 테스트 ──\n');

  await runTest('오늘 "HH:mm" → KST 오늘 시각', () => {
    assert.strictEqual(parseDate('07:14', dateCfg.format, dateCfg.timezone, NOW), '2026-10-08T22:14:00.000Z');
  });

  await runTest('KST 자정 직후 "00:05" → 같은 KST 날짜', () => {
    assert.strictEqual(parseDate('00:05', dateCfg.format, dateCfg.timezone, NOW), '2026-10-08T15:05:00.000Z');
  });

  await runTest('미래 시각 "23:50" → 전날로 보정', () => {
    assert.strictEqual(parseDate('23:50', dateCfg.format, dateCfg.timezone, NOW), '2026-10-08T14:50:00.000Z');
  });

  await runTest('올해 "MM.DD"', () => {
    assert.strictEqual(parseDate('10.08', dateCfg.format, dateCfg.timezone, NOW), '2026-10-07T15:00:00.000Z');
  });

  await runTest('연말 "12.31" (1월 기준) → 작년', () => {
    const jan = new Date('2027-01-02T00:00:00Z');
    assert.strictEqual(parseDate('12.31', dateCfg.format, dateCfg.timezone, jan), '2026-12-30T15:00:00.000Z');
  });

  await runTest('이전 연도 "YY.MM.DD"', () => {
    assert.strictEqual(parseDate('24.04.09', dateCfg.format, dateCfg.timezone, NOW), '2024-04-08T15:00:00.000Z');
  });

  await runTest('단일 포맷/timezone 없는 기존 동작 유지', () => {
    assert.strictEqual(parseDate('2026-10-08 19:11:26', 'YYYY-MM-DD HH:mm:ss'), new Date(2026, 9, 8, 19, 11, 26).toISOString());
  });

  console.log('\n── 더쿠 본문 수집 테스트 ──\n');

  await runTest('실제 게시물: 이미지/텍스트 추출, 광고 제거, Referer 미전송', () => {
    const html = extractContent(postHtml, theqoo.content.selector, POST_URL);
    assert.ok(html.includes('<img src="https://img-cdn.theqoo.net/aGucWN.jpg"'));
    assert.ok(html.includes('<img src="https://img-cdn.theqoo.net/xLTZle.jpg"'));
    assert.ok(html.includes('referrerpolicy="no-referrer"'));
    assert.ok(html.includes('수도권인데 처음봄..'));
    assert.ok(!html.includes('adsbygoogle'));
  });

  await runTest('지연 로딩/상대 경로 이미지, 유튜브·X·인스타 임베드 변환', () => {
    const html = extractContent(
      `<div class="c"><p onclick="x()">t</p><img data-src="/a.jpg" src="data:image/gif;base64,R0">
       <iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ"></iframe>
       <blockquote class="twitter-tweet"><a href="https://twitter.com/u/status/1">d</a></blockquote>
       <blockquote class="instagram-media" data-instgrm-permalink="https://www.instagram.com/p/ABC/"></blockquote>
       <script>alert(1)</script></div>`,
      '.c',
      POST_URL
    );
    assert.ok(html.includes('<img src="https://theqoo.net/a.jpg"'));
    assert.ok(html.includes('https://www.youtube.com/watch?v=dQw4w9WgXcQ'));
    assert.ok(html.includes('X(트위터)에서 보기'));
    assert.ok(html.includes('href="https://www.instagram.com/p/ABC/"'));
    assert.ok(!html.includes('<iframe') && !html.includes('<script') && !html.includes('onclick'));
  });

  await runTest('이전 피드의 본문은 재요청하지 않음 + maxFetch 상한', async () => {
    const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ff-')), 'prev.xml');
    const cachedItem = { title: 'a', link: 'https://theqoo.net/square/1', date: NOW.toISOString(), content: '<p>캐시</p>' };
    fs.writeFileSync(tmp, generateRSS([cachedItem], { filename: 'x.xml' }, true));

    const items = [
      { link: 'https://theqoo.net/square/1' },
      { link: 'https://theqoo.net/square/2' },
      { link: 'https://theqoo.net/square/3' },
    ];
    const requested = [];
    const fetcher = async (url) => {
      requested.push(url);
      return postHtml;
    };
    const stats = await fillContents(items, { ...theqoo.content, maxFetch: 1, delay: 0 }, {}, tmp, fetcher);

    assert.deepStrictEqual(requested, ['https://theqoo.net/square/2']);
    assert.deepStrictEqual(stats, { cached: 1, fetched: 1, failed: 0, skipped: 1 });
    assert.strictEqual(items[0].content, '<p>캐시</p>');
    assert.ok(items[1].content.includes('aGucWN.jpg'));
    assert.strictEqual(items[2].content, undefined);
  });

  await runTest('RSS: description 포맷 유지 + content:encoded 추가', () => {
    const xml = generateRSS(
      [{ title: 't', link: POST_URL, date: NOW.toISOString(), category: '유머', views: 10, content: '<p>본문</p>' }],
      { filename: 'x.xml' },
      true
    );
    assert.ok(xml.includes('<description><![CDATA[[유머] · 조회 10]]></description>'));
    assert.ok(xml.includes('<content:encoded><![CDATA[<p>본문</p>]]></content:encoded>'));
  });

  console.log(`\n── 결과: ${passed}개 통과, ${failed}개 실패 ──\n`);
  process.exit(failed > 0 ? 1 : 0);
})();
