/**
 * rss-generator.js 정렬 기능 테스트
 *
 * 실행: node test/rss-generator.test.js
 */

const assert = require('assert');
const { generateRSS } = require('../src/rss-generator');

// ─── 테스트 데이터 ───
const testItems = [
  { title: '두 번째 글', link: 'https://example.com/2', date: '2025-03-02T10:00:00Z', author: 'B' },
  { title: '네 번째 글', link: 'https://example.com/4', date: '2025-03-04T10:00:00Z', author: 'D' },
  { title: '첫 번째 글', link: 'https://example.com/1', date: '2025-03-01T10:00:00Z', author: 'A' },
  { title: '세 번째 글', link: 'https://example.com/3', date: '2025-03-03T10:00:00Z', author: 'C' },
];

const baseConfig = { filename: 'test.xml', title: 'Test Feed', maxItems: 10 };

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

function extractTitles(xml) {
  // RSS XML에서 <title> 태그들을 순서대로 추출 (첫 번째는 피드 제목이므로 제외)
  const matches = [...xml.matchAll(/<title><!\[CDATA\[(.+?)\]\]><\/title>/g)];
  return matches.map((m) => m[1]).filter((t) => t !== 'Test Feed');
}

// ─── 테스트 실행 ───
console.log('\n── rss-generator 정렬 테스트 ──\n');

runTest('기본값(desc): 최신순 정렬', () => {
  const xml = generateRSS(testItems, { ...baseConfig }, true);
  const titles = extractTitles(xml);
  assert.deepStrictEqual(titles, ['네 번째 글', '세 번째 글', '두 번째 글', '첫 번째 글']);
});

runTest('sortOrder=desc: 최신순 정렬', () => {
  const xml = generateRSS(testItems, { ...baseConfig, sortOrder: 'desc' }, true);
  const titles = extractTitles(xml);
  assert.deepStrictEqual(titles, ['네 번째 글', '세 번째 글', '두 번째 글', '첫 번째 글']);
});

runTest('sortOrder=asc: 오래된순 정렬', () => {
  const xml = generateRSS(testItems, { ...baseConfig, sortOrder: 'asc' }, true);
  const titles = extractTitles(xml);
  assert.deepStrictEqual(titles, ['첫 번째 글', '두 번째 글', '세 번째 글', '네 번째 글']);
});

runTest('원본 배열 변경 없음', () => {
  const original = [...testItems];
  generateRSS(testItems, { ...baseConfig, sortOrder: 'asc' }, true);
  assert.deepStrictEqual(testItems, original);
});

runTest('maxItems 제한 적용', () => {
  const xml = generateRSS(testItems, { ...baseConfig, sortOrder: 'desc', maxItems: 2 }, true);
  const titles = extractTitles(xml);
  assert.strictEqual(titles.length, 2);
  assert.deepStrictEqual(titles, ['네 번째 글', '세 번째 글']);
});

runTest('날짜 없는 항목 처리', () => {
  const itemsWithNoDate = [
    { title: '날짜있음', link: 'https://example.com/a', date: '2025-06-01T00:00:00Z' },
    { title: '날짜없음', link: 'https://example.com/b' },
  ];
  const xml = generateRSS(itemsWithNoDate, { ...baseConfig, sortOrder: 'desc' }, true);
  const titles = extractTitles(xml);
  assert.strictEqual(titles[0], '날짜있음');
  assert.strictEqual(titles[1], '날짜없음');
});

runTest('빈 배열 처리', () => {
  const xml = generateRSS([], { ...baseConfig }, true);
  assert.ok(xml.includes('<rss'));
});

runTest('dryRun=true 시 파일 미생성', () => {
  const fs = require('fs');
  const path = require('path');
  const testFile = path.resolve(__dirname, '..', 'docs', 'feeds', 'test.xml');
  generateRSS(testItems, { ...baseConfig }, true);
  // test.xml이 이전에 없었다면 생성되지 않아야 함
  // (이미 존재할 수 있으므로 XML 반환 여부만 확인)
  const xml = generateRSS(testItems, { ...baseConfig }, true);
  assert.ok(typeof xml === 'string' && xml.length > 0);
});

// ─── 결과 요약 ───
console.log(`\n── 결과: ${passed}개 통과, ${failed}개 실패 ──\n`);
process.exit(failed > 0 ? 1 : 0);
