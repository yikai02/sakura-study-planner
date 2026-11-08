/**
 * 🌸 小櫻讀書計劃表 - GitHub 雲端自動保活與備份服務腳本
 * 
 * 作用：
 * 1. 即使所有裝置電腦、手機關閉超過 12 小時，此腳本每 6 小時在 GitHub 雲端自動執行一次
 * 2. 抓取 ntfy.sh 房間最新進度，儲存至 data/backup-latest.json 永久備份
 * 3. 補發保活封包至 ntfy.sh，讓房號 sakura-study-2026 永遠在線不超時！
 */

const fs = require('fs');
const path = require('path');

const ROOM_ID = process.env.ROOM_ID || 'sakura-study-2026';
const TOPIC = `sakura_room_${encodeURIComponent(ROOM_ID)}`;
const NTFY_URL = `https://ntfy.sh/${TOPIC}`;
const BACKUP_DIR = path.join(__dirname, '..', 'data');
const BACKUP_FILE = path.join(BACKUP_DIR, 'backup-latest.json');

async function run() {
  console.log(`[Keepalive] Polling snapshot from ${NTFY_URL}/json?poll=1 ...`);
  try {
    const res = await fetch(`${NTFY_URL}/json?poll=1`);
    if (!res.ok) {
      console.warn(`[Keepalive] Polling returned status ${res.status}`);
      return;
    }

    const text = await res.text();
    const lines = text.trim().split('\n');
    let latestFull = null;

    for (let i = lines.length - 1; i >= 0; i--) {
      if (!lines[i]) continue;
      try {
        const item = JSON.parse(lines[i]);
        if (item.event === 'message') {
          let payload = null;
          if (item.attachment && item.attachment.url) {
            try {
              const attRes = await fetch(item.attachment.url);
              if (attRes.ok) {
                payload = await attRes.json();
              }
            } catch (attErr) {}
          } else if (item.message) {
            try {
              payload = JSON.parse(item.message);
            } catch (jsonErr) {}
          }

          if (payload && payload.type === 'FULL' && payload.compact) {
            latestFull = payload;
            break;
          }
        }
      } catch (e) {}
    }

    if (!fs.existsSync(BACKUP_DIR)) {
      fs.mkdirSync(BACKUP_DIR, { recursive: true });
    }

    if (latestFull) {
      // 🌸 關鍵自訂封面保護：若既有備份含有使用者上傳之封面，絕不被預設主題刷掉
      if (fs.existsSync(BACKUP_FILE)) {
        try {
          const existData = JSON.parse(fs.readFileSync(BACKUP_FILE, 'utf-8'));
          const existCompact = existData.compact || {};
          const newCompact = latestFull.compact || {};
          const existHc = existCompact.hc || '';
          const newHc = newCompact.hc || '';
          if (existHc && (existHc.startsWith('data:') || existHc.startsWith('url:'))) {
            if (!(newHc && (newHc.startsWith('data:') || newHc.startsWith('url:')))) {
              newCompact.hc = existHc;
              newCompact.hcu = existCompact.hcu || existCompact.u || Date.now();
              newCompact.hcf = existCompact.hcf || 'contain';
              newCompact.hcp = existCompact.hcp || 'center';
            }
          }
        } catch (e) {
          console.warn('[Keepalive] Cover preserve notice:', e);
        }
      }

      console.log(`[Keepalive] Found latest FULL snapshot from sender: ${latestFull.senderName || 'user'} at ${new Date(latestFull.ts).toISOString()}`);
      fs.writeFileSync(BACKUP_FILE, JSON.stringify(latestFull, null, 2), 'utf-8');
      console.log(`[Keepalive] Successfully saved backup to ${BACKUP_FILE}`);
    } else {
      console.log('[Keepalive] No FULL snapshot found in current poll window. Keeping existing backup if present.');
    }

    // 發送雲端保活與心跳訊號至 ntfy，刷新 12 小時過期時間
    console.log('[Keepalive] Sending heartbeat ping to keep ntfy room cache active...');
    await fetch(NTFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'KEEPALIVE',
        roomId: ROOM_ID,
        senderId: 'github-cloud-worker',
        senderName: '雲端守護機器人 🌸',
        ts: Date.now()
      })
    });
    console.log('[Keepalive] Heartbeat sent successfully!');

  } catch (err) {
    console.error('[Keepalive] Error during execution:', err);
    process.exit(1);
  }
}

run();
