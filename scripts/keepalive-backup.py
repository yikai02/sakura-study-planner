"""
🌸 小櫻讀書計劃表 - GitHub 雲端自動保活與備份服務腳本 (Python 版)
"""

import os
import sys
import json
import time
import urllib.request
import urllib.error

ROOM_ID = os.environ.get("ROOM_ID", "sakura-study-2026")
TOPIC = f"sakura_room_{urllib.parse.quote(ROOM_ID)}"
NTFY_URL = f"https://ntfy.sh/{TOPIC}"
BACKUP_DIR = os.path.join(os.path.dirname(__file__), "..", "data")
BACKUP_FILE = os.path.join(BACKUP_DIR, "backup-latest.json")

def main():
    print(f"[Keepalive] Polling snapshot from {NTFY_URL}/json?poll=1 ...")
    try:
        req = urllib.request.Request(f"{NTFY_URL}/json?poll=1", headers={"User-Agent": "Sakura-Keepalive/1.0"})
        with urllib.request.urlopen(req, timeout=15) as resp:
            text = resp.read().decode("utf-8")
        
        lines = text.strip().split("\n")
        latest_full = None

        for line in reversed(lines):
            if not line:
                continue
            try:
                item = json.loads(line)
                if item.get("event") == "message":
                    payload = None
                    if item.get("attachment") and item["attachment"].get("url"):
                        try:
                            att_req = urllib.request.Request(item["attachment"]["url"], headers={"User-Agent": "Sakura-Keepalive/1.0"})
                            with urllib.request.urlopen(att_req, timeout=8) as att_resp:
                                payload = json.loads(att_resp.read().decode("utf-8"))
                        except Exception as e:
                            print(f"[Keepalive] Attachment fetch notice: {e}", file=sys.stderr)
                    elif item.get("message"):
                        try:
                            payload = json.loads(item["message"])
                        except Exception:
                            pass

                    if payload and payload.get("type") == "FULL" and payload.get("compact"):
                        latest_full = payload
                        break
            except Exception:
                pass

        os.makedirs(BACKUP_DIR, exist_ok=True)

        if latest_full:
            # 🌸 關鍵自訂封面保護：若既有備份含有使用者上傳之封面，絕不被預設主題刷掉
            if os.path.exists(BACKUP_FILE):
                try:
                    with open(BACKUP_FILE, "r", encoding="utf-8") as exist_f:
                        exist_data = json.load(exist_f)
                    exist_compact = exist_data.get("compact", {})
                    new_compact = latest_full.get("compact", {})
                    exist_hc = exist_compact.get("hc", "")
                    new_hc = new_compact.get("hc", "")
                    if exist_hc and (exist_hc.startswith("data:") or exist_hc.startswith("url:")):
                        if not (new_hc and (new_hc.startswith("data:") or new_hc.startswith("url:"))):
                            new_compact["hc"] = exist_hc
                            new_compact["hcu"] = exist_compact.get("hcu", exist_compact.get("u", int(time.time() * 1000)))
                except Exception as e:
                    print(f"[Keepalive] Cover preserve notice: {e}", file=sys.stderr)

            print(f"[Keepalive] Found latest FULL snapshot from: {latest_full.get('senderName', 'user')} at {latest_full.get('ts')}")
            with open(BACKUP_FILE, "w", encoding="utf-8") as f:
                json.dump(latest_full, f, ensure_ascii=False, indent=2)
            print(f"[Keepalive] Successfully saved backup to {BACKUP_FILE}")
        else:
            print("[Keepalive] No FULL snapshot found in current poll window. Keeping existing backup if present.")

        # 發送雲端保活心跳訊號至 ntfy，刷新 12 小時快取
        print("[Keepalive] Sending heartbeat ping to keep ntfy room cache active...")
        ping_payload = {
            "type": "KEEPALIVE",
            "roomId": ROOM_ID,
            "senderId": "github-cloud-worker",
            "senderName": "雲端守護機器人 🌸",
            "ts": int(time.time() * 1000)
        }
        post_data = json.dumps(ping_payload).encode("utf-8")
        post_req = urllib.request.Request(NTFY_URL, data=post_data, headers={"Content-Type": "application/json"}, method="POST")
        with urllib.request.urlopen(post_req, timeout=10) as post_resp:
            print(f"[Keepalive] Heartbeat response code: {post_resp.status}")

    except Exception as err:
        print(f"[Keepalive] Execution warning: {err}", file=sys.stderr)

if __name__ == "__main__":
    main()
