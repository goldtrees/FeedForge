/**
 * FeedForge — 게시물 본문 수집기
 *
 * feeds.yaml의 content 설정이 있으면 각 게시물 상세 페이지에서 본문 HTML을 가져와
 * RSS의 <content:encoded>에 넣을 수 있도록 정리합니다.
 * RSS 리더가 원본 페이지를 다시 열지 않아도 이미지/동영상/임베드를 볼 수 있게 하는 것이 목적입니다.
 *
 * 요청 수를 줄이기 위해 직전에 생성된 피드 XML에 이미 본문이 있는 게시물은 재요청하지 않습니다.
 */

const fs = require('fs');
const cheerio = require('cheerio');
const { fetchPage } = require('./scraper-engine');

const REMOVE_SELECTORS = 'script, style, noscript, ins, form, button, input, textarea, select, link, meta';
const LAZY_SRC_ATTRS = ['data-src', 'data-original', 'data-lazy-src', 'data-url'];

/**
 * 게시물 목록에 본문(item.content)을 채웁니다.
 *
 * @param {Array} items - 게시물 배열 (RSS에 포함될 항목만 전달)
 * @param {object} contentConfig - { selector, maxFetch?, delay? }
 * @param {object} reqConfig - 요청 설정 (fetchPage에 그대로 전달)
 * @param {string} [previousXmlPath] - 직전 피드 XML 경로 (본문 캐시)
 * @param {Function} [fetcher] - 테스트용 fetch 함수 (기본: fetchPage)
 * @returns {Promise<{cached:number, fetched:number, failed:number, skipped:number}>}
 */
async function fillContents(items, contentConfig, reqConfig, previousXmlPath, fetcher = fetchPage) {
  const { selector, maxFetch = 30, delay = 300 } = contentConfig;
  const cache = loadContentCache(previousXmlPath);
  const stats = { cached: 0, fetched: 0, failed: 0, skipped: 0 };

  for (const item of items) {
    if (cache.has(item.link)) {
      item.content = cache.get(item.link);
      stats.cached++;
      continue;
    }
    if (stats.fetched + stats.failed >= maxFetch) {
      // 이번 실행에서 못 가져온 항목은 다음 실행에서 수집
      stats.skipped++;
      continue;
    }

    try {
      const html = await fetcher(item.link, { ...reqConfig, retries: 1 });
      const content = extractContent(html, selector, item.link);
      if (content) item.content = content;
      stats.fetched++;
    } catch (err) {
      console.warn(`    ⚠ 본문 수집 실패: ${item.link} (${err.message})`);
      stats.failed++;
    }

    if (delay > 0) await sleep(delay);
  }

  return stats;
}

/**
 * 상세 페이지 HTML에서 본문을 추출하고 RSS 리더용으로 정리합니다.
 *
 * @returns {string|null} 정리된 본문 HTML
 */
