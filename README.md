# 🔥 FeedForge

**Config-driven RSS feed generator** — 웹사이트 게시물 목록을 RSS로 변환하는 서비스

코드 변경 없이 YAML 설정만으로 새 사이트를 추가할 수 있습니다.  
GitHub Actions가 주기적으로 스크래핑하고, GitHub Pages로 RSS XML을 서빙합니다.

## 구조

```
FeedForge/
├── .github/workflows/generate-rss.yml   ← Actions 스케줄 워크플로우
├── src/
│   ├── index.js                         ← 메인 실행
│   ├── scraper-engine.js                ← 범용 CSS 셀렉터 스크래퍼
│   ├── extractors.js                    ← 추출 유틸 (text, attr, number, regex)
│   ├── filter.js                        ← 복합 필터 엔진
│   └── rss-generator.js                 ← RSS XML 생성
├── config/feeds.yaml                    ← 피드 설정 (여기만 수정!)
├── docs/
│   ├── index.html                       ← 대시보드
│   └── feeds/*.xml                      ← 생성된 RSS 파일
└── package.json
```

## 빠른 시작

```bash
# 1. 의존성 설치
npm install

# 2. 설정 검증
npm run validate

# 3. 로컬 테스트 (파일 저장 없이)
npm run dry-run

# 4. RSS 생성
npm run generate
```

## 새 사이트 추가하기

**코드 변경 불필요!** `config/feeds.yaml`에 설정만 추가하세요.

### 1단계: CSS 셀렉터 확인

브라우저에서 대상 사이트의 개발자도구(F12)를 열고 게시판 HTML 구조를 확인합니다.

### 2단계: feeds.yaml에 피드 추가

```yaml
feeds:
  - name: "my-new-site"
    url: "https://example.com/board"
    selectors:
      list: ".post-list .post-item"      # 게시물 행 셀렉터
      title:
        selector: ".post-title a"
        extract: "text"
      link:
        selector: ".post-title a"
        extract: "attr:href"
        baseUrl: "https://example.com"
      views:
        selector: ".view-count"
        extract: "number"
    filters:
      includeKeywords: ["관심키워드"]
      minViews: 100
    output:
      filename: "my-new-site.xml"
      title: "내 피드"
```

### 3단계: 테스트 후 Push

```bash
# 새 피드만 테스트
node src/index.js --feed my-new-site --dry-run --verbose

# 정상이면 push → Actions 자동 실행
git add . && git commit -m "feat: add my-new-site feed" && git push
```

## 설정 레퍼런스

### extract 타입

| 타입 | 설명 | 예시 |
|------|------|------|
| `text` | 텍스트 콘텐츠 | `"제목입니다"` |
| `attr:href` | HTML 속성값 | `"/board/123"` |
| `number` | 숫자 추출 | `"조회 1,234"` → `1234` |
| `regex:패턴` | 정규식 캡처 | 첫 번째 캡처 그룹 |
| `html` | innerHTML | HTML 문자열 |

### 필드 옵션

| 옵션 | 설명 |
|------|------|
| `selector` | CSS 셀렉터 |
| `extract` | 추출 타입 (기본: `text`) |
| `baseUrl` | 상대 URL → 절대 URL 변환 시 기준 URL |
| `format` | 날짜 파싱 포맷 (Day.js 형식, 예: `YYYY.MM.DD HH:mm`) |

### 필터 옵션

| 옵션 | 설명 |
|------|------|
| `includeKeywords` | 제목에 하나 이상 포함 시 통과 (OR) |
| `excludeKeywords` | 제목에 하나라도 포함 시 제외 |
| `minViews` | 최소 조회수 |
| `minLikes` | 최소 추천수 |

### 요청 옵션

| 옵션 | 기본값 | 설명 |
|------|--------|------|
| `encoding` | `utf-8` | 페이지 인코딩 (`euc-kr` 등) |
| `userAgent` | Chrome UA | User-Agent 헤더 |
| `headers` | `{}` | 추가 HTTP 헤더 |
| `timeout` | `15000` | 요청 타임아웃 (ms) |
| `retries` | `3` | 재시도 횟수 |

## CLI 옵션

| 옵션 | 설명 |
|------|------|
| `--dry-run` | 파일 저장 없이 테스트 |
| `--verbose` | 상세 로그 + 미리보기 |
| `--validate` | 설정 파일 검증만 |
| `--feed <name>` | 특정 피드만 실행 |

## GitHub Pages 설정

1. 리포 Settings → Pages
2. Source: **Deploy from a branch**
3. Branch: `main`, Folder: `/docs`
4. RSS URL: `https://<username>.github.io/FeedForge/feeds/<filename>.xml`

## 라이선스

MIT
