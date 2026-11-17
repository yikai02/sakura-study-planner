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
            # 🌸 關鍵自訂封面與擴充資料（里程碑 ms、備忘錄 sn、額外任務 et）防覆蓋保護
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
                            new_compact["hcf"] = exist_compact.get("hcf", "contain")
                            new_compact["hcp"] = exist_compact.get("hcp", "center")

                    # 保留較新的 Notion 總部連結設定 (nhu / nhuu)
                    exist_nhu = exist_compact.get("nhu", "")
                    exist_nhuu = exist_compact.get("nhuu") or 0
                    new_nhuu = new_compact.get("nhuu") or 0
                    if ("nhu" in exist_compact or exist_nhuu) and (
                        ("nhu" not in new_compact and not new_nhuu) or exist_nhuu > new_nhuu
                    ):
                        new_compact["nhu"] = exist_nhu
                        if exist_nhuu:
                            new_compact["nhuu"] = exist_nhuu

                    # 合併陣列型擴充資料 (ms: milestones, sn: studyNotes)，依 id 與 updatedAt 保留最新狀態
                    for list_key in ("ms", "sn"):
                        exist_list = exist_compact.get(list_key)
                        new_list = new_compact.get(list_key)
                        if isinstance(exist_list, list) and len(exist_list) > 0:
                            if not isinstance(new_list, list) or len(new_list) == 0:
                                new_compact[list_key] = exist_list
                            else:
                                merged_map = {}
                                for item in exist_list:
                                    if isinstance(item, dict) and item.get("id"):
                                        merged_map[item["id"]] = item
                                for item in new_list:
                                    if isinstance(item, dict) and item.get("id"):
                                        item_id = item["id"]
                                        prev = merged_map.get(item_id)
                                        if not prev or (item.get("updatedAt") or 0) >= (prev.get("updatedAt") or 0):
                                            merged_map[item_id] = item
                                new_compact[list_key] = list(merged_map.values())

                    # 合併單日額外待辦 (et) 與每日行程狀態標籤 (tg / tgu)
                    for dict_key in ("d", "ex"):
                        exist_days = exist_compact.get(dict_key)
                        new_days = new_compact.get(dict_key)
                        if isinstance(exist_days, dict) and isinstance(new_days, dict):
                            for d_key, exist_day in exist_days.items():
                                if not isinstance(exist_day, dict):
                                    continue
                                exist_tg = exist_day.get("tg")
                                exist_tgu = exist_day.get("tgu") or 0
                                if exist_tg is not None or exist_tgu:
                                    target_day = new_days.setdefault(d_key, {})
                                    new_tgu = target_day.get("tgu") or 0
                                    if "tg" not in target_day and not new_tgu:
                                        if isinstance(exist_tg, str):
                                            target_day["tg"] = exist_tg
                                        if exist_tgu:
                                            target_day["tgu"] = exist_tgu
                                    elif exist_tgu > new_tgu:
                                        if isinstance(exist_tg, str):
                                            target_day["tg"] = exist_tg
                                        target_day["tgu"] = exist_tgu
                                exist_et = exist_day.get("et")
                                if isinstance(exist_et, list) and len(exist_et) > 0:
                                    target_day = new_days.setdefault(d_key, {})
                                    new_et = target_day.get("et")
                                    if not isinstance(new_et, list) or len(new_et) == 0:
                                        target_day["et"] = exist_et
                                    else:
                                        et_map = {t["id"]: t for t in exist_et if isinstance(t, dict) and t.get("id")}
                                        for t in new_et:
                                            if isinstance(t, dict) and t.get("id"):
                                                prev_t = et_map.get(t["id"])
                                                if not prev_t or (t.get("updatedAt") or 0) >= (prev_t.get("updatedAt") or 0):
                                                    et_map[t["id"]] = t
                                        target_day["et"] = list(et_map.values())
                except Exception as e:
                    print(f"[Keepalive] Cover/data preserve notice: {e}", file=sys.stderr)

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
