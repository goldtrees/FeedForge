#!/usr/bin/env node

/**
 * FeedForge — 메인 실행 스크립트
 *
 * config/feeds.yaml 설정을 읽어 각 피드별로:
 *   1. 대상 사이트 스크래핑
 *   2. 복합 필터 적용
 *   3. RSS XML 생성 및 저장
 *
 * 사용법:
 *   node src/index.js                 기본 실행
 *   node src/index.js --dry-run       파일 저장 없이 테스트
 *   node src/index.js --verbose       상세 로그 출력
 *   node src/index.js --validate      설정 파일 검증만
 *   node src/index.js --feed <name>   특정 피드만 실행
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { scrape } = require('./scraper-engine');
const { applyFilters, filterSummary } = require('./filter');
const { generateRSS, generateMeta } = require('./rss-generator');

// ─── CLI 옵션 파싱 ───
const args = process.argv.slice(2);
const OPTIONS = {
  dryRun: args.includes('--dry-run'),
  verbose: args.includes('--verbose'),
  validate: args.includes('--validate'),
  feed: args.includes('--feed') ? args[args.indexOf('--feed') + 1] : null,
};

// ─── 설정 로드 ───
function loadConfig() {
  const configPath = path.resolve(__dirname, '..', 'config', 'feeds.yaml');
  if (!fs.existsSync(configPath)) {
    throw new Error(`설정 파일을 찾을 수 없습니다: ${configPath}`);
  }
  const raw = fs.readFileSync(configPath, 'utf-8');
  return yaml.load(raw);
}

// ─── 설정 검증 ───
function validateConfig(config) {
  const errors = [];

  if (!config.feeds || !Array.isArray(config.feeds)) {
    errors.push('feeds 배열이 필요합니다.');
    return errors;
  }

  config.feeds.forEach((feed, i) => {
    const prefix = `feeds[${i}] (${feed.name || '이름없음'})`;
    if (!feed.name) errors.push(`${prefix}: name은 필수입니다.`);
    if (!feed.url) errors.push(`${prefix}: url은 필수입니다.`);
    if (!feed.selectors) {
      errors.push(`${prefix}: selectors는 필수입니다.`);
    } else {
      if (!feed.selectors.list) errors.push(`${prefix}: selectors.list는 필수입니다.`);
      if (!feed.selectors.title) errors.push(`${prefix}: selectors.title은 필수입니다.`);
      if (!feed.selectors.link) errors.push(`${prefix}: selectors.link는 필수입니다.`);
    }
    if (!feed.output?.filename) errors.push(`${prefix}: output.filename은 필수입니다.`);
  });

  return errors;
}

// ─── 단일 피드 처리 ───
async function processFeed(feedConfig, globalConfig) {
  const name = feedConfig.name;
  console.log(`\n── ${name} ──`);
  console.log(`  URL: ${feedConfig.url}`);

  // 1. 스크래핑
  const startTime = Date.now();
  const items = await scrape(feedConfig, globalConfig);
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`  스크래핑: ${items.length}개 항목 (${elapsed}s)`);

  if (OPTIONS.verbose && items.length > 0) {
    console.log(`  ── 첫 3개 항목 미리보기 ──`);
    items.slice(0, 3).forEach((item, i) => {
      console.log(`  [${i + 1}] ${item.postNumber ? `#${item.postNumber} ` : ''}${item.title}`);
      console.log(`      링크: ${item.link}`);
      console.log(`      조회: ${item.views} | 추천: ${item.likes} | 작성자: ${item.author}`);
    });
  }

  // 2. 필터링
  const filtered = applyFilters(items, feedConfig.filters);
  const summary = filterSummary(items.length, filtered.length, feedConfig.filters || {});
  console.log(`  필터링: ${summary}`);

  // 3. RSS 생성
  const globalMaxItems = globalConfig.output?.maxItems || 30;
  const outputConfig = {
    maxItems: globalMaxItems,
    ...feedConfig.output,
  };

  if (OPTIONS.dryRun) {
    const xml = generateRSS(filtered, outputConfig, true);
    console.log(`  [DRY-RUN] RSS 생성 완료 (${filtered.slice(0, outputConfig.maxItems).length}개 항목, 파일 미저장)`);
    if (OPTIONS.verbose) {
      console.log(`  ── RSS 미리보기 (처음 500자) ──`);
      console.log(xml.substring(0, 500));
    }
  } else {
    generateRSS(filtered, outputConfig, false);
  }

  return {
    name,
    filename: outputConfig.filename,
    itemCount: Math.min(filtered.length, outputConfig.maxItems),
    status: 'ok',
  };
}

// ─── 메인 실행 ───
async function main() {
  console.log('╔══════════════════════════════════════╗');
  console.log('║         FeedForge RSS Generator      ║');
  console.log('╚══════════════════════════════════════╝');
  console.log(`  시각: ${new Date().toISOString()}`);
  if (OPTIONS.dryRun) console.log('  모드: DRY-RUN (파일 저장 안함)');
  if (OPTIONS.verbose) console.log('  모드: VERBOSE');

  // 설정 로드
  const config = loadConfig();
  console.log(`  피드 수: ${config.feeds?.length || 0}개`);

  // 설정 검증
  const errors = validateConfig(config);
  if (errors.length > 0) {
    console.error('\n❌ 설정 오류:');
    errors.forEach((e) => console.error(`  - ${e}`));
    process.exit(1);
  }
  console.log('  설정 검증: ✓ 통과');

  if (OPTIONS.validate) {
    console.log('\n✓ 설정 파일 검증 완료. (--validate 모드)');
    return;
  }

  // 실행할 피드 필터링
  let feeds = config.feeds;
  if (OPTIONS.feed) {
    feeds = feeds.filter((f) => f.name === OPTIONS.feed);
    if (feeds.length === 0) {
      console.error(`\n❌ 피드 '${OPTIONS.feed}'를 찾을 수 없습니다.`);
      console.error(`  사용 가능: ${config.feeds.map((f) => f.name).join(', ')}`);
      process.exit(1);
    }
  }

  // 각 피드 순차 처리
  const results = [];
  for (const feedConfig of feeds) {
    try {
      const result = await processFeed(feedConfig, config.global || {});
      results.push(result);
    } catch (err) {
      console.error(`\n❌ [${feedConfig.name}] 실패: ${err.message}`);
      if (OPTIONS.verbose) console.error(err.stack);
      results.push({
        name: feedConfig.name,
        filename: feedConfig.output?.filename,
        itemCount: 0,
        status: 'error',
        error: err.message,
      });
    }
  }

  // 메타데이터 생성
  if (!OPTIONS.dryRun) {
    generateMeta(results);
  }

  // 결과 요약
  console.log('\n══════════════════════════════════════');
  console.log('  실행 결과 요약');
  console.log('──────────────────────────────────────');
  const okCount = results.filter((r) => r.status === 'ok').length;
  const errCount = results.filter((r) => r.status === 'error').length;
  results.forEach((r) => {
    const icon = r.status === 'ok' ? '✓' : '✗';
    console.log(`  ${icon} ${r.name}: ${r.itemCount}개 항목${r.error ? ` (오류: ${r.error})` : ''}`);
  });
  console.log(`\n  성공: ${okCount} / 실패: ${errCount} / 전체: ${results.length}`);
  console.log('══════════════════════════════════════\n');

  if (errCount > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('치명적 오류:', err.message);
  if (OPTIONS.verbose) console.error(err.stack);
  process.exit(1);
});
