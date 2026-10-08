/**
 * scraper-engine.js 링크 정규화 테스트
 *
 * 실행: node test/scraper-engine.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { parsePage } = require('../src/scraper-engine');

const config = yaml.load(
  fs.readFileSync(path.resolve(__dirname, '..', 'config', 'feeds.yaml'), 'utf-8')
);
const clienSelectors = config.feeds.find((f) => f.name === 'clien-all').selectors;

// 클리앙 목록 행 (같은 글이 다른 페이지(po)에서 수집된 경우)
function clienRow(href) {
  return `
    <div class="list_item">
      <div class="list_number"><span class="no">19274889</span></div>
      <a class="list_subject" href="${href}"><span class="subject_fixed">테스트 글</span></a>
      <span class="nickname">작성자</span>
      <span class="hit">218</span>
      <span class="timestamp">2026-10-08 19:11:26</span>
    </div>`;
}

let passed = 0;
let failed = 0;

function runTest(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    failed++;
  }
}

// ─── 테스트 실행 ───
console.log('\n── scraper-engine 링크 정규화 테스트 ──\n');

runTest('클리앙: 목록 파라미터 제거된 고정 링크', () => {
  const html = clienRow('/service/board/park/19274889?od=T31&po=0&category=0&groupCd=clien_all');
  const [item] = parsePage(html, clienSelectors);
  assert.strictEqual(item.link, 'https://www.clien.net/service/board/park/19274889');
});

runTest('클리앙: 페이지(po)가 달라도 같은 링크', () => {
  const links = [0, 1, 3].map((po) => {
    const html = clienRow(`/service/board/park/19274889?od=T31&po=${po}&category=0&groupCd=clien_all`);
    return parsePage(html, clienSelectors)[0].link;
  });
  assert.strictEqual(new Set(links).size, 1);
});

runTest('클리앙: 나머지 필드 추출 유지', () => {
  const html = clienRow('/service/board/park/19274889?od=T31&po=2&category=0&groupCd=clien_all');
  const [item] = parsePage(html, clienSelectors);
  assert.strictEqual(item.title, '테스트 글');
  assert.strictEqual(item.author, '작성자');
  assert.strictEqual(item.views, 218);
});

// ─── 결과 요약 ───
console.log(`\n── 결과: ${passed}개 통과, ${failed}개 실패 ──\n`);
process.exit(failed > 0 ? 1 : 0);