function extractContent(html, selector, pageUrl) {
  const $ = cheerio.load(html);
  const body = $(selector).first();
  if (!body.length) return null;

  body.find(REMOVE_SELECTORS).remove();

  // 이미지: 지연 로딩 속성 → src, 절대 URL, Referer 미전송
  // (더쿠 이미지 CDN은 외부 Referer에 403을 반환, Referer가 없으면 200)
  body.find('img').each((_, el) => {
    const img = $(el);
    const lazy = LAZY_SRC_ATTRS.map((a) => img.attr(a)).find(Boolean);
    const src = absoluteUrl(lazy || img.attr('src'), pageUrl);
    if (!src || src.startsWith('data:')) {
      img.remove();
      return;
    }
    const alt = img.attr('alt') || '';
    el.attribs = { src, alt, referrerpolicy: 'no-referrer' };
  });

  // 동영상: 절대 URL + 컨트롤 표시
  body.find('video, video source').each((_, el) => {
    const node = $(el);
    for (const attr of ['src', 'poster']) {
      const value = node.attr(attr) || (attr === 'src' ? LAZY_SRC_ATTRS.map((a) => node.attr(a)).find(Boolean) : null);
      if (value) node.attr(attr, absoluteUrl(value, pageUrl));
    }
    if (el.name === 'video') node.attr('controls', '').removeAttr('autoplay');
  });

  // iframe(유튜브 등): 리더 앱에서 제거되는 경우가 많으므로 링크로 대체
  body.find('iframe').each((_, el) => {
    const iframe = $(el);
    const src = absoluteUrl(iframe.attr('src') || iframe.attr('data-src'), pageUrl);
    if (!src) {
      iframe.remove();
      return;
    }
    iframe.replaceWith(embedLink(src));
  });

  // 인스타그램/X(트위터) 임베드: 스크립트 없이도 보이도록 원본 링크 추가
  body.find('blockquote.instagram-media, blockquote.twitter-tweet, blockquote.twitter-video').each((_, el) => {
    const quote = $(el);
    const permalink =
      quote.attr('data-instgrm-permalink') ||
      quote.find('a[href*="instagram.com"], a[href*="twitter.com"], a[href*="x.com"]').last().attr('href');
    if (permalink) {
      const label = quote.hasClass('instagram-media') ? '인스타그램에서 보기' : 'X(트위터)에서 보기';
      quote.after(`<p><a href="${escapeAttr(absoluteUrl(permalink, pageUrl))}">${label}</a></p>`);
    }
  });

  // 링크: 절대 URL
  body.find('a[href]').each((_, el) => {
    const a = $(el);
    const href = absoluteUrl(a.attr('href'), pageUrl);
    if (href) a.attr('href', href);
  });

  // 이벤트 핸들러/인라인 스타일 제거
  body.find('*').each((_, el) => {
    for (const name of Object.keys(el.attribs || {})) {
      if (name.startsWith('on') || name === 'style' || name === 'class' || name === 'id') {
        delete el.attribs[name];
      }
    }
  });

  const result = (body.html() || '').trim();
  return result || null;
}

/**
 * iframe src를 링크 HTML로 변환합니다. 유튜브는 썸네일을 함께 표시합니다.
 */
function embedLink(src) {
  const youtubeId = matchYoutubeId(src);
  if (youtubeId) {
    const watchUrl = `https://www.youtube.com/watch?v=${youtubeId}`;
    const thumb = `https://img.youtube.com/vi/${youtubeId}/hqdefault.jpg`;
    return `<p><a href="${watchUrl}"><img src="${thumb}" alt="YouTube 동영상" referrerpolicy="no-referrer"><br>▶ YouTube에서 보기</a></p>`;
  }
  return `<p><a href="${escapeAttr(src)}">▶ 임베드 콘텐츠 보기</a></p>`;
}

function matchYoutubeId(src) {
  const m = src.match(/(?:youtube(?:-nocookie)?\.com\/(?:embed|shorts)\/|youtu\.be\/|youtube\.com\/watch\?v=)([\w-]{11})/);
  return m ? m[1] : null;
}

/**
 * 직전 피드 XML에서 link → 본문 매핑을 읽어옵니다.
 */
function loadContentCache(xmlPath) {
  const cache = new Map();
  if (!xmlPath || !fs.existsSync(xmlPath)) return cache;
  try {
    const $ = cheerio.load(fs.readFileSync(xmlPath, 'utf-8'), { xmlMode: true });
    $('item').each((_, el) => {
      const link = $(el).find('link').first().text().trim();
      const content = $(el).find('content\\:encoded').first().text().trim();
      if (link && content) cache.set(link, content);
    });
  } catch (err) {
    console.warn(`  ⚠ 본문 캐시 로드 실패: ${err.message}`);
  }
  return cache;
}

function absoluteUrl(href, base) {
  if (!href) return null;
  href = href.trim();
  if (/^javascript:/i.test(href)) return null;
  if (href.startsWith('data:')) return href;
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}

function escapeAttr(value) {
  return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = { fillContents, extractContent, loadContentCache };
