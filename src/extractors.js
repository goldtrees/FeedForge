/**
 * FeedForge — 추출 유틸리티 모듈
 *
 * YAML 설정의 `extract` 필드 타입에 따라 cheerio 엘리먼트에서 값을 추출합니다.
 * 지원 타입: text, attr:<name>, number, regex:<pattern>, html
 */

const dayjs = require('dayjs');
const customParseFormat = require('dayjs/plugin/customParseFormat');
dayjs.extend(customParseFormat);

/**
 * 엘리먼트에서 지정된 방식으로 값을 추출합니다.
 *
 * @param {import('cheerio').CheerioAPI} $ - cheerio 인스턴스
 * @param {import('cheerio').Cheerio} context - 검색할 부모 엘리먼트
 * @param {object} fieldConfig - 필드 설정 { selector, extract, baseUrl?, format? }
 * @returns {string|number|null} 추출된 값
 */
function extractField($, context, fieldConfig) {
  if (!fieldConfig || !fieldConfig.selector) return null;

  const el = $(context).find(fieldConfig.selector).first();
  if (!el.length) return null;

  const extractType = fieldConfig.extract || 'text';
  let value = applyExtract($, el, extractType);

  // 후처리
  if (value === null || value === undefined) return null;

  // baseUrl — 상대 URL을 절대 URL로 변환
  if (fieldConfig.baseUrl && typeof value === 'string') {
    value = resolveUrl(value, fieldConfig.baseUrl);
  }

  // format — 날짜 파싱
  if (fieldConfig.format && typeof value === 'string') {
    value = parseDate(value, fieldConfig.format);
  }

  return value;
}

/**
 * extract 타입에 따라 실제 추출 수행
 */
function applyExtract($, el, extractType) {
  // text — 텍스트 콘텐츠
  if (extractType === 'text') {
    return $(el).text().trim();
  }

  // attr:<name> — 속성값
  if (extractType.startsWith('attr:')) {
    const attrName = extractType.slice(5);
    return $(el).attr(attrName) || null;
  }

  // number — 텍스트에서 숫자만 추출
  if (extractType === 'number') {
    const text = $(el).text().trim();
    return parseNumber(text);
  }

  // regex:<pattern> — 정규식 매치 후 첫 캡처 그룹
  if (extractType.startsWith('regex:')) {
    const pattern = extractType.slice(6);
    const text = $(el).text().trim();
    return applyRegex(text, pattern);
  }

  // html — innerHTML
  if (extractType === 'html') {
    return $(el).html();
  }

  // fallback
  return $(el).text().trim();
}

/**
 * 텍스트에서 숫자를 추출합니다.
 * "조회 1,234회" → 1234
 * "12.5K" → 12500
 */
function parseNumber(text) {
  if (!text) return 0;

  // K/M/B 접미사 처리
  const suffixMatch = text.match(/([\d,.]+)\s*([KkMmBb])/);
  if (suffixMatch) {
    const num = parseFloat(suffixMatch[1].replace(/,/g, ''));
    const suffix = suffixMatch[2].toUpperCase();
    const multipliers = { K: 1000, M: 1000000, B: 1000000000 };
    return Math.round(num * (multipliers[suffix] || 1));
  }

  // 일반 숫자 추출 (콤마, 공백 제거)
  const cleaned = text.replace(/[^\d.-]/g, '');
  const num = parseInt(cleaned, 10);
  return isNaN(num) ? 0 : num;
}

/**
 * 정규식을 적용하여 첫 캡처 그룹을 반환합니다.
 */
function applyRegex(text, pattern) {
  try {
    const regex = new RegExp(pattern);
    const match = text.match(regex);
    return match ? (match[1] || match[0]) : null;
  } catch {
    return null;
  }
}

/**
 * 상대 URL을 baseUrl 기준으로 절대 URL로 변환합니다.
 */
function resolveUrl(href, baseUrl) {
  if (!href) return null;
  href = href.trim();

  // 이미 절대 URL인 경우
  if (href.startsWith('http://') || href.startsWith('https://')) {
    return href;
  }

  // 프로토콜 상대 URL
  if (href.startsWith('//')) {
    return 'https:' + href;
  }

  // 상대 URL
  const base = baseUrl.replace(/\/+$/, '');
  const path = href.startsWith('/') ? href : '/' + href;
  return base + path;
}

/**
 * 날짜 문자열을 파싱합니다.
 * format이 주어지면 dayjs로 파싱, 아니면 Date.parse 시도.
 */
function parseDate(text, format) {
  if (!text) return null;
  text = text.trim();

  // "n분 전", "n시간 전" 등 상대 시간 처리
  const relativeMatch = text.match(/(\d+)\s*(초|분|시간|일|주|개월|달)\s*전/);
  if (relativeMatch) {
    const amount = parseInt(relativeMatch[1], 10);
    const unit = relativeMatch[2];
    const unitMap = {
      '초': 'second',
      '분': 'minute',
      '시간': 'hour',
      '일': 'day',
      '주': 'week',
      '개월': 'month',
      '달': 'month',
    };
    return dayjs().subtract(amount, unitMap[unit] || 'minute').toISOString();
  }

  // 포맷으로 파싱 시도
  if (format) {
    const parsed = dayjs(text, format);
    if (parsed.isValid()) {
      return parsed.toISOString();
    }
  }

  // 일반 Date.parse
  const ts = Date.parse(text);
  if (!isNaN(ts)) {
    return new Date(ts).toISOString();
  }

  return null;
}

module.exports = { extractField, parseNumber, resolveUrl, parseDate };
