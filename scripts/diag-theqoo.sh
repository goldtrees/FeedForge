#!/usr/bin/env bash
# 임시 진단: theqoo 403 원인 파악
UA_OLD='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
UA_NEW='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36'
probe() {
  local label="$1"; shift
  echo "=================== $label"
  curl -sS -o /tmp/body.html -D /tmp/hdr.txt -w 'HTTP %{http_code} | %{size_download}B | http%{http_version}\n' "$@"
  grep -iE '^(server|cf-|content-type|location|set-cookie|x-|retry-after|via)' /tmp/hdr.txt | cut -c1-160
  echo "--- body head:"; head -c 600 /tmp/body.html | tr '\n' ' '; echo
  echo "--- list rows: $(grep -c 'class="no"' /tmp/body.html)  theqoo_board: $(grep -c 'theqoo_board' /tmp/body.html)"
}
echo "runner IP: $(curl -s https://api.ipify.org)"
probe "A old UA, axios-like headers" -A "$UA_OLD" -H 'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' -H 'Accept-Language: ko-KR,ko;q=0.9' 'https://theqoo.net/square?page=1'
probe "B no UA (curl default)" 'https://theqoo.net/square'
probe "C new UA + full browser headers" --compressed -A "$UA_NEW" \
  -H 'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8' \
  -H 'Accept-Language: ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7' \
  -H 'sec-ch-ua: "Chromium";v="142", "Google Chrome";v="142", "Not_A Brand";v="99"' -H 'sec-ch-ua-mobile: ?0' -H 'sec-ch-ua-platform: "Windows"' \
  -H 'Sec-Fetch-Dest: document' -H 'Sec-Fetch-Mode: navigate' -H 'Sec-Fetch-Site: none' -H 'Sec-Fetch-User: ?1' -H 'Upgrade-Insecure-Requests: 1' \
  'https://theqoo.net/square'
probe "D root page" -A "$UA_NEW" 'https://theqoo.net/'
probe "E mobile UA" -A 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' 'https://theqoo.net/square'
probe "F RSS act=rss" -A "$UA_NEW" 'https://theqoo.net/index.php?mid=square&act=rss'
probe "G /square/rss" -A "$UA_NEW" 'https://theqoo.net/square/rss'
probe "H bot UA (Feedfetcher)" -A 'Feedly/1.0 (+http://www.feedly.com/fetcher.html; like FeedFetcher-Google)' 'https://theqoo.net/index.php?mid=square&act=rss'
probe "I robots.txt" -A "$UA_NEW" 'https://theqoo.net/robots.txt'
echo "=== robots body"; head -c 1500 /tmp/body.html
