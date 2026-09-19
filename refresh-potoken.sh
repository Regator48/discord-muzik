#!/bin/bash
set -e

DISPLAY_NUM=98
COOKIE_JAR="/tmp/potoken-cookies.txt"

# Start Xvfb
Xvfb :$DISPLAY_NUM -screen 0 1280x720x24 &>/dev/null &
XVFB_PID=$!
sleep 1

# Start Chrome
google-chrome-stable \
  --no-sandbox --disable-gpu --headless=new \
  --remote-debugging-port=9223 \
  --disable-dev-shm-usage \
  --no-first-run --no-default-browser-check \
  --disable-blink-features=AutomationControlled \
  --user-data-dir=/tmp/potoken-chrome-refresh \
  --display=:$DISPLAY_NUM \
  "about:blank" &>/dev/null &
CHROME_PID=$!
sleep 3

# Extract tokens
RESULT=$(timeout 45 node -e "
const { chromium } = require('playwright-core');
(async () => {
  const browser = await chromium.connectOverCDP('http://localhost:9223');
  const page = browser.contexts()[0].pages()[0];
  
  let poToken = null;
  page.on('request', (req) => {
    if (req.url().includes('/youtubei/') && !poToken) {
      try {
        const data = req.postData();
        if (data) {
          const m = data.match(/\"poToken\"\s*:\s*\"([^\"]+)\"/);
          if (m) poToken = m[1];
        }
      } catch {}
    }
  });
  
  await page.goto('https://www.youtube.com/watch?v=jNQXAC9IVRw', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(10000);
  
  const visitorData = await page.evaluate(() => window.ytcfg?.get('VISITOR_DATA'));
  
  if (poToken && visitorData) {
    console.log(JSON.stringify({ poToken, visitorData }));
  }
  
  browser.close();
  process.exit(0);
})();
" 2>/dev/null)

# Kill Chrome and Xvfb
kill $CHROME_PID 2>/dev/null
kill $XVFB_PID 2>/dev/null
rm -rf /tmp/potoken-chrome-refresh

if [ -n "$RESULT" ]; then
  PO_TOKEN=$(echo "$RESULT" | python3 -c "import json,sys; print(json.load(sys.stdin)['poToken'])")
  VISITOR_DATA=$(echo "$RESULT" | python3 -c "import json,sys; print(json.load(sys.stdin)['visitorData'])")
  
  # Update application.yml
  sed -i "s/^    potoken:.*/    potoken: \"$PO_TOKEN\"/" /home/regator47/discord-bot/lavalink/application.yml
  sed -i "s/^    visitorData:.*/    visitorData: \"$VISITOR_DATA\"/" /home/regator47/discord-bot/lavalink/application.yml
  
  # Restart lavalink
  docker restart lavalink
  echo "[$(date)] PO token refreshed successfully"
else
  echo "[$(date)] PO token refresh FAILED" >&2
fi
