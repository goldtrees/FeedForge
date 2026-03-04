/**
 * FeedForge — 범용 CSS 셀렉터 기반 스크래퍼 엔진
 *
 * feeds.yaml의 selectors 설정만으로 임의의 웹사이트 게시판을 스크래핑합니다.
 * 사이트별 전용 파서 코드 없이 설정 변경만으로 새 사이트를 추가할 수 있습니다.
 */

const axios = require('axios');
const cheerio = require('cheerio');
const iconv = require('iconv-lite');
const { extractField } = require('./extractors');

const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/**
 * 피드 설정에 따라 대상 URL을 스크래핑하고 게시물 목록을 반환합니다.
 * pagination 설정이 있으면 여러 페이지를 순회하며 수집합니다.
 *
 * @param {object} feedConfig - feeds.yaml의 단일 피드 설정
 * @param {object} globalConfig - feeds.yaml의 global 설정
 * @returns {Promise<Array<{title,link,date,author,views,likes,no}>>}
 */
async function scrape(feedConfig, globalConfig = {}) {
  const reqConfig = mergeRequestConfig(feedConfig.request, globalConfig.request);
  const pagination = feedConfig.pagination || null;

  let allItems = [];

  if (pagination && pagination.maxPages > 1) {
    // ─── 페이지네이션 모드 ───
    const maxPages = pagination.maxPages || 3;
    const paramName = pagination.param || 'page';
    const startPage = pagination.startPage ?? 1;
    const step = pagination.step ?? 1;
    const delay = pagination.delay ?? 1000;

    for (let i = 0; i < maxPages; i++) {
      const pageNum = startPage + i * step;
      const pageUrl = buildPageUrl(feedConfig.url, paramName, pageNum);
      console.log(`  페이지 ${i + 1}/${maxPages}: ${pageUrl}`);

      try {
        const html = await fetchPage(pageUrl, reqConfig);
        const items = parsePage(html, feedConfig.selectors);
        allItems = allItems.concat(items);
        console.log(`    → ${items.length}개 항목 수집`);
      } catch (err) {
        console.warn(`    ⚠ 페이지 ${pageNum} 실패: ${err.message}`);
        // stopOnError 설정 시 중단, 기본은 계속 진행
        if (pagination.stopOnError) break;
      }

      // 마지막 페이지가 아니면 딜레이
      if (i < maxPages - 1 && delay > 0) {
        await sleep(delay);
      }
    }
  } else {
    // ─── 단일 페이지 모드 ───
    const html = await fetchPage(feedConfig.url, reqConfig);
    allItems = parsePage(html, feedConfig.selectors);
  }

  // ─── 중복 제거 (link 기준) ───
  allItems = deduplicateItems(allItems);

  return allItems;
}

/**
 * 페이지네이션 URL을 생성합니다.
 * URL에 이미 쿼리 파라미터가 있으면 &로 추가, 없으면 ?로 추가합니다.
 */
function buildPageUrl(baseUrl, paramName, pageNum) {
  const url = new URL(baseUrl);
  url.searchParams.set(paramName, String(pageNum));
  return url.toString();
}

/**
 * link 기준으로 중복 항목을 제거합니다. 먼저 등장한 항목을 유지합니다.
 */
function deduplicateItems(items) {
  const seen = new Set();
  return items.filter((item) => {
    if (seen.has(item.link)) return false;
    seen.add(item.link);
    return true;
  });
}

/**
 * HTTP 요청으로 페이지 HTML을 가져옵니다.
 * 인코딩 변환, 재시도, 커스텀 헤더를 지원합니다.
 */
async function fetchPage(url, reqConfig) {
  const {
    encoding = 'utf-8',
    userAgent = DEFAULT_USER_AGENT,
    headers = {},
    timeout = 15000,
    retries = 3,
    retryDelay = 2000,
  } = reqConfig;

  const axiosConfig = {
    url,
    method: 'GET',
    timeout,
    headers: {
      'User-Agent': userAgent,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
      ...headers,
    },
    // 비UTF-8 인코딩 처리를 위해 arraybuffer로 받기
    responseType: encoding.toLowerCase() !== 'utf-8' ? 'arraybuffer' : 'text',
  };

  let lastError;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await axios(axiosConfig);

      // 인코딩 변환
      if (encoding.toLowerCase() !== 'utf-8') {
        return iconv.decode(Buffer.from(response.data), encoding);
      }
      return response.data;
    } catch (err) {
      lastError = err;
      const status = err.response?.status;
      console.warn(
        `  [${attempt}/${retries}] ${url} 요청 실패: ${err.message}${status ? ` (HTTP ${status})` : ''}`
      );
      if (attempt < retries) {
        await sleep(retryDelay * attempt);
      }
    }
  }

  throw new Error(`${url} 페이지 요청 실패 (${retries}회 재시도 후): ${lastError.message}`);
}

/**
 * HTML을 파싱하여 셀렉터 설정에 따라 게시물 목록을 추출합니다.
 */
function parsePage(html, selectors) {
  if (!selectors || !selectors.list) {
    throw new Error('selectors.list가 설정되지 않았습니다.');
  }

  const $ = cheerio.load(html);
  const rows = $(selectors.list);
  const items = [];

  rows.each((_, row) => {
    try {
      const title = extractField($, row, selectors.title);
      const link = extractField($, row, selectors.link);

      // 제목과 링크는 필수
      if (!title || !link) return;

      const item = {
        title,
        link,
        no: extractField($, row, selectors.no) || '',
        date: extractField($, row, selectors.date) || new Date().toISOString(),
        author: extractField($, row, selectors.author) || '',
        views: extractField($, row, selectors.views) || 0,
        likes: extractField($, row, selectors.likes) || 0,
      };

      items.push(item);
    } catch (err) {
      // 개별 행 파싱 실패 시 skip
      console.warn(`  행 파싱 실패: ${err.message}`);
    }
  });

  return items;
}

/**
 * 요청 설정을 병합합니다 (피드 설정 > 글로벌 설정).
 */
function mergeRequestConfig(feedReq = {}, globalReq = {}) {
  return {
    ...globalReq,
    ...feedReq,
    headers: {
      ...(globalReq.headers || {}),
      ...(feedReq.headers || {}),
    },
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = { scrape, fetchPage, parsePage, deduplicateItems, buildPageUrl };
