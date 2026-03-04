/**
 * FeedForge — 복합 필터 엔진
 *
 * 설정 기반으로 게시물 목록을 필터링합니다.
 * 모든 필터 조건은 선택적이며, 설정된 조건들은 AND로 결합됩니다.
 *
 * 지원 필터:
 *   - includeKeywords: 제목에 하나 이상 포함 시 통과 (OR)
 *   - excludeKeywords: 제목에 하나라도 포함 시 제외
 *   - minViews: 최소 조회수
 *   - minLikes: 최소 추천수
 */

/**
 * 게시물 목록을 필터 설정에 따라 필터링합니다.
 *
 * @param {Array} items - 게시물 배열 [{ title, link, date, views, likes, ... }]
 * @param {object} filters - 필터 설정
 * @returns {Array} 필터링된 게시물 배열
 */
function applyFilters(items, filters = {}) {
  if (!filters || Object.keys(filters).length === 0) {
    return items;
  }

  const {
    includeKeywords = [],
    excludeKeywords = [],
    minViews = 0,
    minLikes = 0,
  } = filters;

  return items.filter((item) => {
    const title = (item.title || '').toLowerCase();

    // includeKeywords — 하나 이상 포함해야 통과 (비어있으면 skip)
    if (includeKeywords.length > 0) {
      const hasInclude = includeKeywords.some((kw) =>
        title.includes(kw.toLowerCase())
      );
      if (!hasInclude) return false;
    }

    // excludeKeywords — 하나라도 포함하면 제외
    if (excludeKeywords.length > 0) {
      const hasExclude = excludeKeywords.some((kw) =>
        title.includes(kw.toLowerCase())
      );
      if (hasExclude) return false;
    }

    // minViews
    if (minViews > 0) {
      const views = typeof item.views === 'number' ? item.views : parseInt(item.views, 10) || 0;
      if (views < minViews) return false;
    }

    // minLikes
    if (minLikes > 0) {
      const likes = typeof item.likes === 'number' ? item.likes : parseInt(item.likes, 10) || 0;
      if (likes < minLikes) return false;
    }

    return true;
  });
}

/**
 * 필터링 결과 요약을 반환합니다.
 */
function filterSummary(beforeCount, afterCount, filters) {
  const parts = [];
  if (filters.includeKeywords?.length) {
    parts.push(`include=[${filters.includeKeywords.join(',')}]`);
  }
  if (filters.excludeKeywords?.length) {
    parts.push(`exclude=[${filters.excludeKeywords.join(',')}]`);
  }
  if (filters.minViews > 0) parts.push(`minViews=${filters.minViews}`);
  if (filters.minLikes > 0) parts.push(`minLikes=${filters.minLikes}`);

  const filterDesc = parts.length > 0 ? parts.join(', ') : '없음';
  return `${beforeCount}개 → ${afterCount}개 (필터: ${filterDesc})`;
}

module.exports = { applyFilters, filterSummary };
