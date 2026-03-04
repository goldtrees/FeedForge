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
 *
 * @param {object} feedConfig - feeds.yaml의 단일 피드 설정
 * @param {object} globalConfig - feeds.yaml의 global 설정
 * @returns {Promise<Array<{title,link,date,author,views,likes}>>}
 */
async function scrape(feedConfig, globalConfig = {}) {
  const reqConfig = mergeRequestConfig(feedConfig.request, globalConfig.request);
  const html = await fetchPage(feedConfig.url, reqConfig);
  const items = parsePage(html, feedConfig.selectors);
  return items;
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

module.exports = { scrape, fetchPage, parsePage };
