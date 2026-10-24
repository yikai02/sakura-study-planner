/**
 * 小櫻讀書計劃表 🌸 YPT 計時模式 × Numbers 讀書計劃與統計儀表板
 * 計畫期間：11月1日 (Day 85) ~ 1月24日 (Day 1)，共計 85 天
 */

const STORAGE_KEY = 'sakura_study_planner_v1';
const ROOM_STORAGE_KEY = 'sakura_shared_room_v2';

// 多人即時同步房全域變數（免註冊・免 Google 帳號・免兩階段驗證）
const myClientId = 'usr_' + Math.random().toString(36).slice(2, 9);
let roomWs = null;
let isRoomConnected = false;
let currentRoomId = '';
let myNickname = '我';
let roomReconnectTimeout = null;
let isReceivingRemoteUpdate = false;
let roomDebounceTimer = null;

// 主表格下拉選單科目選項
const SUBJECT_OPTIONS = ['', '個經', '總經', '經濟', '統計', '財管', '英文', '上課', '其他'];

// 統計表歸類之五大核心科目（個經、總經自動歸類至「經濟」）
const STAT_SUBJECTS = ['經濟', '統計', '財管', '英文', '上課'];

// 小櫻目標表之縱軸科目
const GOAL_SUBJECTS = ['經濟', '統計', '財管', '其他'];

// 三大時段定義（依使用者設定：早上 05:00~12:00、下午 12:00~19:00、晚上 19:00~05:00）
const SLOT_KEYS = [
  { key: 'morning', label: '早上', timeRange: '05:00~12:00', icon: '☀️' },
  { key: 'afternoon', label: '下午', timeRange: '12:00~19:00', icon: '🌤️' },
  { key: 'evening', label: '晚上', timeRange: '19:00~05:00', icon: '🌙' }
];

/**
 * 依開始時間判定歸屬時段（最重要依據）
 * 早上: 05:00 ~ 12:00
 * 下午: 12:00 ~ 19:00
 * 晚上: 19:00 ~ 05:00
 */
function getSlotKeyFromStartTime(timeInput = new Date()) {
  let hr = 0;
  if (typeof timeInput === 'string' && timeInput.includes(':')) {
    hr = parseInt(timeInput.split(':')[0], 10) || 0;
  } else if (timeInput instanceof Date) {
    hr = timeInput.getHours();
  } else {
    hr = (new Date()).getHours();
  }

  if (hr >= 5 && hr < 12) {
    return 'morning';
  } else if (hr >= 12 && hr < 19) {
    return 'afternoon';
  } else {
    return 'evening';
  }
}

// 預設三階段設定 (Day 85-61, Day 60-31, Day 30-1)
const DEFAULT_PHASES = [
  { id: 'phase1', name: '第一階段', startDay: 85, endDay: 61 },
  { id: 'phase2', name: '第二階段', startDay: 60, endDay: 31 },
  { id: 'phase3', name: '第三階段', startDay: 30, endDay: 1 }
];

// 預設小櫻分階段目標內容（參考原 Numbers 目標表並支援自由編輯）
const DEFAULT_GOALS = {
  '經濟': {
    phase1: '個經、總經各一遍\n線上小考、整理觀念架構',
    phase2: '刷楊莉題庫本\n強化申論與計算題型',
    phase3: '歷屆考古題計時演練\n用經濟模型整理時事'
  },
  '統計': {
    phase1: '提綱一遍＋700題 (0*、1*)\n打穩機率與推論統計底子',
    phase2: '計量經濟學重點整理\n700題 (2*) 進階題刷題',
    phase3: '各校歷屆考古題實戰\n錯題本與易忘公式總複習'
  },
  '財管': {
    phase1: '實戰書重要單元複習\n核心公式與觀念推導',
    phase2: '實戰書二刷＋題庫演練\n投資與公司理財整合',
    phase3: '歷屆考古題計時演練\n高頻考點與計算速度強化'
  },
  '其他': {
    phase1: '閱讀財金時事、顧好學校期中考與課業報告',
    phase2: '定期整理時事筆記、維持規律作息與體力',
    phase3: '英文歷屆題感維持、調整考前作息時間表'
  }
};

// 從原 Numbers PDF 擷取之 11/1 ~ 12/7 預排科目、範圍與行事曆（所有時間與打勾皆重置為 0）
const PDF_PREPLANNED_DATA = {
  '11-01': { calendar: '', morning: ['統計', '700題＋計量'], afternoon: ['財管', '複習 實戰書'], evening: ['總經', 'Ch11影片完'] },
  '11-02': { calendar: '回南投', morning: ['其他', '坐火車'], afternoon: ['其他', '學校報告'], evening: ['個經', 'Ch5影片'] },
  '11-03': { calendar: '', morning: ['統計', '700題＋計量'], afternoon: ['財管', '複習 實戰書'], evening: ['總經', 'Ch12兩部影片'] },
  '11-04': { calendar: '', morning: ['上課', '財金計量方法'], afternoon: ['個經', 'Ch6.1~6.3半'], evening: ['統計', '700題＋計量'] },
  '11-05': { calendar: '', morning: ['財管', '複習 實戰書'], afternoon: ['上課', '富邦投信'], evening: ['統計', '700題＋計量'] },
  '11-06': { calendar: '', morning: ['上課', '投資學'], afternoon: ['總經', 'Ch12兩部影片'], evening: ['統計', '700題＋計量'] },
  '11-07': { calendar: '', morning: ['統計', '700題＋計量'], afternoon: ['財管', '複習 實戰書'], evening: ['個經', 'ch6完'] },
  '11-08': { calendar: '', morning: ['統計', '700題＋計量'], afternoon: ['其他', '學校報告'], evening: ['總經', 'Ch12兩部影片'] },
  '11-09': { calendar: '', morning: ['統計', '700題＋計量'], afternoon: ['其他', '學校報告'], evening: ['個經', '8.1~8.3'] },
  '11-10': { calendar: '', morning: ['統計', '700題＋計量'], afternoon: ['財管', '複習 實戰書'], evening: ['總經', 'Ch13完'] },
  '11-11': { calendar: '', morning: ['上課', '財金計量方法'], afternoon: ['個經', 'Ch8完'], evening: ['統計', '700題＋計量'] },
  '11-12': { calendar: '', morning: ['財管', '複習 實戰書'], afternoon: ['上課', '富邦投信'], evening: ['統計', '700題＋計量'] },
  '11-13': { calendar: '', morning: ['上課', '投資學'], afternoon: ['總經', 'Ch14影片完'], evening: ['統計', '700題＋計量'] },
  '11-14': { calendar: '', morning: ['統計', '700題＋計量'], afternoon: ['財管', '複習 實戰書'], evening: ['個經', 'Ch9.1~9.3'] },
  '11-15': { calendar: '', morning: ['統計', '700題＋計量'], afternoon: ['其他', '學校報告'], evening: ['個經', 'Ch9.4~9.5影片＋9.9'] },
  '11-16': { calendar: '', morning: ['統計', ''], afternoon: ['其他', '學校報告'], evening: ['個經', '9.6'] },
  '11-17': { calendar: '', morning: ['統計', ''], afternoon: ['財管', '複習 實戰書'], evening: ['個經', '9.7'] },
  '11-18': { calendar: '', morning: ['上課', '財金計量方法'], afternoon: ['個經', '10.1'], evening: ['統計', ''] },
  '11-19': { calendar: '', morning: ['統計', ''], afternoon: ['上課', '富邦投信'], evening: ['統計', ''] },
  '11-20': { calendar: '投資學期中考', morning: ['上課', '投資學'], afternoon: ['個經', 'ch10完'], evening: ['統計', ''] },
  '11-21': { calendar: '', morning: ['統計', ''], afternoon: ['財管', '複習 實戰書'], evening: ['個經', 'ch11完'] },
  '11-22': { calendar: '', morning: ['統計', ''], afternoon: ['其他', '學校報告'], evening: ['個經', 'Ch12完'] },
  '11-23': { calendar: '', morning: ['統計', ''], afternoon: ['其他', '學校報告'], evening: ['個經', 'Ch14.1~14.2'] },
  '11-24': { calendar: '', morning: ['統計', ''], afternoon: ['財管', '複習 實戰書'], evening: ['個經', 'Ch14.3~14.4'] },
  '11-25': { calendar: '', morning: ['上課', '財金計量方法'], afternoon: ['個經', '14.5~14.6'], evening: ['統計', ''] },
  '11-26': { calendar: '', morning: ['財管', '複習 實戰書'], afternoon: ['上課', '富邦投信'], evening: ['統計', ''] },
  '11-27': { calendar: '', morning: ['上課', '投資學'], afternoon: ['個經', '14完'], evening: ['統計', ''] },
  '11-28': { calendar: '', morning: ['統計', ''], afternoon: ['財管', '複習 實戰書'], evening: ['個經', 'Ch15影片完'] },
  '11-29': { calendar: '', morning: ['統計', ''], afternoon: ['其他', ''], evening: ['個經', ''] },
  '11-30': { calendar: '經濟和計量死線', morning: ['統計', ''], afternoon: ['其他', ''], evening: ['個經', ''] },
  '12-01': { calendar: '開始寫考古題', morning: ['', ''], afternoon: ['', ''], evening: ['', ''] },
  '12-03': { calendar: '', morning: ['', ''], afternoon: ['上課', '富邦投信'], evening: ['', ''] },
  '12-04': { calendar: '投資學報告', morning: ['', ''], afternoon: ['', ''], evening: ['', ''] },
  '12-06': { calendar: '', morning: ['', ''], afternoon: ['其他', ''], evening: ['', ''] },
  '12-07': { calendar: '', morning: ['', ''], afternoon: ['其他', ''], evening: ['', ''] }
};

const WEEKDAY_NAMES = ['週日', '週一', '週二', '週三', '週四', '週五', '週六'];

// 全域狀態
let appState = null;
let currentPhaseFilter = 'all';
let currentSubjectFilter = '';
let currentSearchQuery = '';
let isSideBySideLayout = false;
let isDashboardCollapsed = false;
let timerIntervalId = null;

/**
 * 建立空白時段物件（所有時間與紀錄從 0 開始）
 */
function createEmptySlot(subject = '', task = '') {
  return {
    subject: subject || '',
    task: task || '',
    startTime: '',
    endTime: '',
    durationMinutes: 0,      // 鎖定或手動設定之真實讀書時長（分鐘）
    accumulatedMs: 0,        // YPT 計時器累計毫秒數（不含當前正在跑的區間）
    timerStatus: 'idle',     // 'idle' | 'running' | 'paused' | 'ended'
    lastResumeTimestamp: null, // 系統時間戳記 Date.now()
    completed: false
  };
}

/**
 * 自動生成 11月1日 (Day 85) 至 1月24日 (Day 1) 共 85 天資料
 * 2026/11/01 為週日，至 2027/01/24 週日，共計 85 天
 */
function generate85DaysSchedule(withPreplanned = true) {
  const days = [];
  const startDate = new Date(2026, 10, 1); // Month 10 = November (0-indexed)
  const totalDays = 85;

  for (let i = 0; i < totalDays; i++) {
    const d = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate() + i);
    const month = d.getMonth() + 1;
    const dateNum = d.getDate();
    const weekday = WEEKDAY_NAMES[d.getDay()];
    const isWeekend = d.getDay() === 0 || d.getDay() === 6;
    const dayCountdown = totalDays - i; // 85 down to 1

    const mmddKey = `${String(month).padStart(2, '0')}-${String(dateNum).padStart(2, '0')}`;
    const pre = withPreplanned ? PDF_PREPLANNED_DATA[mmddKey] : null;

    days.push({
      id: `day-${dayCountdown}`,
      isoDate: `${d.getFullYear()}-${String(month).padStart(2, '0')}-${String(dateNum).padStart(2, '0')}`,
      dateDisplay: `${month}月${dateNum}日`,
      weekdayDisplay: weekday,
      isWeekend,
      dayCountdown,
      calendar: pre ? pre.calendar : '',
      morning: createEmptySlot(pre ? pre.morning[0] : '', pre ? pre.morning[1] : ''),
      afternoon: createEmptySlot(pre ? pre.afternoon[0] : '', pre ? pre.afternoon[1] : ''),
      evening: createEmptySlot(pre ? pre.evening[0] : '', pre ? pre.evening[1] : '')
    });
  }
  return days;
}

/**
 * 建立初始完整 App 狀態
 */
function createDefaultState(withPreplanned = true) {
  return {
    version: 1,
    phases: JSON.parse(JSON.stringify(DEFAULT_PHASES)),
    goals: JSON.parse(JSON.stringify(DEFAULT_GOALS)),
    days: generate85DaysSchedule(withPreplanned)
  };
}

/**
 * 載入或初始化狀態
 */
function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      appState = createDefaultState(true);
      saveState(false);
      return;
    }
    const parsed = JSON.parse(raw);
    const normalized = normalizeState(parsed);
    if (!normalized) {
      appState = createDefaultState(true);
      saveState(false);
      return;
    }
    appState = normalized;
  } catch (err) {
    console.error('Failed to load state from localStorage:', err);
    appState = createDefaultState(true);
  }
}

/**
 * 驗證並補齊狀態欄位（用於 localStorage 載入與 JSON 匯入，避免缺欄位造成整頁崩潰）
 * 回傳 null 代表格式不符
 */
function normalizeState(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.days) || raw.days.length !== 85) {
    return null;
  }
  const template = generate85DaysSchedule(false);
  const validStatus = ['idle', 'running', 'paused', 'ended'];

  const days = template.map((tpl, i) => {
    const src = raw.days.find(d => d && Number(d.dayCountdown) === tpl.dayCountdown) || raw.days[i] || {};
    const day = { ...tpl, calendar: typeof src.calendar === 'string' ? src.calendar : '' };
    SLOT_KEYS.forEach(({ key }) => {
      const s = src[key] && typeof src[key] === 'object' ? src[key] : {};
      const slot = createEmptySlot();
      slot.subject = SUBJECT_OPTIONS.includes(s.subject) ? s.subject : '';
      slot.task = typeof s.task === 'string' ? s.task : '';
      slot.startTime = typeof s.startTime === 'string' ? s.startTime : '';
      slot.endTime = typeof s.endTime === 'string' ? s.endTime : '';
      slot.durationMinutes = Math.max(0, Math.round(Number(s.durationMinutes) || 0));
      slot.accumulatedMs = Math.max(0, Number(s.accumulatedMs) || 0);
      slot.timerStatus = validStatus.includes(s.timerStatus) ? s.timerStatus : 'idle';
      slot.lastResumeTimestamp = Number(s.lastResumeTimestamp) || null;
      slot.completed = Boolean(s.completed);
      if (slot.timerStatus === 'running' && !slot.lastResumeTimestamp) {
        slot.timerStatus = 'paused';
      }
      day[key] = slot;
    });
    return day;
  });

  let phases = JSON.parse(JSON.stringify(DEFAULT_PHASES));
  if (Array.isArray(raw.phases) && raw.phases.length === 3) {
    phases = raw.phases.map((p, i) => ({
      id: DEFAULT_PHASES[i].id,
      name: (p && typeof p.name === 'string' && p.name.trim()) ? p.name : DEFAULT_PHASES[i].name,
      startDay: clampDay(p && p.startDay, DEFAULT_PHASES[i].startDay),
      endDay: clampDay(p && p.endDay, DEFAULT_PHASES[i].endDay)
    }));
  }

  const goals = JSON.parse(JSON.stringify(DEFAULT_GOALS));
  if (raw.goals && typeof raw.goals === 'object') {
    GOAL_SUBJECTS.forEach(subj => {
      const g = raw.goals[subj];
      if (!g || typeof g !== 'object') return;
      ['phase1', 'phase2', 'phase3'].forEach(k => {
        if (typeof g[k] === 'string') goals[subj][k] = g[k];
      });
    });
  }

  // 確保同一時間只有一個時段在「計時中」，其餘自動轉為暫停
  let runningFound = false;
  days.forEach(d => SLOT_KEYS.forEach(({ key }) => {
    const s = d[key];
    if (s.timerStatus !== 'running') return;
    if (runningFound) {
      s.accumulatedMs += Math.max(0, Date.now() - s.lastResumeTimestamp);
      s.lastResumeTimestamp = null;
      s.timerStatus = 'paused';
    }
    runningFound = true;
  }));

  return { version: 1, phases, goals, days };
}

function clampDay(v, fallback) {
  const n = parseInt(v, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.max(1, Math.min(85, n));
}

/**
 * 檢查三階段是否完整涵蓋 Day 1~85 且彼此不重疊
 */
function validatePhases() {
  const coverage = new Array(86).fill(0);
  appState.phases.forEach(p => {
    const high = Math.max(p.startDay, p.endDay);
    const low = Math.min(p.startDay, p.endDay);
    for (let d = low; d <= high; d++) coverage[d] += 1;
  });
  const gaps = [];
  const overlaps = [];
  for (let d = 1; d <= 85; d++) {
    if (coverage[d] === 0) gaps.push(d);
    if (coverage[d] > 1) overlaps.push(d);
  }
  return { gaps, overlaps };
}

function compressDayList(list) {
  if (list.length === 0) return '';
  const sorted = [...list].sort((a, b) => b - a);
  const ranges = [];
  let start = sorted[0];
  let prev = sorted[0];
  for (let i = 1; i <= sorted.length; i++) {
    const cur = sorted[i];
    if (cur === prev - 1) { prev = cur; continue; }
    ranges.push(start === prev ? `Day ${start}` : `Day ${start}-${prev}`);
    start = cur;
    prev = cur;
  }
  return ranges.join('、');
}

function renderPhaseWarning() {
  const el = document.getElementById('phaseWarning');
  if (!el) return;
  const { gaps, overlaps } = validatePhases();
  const msgs = [];
  if (overlaps.length) msgs.push(`⚠️ 階段範圍重疊：${compressDayList(overlaps)}（重疊天數會被重複計入多個階段統計）`);
  if (gaps.length) msgs.push(`⚠️ 未被任何階段涵蓋：${compressDayList(gaps)}（這些天數不會計入分階段統計，但仍計入全期總計）`);
  el.innerHTML = msgs.map(m => `<div>${escapeHtml(m)}</div>`).join('');
  el.style.display = msgs.length ? 'block' : 'none';
}

/**
 * 將使用者輸入的時間正規化為 HH:MM（支援 830、0830、8:30、8.30、08：30）
 * 無法解析時回傳 null，空字串回傳 ''
 */
function normalizeTimeInput(str) {
  const s = String(str || '').trim().replace(/[：.．]/g, ':');
  if (s === '') return '';
  let h;
  let m;
  let match = /^(\d{1,2}):(\d{1,2})$/.exec(s);
  if (match) {
    h = parseInt(match[1], 10);
    m = parseInt(match[2], 10);
  } else if (/^\d{3,4}$/.test(s)) {
    h = parseInt(s.slice(0, s.length - 2), 10);
    m = parseInt(s.slice(-2), 10);
  } else if (/^\d{1,2}$/.test(s)) {
    h = parseInt(s, 10);
    m = 0;
  } else {
    return null;
  }
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * 儲存狀態至 localStorage，若已進入共同讀書房則自動即時廣播給所有成員
 */
function saveState(showIndicator = true, broadcastToRoom = true) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(appState));
    if (showIndicator) {
      updateSaveStatusDisplay();
    }
  } catch (err) {
    console.error('Failed to save state:', err);
    showToast('⚠️ 儲存失敗：瀏覽器儲存空間可能已滿');
  }

  // 自動同步至共同房間（多人即時連線）
  if (broadcastToRoom && isRoomConnected && !isReceivingRemoteUpdate) {
    queueRoomFullBroadcast();
  }
}

function updateSaveStatusDisplay(roomStatusMessage = null) {
  const statusEl = document.getElementById('saveStatusText');
  const dotEl = document.getElementById('saveIndicatorDot');
  if (!statusEl) return;

  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');

  if (roomStatusMessage) {
    statusEl.textContent = roomStatusMessage;
  } else if (isRoomConnected) {
    statusEl.textContent = `🌸 房間已同步 (${hh}:${mm})`;
    if (dotEl) dotEl.style.background = '#2E7350';
  } else {
    statusEl.textContent = `已本機儲存 (${hh}:${mm})`;
    if (dotEl) dotEl.style.background = '#4E8C6F';
  }
}

/**
 * 共同房間全量防抖廣播（延遲 600ms 批次上傳連續輸入，避免頻繁發送）
 */
function queueRoomFullBroadcast() {
  if (roomDebounceTimer) {
    clearTimeout(roomDebounceTimer);
  }
  setRoomNavbarStatus('syncing');

  roomDebounceTimer = setTimeout(() => {
    broadcastFullStateToRoom();
    updateSaveStatusDisplay();
    setRoomNavbarStatus('connected');
  }, 600);
}

/**
 * 科目歸類函式：個經、總經、經濟 -> 統一歸類至「經濟」
 */
function mapSubjectToStatCategory(subject) {
  if (!subject) return '';
  if (subject === '個經' || subject === '總經' || subject === '經濟') {
    return '經濟';
  }
  return subject;
}

/**
 * 取得某個時段目前的真實淨毫秒數（含正在計時中的差值 Date.now() - lastResumeTimestamp）
 */
function getSlotLiveMs(slot) {
  if (slot.timerStatus === 'running' && slot.lastResumeTimestamp) {
    const delta = Math.max(0, Date.now() - slot.lastResumeTimestamp);
    return (slot.accumulatedMs || 0) + delta;
  }
  if (slot.timerStatus === 'paused') {
    return slot.accumulatedMs || 0;
  }
  return (slot.durationMinutes || 0) * 60000;
}

/**
 * 取得某個時段用於統計與每日加總的「真實讀書分鐘數」
 * 若計時器正在執行或暫停，也會即時換算為分鐘數以同步更新統計表
 */
function getSlotEffectiveMinutes(slot) {
  if (slot.timerStatus === 'running' || slot.timerStatus === 'paused') {
    const liveMs = getSlotLiveMs(slot);
    if (liveMs <= 0) return 0;
    return Math.max(1, Math.round(liveMs / 60000));
  }
  return Math.max(0, Number(slot.durationMinutes) || 0);
}

/**
 * 格式化分鐘數為「X小時 Y分」
 */
function formatMinutesToHM(totalMinutes) {
  const mins = Math.round(Number(totalMinutes) || 0);
  if (mins <= 0) return '0小時 0分';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `0小時 ${m}分`;
  return `${h}小時 ${m}分`;
}

/**
 * 格式化毫秒數為 YPT 計時器顯示「HH:MM:SS」
 */
function formatMsToClock(ms) {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/**
 * 取得當下系統時間字串 "HH:MM"
 */
function getCurrentTimeHM() {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

/**
 * 計算中位數（僅針對 > 0 的有效數值陣列由小到大排序計算）
 */
function calculateMedian(values) {
  const valid = values.filter(v => typeof v === 'number' && v > 0).sort((a, b) => a - b);
  if (valid.length === 0) return 0;
  const mid = Math.floor(valid.length / 2);
  if (valid.length % 2 === 1) {
    return valid[mid];
  }
  return (valid[mid - 1] + valid[mid]) / 2;
}

/**
 * 計算算術平均數（僅針對 > 0 的有效數值陣列計算）
 */
function calculateMean(values) {
  const valid = values.filter(v => typeof v === 'number' && v > 0);
  if (valid.length === 0) return 0;
  const sum = valid.reduce((acc, v) => acc + v, 0);
  return sum / valid.length;
}

/**
 * 判斷某個倒數天數 (dayCountdown) 屬於哪一個階段索引 (0, 1, 2)
 */
function getPhaseIndexForDay(dayCountdown) {
  for (let i = 0; i < appState.phases.length; i++) {
    const p = appState.phases[i];
    const high = Math.max(p.startDay, p.endDay);
    const low = Math.min(p.startDay, p.endDay);
    if (dayCountdown <= high && dayCountdown >= low) {
      return i;
    }
  }
  return -1;
}

/**
 * 取得某個倒數天數對應的顯示日期字串
 */
function getDateLabelForCountdown(dayCountdown) {
  const found = appState.days.find(d => d.dayCountdown === Number(dayCountdown));
  return found ? found.dateDisplay : '';
}

/* ==========================================================================
   UI 渲染：三階段設定卡片與篩選按鈕
   ========================================================================== */

function renderPhasesConfig() {
  const container = document.getElementById('phasesConfigContainer');
  if (!container) return;

  container.innerHTML = appState.phases.map((phase, idx) => {
    const high = Math.max(phase.startDay, phase.endDay);
    const low = Math.min(phase.startDay, phase.endDay);
    const dayCount = Math.max(0, high - low + 1);
    const startDateStr = getDateLabelForCountdown(high);
    const endDateStr = getDateLabelForCountdown(low);

    return `
      <div class="phase-config-item" data-phase-idx="${idx}">
        <div class="phase-config-top">
          <span class="phase-badge">階段 ${idx + 1}</span>
          <input
            type="text"
            class="phase-name-input"
            data-phase-idx="${idx}"
            value="${escapeHtml(phase.name)}"
            placeholder="輸入階段名稱"
            title="點擊修改階段名稱"
          />
        </div>
        <div class="phase-range-row">
          <span>Day</span>
          <input
            type="number"
            min="1"
            max="85"
            class="phase-day-input"
            data-phase-idx="${idx}"
            data-bound="startDay"
            value="${phase.startDay}"
            title="起始倒數天數 (1~85)"
          />
          <span>～ Day</span>
          <input
            type="number"
            min="1"
            max="85"
            class="phase-day-input"
            data-phase-idx="${idx}"
            data-bound="endDay"
            value="${phase.endDay}"
            title="結束倒數天數 (1~85)"
          />
          <span class="phase-date-hint">${startDateStr}~${endDateStr} (${dayCount}天)</span>
        </div>
      </div>
    `;
  }).join('');

  // 同步更新篩選分頁按鈕文字
  appState.phases.forEach((p, idx) => {
    const btn = document.getElementById(`filterTabPhase${idx}`);
    if (btn) {
      btn.textContent = `${p.name} (Day ${p.startDay}-${p.endDay})`;
    }
  });
}

/* ==========================================================================
   UI 渲染：五張即時連動統計量表與頂部 KPI
   ========================================================================== */

/**
 * 重新計算並渲染統計表（不重繪小櫻目標表，避免正在輸入的目標文字失焦）
 */
function renderAllStatistics() {
  const stats = computeDashboardStatistics();
  renderTopKpis(stats);
  renderCompletionTable(stats);
  renderSubjectCountTable(stats);
  renderSubjectTimeTable(stats);
  renderAdvancedStatTable(stats);
}

/**
 * 完整重繪儀表板（含小櫻目標表與階段警示），用於初始化、階段變更、匯入與重置
 */
function renderFullDashboard() {
  renderGoalTable();
  renderPhaseWarning();
  renderAllStatistics();
}

/**
 * 表 1：小櫻目標（分階段目標表）
 * 橫軸為三個倒數階段，縱軸為 經濟、統計、財管、其他
 */
function renderGoalTable() {
  const table = document.getElementById('goalTable');
  if (!table) return;

  const p0 = appState.phases[0];
  const p1 = appState.phases[1];
  const p2 = appState.phases[2];

  const thead = `
    <thead>
      <tr>
        <th style="width: 90px;">科目 \\ 階段</th>
        <th>${escapeHtml(p0.name)}<span class="stat-sub-val">Day ${p0.startDay}–${p0.endDay}</span></th>
        <th>${escapeHtml(p1.name)}<span class="stat-sub-val">Day ${p1.startDay}–${p1.endDay}</span></th>
        <th>${escapeHtml(p2.name)}<span class="stat-sub-val">Day ${p2.startDay}–${p2.endDay}</span></th>
      </tr>
    </thead>
  `;

  const tbodyRows = GOAL_SUBJECTS.map(subj => {
    const g = appState.goals[subj] || { phase1: '', phase2: '', phase3: '' };
    return `
      <tr>
        <td><span class="subj-pill" data-subj="${subj}">${subj}</span></td>
        <td>
          <textarea class="goal-textarea" data-goal-subj="${subj}" data-goal-phase="phase1" placeholder="輸入${escapeHtml(p0.name)}${subj}目標...">${escapeHtml(g.phase1 || '')}</textarea>
        </td>
        <td>
          <textarea class="goal-textarea" data-goal-subj="${subj}" data-goal-phase="phase2" placeholder="輸入${escapeHtml(p1.name)}${subj}目標...">${escapeHtml(g.phase2 || '')}</textarea>
        </td>
        <td>
          <textarea class="goal-textarea" data-goal-subj="${subj}" data-goal-phase="phase3" placeholder="輸入${escapeHtml(p2.name)}${subj}目標...">${escapeHtml(g.phase3 || '')}</textarea>
        </td>
      </tr>
    `;
  }).join('');

  table.innerHTML = `${thead}<tbody>${tbodyRows}</tbody>`;
}

/**
 * 計算五張統計表所需之所有彙整指標
 */
function computeDashboardStatistics() {
  const phaseStats = appState.phases.map((p, idx) => {
    const high = Math.max(p.startDay, p.endDay);
    const low = Math.min(p.startDay, p.endDay);
    const daysInPhase = appState.days.filter(d => d.dayCountdown <= high && d.dayCountdown >= low);

    const subjectCounts = {};
    const subjectMinutes = {};
    const subjectSessionDurations = {};
    STAT_SUBJECTS.forEach(s => {
      subjectCounts[s] = 0;
      subjectMinutes[s] = 0;
      subjectSessionDurations[s] = [];
    });

    let completedSlotsCount = 0;
    let activeDaysCount = 0;
    const dailyTotalMinutesList = [];

    daysInPhase.forEach(day => {
      let dayTotalMins = 0;
      let dayHasActivity = false;

      SLOT_KEYS.forEach(({ key }) => {
        const slot = day[key];
        const mins = getSlotEffectiveMinutes(slot);
        const isChecked = Boolean(slot.completed);

        if (isChecked) {
          completedSlotsCount += 1;
          dayHasActivity = true;
        }
        if (mins > 0) {
          dayTotalMins += mins;
          dayHasActivity = true;
        }

        const mappedSubj = mapSubjectToStatCategory(slot.subject);
        if (STAT_SUBJECTS.includes(mappedSubj)) {
          // 讀書次數：該科目有實際讀書紀錄 (mins > 0) 或打勾 (isChecked) 的時段數
          if (mins > 0 || isChecked) {
            subjectCounts[mappedSubj] += 1;
          }
          // 讀書時間：累計真實讀書時間
          if (mins > 0) {
            subjectMinutes[mappedSubj] += mins;
            subjectSessionDurations[mappedSubj].push(mins);
          }
        }
      });

      if (dayHasActivity) activeDaysCount += 1;
      if (dayTotalMins > 0) {
        dailyTotalMinutesList.push(dayTotalMins);
      }
    });

    const totalDays = daysInPhase.length;
    const totalSlots = totalDays * 3;
    const completionRate = totalSlots > 0 ? (completedSlotsCount / totalSlots) * 100 : 0;
    const avgCompletedPerDay = totalDays > 0 ? completedSlotsCount / totalDays : 0;
    const avgCompletedPerActiveDay = activeDaysCount > 0 ? completedSlotsCount / activeDaysCount : 0;

    const totalStatSubjectCount = STAT_SUBJECTS.reduce((acc, s) => acc + subjectCounts[s], 0);
    const totalStatSubjectMinutes = STAT_SUBJECTS.reduce((acc, s) => acc + subjectMinutes[s], 0);

    return {
      phaseIndex: idx,
      name: p.name,
      rangeLabel: `Day ${p.startDay}–${p.endDay}`,
      totalDays,
      totalSlots,
      activeDaysCount,
      completedSlotsCount,
      completionRate,
      avgCompletedPerDay,
      avgCompletedPerActiveDay,
      subjectCounts,
      totalStatSubjectCount,
      subjectMinutes,
      totalStatSubjectMinutes,
      subjectSessionDurations,
      dailyTotalMinutesList
    };
  });

  // 全期 85 天總計
  const overallSubjectCounts = {};
  const overallSubjectMinutes = {};
  const overallSubjectSessionDurations = {};
  STAT_SUBJECTS.forEach(s => {
    overallSubjectCounts[s] = 0;
    overallSubjectMinutes[s] = 0;
    overallSubjectSessionDurations[s] = [];
  });

  let overallCompletedSlots = 0;
  let overallStudyMinutesAll = 0; // 包含「其他」科目的總真實讀書時長
  let overallActiveStudyDays = 0;
  const overallDailyTotalMinutesList = [];

  appState.days.forEach(day => {
    let dayMins = 0;
    SLOT_KEYS.forEach(({ key }) => {
      const slot = day[key];
      const mins = getSlotEffectiveMinutes(slot);
      const isChecked = Boolean(slot.completed);

      if (isChecked) overallCompletedSlots += 1;
      if (mins > 0) {
        dayMins += mins;
        overallStudyMinutesAll += mins;
      }

      const mappedSubj = mapSubjectToStatCategory(slot.subject);
      if (STAT_SUBJECTS.includes(mappedSubj)) {
        if (mins > 0 || isChecked) {
          overallSubjectCounts[mappedSubj] += 1;
        }
        if (mins > 0) {
          overallSubjectMinutes[mappedSubj] += mins;
          overallSubjectSessionDurations[mappedSubj].push(mins);
        }
      }
    });

    if (dayMins > 0) {
      overallActiveStudyDays += 1;
      overallDailyTotalMinutesList.push(dayMins);
    }
  });

  const overallStatSubjectCount = STAT_SUBJECTS.reduce((acc, s) => acc + overallSubjectCounts[s], 0);
  const overallStatSubjectMinutes = STAT_SUBJECTS.reduce((acc, s) => acc + overallSubjectMinutes[s], 0);

  return {
    phaseStats,
    overall: {
      totalDays: 85,
      totalSlots: 255,
      overallCompletedSlots,
      overallCompletionRate: (overallCompletedSlots / 255) * 100,
      overallAvgCompletedPerDay: overallCompletedSlots / 85,
      overallStudyMinutesAll,
      overallActiveStudyDays,
      overallSubjectCounts,
      overallStatSubjectCount,
      overallSubjectMinutes,
      overallStatSubjectMinutes,
      overallSubjectSessionDurations,
      overallDailyTotalMinutesList
    }
  };
}

/**
 * 更新頂部 4 個總覽 KPI 卡片
 */
function renderTopKpis(stats) {
  const { overall } = stats;
  const elTotalTime = document.getElementById('kpiTotalStudyTime');
  const elActiveDays = document.getElementById('kpiActiveDaysSub');
  const elTotalComp = document.getElementById('kpiTotalCompletion');
  const elAvgSlot = document.getElementById('kpiAvgSlotPerDay');
  const elDailyMean = document.getElementById('kpiDailyMeanTime');
  const elDailyMeanAll = document.getElementById('kpiDailyMeanAllSub');
  const elDailyMedian = document.getElementById('kpiDailyMedianTime');

  if (elTotalTime) elTotalTime.textContent = formatMinutesToHM(overall.overallStudyMinutesAll);
  if (elActiveDays) elActiveDays.textContent = `有效讀書天數：${overall.overallActiveStudyDays} / 85 天`;
  if (elTotalComp) {
    elTotalComp.textContent = `${overall.overallCompletedSlots} / 255 (${Math.round(overall.overallCompletionRate)}%)`;
  }
  if (elAvgSlot) {
    elAvgSlot.textContent = `每日平均完成：${overall.overallAvgCompletedPerDay.toFixed(2)} 時段`;
  }

  const activeDayMean = calculateMean(overall.overallDailyTotalMinutesList);
  const all85DayMean = overall.overallStudyMinutesAll / 85;
  const activeDayMedian = calculateMedian(overall.overallDailyTotalMinutesList);

  if (elDailyMean) elDailyMean.textContent = formatMinutesToHM(activeDayMean);
  if (elDailyMeanAll) elDailyMeanAll.textContent = `全85天日均：${formatMinutesToHM(all85DayMean)}`;
  if (elDailyMedian) elDailyMedian.textContent = formatMinutesToHM(activeDayMedian);
}

/**
 * 表 2：完成率表單
 * 依三個階段分別統計：總完成度（累計打勾次數）、總完成率（打勾數 ÷ 該階段總時段數）、每日平均完成度
 */
function renderCompletionTable(stats) {
  const table = document.getElementById('completionTable');
  if (!table) return;

  const rowsHtml = stats.phaseStats.map(p => `
    <tr>
      <td>
        ${escapeHtml(p.name)}
        <span class="stat-sub-val">${p.rangeLabel} (${p.totalDays}天 / ${p.totalSlots}時段)</span>
      </td>
      <td>
        <strong>${p.completedSlotsCount}</strong>
        <span class="stat-sub-val">共 ${p.totalSlots} 時段</span>
      </td>
      <td>
        <span class="stat-pct-badge">${p.completionRate.toFixed(1)}%</span>
      </td>
      <td>
        <strong>${p.avgCompletedPerDay.toFixed(2)}</strong> 時段/日
        <span class="stat-sub-val">有效日均：${p.avgCompletedPerActiveDay.toFixed(2)}</span>
      </td>
    </tr>
  `).join('');

  const ov = stats.overall;
  const tfootHtml = `
    <tfoot>
      <tr class="total-row">
        <td>全期總計<span class="stat-sub-val">Day 85–1 (85天 / 255時段)</span></td>
        <td><strong>${ov.overallCompletedSlots}</strong><span class="stat-sub-val">共 255 時段</span></td>
        <td><span class="stat-pct-badge">${ov.overallCompletionRate.toFixed(1)}%</span></td>
        <td><strong>${ov.overallAvgCompletedPerDay.toFixed(2)}</strong> 時段/日</td>
      </tr>
    </tfoot>
  `;

  table.innerHTML = `
    <thead>
      <tr>
        <th>衝刺階段區間</th>
        <th>總完成度 (累計打勾數)</th>
        <th>總完成率</th>
        <th>每日平均完成度</th>
      </tr>
    </thead>
    <tbody>${rowsHtml}</tbody>
    ${tfootHtml}
  `;
}

/**
 * 表 3：各科讀書次數 & 百分比表
 * 統計科目：經濟(含個經/總經)、統計、財管、英文、上課
 */
function renderSubjectCountTable(stats) {
  const table = document.getElementById('subjectCountTable');
  if (!table) return;

  const subjectHeaders = STAT_SUBJECTS.map(s => `<th><span class="subj-pill" data-subj="${s}">${s}</span></th>`).join('');

  const bodyRows = stats.phaseStats.map(p => {
    const cells = STAT_SUBJECTS.map(s => {
      const count = p.subjectCounts[s] || 0;
      const pct = p.totalStatSubjectCount > 0 ? Math.round((count / p.totalStatSubjectCount) * 100) : 0;
      return `
        <td>
          <strong>${count}</strong> 次
          <span class="stat-sub-val">${pct}%</span>
        </td>
      `;
    }).join('');

    return `
      <tr>
        <td>${escapeHtml(p.name)}<span class="stat-sub-val">${p.rangeLabel}</span></td>
        ${cells}
        <td><strong>${p.totalStatSubjectCount}</strong> 次<span class="stat-sub-val">100%</span></td>
      </tr>
    `;
  }).join('');

  const ov = stats.overall;
  const totalCountCells = STAT_SUBJECTS.map(s => {
    const count = ov.overallSubjectCounts[s] || 0;
    const pct = ov.overallStatSubjectCount > 0 ? Math.round((count / ov.overallStatSubjectCount) * 100) : 0;
    return `
      <td>
        <strong>${count}</strong> 次
        <span class="stat-pct-badge" style="margin-top:2px;">${pct}%</span>
      </td>
    `;
  }).join('');

  table.innerHTML = `
    <thead>
      <tr>
        <th>階段 \\ 科目</th>
        ${subjectHeaders}
        <th>階段讀書次數合計</th>
      </tr>
    </thead>
    <tbody>${bodyRows}</tbody>
    <tfoot>
      <tr class="total-row">
        <td>各科讀書次數總計<span class="stat-sub-val">含總次數百分比</span></td>
        ${totalCountCells}
        <td><strong>${ov.overallStatSubjectCount}</strong> 次<span class="stat-sub-val">100%</span></td>
      </tr>
    </tfoot>
  `;
}

/**
 * 表 4：各科讀書時間 & 百分比表
 * 統計科目：經濟(含個經/總經)、統計、財管、英文、上課
 */
function renderSubjectTimeTable(stats) {
  const table = document.getElementById('subjectTimeTable');
  if (!table) return;

  const subjectHeaders = STAT_SUBJECTS.map(s => `<th><span class="subj-pill" data-subj="${s}">${s}</span></th>`).join('');

  const bodyRows = stats.phaseStats.map(p => {
    const cells = STAT_SUBJECTS.map(s => {
      const mins = p.subjectMinutes[s] || 0;
      const pct = p.totalStatSubjectMinutes > 0 ? Math.round((mins / p.totalStatSubjectMinutes) * 100) : 0;
      return `
        <td>
          <strong>${formatMinutesToHM(mins)}</strong>
          <span class="stat-sub-val">${pct}%</span>
        </td>
      `;
    }).join('');

    return `
      <tr>
        <td>${escapeHtml(p.name)}<span class="stat-sub-val">${p.rangeLabel}</span></td>
        ${cells}
        <td><strong>${formatMinutesToHM(p.totalStatSubjectMinutes)}</strong><span class="stat-sub-val">100%</span></td>
      </tr>
    `;
  }).join('');

  const ov = stats.overall;
  const totalTimeCells = STAT_SUBJECTS.map(s => {
    const mins = ov.overallSubjectMinutes[s] || 0;
    const pct = ov.overallStatSubjectMinutes > 0 ? Math.round((mins / ov.overallStatSubjectMinutes) * 100) : 0;
    return `
      <td>
        <strong>${formatMinutesToHM(mins)}</strong>
        <span class="stat-pct-badge" style="margin-top:2px;">${pct}%</span>
      </td>
    `;
  }).join('');

  table.innerHTML = `
    <thead>
      <tr>
        <th>階段 \\ 科目</th>
        ${subjectHeaders}
        <th>階段讀書時間合計</th>
      </tr>
    </thead>
    <tbody>${bodyRows}</tbody>
    <tfoot>
      <tr class="total-row">
        <td>各科讀書時間總計<span class="stat-sub-val">含總時間佔比 (%)</span></td>
        ${totalTimeCells}
        <td><strong>${formatMinutesToHM(ov.overallStatSubjectMinutes)}</strong><span class="stat-sub-val">100%</span></td>
      </tr>
    </tfoot>
  `;
}

/**
 * 表 5：進階時間統計量表（平均數 & 中位數）
 * - 各科平均讀書時間（單次讀書平均真實時長） & 每日平均讀書總時長
 * - 各科讀書時間中位數（有效讀書時長 > 0 由小到大排序） & 每日總讀書時間中位數
 */
function renderAdvancedStatTable(stats) {
  const table = document.getElementById('advancedStatTable');
  if (!table) return;

  const subjectHeaders = STAT_SUBJECTS.map(s => `<th><span class="subj-pill" data-subj="${s}">${s}</span><span class="stat-sub-val">單次有效紀錄</span></th>`).join('');
  const ov = stats.overall;

  // 全期各科單次平均時長
  const overallMeanCells = STAT_SUBJECTS.map(s => {
    const arr = ov.overallSubjectSessionDurations[s] || [];
    const meanVal = calculateMean(arr);
    return `
      <td>
        <strong>${formatMinutesToHM(meanVal)}</strong>
        <span class="stat-sub-val">樣本數 n=${arr.length}</span>
      </td>
    `;
  }).join('');

  const overallDailyActiveMean = calculateMean(ov.overallDailyTotalMinutesList);
  const overallDailyAllMean = ov.overallStudyMinutesAll / 85;

  // 全期各科單次中位數時長
  const overallMedianCells = STAT_SUBJECTS.map(s => {
    const arr = ov.overallSubjectSessionDurations[s] || [];
    const medianVal = calculateMedian(arr);
    return `
      <td>
        <strong style="color: var(--sakura-deep);">${formatMinutesToHM(medianVal)}</strong>
        <span class="stat-sub-val">${arr.length > 0 ? `中位數 (n=${arr.length})` : '尚無有效紀錄'}</span>
      </td>
    `;
  }).join('');

  const overallDailyMedian = calculateMedian(ov.overallDailyTotalMinutesList);

  // 分階段平均數與中位數明細列
  const phaseDetailRows = stats.phaseStats.map(p => {
    const cells = STAT_SUBJECTS.map(s => {
      const arr = p.subjectSessionDurations[s] || [];
      const meanVal = calculateMean(arr);
      const medVal = calculateMedian(arr);
      return `
        <td>
          <span>平均：${formatMinutesToHM(meanVal)}</span>
          <span class="stat-sub-val">中位數：${formatMinutesToHM(medVal)} (n=${arr.length})</span>
        </td>
      `;
    }).join('');

    const pDailyMean = calculateMean(p.dailyTotalMinutesList);
    const pDailyAllMean = p.totalDays > 0 ? p.dailyTotalMinutesList.reduce((a, b) => a + b, 0) / p.totalDays : 0;
    const pDailyMedian = calculateMedian(p.dailyTotalMinutesList);

    return `
      <tr>
        <td>
          ${escapeHtml(p.name)} 平均 / 中位數
          <span class="stat-sub-val">${p.rangeLabel}</span>
        </td>
        ${cells}
        <td>
          <span>日均(有效日)：<strong>${formatMinutesToHM(pDailyMean)}</strong></span>
          <span class="stat-sub-val">中位數：<strong>${formatMinutesToHM(pDailyMedian)}</strong>｜全階段日均：${formatMinutesToHM(pDailyAllMean)}</span>
        </td>
      </tr>
    `;
  }).join('');

  table.innerHTML = `
    <thead>
      <tr>
        <th>統計指標 \\ 科目與每日總計</th>
        ${subjectHeaders}
        <th>🌸 每日讀書總時長<span class="stat-sub-val">每日早+午+晚加總</span></th>
      </tr>
    </thead>
    <tbody>
      <tr class="total-row">
        <td>
          📊 各科平均讀書時間 (Mean)
          <span class="stat-sub-val">全期單次平均 &amp; 每日平均讀書總時長</span>
        </td>
        ${overallMeanCells}
        <td>
          <strong>${formatMinutesToHM(overallDailyActiveMean)}</strong> <span style="font-size:11px;font-weight:500;">(有效日均, n=${ov.overallActiveStudyDays}天)</span>
          <span class="stat-sub-val">全期 85 天日均：${formatMinutesToHM(overallDailyAllMean)}</span>
        </td>
      </tr>
      <tr class="total-row">
        <td>
          🎯 各科讀書時間中位數 (Median)
          <span class="stat-sub-val">有效時長 &gt; 0 由小到大排序・排除極端值</span>
        </td>
        ${overallMedianCells}
        <td>
          <strong style="color: var(--sakura-deep);">${formatMinutesToHM(overallDailyMedian)}</strong>
          <span class="stat-sub-val">每日總讀書時間中位數 (n=${ov.overallDailyTotalMinutesList.length}天)</span>
        </td>
      </tr>
      ${phaseDetailRows}
    </tbody>
  `;
}

/* ==========================================================================
   全新分頁導航與視圖管理模組（快捷計時、今日專注、行事曆、統計列表）
   ========================================================================== */

let currentActiveTab = 'quick-timer';
let currentActiveDayCountdown = 85;

function initCurrentActiveDay() {
  const now = new Date();
  const m = now.getMonth() + 1;
  const d = now.getDate();
  const match = appState.days.find(item => item.dateDisplay === `${m}月${d}日`);
  if (match) {
    currentActiveDayCountdown = match.dayCountdown;
  } else {
    currentActiveDayCountdown = 85;
  }
}

function getTodayDayCountdown() {
  const now = new Date();
  const m = now.getMonth() + 1;
  const d = now.getDate();
  const match = appState.days.find(item => item.dateDisplay === `${m}月${d}日`);
  return match ? match.dayCountdown : 85;
}

function switchMainTab(tabId) {
  currentActiveTab = tabId;
  const navBtns = document.querySelectorAll('.tab-nav-btn');
  navBtns.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabId);
  });

  const views = {
    'quick-timer': document.getElementById('tabQuickTimer'),
    'daily-plan': document.getElementById('tabDailyPlan'),
    'calendar-schedule': document.getElementById('tabCalendarSchedule'),
    'statistics-dashboard': document.getElementById('tabStatisticsDashboard')
  };

  Object.keys(views).forEach(key => {
    if (views[key]) {
      views[key].classList.toggle('active', key === tabId);
    }
  });

  if (tabId === 'quick-timer') {
    renderQuickTimerView();
  } else if (tabId === 'daily-plan') {
    renderDailyPlanView();
  } else if (tabId === 'calendar-schedule') {
    renderMainScheduleTable();
  } else if (tabId === 'statistics-dashboard') {
    renderAllStatistics();
  }
}

function changeDailyPlanDay(targetDayCountdown) {
  if (targetDayCountdown > 85) targetDayCountdown = 85;
  if (targetDayCountdown < 1) targetDayCountdown = 1;
  currentActiveDayCountdown = targetDayCountdown;
  renderDailyPlanView();
  renderQuickTimerView();
}

/* ==========================================================================
   分頁 1：⚡ 快捷計時（YPT 模式）渲染與邏輯
   ========================================================================== */

function getDayTotalEffectiveMinutes(day) {
  if (!day) return 0;
  return SLOT_KEYS.reduce((acc, { key }) => acc + getSlotEffectiveMinutes(day[key]), 0);
}

function renderQuickTimerView() {
  const day = appState.days.find(d => d.dayCountdown === currentActiveDayCountdown);
  if (!day) return;

  const quickDayBadge = document.getElementById('quickDayBadge');
  const quickDateTitle = document.getElementById('quickDateTitle');
  const quickPhaseTag = document.getElementById('quickPhaseTag');
  const quickTodayTotalTime = document.getElementById('quickTodayTotalTime');

  if (quickDayBadge) quickDayBadge.textContent = `Day ${day.dayCountdown}`;
  if (quickDateTitle) quickDateTitle.textContent = `${day.dateDisplay}（${day.weekdayDisplay}）`;
  if (quickPhaseTag) {
    const phaseIdx = getPhaseIndexForDay(day.dayCountdown);
    const p = appState.phases[phaseIdx] || DEFAULT_PHASES[phaseIdx];
    quickPhaseTag.textContent = p.name;
  }
  if (quickTodayTotalTime) {
    quickTodayTotalTime.textContent = formatMinutesToHM(getDayTotalEffectiveMinutes(day));
  }

  updateQuickTimerDom();
  renderQuickSubjectsGrid(day);
  renderQuickSlotsOverview(day);
}

function updateQuickTimerDom() {
  const clockEl = document.getElementById('quickClockDisplay');
  const dotEl = document.getElementById('quickStatusDot');
  const textEl = document.getElementById('quickStatusText');
  const actionsRow = document.getElementById('quickActionsRow');
  const pauseResumeBtn = document.getElementById('quickPauseResumeBtn');

  if (!clockEl || !textEl) return;

  const active = findActiveTimerSlot();
  if (active) {
    const liveMs = getSlotLiveMs(active.slot);
    clockEl.textContent = formatMsToClock(liveMs);

    const isRunning = active.slot.timerStatus === 'running';
    if (dotEl) {
      dotEl.className = 'quick-status-dot ' + (isRunning ? 'running' : 'paused');
    }

    const slotObj = SLOT_KEYS.find(k => k.key === active.slotKey);
    const slotLabel = slotObj ? `${slotObj.icon} ${slotObj.label}時段` : active.slotLabel;

    if (isRunning) {
      textEl.innerHTML = `⏱️ 正在專注：<strong style="color:var(--sakura-deep);font-size:15px;">${escapeHtml(active.slot.subject || '自訂科目')}</strong>（依開始時間 ${active.slot.startTime || ''} 歸於 ${slotLabel}）`;
    } else {
      textEl.innerHTML = `⏸️ 專注已暫停：<strong style="color:var(--timer-paused);">${escapeHtml(active.slot.subject || '自訂科目')}</strong>（休息不計入專注時長）`;
    }

    if (actionsRow) actionsRow.style.display = 'flex';
    if (pauseResumeBtn) {
      pauseResumeBtn.textContent = isRunning ? '暫停 ⏸' : '繼續 ▶';
      pauseResumeBtn.className = 'btn btn-lg ' + (isRunning ? 'btn-pause' : 'btn-resume');
    }
  } else {
    clockEl.textContent = '00:00:00';
    if (dotEl) dotEl.className = 'quick-status-dot';
    textEl.textContent = '🌸 點選下方科目，一鍵立即開始專注計時';
    if (actionsRow) actionsRow.style.display = 'none';
  }
}

function renderQuickSubjectsGrid(day) {
  const container = document.getElementById('quickSubjectsGrid');
  if (!container) return;

  const active = findActiveTimerSlot();
  const activeSubject = (active && active.slot.timerStatus === 'running') ? active.slot.subject : null;

  const subjTodayMinutes = {};
  SLOT_KEYS.forEach(({ key }) => {
    const s = day[key];
    if (s.subject) {
      const cat = mapSubjectToStatCategory(s.subject);
      subjTodayMinutes[cat] = (subjTodayMinutes[cat] || 0) + getSlotEffectiveMinutes(s);
      subjTodayMinutes[s.subject] = (subjTodayMinutes[s.subject] || 0) + getSlotEffectiveMinutes(s);
    }
  });

  const subjects = [
    { name: '經濟', icon: '🌸', colorVar: '--subj-econ-border' },
    { name: '統計', icon: '📊', colorVar: '--subj-stat-border' },
    { name: '財管', icon: '📈', colorVar: '--subj-fin-border' },
    { name: '英文', icon: '📖', colorVar: '--subj-eng-border' },
    { name: '上課', icon: '🏫', colorVar: '--subj-class-border' },
    { name: '其他', icon: '📝', colorVar: '--subj-other-border' }
  ];

  container.innerHTML = subjects.map(s => {
    const isThisRunning = activeSubject === s.name;
    const mins = subjTodayMinutes[s.name] || 0;
    const timeText = mins > 0 ? `今日已讀 ${formatMinutesToHM(mins)}` : '今日未讀';
    return `
      <button
        type="button"
        class="quick-subj-btn ${isThisRunning ? 'active-running' : ''}"
        data-quick-subject="${s.name}"
        style="border-color: ${isThisRunning ? 'var(--sakura-primary)' : `var(${s.colorVar})`};"
      >
        <span class="quick-subj-icon">${s.icon}</span>
        <span class="quick-subj-name">${s.name}</span>
        <span class="quick-subj-time">${isThisRunning ? '⏱️ 計時中...' : timeText}</span>
      </button>
    `;
  }).join('');
}

function renderQuickSlotsOverview(day) {
  const container = document.getElementById('quickSlotsGrid');
  if (!container) return;

  const active = findActiveTimerSlot();

  container.innerHTML = SLOT_KEYS.map(({ key, label, timeRange, icon }) => {
    const s = day[key];
    const isThisActive = active && active.day.dayCountdown === day.dayCountdown && active.slotKey === key;
    const isRunning = s.timerStatus === 'running';
    const isPaused = s.timerStatus === 'paused';
    const effMins = getSlotEffectiveMinutes(s);

    let statusBadge = '';
    if (isRunning) {
      statusBadge = '<span class="quick-slot-badge" style="background:#FFF0F3;color:#D9536F;">⏱️ 計時中</span>';
    } else if (isPaused) {
      statusBadge = '<span class="quick-slot-badge" style="background:#FFF7ED;color:#D98A3C;">⏸️ 暫停中</span>';
    } else if (s.completed) {
      statusBadge = '<span class="quick-slot-badge" style="background:#EDF8F2;color:#2E7350;">✅ 已完成</span>';
    } else if (effMins > 0) {
      statusBadge = '<span class="quick-slot-badge" style="background:#F2EDEC;color:#6E6568;">已記錄</span>';
    } else {
      statusBadge = '<span class="quick-slot-badge" style="background:#F4EFEA;color:#9E9497;">尚未開始</span>';
    }

    const timeDetails = s.startTime || s.endTime ? `${s.startTime || '--:--'} ~ ${s.endTime || '--:--'}` : timeRange;

    return `
      <div class="quick-slot-card ${isThisActive ? 'is-active' : ''}">
        <div class="quick-slot-header">
          <span class="quick-slot-title">${icon} ${label} (${timeRange})</span>
          ${statusBadge}
        </div>
        <div class="quick-slot-details">
          <div><strong>科目：</strong>${escapeHtml(s.subject || '（未選）')}</div>
          ${s.task ? `<div><strong>任務：</strong>${escapeHtml(s.task)}</div>` : ''}
          <div><strong>時間：</strong>${timeDetails}（共 ${formatMinutesToHM(effMins)}）</div>
        </div>
      </div>
    `;
  }).join('');
}

function handleQuickSubjectClick(subjectName) {
  const targetDayCountdown = currentActiveDayCountdown;
  const day = appState.days.find(d => d.dayCountdown === targetDayCountdown);
  if (!day) return;

  const active = findActiveTimerSlot();
  if (active && active.slot.timerStatus === 'running') {
    if (active.slot.subject === subjectName && active.day.dayCountdown === targetDayCountdown) {
      handleYptTimerAction('ypt-pause', active.day.dayCountdown, active.slotKey);
      renderQuickTimerView();
      return;
    } else {
      handleYptTimerAction('ypt-pause', active.day.dayCountdown, active.slotKey);
    }
  }

  // 依當前「開始時間」判定時段（以開始時間作為最重要依據）
  const now = new Date();
  const slotKey = getSlotKeyFromStartTime(now);
  const slot = day[slotKey];

  slot.subject = subjectName;
  if (!slot.startTime || slot.timerStatus === 'idle' || slot.timerStatus === 'ended') {
    slot.startTime = getCurrentTimeHM();
  }

  handleYptTimerAction('ypt-start', day.dayCountdown, slotKey);
  renderQuickTimerView();
}

/* ==========================================================================
   分頁 2：📖 今日專注（每天計時使用）渲染與邏輯
   ========================================================================== */

function renderDailyPlanView() {
  const day = appState.days.find(d => d.dayCountdown === currentActiveDayCountdown);
  if (!day) return;

  const badgeEl = document.getElementById('dailyDayBadge');
  const headingEl = document.getElementById('dailyDateHeading');
  const phaseBadgeEl = document.getElementById('dailyPhaseBadge');
  const calendarInput = document.getElementById('dailyCalendarInput');
  const selectEl = document.getElementById('dailyDaySelect');

  if (badgeEl) badgeEl.textContent = `Day ${day.dayCountdown}`;
  if (headingEl) headingEl.textContent = `${day.dateDisplay}（${day.weekdayDisplay}）`;
  if (phaseBadgeEl) {
    const phaseIdx = getPhaseIndexForDay(day.dayCountdown);
    const p = appState.phases[phaseIdx] || DEFAULT_PHASES[phaseIdx];
    phaseBadgeEl.textContent = p.name;
  }
  if (calendarInput && document.activeElement !== calendarInput) {
    calendarInput.value = day.calendar || '';
  }

  if (selectEl) {
    selectEl.innerHTML = appState.days.map(d => `
      <option value="${d.dayCountdown}" ${d.dayCountdown === day.dayCountdown ? 'selected' : ''}>
        Day ${d.dayCountdown} - ${d.dateDisplay} (${d.weekdayDisplay})
      </option>
    `).join('');
  }

  renderDailySlotsDetailed(day);

  const doneCount = SLOT_KEYS.filter(({ key }) => day[key].completed).length;
  const rate = Math.round((doneCount / 3) * 100);
  const totalMins = getDayTotalEffectiveMinutes(day);

  const doneCountEl = document.getElementById('dailyDoneCount');
  const doneRateEl = document.getElementById('dailyDoneRate');
  const totalTimeEl = document.getElementById('dailyTotalTime');

  if (doneCountEl) doneCountEl.textContent = `${doneCount} / 3`;
  if (doneRateEl) doneRateEl.textContent = `${rate}%`;
  if (totalTimeEl) totalTimeEl.textContent = formatMinutesToHM(totalMins);
}

function renderDailySlotsDetailed(day) {
  const container = document.getElementById('dailySlotsContainer');
  if (!container) return;

  container.innerHTML = SLOT_KEYS.map(({ key, label, timeRange, icon }) => {
    const s = day[key];
    const isThisRunning = s.timerStatus === 'running';
    const isThisPaused = s.timerStatus === 'paused';
    const effMins = getSlotEffectiveMinutes(s);
    const liveMs = getSlotLiveMs(s);

    const durHr = Math.floor(effMins / 60);
    const durMin = effMins % 60;

    const [defStart, defEnd] = timeRange.split('~');

    const subjectOptionsHtml = SUBJECT_OPTIONS.map(opt => `
      <option value="${escapeHtml(opt)}" ${s.subject === opt ? 'selected' : ''}>${escapeHtml(opt || '— 選擇科目 —')}</option>
    `).join('');

    return `
      <div class="daily-slot-card ${s.completed ? 'completed' : ''} ${isThisRunning ? 'running' : ''}" id="daily-card-${day.dayCountdown}-${key}">
        <div class="daily-slot-card-header">
          <div class="daily-slot-card-title">
            <span>${icon} ${label}時段</span>
            <span class="daily-slot-time-range">(${timeRange})</span>
          </div>
          <div class="slot-done-wrap">
            <label class="done-checkbox-label">
              <input
                type="checkbox"
                class="done-checkbox daily-done-checkbox"
                data-day="${day.dayCountdown}"
                data-slot="${key}"
                ${s.completed ? 'checked' : ''}
              />
              <span class="done-text">${s.completed ? '已完成' : '標記完成'}</span>
            </label>
          </div>
        </div>

        <div class="daily-slot-card-body">
          <div class="daily-field-group">
            <label class="daily-field-label">讀書科目：</label>
            <select class="subject-select daily-subject-select" data-day="${day.dayCountdown}" data-slot="${key}">
              ${subjectOptionsHtml}
            </select>
          </div>

          <div class="daily-field-group">
            <label class="daily-field-label">範圍 / 任務目標：</label>
            <input
              type="text"
              class="task-input daily-task-input"
              data-day="${day.dayCountdown}"
              data-slot="${key}"
              value="${escapeHtml(s.task)}"
              placeholder="例如：Ch14完、700題＋計量、複習實戰書..."
            />
          </div>

          <!-- YPT 計時控制列 -->
          <div class="daily-timer-strip">
            <div class="ypt-btn-group">
              <button
                type="button"
                class="ypt-btn btn-start"
                data-action="ypt-start"
                data-day="${day.dayCountdown}"
                data-slot="${key}"
                ${isThisRunning ? 'disabled' : ''}
              >${s.timerStatus === 'ended' ? '重新計時 ▶' : '開始 ▶'}</button>

              <button
                type="button"
                class="ypt-btn btn-pause"
                data-action="ypt-pause"
                data-day="${day.dayCountdown}"
                data-slot="${key}"
                ${!isThisRunning ? 'disabled' : ''}
              >暫停 ⏸</button>

              <button
                type="button"
                class="ypt-btn btn-resume"
                data-action="ypt-resume"
                data-day="${day.dayCountdown}"
                data-slot="${key}"
                ${!isThisPaused ? 'disabled' : ''}
              >繼續 ▶</button>

              <button
                type="button"
                class="ypt-btn btn-stop"
                data-action="ypt-stop"
                data-day="${day.dayCountdown}"
                data-slot="${key}"
                ${!isThisRunning && !isThisPaused ? 'disabled' : ''}
              >結束 ⏹</button>
            </div>

            <div class="daily-timer-clock-box">
              <span style="font-size:12px;color:var(--text-secondary);">專注計時：</span>
              <span class="daily-live-clock" id="daily-clock-${day.dayCountdown}-${key}">
                ${formatMsToClock(liveMs)}
              </span>
            </div>
          </div>

          <!-- 時間手動微調 -->
          <div class="slot-time-inputs" style="grid-column: 1 / -1; display:flex; align-items:center; gap:16px; flex-wrap:wrap; margin-top:2px;">
            <div class="time-range-group">
              <span>起</span>
              <input
                type="text"
                class="time-hm-input daily-time-input"
                data-day="${day.dayCountdown}"
                data-slot="${key}"
                data-field="startTime"
                value="${escapeHtml(s.startTime)}"
                placeholder="${defStart}"
                maxlength="5"
              />
              <span>迄</span>
              <input
                type="text"
                class="time-hm-input daily-time-input"
                data-day="${day.dayCountdown}"
                data-slot="${key}"
                data-field="endTime"
                value="${escapeHtml(s.endTime)}"
                placeholder="${defEnd}"
                maxlength="5"
              />
            </div>

            <div class="duration-manual-group">
              <span class="duration-label">真實時長:</span>
              <input
                type="number"
                min="0"
                max="24"
                class="dur-num-input daily-dur-hr"
                data-day="${day.dayCountdown}"
                data-slot="${key}"
                value="${durHr}"
              />
              <span class="duration-unit">時</span>
              <input
                type="number"
                min="0"
                max="59"
                class="dur-num-input daily-dur-min"
                data-day="${day.dayCountdown}"
                data-slot="${key}"
                value="${durMin}"
              />
              <span class="duration-unit">分</span>
            </div>
          </div>

        </div>
      </div>
    `;
  }).join('');
}

function updateDailyPlanLiveClocks(active) {
  if (!active || active.day.dayCountdown !== currentActiveDayCountdown) return;
  const clockEl = document.getElementById(`daily-clock-${active.day.dayCountdown}-${active.slotKey}`);
  if (clockEl) {
    clockEl.textContent = formatMsToClock(getSlotLiveMs(active.slot));
  }
}

/* ==========================================================================
   UI 渲染：主工作區（每日讀書計劃與 YPT 真實計時表格）
   ========================================================================== */

function renderMainScheduleTable() {
  const tbody = document.getElementById('planTableBody');
  if (!tbody) return;

  const filteredDays = appState.days.filter(day => {
    // 1. 階段或紀錄篩選
    if (currentPhaseFilter === 'phase-0' && getPhaseIndexForDay(day.dayCountdown) !== 0) return false;
    if (currentPhaseFilter === 'phase-1' && getPhaseIndexForDay(day.dayCountdown) !== 1) return false;
    if (currentPhaseFilter === 'phase-2' && getPhaseIndexForDay(day.dayCountdown) !== 2) return false;
    if (currentPhaseFilter === 'has-record') {
      const hasRec = SLOT_KEYS.some(({ key }) => {
        const s = day[key];
        return s.completed || getSlotEffectiveMinutes(s) > 0 || s.timerStatus === 'running' || s.timerStatus === 'paused';
      });
      if (!hasRec) return false;
    }

    // 2. 科目篩選
    if (currentSubjectFilter) {
      const matchSubj = SLOT_KEYS.some(({ key }) => {
        const subj = day[key].subject;
        if (currentSubjectFilter === '經濟') {
          return subj === '經濟' || subj === '個經' || subj === '總經';
        }
        return subj === currentSubjectFilter;
      });
      if (!matchSubj) return false;
    }

    // 3. 關鍵字搜尋
    if (currentSearchQuery) {
      const q = currentSearchQuery.toLowerCase();
      const hay = [
        day.dateDisplay,
        day.weekdayDisplay,
        `day ${day.dayCountdown}`,
        day.calendar,
        day.morning.subject,
        day.morning.task,
        day.afternoon.subject,
        day.afternoon.task,
        day.evening.subject,
        day.evening.task
      ].join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }

    return true;
  });

  if (filteredDays.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="9" style="text-align:center; padding: 36px; color: var(--text-muted);">
          找不到符合篩選條件的日期列，請切換上方篩選分頁或清除搜尋關鍵字 🌸
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = filteredDays.map(day => buildDayRowHtml(day)).join('');
}

function buildDayRowHtml(day) {
  const phaseIdx = getPhaseIndexForDay(day.dayCountdown);
  const phaseName = phaseIdx >= 0 ? appState.phases[phaseIdx].name : '未分類';

  const hasActiveTimer = SLOT_KEYS.some(({ key }) => day[key].timerStatus === 'running' || day[key].timerStatus === 'paused');

  // 計算當日自動彙總
  const doneCount = SLOT_KEYS.reduce((acc, { key }) => acc + (day[key].completed ? 1 : 0), 0);
  const ratePct = doneCount === 0 ? 0 : doneCount === 1 ? 33 : doneCount === 2 ? 67 : 100;
  const totalDayMins = SLOT_KEYS.reduce((acc, { key }) => acc + getSlotEffectiveMinutes(day[key]), 0);

  const rowClasses = [
    hasActiveTimer ? 'row-active-timer' : '',
    doneCount === 3 ? 'row-complete-all' : ''
  ].filter(Boolean).join(' ');

  return `
    <tr id="row-day-${day.dayCountdown}" class="${rowClasses}" data-day="${day.dayCountdown}">
      <!-- Date -->
      <td class="sticky-col-1">
        <div class="date-cell-content">
          <span class="date-main">${day.dateDisplay}</span>
          <span class="date-weekday ${day.isWeekend ? 'weekend' : ''}">${day.weekdayDisplay}</span>
        </div>
      </td>

      <!-- Day Countdown -->
      <td class="sticky-col-2" style="text-align:center;">
        <span class="day-badge">Day ${day.dayCountdown}</span>
        <span class="phase-mini-tag" id="row-phase-tag-${day.dayCountdown}">${escapeHtml(phaseName)}</span>
        <button type="button" class="btn btn-xs btn-subtle jump-to-daily-btn" data-jump-day="${day.dayCountdown}" style="margin-top:4px;padding:2px 6px;font-size:11px;" title="開啟此日的專注計時與詳細規劃">今日專注 ➔</button>
      </td>

      <!-- 行事曆 -->
      <td class="calendar-cell">
        <textarea
          class="calendar-input"
          data-day="${day.dayCountdown}"
          data-field="calendar"
          placeholder="自由輸入行程、期中考或死線..."
        >${escapeHtml(day.calendar)}</textarea>
      </td>

      <!-- 三大時段：早上 / 下午 / 晚上 -->
      ${SLOT_KEYS.map(({ key }) => buildSlotCellHtml(day.dayCountdown, key, day[key])).join('')}

      <!-- 每日自動彙總：每日完成 (0~3) -->
      <td class="summary-cell">
        <span class="daily-done-count" id="summary-done-${day.dayCountdown}">${doneCount}</span>
        <span class="stat-sub-val">/ 3 時段</span>
      </td>

      <!-- 每日自動彙總：每日完成率 (0%, 33%, 67%, 100%) -->
      <td class="summary-cell">
        <div class="daily-rate-wrap">
          <span class="daily-rate-text" id="summary-rate-${day.dayCountdown}">${ratePct}%</span>
          <div class="mini-progress-bar">
            <div class="mini-progress-fill" id="summary-bar-${day.dayCountdown}" style="width: ${ratePct}%;"></div>
          </div>
        </div>
      </td>

      <!-- 每日自動彙總：每日讀書時間 -->
      <td class="summary-cell">
        <span class="daily-total-time ${totalDayMins > 0 ? 'has-time' : ''}" id="summary-time-${day.dayCountdown}">
          ${formatMinutesToHM(totalDayMins)}
        </span>
      </td>
    </tr>
  `;
}

function buildSlotCellHtml(dayCountdown, slotKey, slot) {
  const effectiveMins = getSlotEffectiveMinutes(slot);
  const hoursVal = Math.floor(effectiveMins / 60);
  const minsVal = effectiveMins % 60;
  const liveMs = getSlotLiveMs(slot);

  const isRunning = slot.timerStatus === 'running';
  const isPaused = slot.timerStatus === 'paused';

  const cardStatusClass = [
    isRunning ? 'status-running' : '',
    isPaused ? 'status-paused' : '',
    slot.completed ? 'slot-completed' : ''
  ].filter(Boolean).join(' ');

  const subjectOptionsHtml = SUBJECT_OPTIONS.map(opt => {
    const label = opt === '' ? '科目...' : opt;
    const selected = slot.subject === opt ? 'selected' : '';
    return `<option value="${opt}" ${selected}>${label}</option>`;
  }).join('');

  return `
    <td class="slot-cell">
      <div class="slot-card ${cardStatusClass}" id="slot-card-${dayCountdown}-${slotKey}">
        <!-- 第一排：科目下拉選單 + 範圍/任務內容 + 完成打勾 -->
        <div class="slot-top-row">
          <select
            class="subject-select"
            data-day="${dayCountdown}"
            data-slot="${slotKey}"
            data-field="subject"
            data-subj="${slot.subject}"
          >
            ${subjectOptionsHtml}
          </select>

          <input
            type="text"
            class="task-input"
            data-day="${dayCountdown}"
            data-slot="${slotKey}"
            data-field="task"
            value="${escapeHtml(slot.task)}"
            placeholder="範圍/任務 (如: 700題+計量)"
          />

          <label class="done-check-label" title="勾選代表完成此時段">
            <input
              type="checkbox"
              class="done-checkbox"
              data-day="${dayCountdown}"
              data-slot="${slotKey}"
              data-field="completed"
              ${slot.completed ? 'checked' : ''}
            />
            <span>完成</span>
          </label>
        </div>

        <!-- 第二排：YPT 模式計時器按鈕組 (開始 ▶ / 暫停 ⏸ / 繼續 ▶ / 結束 ⏹) + 即時讀秒 -->
        <div class="slot-timer-row">
          <div class="ypt-btn-group">
            <button
              type="button"
              class="ypt-btn btn-start"
              data-action="ypt-start"
              data-day="${dayCountdown}"
              data-slot="${slotKey}"
              ${isRunning || isPaused ? 'disabled' : ''}
              title="首次按下開始：自動記錄當下時間為開始時間並啟動計時"
            >開始 ▶</button>

            <button
              type="button"
              class="ypt-btn btn-pause"
              data-action="ypt-pause"
              data-day="${dayCountdown}"
              data-slot="${slotKey}"
              ${!isRunning ? 'disabled' : ''}
              title="休息或暫離時點擊暫停：立即停止累加時間"
            >暫停 ⏸</button>

            <button
              type="button"
              class="ypt-btn btn-resume"
              data-action="ypt-resume"
              data-day="${dayCountdown}"
              data-slot="${slotKey}"
              ${!isPaused ? 'disabled' : ''}
              title="繼續累加淨專注讀書時間"
            >繼續 ▶</button>

            <button
              type="button"
              class="ypt-btn btn-stop"
              data-action="ypt-stop"
              data-day="${dayCountdown}"
              data-slot="${slotKey}"
              ${!isRunning && !isPaused ? 'disabled' : ''}
              title="按下結束：自動記錄結束時間並鎖定真實讀書淨時長"
            >結束 ⏹</button>
          </div>

          <span class="ypt-live-display" id="ypt-clock-${dayCountdown}-${slotKey}">
            ${formatMsToClock(liveMs)}
          </span>
        </div>

        <!-- 第三排：開始時間、結束時間 與 真實讀書時長（支援手動微調） -->
        <div class="slot-time-inputs">
          <div class="time-range-group" title="可直接點擊手動輸入或修改開始與結束時間">
            <span>起</span>
            <input
              type="text"
              class="time-hm-input"
              id="start-input-${dayCountdown}-${slotKey}"
              data-day="${dayCountdown}"
              data-slot="${slotKey}"
              data-field="startTime"
              value="${escapeHtml(slot.startTime)}"
              placeholder="${slotKey === 'morning' ? '05:00' : (slotKey === 'afternoon' ? '12:00' : '19:00')}"
              maxlength="5"
            />
            <span>迄</span>
            <input
              type="text"
              class="time-hm-input"
              id="end-input-${dayCountdown}-${slotKey}"
              data-day="${dayCountdown}"
              data-slot="${slotKey}"
              data-field="endTime"
              value="${escapeHtml(slot.endTime)}"
              placeholder="${slotKey === 'morning' ? '12:00' : (slotKey === 'afternoon' ? '19:00' : '05:00')}"
              maxlength="5"
            />
          </div>

          <div class="duration-manual-group" title="真實讀書時長（僅計算淨專注時間，可直接手動輸入微調）">
            <span class="duration-label">真實時長:</span>
            <input
              type="number"
              min="0"
              max="24"
              class="dur-num-input"
              id="dur-hr-${dayCountdown}-${slotKey}"
              data-day="${dayCountdown}"
              data-slot="${slotKey}"
              data-field="durationHours"
              value="${hoursVal}"
            />
            <span>時</span>
            <input
              type="number"
              min="0"
              max="59"
              class="dur-num-input"
              id="dur-min-${dayCountdown}-${slotKey}"
              data-day="${dayCountdown}"
              data-slot="${slotKey}"
              data-field="durationMins"
              value="${minsVal}"
            />
            <span>分</span>
          </div>
        </div>
      </div>
    </td>
  `;
}

/**
 * 局部更新單日右側彙總與特定時段卡片（避免重新渲染整張表導致輸入框失焦）
 */
function updateSingleDayRowSummaryDom(day) {
  const doneCount = SLOT_KEYS.reduce((acc, { key }) => acc + (day[key].completed ? 1 : 0), 0);
  const ratePct = doneCount === 0 ? 0 : doneCount === 1 ? 33 : doneCount === 2 ? 67 : 100;
  const totalDayMins = SLOT_KEYS.reduce((acc, { key }) => acc + getSlotEffectiveMinutes(day[key]), 0);

  const doneEl = document.getElementById(`summary-done-${day.dayCountdown}`);
  const rateEl = document.getElementById(`summary-rate-${day.dayCountdown}`);
  const barEl = document.getElementById(`summary-bar-${day.dayCountdown}`);
  const timeEl = document.getElementById(`summary-time-${day.dayCountdown}`);
  const rowEl = document.getElementById(`row-day-${day.dayCountdown}`);

  if (doneEl) doneEl.textContent = String(doneCount);
  if (rateEl) rateEl.textContent = `${ratePct}%`;
  if (barEl) barEl.style.width = `${ratePct}%`;
  if (timeEl) {
    timeEl.textContent = formatMinutesToHM(totalDayMins);
    timeEl.classList.toggle('has-time', totalDayMins > 0);
  }
  if (rowEl) {
    const hasActive = SLOT_KEYS.some(({ key }) => day[key].timerStatus === 'running' || day[key].timerStatus === 'paused');
    rowEl.classList.toggle('row-active-timer', hasActive);
    rowEl.classList.toggle('row-complete-all', doneCount === 3);
  }
}

/* ==========================================================================
   YPT 模式計時器核心控制（Date.now() 時間戳記差值計算，背景不掉秒）
   ========================================================================== */

function findActiveTimerSlot() {
  for (const day of appState.days) {
    for (const { key, label } of SLOT_KEYS) {
      const slot = day[key];
      if (slot.timerStatus === 'running' || slot.timerStatus === 'paused') {
        return { day, slotKey: key, slotLabel: label, slot };
      }
    }
  }
  return null;
}

function handleYptTimerAction(action, dayCountdown, slotKey) {
  const day = appState.days.find(d => d.dayCountdown === Number(dayCountdown));
  if (!day) return;
  const slot = day[slotKey];
  if (!slot) return;

  const now = Date.now();

  if (action === 'ypt-start') {
    // 若有其他正在跑的時段，先自動將其暫停以確保單一專注計時準確
    pauseOtherActiveSlots(day.dayCountdown, slotKey);

    if (!slot.startTime) {
      slot.startTime = getCurrentTimeHM();
    }
    // 若先前已有手動輸入的時長，從該時長基礎上繼續或從 0 開始
    if (slot.timerStatus === 'idle' || slot.timerStatus === 'ended') {
      slot.accumulatedMs = (slot.durationMinutes || 0) * 60000;
      slot.endTime = ''; // 重新開始計時時清除舊的結束時間，待按「結束」再重新記錄
    }
    slot.timerStatus = 'running';
    slot.lastResumeTimestamp = now;

    showToast(`▶ 開始專注計時：${day.dateDisplay} ${getSlotLabel(slotKey)}（開始時間 ${slot.startTime}）`);
  } else if (action === 'ypt-pause') {
    if (slot.timerStatus === 'running' && slot.lastResumeTimestamp) {
      slot.accumulatedMs = (slot.accumulatedMs || 0) + Math.max(0, now - slot.lastResumeTimestamp);
    }
    slot.lastResumeTimestamp = null;
    slot.timerStatus = 'paused';
    slot.durationMinutes = slot.accumulatedMs > 0 ? Math.max(1, Math.round(slot.accumulatedMs / 60000)) : 0;

    showToast(`⏸ 已暫停計時：休息期間不計入真實讀書時長`);
  } else if (action === 'ypt-resume') {
    pauseOtherActiveSlots(day.dayCountdown, slotKey);
    slot.timerStatus = 'running';
    slot.lastResumeTimestamp = now;

    showToast(`▶ 繼續專注計時：${day.dateDisplay} ${getSlotLabel(slotKey)}`);
  } else if (action === 'ypt-stop') {
    if (slot.timerStatus === 'running' && slot.lastResumeTimestamp) {
      slot.accumulatedMs = (slot.accumulatedMs || 0) + Math.max(0, now - slot.lastResumeTimestamp);
    }
    slot.lastResumeTimestamp = null;
    slot.timerStatus = 'ended';
    slot.endTime = getCurrentTimeHM();

    // 計算鎖定淨時長（若累積大於 1 秒但未滿 1 分鐘，以 1 分鐘計，方便測試與短時紀錄；超過 1 分鐘則四捨五入至分鐘）
    const totalMs = slot.accumulatedMs || 0;
    const netMinutes = totalMs >= 1000 ? Math.max(1, Math.round(totalMs / 60000)) : 0;
    slot.durationMinutes = netMinutes;
    slot.accumulatedMs = netMinutes * 60000;

    showToast(`⏹ 結束計時！已鎖定真實讀書時長：${formatMinutesToHM(netMinutes)}（結束時間 ${slot.endTime}）`);
  }

  saveState();
  refreshSlotDom(day, slotKey);
  updateSingleDayRowSummaryDom(day);
  updateActiveTimerBanner();
  renderAllStatistics();
  renderQuickTimerView();
  renderDailyPlanView();
  if (isRoomConnected && !isReceivingRemoteUpdate) {
    broadcastRoomDelta({
      kind: 'timer',
      day: day.dayCountdown,
      slot: slotKey,
      timerStatus: slot.timerStatus,
      startTime: slot.startTime,
      endTime: slot.endTime,
      durationMinutes: slot.durationMinutes,
      accumulatedMs: slot.accumulatedMs,
      label: `${day.dateDisplay} ${getSlotLabel(slotKey)}`
    });
  }
}

function pauseOtherActiveSlots(currentDayCountdown, currentSlotKey) {
  const now = Date.now();
  appState.days.forEach(d => {
    SLOT_KEYS.forEach(({ key }) => {
      if (d.dayCountdown === Number(currentDayCountdown) && key === currentSlotKey) return;
      const s = d[key];
      if (s.timerStatus === 'running') {
        if (s.lastResumeTimestamp) {
          s.accumulatedMs = (s.accumulatedMs || 0) + Math.max(0, now - s.lastResumeTimestamp);
        }
        s.lastResumeTimestamp = null;
        s.timerStatus = 'paused';
        s.durationMinutes = s.accumulatedMs > 0 ? Math.max(1, Math.round(s.accumulatedMs / 60000)) : 0;
        refreshSlotDom(d, key);
        updateSingleDayRowSummaryDom(d);
      }
    });
  });
}

function refreshSlotDom(day, slotKey) {
  const cardEl = document.getElementById(`slot-card-${day.dayCountdown}-${slotKey}`);
  if (!cardEl) return;
  const parentTd = cardEl.parentElement;
  if (!parentTd) return;

  // 重新渲染該時段儲存格內部 HTML
  const temp = document.createElement('tbody');
  temp.innerHTML = `<tr>${buildSlotCellHtml(day.dayCountdown, slotKey, day[slotKey])}</tr>`;
  const newTd = temp.querySelector('td');
  if (newTd) {
    parentTd.replaceWith(newTd);
  }
}

/**
 * 每秒定時更新正在運行或暫停中的時鐘與統計（背景分頁切換回來時自動以 Date.now() 差值對齊）
 */
function startGlobalTimerTicker() {
  if (timerIntervalId) clearInterval(timerIntervalId);
  let lastMinuteBucket = -1;

  timerIntervalId = setInterval(() => {
    const active = findActiveTimerSlot();
    updateActiveTimerBanner(active);

    if (currentActiveTab === 'quick-timer') {
      updateQuickTimerDom();
    } else if (currentActiveTab === 'daily-plan') {
      updateDailyPlanLiveClocks(active);
    }

    if (active && active.slot.timerStatus === 'running') {
      const liveMs = getSlotLiveMs(active.slot);
      const clockEl = document.getElementById(`ypt-clock-${active.day.dayCountdown}-${active.slotKey}`);
      if (clockEl) {
        clockEl.textContent = formatMsToClock(liveMs);
      }

      const currentMinuteBucket = Math.floor(liveMs / 60000);
      if (currentMinuteBucket !== lastMinuteBucket) {
        lastMinuteBucket = currentMinuteBucket;
        const effectiveMins = getSlotEffectiveMinutes(active.slot);
        const hrEl = document.getElementById(`dur-hr-${active.day.dayCountdown}-${active.slotKey}`);
        const minEl = document.getElementById(`dur-min-${active.day.dayCountdown}-${active.slotKey}`);
        if (hrEl && document.activeElement !== hrEl) hrEl.value = Math.floor(effectiveMins / 60);
        if (minEl && document.activeElement !== minEl) minEl.value = effectiveMins % 60;

        updateSingleDayRowSummaryDom(active.day);
        renderAllStatistics();
        if (currentActiveTab === 'quick-timer') {
          renderQuickTimerView();
        } else if (currentActiveTab === 'daily-plan') {
          renderDailyPlanView();
        }
      }
    }
  }, 500);
}

/**
 * 更新頂部懸浮 YPT 計時狀態列
 */
function updateActiveTimerBanner(activeObj = findActiveTimerSlot()) {
  const banner = document.getElementById('activeTimerBanner');
  if (!banner) return;

  if (!activeObj) {
    banner.classList.add('hidden');
    return;
  }

  banner.classList.remove('hidden');
  const { day, slotKey, slotLabel, slot } = activeObj;
  const isPaused = slot.timerStatus === 'paused';
  banner.classList.toggle('paused', isPaused);

  const labelEl = document.getElementById('bannerSlotLabel');
  const pillEl = document.getElementById('bannerSubjectPill');
  const clockEl = document.getElementById('bannerClock');
  const toggleBtn = document.getElementById('bannerToggleBtn');

  if (labelEl) {
    labelEl.textContent = `${day.dateDisplay} (Day ${day.dayCountdown}) ${slotLabel}`;
  }
  if (pillEl) {
    const subjText = slot.subject || '未選科目';
    pillEl.textContent = subjText;
    pillEl.setAttribute('data-subj', slot.subject || '其他');
  }
  if (clockEl) {
    clockEl.textContent = formatMsToClock(getSlotLiveMs(slot));
  }
  if (toggleBtn) {
    if (isPaused) {
      toggleBtn.textContent = '繼續 ▶';
      toggleBtn.className = 'ypt-btn btn-resume';
    } else {
      toggleBtn.textContent = '暫停 ⏸';
      toggleBtn.className = 'ypt-btn btn-pause';
    }
  }

  banner.dataset.day = day.dayCountdown;
  banner.dataset.slot = slotKey;
}

/* ==========================================================================
   事件綁定與互動處理
   ========================================================================== */

function setupEventListeners() {
  // 1. 三階段設定變更（名稱與 Day 起訖範圍）
  const phasesContainer = document.getElementById('phasesConfigContainer');
  if (phasesContainer) {
    phasesContainer.addEventListener('input', (e) => {
      const target = e.target;
      const idx = Number(target.dataset.phaseIdx);
      if (Number.isNaN(idx) || !appState.phases[idx]) return;

      if (target.classList.contains('phase-name-input')) {
        appState.phases[idx].name = target.value.trim() || `階段 ${idx + 1}`;
        saveState();
        // 更新篩選按鈕與主表格階段小標籤與統計表
        const btn = document.getElementById(`filterTabPhase${idx}`);
        if (btn) {
          const p = appState.phases[idx];
          btn.textContent = `${p.name} (Day ${p.startDay}-${p.endDay})`;
        }
        updateAllRowPhaseTags();
        renderFullDashboard();
      } else if (target.classList.contains('phase-day-input')) {
        const bound = target.dataset.bound;
        let val = parseInt(target.value, 10);
        if (Number.isNaN(val)) return;
        val = Math.max(1, Math.min(85, val));
        appState.phases[idx][bound] = val;
        saveState();

        const p = appState.phases[idx];
        const btn = document.getElementById(`filterTabPhase${idx}`);
        if (btn) btn.textContent = `${p.name} (Day ${p.startDay}-${p.endDay})`;

        // 更新該階段卡片上的日期提示
        const card = target.closest('.phase-config-item');
        if (card) {
          const hintEl = card.querySelector('.phase-date-hint');
          const high = Math.max(p.startDay, p.endDay);
          const low = Math.min(p.startDay, p.endDay);
          if (hintEl) {
            hintEl.textContent = `${getDateLabelForCountdown(high)}~${getDateLabelForCountdown(low)} (${high - low + 1}天)`;
          }
        }

        updateAllRowPhaseTags();
        renderFullDashboard();
        if (isRoomConnected && !isReceivingRemoteUpdate) {
          broadcastRoomDelta({ kind: 'phases', phases: appState.phases });
        }
      }
    });

    // 失焦時把被夾限的數值寫回輸入框（例如輸入 99 → 85）
    phasesContainer.addEventListener('change', (e) => {
      const target = e.target;
      if (!target.classList.contains('phase-day-input')) return;
      const idx = Number(target.dataset.phaseIdx);
      const p = appState.phases[idx];
      if (p) target.value = p[target.dataset.bound];
    });
  }

  // 還原預設三階段按鈕
  const restorePhasesBtn = document.getElementById('restoreDefaultPhasesBtn');
  if (restorePhasesBtn) {
    restorePhasesBtn.addEventListener('click', () => {
      appState.phases = JSON.parse(JSON.stringify(DEFAULT_PHASES));
      saveState();
      renderPhasesConfig();
      updateAllRowPhaseTags();
      renderFullDashboard();
      showToast('🌸 已還原預設三階段區間（Day 85-61、60-31、30-1）');
    });
  }

  // 2. 小櫻目標表編輯事件
  const goalTable = document.getElementById('goalTable');
  if (goalTable) {
    goalTable.addEventListener('input', (e) => {
      const target = e.target;
      if (!target.classList.contains('goal-textarea')) return;
      const subj = target.dataset.goalSubj;
      const phaseKey = target.dataset.goalPhase;
      if (!subj || !phaseKey) return;
      if (!appState.goals[subj]) appState.goals[subj] = {};
      appState.goals[subj][phaseKey] = target.value;
      saveState();
      if (isRoomConnected && !isReceivingRemoteUpdate) {
        broadcastRoomDelta({ kind: 'goal', subj, phaseKey, val: target.value });
      }
    });
  }

  // 3. 主表格：YPT 按鈕點擊委派
  const planTableBody = document.getElementById('planTableBody');
  if (planTableBody) {
    planTableBody.addEventListener('click', (e) => {
      const jumpBtn = e.target.closest('.jump-to-daily-btn');
      if (jumpBtn && jumpBtn.dataset.jumpDay) {
        changeDailyPlanDay(Number(jumpBtn.dataset.jumpDay));
        switchMainTab('daily-plan');
        return;
      }

      const btn = e.target.closest('button[data-action]');
      if (!btn) return;
      const action = btn.dataset.action;
      const dayCountdown = Number(btn.dataset.day);
      const slotKey = btn.dataset.slot;
      handleYptTimerAction(action, dayCountdown, slotKey);
    });

    // 主表格：科目下拉、完成勾選、開始/結束時間、真實時長手動微調
    planTableBody.addEventListener('change', (e) => {
      const target = e.target;
      const dayCountdown = Number(target.dataset.day);
      const day = appState.days.find(d => d.dayCountdown === dayCountdown);
      if (!day) return;

      const field = target.dataset.field;
      const slotKey = target.dataset.slot;
      const slot = slotKey ? day[slotKey] : null;

      if (field === 'subject' && slot) {
        slot.subject = target.value;
        target.setAttribute('data-subj', slot.subject);
        saveState();
        updateActiveTimerBanner();
        renderAllStatistics();
        if (isRoomConnected && !isReceivingRemoteUpdate) {
          broadcastRoomDelta({ kind: 'subject', day: dayCountdown, slot: slotKey, val: slot.subject });
        }
      } else if (field === 'completed' && slot) {
        slot.completed = target.checked;
        const cardEl = document.getElementById(`slot-card-${dayCountdown}-${slotKey}`);
        if (cardEl) cardEl.classList.toggle('slot-completed', slot.completed);
        saveState();
        updateSingleDayRowSummaryDom(day);
        renderAllStatistics();
        if (isRoomConnected && !isReceivingRemoteUpdate) {
          broadcastRoomDelta({
            kind: 'completed',
            day: dayCountdown,
            slot: slotKey,
            val: slot.completed,
            label: `${day.dateDisplay} ${getSlotLabel(slotKey)}`
          });
        }
      } else if ((field === 'startTime' || field === 'endTime') && slot) {
        const normalizedTime = normalizeTimeInput(target.value);
        if (normalizedTime === null) {
          target.value = slot[field] || '';
          showToast('⚠️ 時間格式不正確，請輸入如 08:30、830 或 8:30');
          return;
        }
        slot[field] = normalizedTime;
        target.value = normalizedTime;
        // 若使用者手動輸入了開始與結束時間，且目前真實讀書時長為 0，貼心自動試算時長（仍可隨時手動修改）
        if (slot.startTime && slot.endTime && slot.durationMinutes === 0 && slot.timerStatus === 'idle') {
          const autoMins = computeMinutesBetweenHM(slot.startTime, slot.endTime);
          if (autoMins > 0) {
            slot.durationMinutes = autoMins;
            slot.accumulatedMs = autoMins * 60000;
            const hrEl = document.getElementById(`dur-hr-${dayCountdown}-${slotKey}`);
            const minEl = document.getElementById(`dur-min-${dayCountdown}-${slotKey}`);
            const clockEl = document.getElementById(`ypt-clock-${dayCountdown}-${slotKey}`);
            if (hrEl) hrEl.value = Math.floor(autoMins / 60);
            if (minEl) minEl.value = autoMins % 60;
            if (clockEl) clockEl.textContent = formatMsToClock(slot.accumulatedMs);
          }
        }
        saveState();
        updateSingleDayRowSummaryDom(day);
        renderAllStatistics();
        if (isRoomConnected && !isReceivingRemoteUpdate) {
          broadcastRoomDelta({
            kind: 'time',
            day: dayCountdown,
            slot: slotKey,
            startTime: slot.startTime,
            endTime: slot.endTime,
            durationMinutes: slot.durationMinutes
          });
        }
      } else if ((field === 'durationHours' || field === 'durationMins') && slot) {
        const hrEl = document.getElementById(`dur-hr-${dayCountdown}-${slotKey}`);
        const minEl = document.getElementById(`dur-min-${dayCountdown}-${slotKey}`);
        const hrs = Math.max(0, Math.min(24, parseInt(hrEl ? hrEl.value : '0', 10) || 0));
        const mins = Math.max(0, Math.min(59, parseInt(minEl ? minEl.value : '0', 10) || 0));
        if (hrEl) hrEl.value = hrs;
        if (minEl) minEl.value = mins;

        const totalManualMins = hrs * 60 + mins;
        slot.durationMinutes = totalManualMins;
        slot.accumulatedMs = totalManualMins * 60000;
        if (slot.timerStatus === 'running') {
          slot.lastResumeTimestamp = Date.now();
        }

        const clockEl = document.getElementById(`ypt-clock-${dayCountdown}-${slotKey}`);
        if (clockEl) clockEl.textContent = formatMsToClock(slot.accumulatedMs);

        saveState();
        updateSingleDayRowSummaryDom(day);
        updateActiveTimerBanner();
        renderAllStatistics();
        if (isRoomConnected && !isReceivingRemoteUpdate) {
          broadcastRoomDelta({
            kind: 'time',
            day: dayCountdown,
            slot: slotKey,
            startTime: slot.startTime,
            endTime: slot.endTime,
            durationMinutes: slot.durationMinutes
          });
        }
      }
    });

    // 主表格：行事曆與範圍任務文字即時輸入儲存
    planTableBody.addEventListener('input', (e) => {
      const target = e.target;
      const dayCountdown = Number(target.dataset.day);
      const day = appState.days.find(d => d.dayCountdown === dayCountdown);
      if (!day) return;

      const field = target.dataset.field;
      const slotKey = target.dataset.slot;

      if (field === 'calendar') {
        day.calendar = target.value;
        saveState();
        if (isRoomConnected && !isReceivingRemoteUpdate) {
          broadcastRoomDeltaDebounced({ kind: 'calendar', day: dayCountdown, val: day.calendar });
        }
      } else if (field === 'task' && slotKey && day[slotKey]) {
        day[slotKey].task = target.value;
        saveState();
        if (isRoomConnected && !isReceivingRemoteUpdate) {
          broadcastRoomDeltaDebounced({ kind: 'task', day: dayCountdown, slot: slotKey, val: day[slotKey].task });
        }
      } else if ((field === 'durationHours' || field === 'durationMins') && slotKey && day[slotKey]) {
        const slot = day[slotKey];
        const hrEl = document.getElementById(`dur-hr-${dayCountdown}-${slotKey}`);
        const minEl = document.getElementById(`dur-min-${dayCountdown}-${slotKey}`);
        const hrs = Math.max(0, Math.min(24, parseInt(hrEl ? hrEl.value : '0', 10) || 0));
        const mins = Math.max(0, Math.min(59, parseInt(minEl ? minEl.value : '0', 10) || 0));
        const totalManualMins = hrs * 60 + mins;
        slot.durationMinutes = totalManualMins;
        slot.accumulatedMs = totalManualMins * 60000;
        if (slot.timerStatus === 'running') {
          slot.lastResumeTimestamp = Date.now();
        }
        const clockEl = document.getElementById(`ypt-clock-${dayCountdown}-${slotKey}`);
        if (clockEl) clockEl.textContent = formatMsToClock(slot.accumulatedMs);

        saveState();
        updateSingleDayRowSummaryDom(day);
        renderAllStatistics();
      }
    });
  }

  // 4. 頂部懸浮計時列控制按鈕
  const bannerToggleBtn = document.getElementById('bannerToggleBtn');
  const bannerStopBtn = document.getElementById('bannerStopBtn');
  const bannerJumpBtn = document.getElementById('bannerJumpBtn');

  if (bannerToggleBtn) {
    bannerToggleBtn.addEventListener('click', () => {
      const active = findActiveTimerSlot();
      if (!active) return;
      const action = active.slot.timerStatus === 'running' ? 'ypt-pause' : 'ypt-resume';
      handleYptTimerAction(action, active.day.dayCountdown, active.slotKey);
    });
  }
  if (bannerStopBtn) {
    bannerStopBtn.addEventListener('click', () => {
      const active = findActiveTimerSlot();
      if (!active) return;
      handleYptTimerAction('ypt-stop', active.day.dayCountdown, active.slotKey);
    });
  }
  if (bannerJumpBtn) {
    bannerJumpBtn.addEventListener('click', () => {
      const active = findActiveTimerSlot();
      if (!active) return;
      currentActiveDayCountdown = active.day.dayCountdown;
      switchMainTab('quick-timer');
    });
  }

  // 5. 階段篩選 Tabs、科目篩選與搜尋框
  const phaseFilterTabs = document.getElementById('phaseFilterTabs');
  if (phaseFilterTabs) {
    phaseFilterTabs.addEventListener('click', (e) => {
      const btn = e.target.closest('.filter-tab');
      if (!btn) return;
      phaseFilterTabs.querySelectorAll('.filter-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentPhaseFilter = btn.dataset.filter || 'all';
      renderMainScheduleTable();
    });
  }

  const subjectFilterSelect = document.getElementById('subjectFilterSelect');
  if (subjectFilterSelect) {
    subjectFilterSelect.addEventListener('change', (e) => {
      currentSubjectFilter = e.target.value;
      renderMainScheduleTable();
    });
  }

  const searchInput = document.getElementById('searchScheduleInput');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      currentSearchQuery = e.target.value.trim();
      renderMainScheduleTable();
    });
  }

  const jumpBtn = document.getElementById('jumpToTodayOrTopBtn');
  if (jumpBtn) {
    jumpBtn.addEventListener('click', () => {
      const now = new Date();
      const mm = String(now.getMonth() + 1).padStart(2, '0');
      const dd = String(now.getDate()).padStart(2, '0');
      const todayMatch = appState.days.find(d => d.isoDate.endsWith(`-${mm}-${dd}`));
      if (todayMatch) {
        scrollToDayRow(todayMatch.dayCountdown);
      } else {
        scrollToDayRow(85);
      }
    });
  }

  // 6. 切換排版與展開/收合統計面板
  const toggleLayoutBtn = document.getElementById('toggleLayoutBtn');
  if (toggleLayoutBtn) {
    toggleLayoutBtn.addEventListener('click', () => {
      isSideBySideLayout = !isSideBySideLayout;
      const splitEl = document.getElementById('workspaceSplit');
      if (splitEl) {
        splitEl.classList.toggle('side-by-side', isSideBySideLayout);
      }
      toggleLayoutBtn.textContent = isSideBySideLayout ? '切換上下全寬 ▤' : '切換左右並排 ◫';
      showToast(isSideBySideLayout ? '已切換為「左右並排（Numbers 經典檢視）」' : '已切換為「上下全寬檢視」');
    });
  }

  const toggleDashboardBtn = document.getElementById('toggleDashboardBtn');
  if (toggleDashboardBtn) {
    toggleDashboardBtn.addEventListener('click', () => {
      isDashboardCollapsed = !isDashboardCollapsed;
      const dash = document.getElementById('dashboardSection');
      if (dash) {
        dash.style.display = isDashboardCollapsed ? 'none' : 'flex';
      }
      toggleDashboardBtn.textContent = isDashboardCollapsed ? '展開統計面板 ▼' : '收合統計面板 ▲';
    });
  }

  // 7. 帶入原表預排範圍（時間與打勾維持不動或歸零）
  const loadPdfPlanBtn = document.getElementById('loadPdfPlanBtn');
  if (loadPdfPlanBtn) {
    loadPdfPlanBtn.addEventListener('click', () => {
      appState.days.forEach(day => {
        const mmdd = day.isoDate.slice(5);
        const pre = PDF_PREPLANNED_DATA[mmdd];
        if (!pre) return;
        if (!day.calendar && pre.calendar) day.calendar = pre.calendar;
        SLOT_KEYS.forEach(({ key }) => {
          if (!day[key].subject && pre[key][0]) day[key].subject = pre[key][0];
          if (!day[key].task && pre[key][1]) day[key].task = pre[key][1];
        });
      });
      saveState();
      renderMainScheduleTable();
      renderAllStatistics();
      showToast('🌸 已帶入原 Numbers 表 11/1~12/7 之預排科目與範圍（時間與打勾紀錄維持不變）');
    });
  }

  // 8. JSON 匯出與匯入備份功能
  const exportBtn = document.getElementById('exportJsonBtn');
  if (exportBtn) {
    exportBtn.addEventListener('click', exportJsonBackup);
  }

  const importInput = document.getElementById('importJsonInput');
  if (importInput) {
    importInput.addEventListener('change', importJsonBackup);
  }

  // 9. 全新重置按鈕
  const resetAllBtn = document.getElementById('resetAllBtn');
  if (resetAllBtn) {
    resetAllBtn.addEventListener('click', () => {
      const confirmed = window.confirm(
        '確定要將所有讀書時間、計時器與打勾紀錄「從零開始重新計算」嗎？\n\n（將重置 11/1~1/24 共 85 天的開始/結束時間、真實讀書時長與打勾；已填寫的科目、範圍、行事曆與小櫻目標會保留。建議先「匯出 JSON」備份）'
      );
      if (!confirmed) return;
      appState.days.forEach(day => {
        SLOT_KEYS.forEach(({ key }) => {
          day[key] = createEmptySlot(day[key].subject, day[key].task);
        });
      });
      saveState();
      renderPhasesConfig();
      renderMainScheduleTable();
      renderFullDashboard();
      renderQuickTimerView();
      renderDailyPlanView();
      updateActiveTimerBanner();
      showToast('✨ 已將 85 天所有時間、計時器與打勾紀錄全新重置為 0（科目、範圍、行事曆與目標保留）');
    });
  }

  // 10. 主要分頁導航切換（快捷計時、今日專注、行事曆、統計列表）
  const mainTabsNav = document.getElementById('mainTabsNav');
  if (mainTabsNav) {
    mainTabsNav.addEventListener('click', (e) => {
      const btn = e.target.closest('.tab-nav-btn');
      if (btn && btn.dataset.tab) {
        switchMainTab(btn.dataset.tab);
      }
    });
  }

  // 11. 分頁 1（快捷計時）互動處理
  const quickGrid = document.getElementById('quickSubjectsGrid');
  if (quickGrid) {
    quickGrid.addEventListener('click', (e) => {
      const btn = e.target.closest('.quick-subj-btn');
      if (btn && btn.dataset.quickSubject) {
        handleQuickSubjectClick(btn.dataset.quickSubject);
      }
    });
  }

  const quickPauseResumeBtn = document.getElementById('quickPauseResumeBtn');
  if (quickPauseResumeBtn) {
    quickPauseResumeBtn.addEventListener('click', () => {
      const active = findActiveTimerSlot();
      if (!active) return;
      const action = active.slot.timerStatus === 'running' ? 'ypt-pause' : 'ypt-resume';
      handleYptTimerAction(action, active.day.dayCountdown, active.slotKey);
    });
  }

  const quickStopBtn = document.getElementById('quickStopBtn');
  if (quickStopBtn) {
    quickStopBtn.addEventListener('click', () => {
      const active = findActiveTimerSlot();
      if (!active) return;
      handleYptTimerAction('ypt-stop', active.day.dayCountdown, active.slotKey);
    });
  }

  const quickSwitchDayBtn = document.getElementById('quickSwitchDayBtn');
  if (quickSwitchDayBtn) {
    quickSwitchDayBtn.addEventListener('click', () => {
      switchMainTab('daily-plan');
    });
  }

  const quickJumpToDailyBtn = document.getElementById('quickJumpToDailyBtn');
  if (quickJumpToDailyBtn) {
    quickJumpToDailyBtn.addEventListener('click', () => {
      switchMainTab('daily-plan');
    });
  }

  // 12. 分頁 2（今日專注 / 每天計時）互動處理
  const dailyPrevDayBtn = document.getElementById('dailyPrevDayBtn');
  const dailyNextDayBtn = document.getElementById('dailyNextDayBtn');
  const dailyTodayBtn = document.getElementById('dailyTodayBtn');
  const dailyDaySelect = document.getElementById('dailyDaySelect');
  const dailyCalendarInput = document.getElementById('dailyCalendarInput');
  const dailySlotsContainer = document.getElementById('dailySlotsContainer');

  if (dailyPrevDayBtn) {
    dailyPrevDayBtn.addEventListener('click', () => {
      changeDailyPlanDay(currentActiveDayCountdown + 1);
    });
  }
  if (dailyNextDayBtn) {
    dailyNextDayBtn.addEventListener('click', () => {
      changeDailyPlanDay(currentActiveDayCountdown - 1);
    });
  }
  if (dailyTodayBtn) {
    dailyTodayBtn.addEventListener('click', () => {
      changeDailyPlanDay(getTodayDayCountdown());
    });
  }
  if (dailyDaySelect) {
    dailyDaySelect.addEventListener('change', (e) => {
      changeDailyPlanDay(Number(e.target.value));
    });
  }
  if (dailyCalendarInput) {
    dailyCalendarInput.addEventListener('input', (e) => {
      const day = appState.days.find(d => d.dayCountdown === currentActiveDayCountdown);
      if (!day) return;
      day.calendar = e.target.value;
      saveState();
      const mainRow = document.getElementById(`row-day-${day.dayCountdown}`);
      if (mainRow) {
        const inp = mainRow.querySelector('.calendar-input');
        if (inp && document.activeElement !== inp) inp.value = day.calendar;
      }
      broadcastRoomDeltaDebounced({ kind: 'calendar', day: day.dayCountdown, val: day.calendar });
    });
  }

  if (dailySlotsContainer) {
    dailySlotsContainer.addEventListener('change', (e) => {
      const target = e.target;
      const dayCountdown = Number(target.dataset.day);
      const slotKey = target.dataset.slot;
      const day = appState.days.find(d => d.dayCountdown === dayCountdown);
      if (!day || !day[slotKey]) return;
      const slot = day[slotKey];

      if (target.classList.contains('daily-subject-select')) {
        slot.subject = target.value;
        saveState();
        refreshSlotDom(day, slotKey);
        renderDailyPlanView();
        renderQuickTimerView();
        renderAllStatistics();
        broadcastRoomDeltaDebounced({ kind: 'subject', day: dayCountdown, slot: slotKey, val: slot.subject });
      } else if (target.classList.contains('daily-done-checkbox')) {
        slot.completed = target.checked;
        saveState();
        refreshSlotDom(day, slotKey);
        renderDailyPlanView();
        renderQuickTimerView();
        renderAllStatistics();
        broadcastRoomDelta({ kind: 'completed', day: dayCountdown, slot: slotKey, val: slot.completed, label: `${day.dateDisplay} ${getSlotLabel(slotKey)}` });
      } else if (target.classList.contains('daily-time-input')) {
        const field = target.dataset.field;
        slot[field] = target.value.trim();
        saveState();
        refreshSlotDom(day, slotKey);
        renderDailyPlanView();
        renderQuickTimerView();
        renderAllStatistics();
        broadcastRoomDeltaDebounced({ kind: 'time', day: dayCountdown, slot: slotKey, startTime: slot.startTime, endTime: slot.endTime, durationMinutes: slot.durationMinutes });
      } else if (target.classList.contains('daily-dur-hr') || target.classList.contains('daily-dur-min')) {
        const card = document.getElementById(`daily-card-${dayCountdown}-${slotKey}`);
        const hr = Number(card.querySelector('.daily-dur-hr').value) || 0;
        const min = Number(card.querySelector('.daily-dur-min').value) || 0;
        slot.durationMinutes = Math.max(0, hr * 60 + min);
        slot.accumulatedMs = slot.durationMinutes * 60000;
        saveState();
        refreshSlotDom(day, slotKey);
        renderDailyPlanView();
        renderQuickTimerView();
        renderAllStatistics();
        broadcastRoomDeltaDebounced({ kind: 'time', day: dayCountdown, slot: slotKey, durationMinutes: slot.durationMinutes });
      }
    });

    dailySlotsContainer.addEventListener('input', (e) => {
      const target = e.target;
      if (target.classList.contains('daily-task-input')) {
        const dayCountdown = Number(target.dataset.day);
        const slotKey = target.dataset.slot;
        const day = appState.days.find(d => d.dayCountdown === dayCountdown);
        if (!day || !day[slotKey]) return;
        day[slotKey].task = target.value;
        saveState();
        const mainCard = document.getElementById(`slot-card-${dayCountdown}-${slotKey}`);
        if (mainCard) {
          const inp = mainCard.querySelector('.task-input');
          if (inp && document.activeElement !== inp) inp.value = target.value;
        }
        broadcastRoomDeltaDebounced({ kind: 'task', day: dayCountdown, slot: slotKey, val: target.value });
      }
    });

    dailySlotsContainer.addEventListener('click', (e) => {
      const btn = e.target.closest('.ypt-btn');
      if (!btn) return;
      const action = btn.dataset.action;
      const dayCountdown = Number(btn.dataset.day);
      const slotKey = btn.dataset.slot;
      if (action && dayCountdown && slotKey) {
        handleYptTimerAction(action, dayCountdown, slotKey);
      }
    });
  }

  // 13. 設定彈窗（⚙️ 開啟 / 關閉）
  const openSettingsModalBtn = document.getElementById('openSettingsModalBtn');
  const closeSettingsModalBtn = document.getElementById('closeSettingsModalBtn');
  const settingsModal = document.getElementById('settingsModal');

  if (openSettingsModalBtn && settingsModal) {
    openSettingsModalBtn.addEventListener('click', () => {
      settingsModal.classList.remove('hidden');
    });
  }
  if (closeSettingsModalBtn && settingsModal) {
    closeSettingsModalBtn.addEventListener('click', () => {
      settingsModal.classList.add('hidden');
    });
  }
  if (settingsModal) {
    settingsModal.addEventListener('click', (e) => {
      if (e.target === settingsModal) {
        settingsModal.classList.add('hidden');
      }
    });
  }


}

/* ==========================================================================
   輔助工具函式
   ========================================================================== */

function updateAllRowPhaseTags() {
  appState.days.forEach(day => {
    const tagEl = document.getElementById(`row-phase-tag-${day.dayCountdown}`);
    if (tagEl) {
      const idx = getPhaseIndexForDay(day.dayCountdown);
      tagEl.textContent = idx >= 0 ? appState.phases[idx].name : '未分類';
    }
  });
}

function scrollToDayRow(dayCountdown) {
  switchMainTab('calendar-schedule');
  setTimeout(() => {
    let row = document.getElementById(`row-day-${dayCountdown}`);
    if (!row) {
      currentPhaseFilter = 'all';
      currentSubjectFilter = '';
      currentSearchQuery = '';
      const tabs = document.querySelectorAll('#phaseFilterTabs .filter-tab');
      tabs.forEach(t => t.classList.toggle('active', t.dataset.filter === 'all'));
      const searchEl = document.getElementById('searchScheduleInput');
      if (searchEl) searchEl.value = '';
      const subjEl = document.getElementById('subjectFilterSelect');
      if (subjEl) subjEl.value = '';
      renderMainScheduleTable();
      row = document.getElementById(`row-day-${dayCountdown}`);
    }
    if (row) {
      row.scrollIntoView({ behavior: 'smooth', block: 'center' });
      row.style.transition = 'box-shadow 0.3s';
      row.style.boxShadow = 'inset 0 0 0 2px var(--sakura-primary)';
      setTimeout(() => {
        row.style.boxShadow = '';
      }, 1800);
    }
  }, 100);
}

function computeMinutesBetweenHM(startStr, endStr) {
  const m1 = /^(\d{1,2}):(\d{2})$/.exec(startStr);
  const m2 = /^(\d{1,2}):(\d{2})$/.exec(endStr);
  if (!m1 || !m2) return 0;
  const startMins = parseInt(m1[1], 10) * 60 + parseInt(m1[2], 10);
  let endMins = parseInt(m2[1], 10) * 60 + parseInt(m2[2], 10);
  if (endMins < startMins) {
    // 跨午夜（例如 22:00 ~ 01:00）
    endMins += 24 * 60;
  }
  return Math.max(0, endMins - startMins);
}

function getSlotLabel(slotKey) {
  const found = SLOT_KEYS.find(s => s.key === slotKey);
  return found ? found.label : slotKey;
}

function exportJsonBackup() {
  try {
    const dataStr = JSON.stringify(appState, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const now = new Date();
    const dateTag = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
    a.href = url;
    a.download = `小櫻讀書計劃表備份_${dateTag}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('📦 已成功匯出 JSON 備份檔案！');
  } catch (err) {
    console.error('Export failed:', err);
    showToast('⚠️ 匯出失敗');
  }
}

function importJsonBackup(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (evt) => {
    try {
      const imported = normalizeState(JSON.parse(evt.target.result));
      if (!imported) {
        showToast('⚠️ 匯入格式不符：請選擇有效的 85 天小櫻讀書計劃表 JSON 備份檔');
        return;
      }
      if (!window.confirm('匯入將覆蓋目前瀏覽器中的所有資料，確定要繼續嗎？')) return;
      appState = imported;
      saveState();
      renderPhasesConfig();
      renderMainScheduleTable();
      renderFullDashboard();
      renderQuickTimerView();
      renderDailyPlanView();
      updateActiveTimerBanner();
      showToast('🌸 已成功匯入並還原讀書計劃表資料！');
    } catch (err) {
      console.error('Import JSON error:', err);
      showToast('⚠️ JSON 檔案解析失敗，請確認檔案格式');
    } finally {
      e.target.value = '';
    }
  };
  reader.readAsText(file);
}

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ==========================================================================
   🌸 免註冊・多人即時同步讀書房核心模組（免 Google 帳號、免兩階段驗證、多人可編輯）
   ========================================================================== */

/**
 * 壓縮狀態以節省頻寬與即時傳輸量（僅保留有內容的日期與時段）
 */
function compactState(st) {
  const compactDays = {};
  st.days.forEach(d => {
    const dayEntry = {};
    if (d.calendar && d.calendar.trim()) dayEntry.c = d.calendar.trim();
    SLOT_KEYS.forEach(({ key }) => {
      const s = d[key];
      if (s.subject || s.task || s.durationMinutes || s.completed || s.startTime || s.endTime || (s.accumulatedMs && s.accumulatedMs > 0)) {
        const arr = [
          s.subject || '',
          s.task || '',
          s.durationMinutes || 0,
          s.completed ? 1 : 0,
          s.startTime || '',
          s.endTime || '',
          s.timerStatus || 'idle',
          s.accumulatedMs || 0
        ];
        // 移除尾部預設值以極度精簡傳輸體積
        while (arr.length > 2 && (
          (arr.length === 8 && arr[7] === 0) ||
          (arr.length === 7 && arr[6] === 'idle') ||
          (arr.length === 6 && arr[5] === '') ||
          (arr.length === 5 && arr[4] === '') ||
          (arr.length === 4 && arr[3] === 0) ||
          (arr.length === 3 && arr[2] === 0)
        )) {
          arr.pop();
        }
        dayEntry[key[0]] = arr;
      }
    });
    if (Object.keys(dayEntry).length > 0) {
      compactDays[d.dayCountdown] = dayEntry;
    }
  });
  return { p: st.phases, g: st.goals, d: compactDays };
}

/**
 * 解壓縮還原完整 85 天狀態
 */
function unpackCompactState(compact) {
  const base = generate85DaysSchedule(false);
  const phases = (compact.p && Array.isArray(compact.p) && compact.p.length === 3) ? compact.p : DEFAULT_PHASES;
  const goals = compact.g || DEFAULT_GOALS;
  const compactDays = compact.d || {};

  const days = base.map(day => {
    const saved = compactDays[day.dayCountdown];
    if (saved) {
      if (typeof saved.c === 'string') day.calendar = saved.c;
      SLOT_KEYS.forEach(({ key }) => {
        const slotData = saved[key[0]];
        if (Array.isArray(slotData)) {
          day[key] = {
            subject: slotData[0] || '',
            task: slotData[1] || '',
            durationMinutes: Number(slotData[2]) || 0,
            completed: Boolean(slotData[3]),
            startTime: slotData[4] || '',
            endTime: slotData[5] || '',
            timerStatus: slotData[6] || 'idle',
            accumulatedMs: Number(slotData[7]) || 0,
            lastResumeTimestamp: null
          };
        }
      });
    }
    return day;
  });

  return normalizeState({ version: 1, phases, goals, days });
}

/**
 * 向共同房間廣播即時訊息（透過 HTTPS POST）
 */
async function broadcastToRoom(messageObj) {
  if (!isRoomConnected || !currentRoomId) return;
  const topic = `sakura_room_${encodeURIComponent(currentRoomId)}`;
  try {
    await fetch(`https://ntfy.sh/${topic}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(messageObj)
    });
  } catch (err) {
    console.warn('Room broadcast failed:', err);
  }
}

/**
 * 廣播個別細項異動（打勾、修改時間、寫筆記等毫秒級同步）
 */
function broadcastRoomDelta(payload) {
  if (!isRoomConnected || !currentRoomId || isReceivingRemoteUpdate) return;
  broadcastToRoom({
    type: 'DELTA',
    roomId: currentRoomId,
    senderId: myClientId,
    senderName: myNickname,
    ts: Date.now(),
    payload
  });
}

let roomInputDebounce = null;
function broadcastRoomDeltaDebounced(payload) {
  if (roomInputDebounce) clearTimeout(roomInputDebounce);
  roomInputDebounce = setTimeout(() => {
    broadcastRoomDelta(payload);
  }, 450);
}

/**
 * 廣播完整狀態（開房、加入或手動強制推送時）
 */
let lastFullBroadcastTs = 0;
function broadcastFullStateToRoom() {
  if (!isRoomConnected || !currentRoomId || isReceivingRemoteUpdate) return;
  lastFullBroadcastTs = Date.now();
  broadcastToRoom({
    type: 'FULL',
    roomId: currentRoomId,
    senderId: myClientId,
    senderName: myNickname,
    ts: Date.now(),
    compact: compactState(appState)
  });
}

/**
 * 解析共同房間訊息（支援直接 JSON 訊息，以及 ntfy 大於 4KB 轉為檔案附件時的自動讀取）
 */
async function extractRoomMessagePayload(msgEvent) {
  if (!msgEvent) return null;

  // 1. 若為 ntfy 超過 4KB 轉成的檔案附件
  if (msgEvent.attachment && msgEvent.attachment.url) {
    try {
      const res = await fetch(msgEvent.attachment.url);
      if (res.ok) {
        return await res.json();
      }
    } catch (e) {
      console.warn('Failed to fetch room attachment:', e);
    }
  }

  // 2. 一般文字訊息
  if (msgEvent.message) {
    try {
      return JSON.parse(msgEvent.message);
    } catch (e) {
      return null;
    }
  }

  return null;
}

/**
 * 連線至共同房間（WebSocket 全球即時頻道，免帳號、免2FA）
 */
function connectToSharedRoom(roomId, nickname = '我', isInitial = false) {
  const cleanRoomId = (roomId || 'sakura-study-2026').trim().replace(/[^a-zA-Z0-9_一-龥-]/g, '_');
  if (!cleanRoomId) return;

  // 避免重複連線造成 WebSocket 閃爍與無窮重連風暴
  if (roomWs && (roomWs.readyState === WebSocket.OPEN || roomWs.readyState === WebSocket.CONNECTING) && currentRoomId === cleanRoomId) {
    myNickname = (nickname || '我').trim() || '我';
    setRoomNavbarStatus('connected');
    return;
  }

  if (roomReconnectTimeout) {
    clearTimeout(roomReconnectTimeout);
    roomReconnectTimeout = null;
  }

  if (roomWs) {
    try { roomWs.close(); } catch (e) {}
    roomWs = null;
  }

  currentRoomId = cleanRoomId;
  myNickname = (nickname || '我').trim() || '我';
  setRoomNavbarStatus('connected');

  const topic = `sakura_room_${encodeURIComponent(currentRoomId)}`;
  const wsUrl = `wss://ntfy.sh/${topic}/ws`;

  try {
    roomWs = new WebSocket(wsUrl);

    roomWs.onopen = () => {
      isRoomConnected = true;
      localStorage.setItem(ROOM_STORAGE_KEY, JSON.stringify({
        enabled: true,
        roomId: currentRoomId,
        nickname: myNickname
      }));

      setRoomNavbarStatus('connected');
      renderRoomModalState();

      // 發送加入通知，請求房間內其他在線成員同步最新進度
      broadcastToRoom({
        type: 'JOIN',
        roomId: currentRoomId,
        senderId: myClientId,
        senderName: myNickname,
        ts: Date.now()
      });

      // 同時主動向伺服器快取查詢最新進度
      pollLatestRoomSnapshot(topic);

      if (!isInitial) {
        showToast(`🌸 已成功加入房間【${currentRoomId}】！多人即時同步中`);
      }
    };

    roomWs.onmessage = async (event) => {
      try {
        const msgEvent = JSON.parse(event.data);
        if (msgEvent.event === 'message') {
          const data = await extractRoomMessagePayload(msgEvent);
          if (data) {
            handleRoomIncomingMessage(data);
          }
        }
      } catch (err) {
        // 忽略非預期訊息
      }
    };

    roomWs.onclose = () => {
      isRoomConnected = false;
      renderRoomModalState();

      // 若使用者仍處於連線設定中，則 6 秒後自動重連
      const stored = localStorage.getItem(ROOM_STORAGE_KEY);
      if (stored) {
        try {
          const parsed = JSON.parse(stored);
          if (parsed && parsed.enabled) {
            roomReconnectTimeout = setTimeout(() => {
              connectToSharedRoom(currentRoomId, myNickname, true);
            }, 6000);
          }
        } catch (e) {}
      }
    };

    roomWs.onerror = (err) => {
      console.warn('Room WebSocket error:', err);
    };
  } catch (err) {
    console.error('Failed to open room WebSocket:', err);
  }
}

let lastJoinResponseTs = 0;
let lastJoinToastTs = 0;
let lastKnownJoinSender = '';

/**
 * 處理房間內收到的即時更新訊息
 */
function handleRoomIncomingMessage(msg) {
  if (!msg || msg.senderId === myClientId) return; // 略過自己發出的廣播

  if (msg.type === 'JOIN') {
    const now = Date.now();
    // 夥伴加入通知防洗版（同一個人在 15 秒內只彈一次提示）
    if (now - lastJoinToastTs > 15000 || lastKnownJoinSender !== msg.senderId) {
      lastJoinToastTs = now;
      lastKnownJoinSender = msg.senderId;
      showToast(`👋 夥伴【${escapeHtml(msg.senderName || '新成員')}】已連線！`);
    }

    // 關鍵防循環保護：8 秒內只回應一次 FULL，避免手機與電腦互相 JOIN 形成無窮發送風暴
    if (now - lastJoinResponseTs > 8000) {
      lastJoinResponseTs = now;
      broadcastFullStateToRoom();
    }
    return;
  }

  if (msg.type === 'REQ_FULL') {
    const now = Date.now();
    if (now - lastJoinResponseTs > 5000) {
      lastJoinResponseTs = now;
      broadcastFullStateToRoom();
    }
    return;
  }

  if (msg.type === 'FULL' && msg.compact) {
    const remote = unpackCompactState(msg.compact);
    if (!remote) return;

    isReceivingRemoteUpdate = true;
    appState = remote;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(appState)); } catch (e) {}

    renderPhasesConfig();
    renderMainScheduleTable();
    renderFullDashboard();
    renderQuickTimerView();
    renderDailyPlanView();
    updateActiveTimerBanner();

    isReceivingRemoteUpdate = false;
    updateSaveStatusDisplay();
    showToast(`🌸 已自房間同步【${escapeHtml(msg.senderName || '成員')}】更新的完整進度！`);
    return;
  }

  if (msg.type === 'DELTA' && msg.payload) {
    const p = msg.payload;
    isReceivingRemoteUpdate = true;

    if (p.kind === 'completed') {
      const day = appState.days.find(d => d.dayCountdown === Number(p.day));
      if (day && day[p.slot]) {
        day[p.slot].completed = Boolean(p.val);
        const cardEl = document.getElementById(`slot-card-${p.day}-${p.slot}`);
        if (cardEl) cardEl.classList.toggle('slot-completed', day[p.slot].completed);
        const chk = cardEl ? cardEl.querySelector('.done-checkbox') : null;
        if (chk) chk.checked = day[p.slot].completed;

        updateSingleDayRowSummaryDom(day);
        renderAllStatistics();
        saveState(false, false);
        showToast(`🌸 ${escapeHtml(msg.senderName || '夥伴')} ${p.val ? '打勾完成了' : '取消了'} ${p.label || '時段'}！`);
      }
    } else if (p.kind === 'subject') {
      const day = appState.days.find(d => d.dayCountdown === Number(p.day));
      if (day && day[p.slot]) {
        day[p.slot].subject = p.val;
        refreshSlotDom(day, p.slot);
        renderAllStatistics();
        saveState(false, false);
      }
    } else if (p.kind === 'time') {
      const day = appState.days.find(d => d.dayCountdown === Number(p.day));
      if (day && day[p.slot]) {
        if (p.startTime !== undefined) day[p.slot].startTime = p.startTime;
        if (p.endTime !== undefined) day[p.slot].endTime = p.endTime;
        if (p.durationMinutes !== undefined) {
          day[p.slot].durationMinutes = p.durationMinutes;
          day[p.slot].accumulatedMs = p.durationMinutes * 60000;
        }
        refreshSlotDom(day, p.slot);
        updateSingleDayRowSummaryDom(day);
        renderAllStatistics();
        saveState(false, false);
      }
    } else if (p.kind === 'timer') {
      const day = appState.days.find(d => d.dayCountdown === Number(p.day));
      if (day && day[p.slot]) {
        day[p.slot].timerStatus = p.timerStatus || 'idle';
        day[p.slot].startTime = p.startTime || '';
        day[p.slot].endTime = p.endTime || '';
        day[p.slot].durationMinutes = p.durationMinutes || 0;
        day[p.slot].accumulatedMs = p.accumulatedMs || 0;
        day[p.slot].lastResumeTimestamp = (p.timerStatus === 'running') ? Date.now() : null;

        refreshSlotDom(day, p.slot);
        updateSingleDayRowSummaryDom(day);
        updateActiveTimerBanner();
        renderAllStatistics();
        saveState(false, false);
        if (p.timerStatus === 'running') {
          showToast(`⏱️ ${escapeHtml(msg.senderName || '夥伴')} 開始了 ${p.label || ''} 專注計時！`);
        } else if (p.timerStatus === 'ended') {
          showToast(`⏹️ ${escapeHtml(msg.senderName || '夥伴')} 結束了計時（鎖定 ${formatMinutesToHM(p.durationMinutes)}）`);
        }
      }
    } else if (p.kind === 'task') {
      const day = appState.days.find(d => d.dayCountdown === Number(p.day));
      if (day && day[p.slot]) {
        day[p.slot].task = p.val || '';
        const cardEl = document.getElementById(`slot-card-${p.day}-${p.slot}`);
        const inputEl = cardEl ? cardEl.querySelector('.task-input') : null;
        if (inputEl && document.activeElement !== inputEl) {
          inputEl.value = day[p.slot].task;
        }
        saveState(false, false);
      }
    } else if (p.kind === 'calendar') {
      const day = appState.days.find(d => d.dayCountdown === Number(p.day));
      if (day) {
        day.calendar = p.val || '';
        const row = document.getElementById(`row-day-${p.day}`);
        const inputEl = row ? row.querySelector('.calendar-input') : null;
        if (inputEl && document.activeElement !== inputEl) {
          inputEl.value = day.calendar;
        }
        saveState(false, false);
      }
    } else if (p.kind === 'goal') {
      if (!appState.goals[p.subj]) appState.goals[p.subj] = {};
      appState.goals[p.subj][p.phaseKey] = p.val || '';
      saveState(false, false);
      const textarea = document.querySelector(`.goal-textarea[data-goal-subj="${p.subj}"][data-goal-phase="${p.phaseKey}"]`);
      if (textarea && document.activeElement !== textarea) {
        textarea.value = p.val || '';
      }
    } else if (p.kind === 'phases') {
      if (Array.isArray(p.phases) && p.phases.length === 3) {
        appState.phases = p.phases;
        saveState(false, false);
        renderPhasesConfig();
        updateAllRowPhaseTags();
        renderFullDashboard();
      }
    }

    renderQuickTimerView();
    renderDailyPlanView();
    isReceivingRemoteUpdate = false;
  }
}

/**
 * 查詢房間最近一筆快取進度並依序回放最新異動
 */
async function pollLatestRoomSnapshot(topic) {
  try {
    const res = await fetch(`https://ntfy.sh/${topic}/json?poll=1`);
    if (!res.ok) return;
    const text = await res.text();
    const lines = text.trim().split('\n');
    let fullSnapshotIndex = -1;
    let fullSnapshotData = null;
    const items = [];

    for (let i = 0; i < lines.length; i++) {
      try {
        const item = JSON.parse(lines[i]);
        if (item.event === 'message') {
          const data = await extractRoomMessagePayload(item);
          if (data) {
            items.push(data);
            if (data.type === 'FULL' && data.compact && data.senderId !== myClientId) {
              fullSnapshotIndex = items.length - 1;
              fullSnapshotData = data;
            }
          }
        }
      } catch (e) {}
    }

    // 優先套用最新一筆完整快照
    if (fullSnapshotData) {
      handleRoomIncomingMessage(fullSnapshotData);
    }

    // 依序回放快照之後的所有最新細項異動
    const startIdx = fullSnapshotIndex >= 0 ? fullSnapshotIndex + 1 : 0;
    for (let i = startIdx; i < items.length; i++) {
      if (items[i] && items[i].type === 'DELTA' && items[i].senderId !== myClientId) {
        handleRoomIncomingMessage(items[i]);
      }
    }
  } catch (err) {
    console.warn('Poll room snapshot warning:', err);
  }
}

/**
 * 離開房間（切回個人單機模式）
 */
function leaveSharedRoom() {
  if (roomReconnectTimeout) {
    clearTimeout(roomReconnectTimeout);
    roomReconnectTimeout = null;
  }
  if (roomWs) {
    try { roomWs.close(); } catch (e) {}
    roomWs = null;
  }
  isRoomConnected = false;
  currentRoomId = '';
  localStorage.removeItem(ROOM_STORAGE_KEY);
  setRoomNavbarStatus('disconnected');
  renderRoomModalState();
  updateSaveStatusDisplay();
  showToast('🚪 已離開房間，切回個人單機模式');
}

/**
 * 更新導覽列房間同步按鈕狀態
 */
function setRoomNavbarStatus(status) {
  const btn = document.getElementById('roomSyncBtn');
  const textEl = document.getElementById('roomStatusText');
  if (!btn || !textEl) return;

  btn.classList.remove('connected', 'syncing');

  if (status === 'connected') {
    btn.classList.add('connected');
  } else if (status === 'syncing') {
    btn.classList.add('syncing');
  }

  // 保持按鈕文字穩定，絕對不切換長短字串，防止導覽列跳動閃爍
  textEl.textContent = currentRoomId ? `房號: ${currentRoomId}` : '多人同步房';
}

/**
 * 渲染房間彈窗內容（包含專屬連結與 QR Code）
 */
function renderRoomModalState() {
  const strip = document.getElementById('roomStatusStrip');
  const titleEl = document.getElementById('roomStatusTitle');
  const descEl = document.getElementById('roomStatusDesc');
  const roomPill = document.getElementById('currentRoomPill');
  const roomText = document.getElementById('currentRoomPillText');
  const shareSection = document.getElementById('roomShareSection');
  const manualSection = document.getElementById('roomManualSyncSection');
  const leaveBtn = document.getElementById('leaveRoomBtn');
  const shareInput = document.getElementById('roomShareUrlInput');
  const qrContainer = document.getElementById('roomQrCodeContainer');
  const roomIdInput = document.getElementById('roomInputId');
  const nicknameInput = document.getElementById('roomInputNickname');

  if (!strip) return;

  if (isRoomConnected && currentRoomId) {
    strip.classList.add('connected');
    if (titleEl) titleEl.textContent = `🟢 共同讀書房連線中（房號：${currentRoomId}）`;
    if (descEl) descEl.textContent = `多人協作模式已啟動！任何人在手機、電腦上的修改或打勾，所有人的畫面將在 0.1 秒內自動同步！`;
    if (roomPill && roomText) {
      roomPill.classList.remove('hidden');
      roomText.textContent = currentRoomId;
    }
    if (leaveBtn) leaveBtn.classList.remove('hidden');
    if (manualSection) manualSection.classList.remove('hidden');
    if (shareSection) shareSection.classList.remove('hidden');
    if (roomIdInput) roomIdInput.value = currentRoomId;
    if (nicknameInput) nicknameInput.value = myNickname;

    // 產生專屬房間邀請連結（傳給朋友或用手機點開即直接進入連線！）
    const shareUrl = `${window.location.origin}${window.location.pathname}?room=${encodeURIComponent(currentRoomId)}`;
    if (shareInput) shareInput.value = shareUrl;

    // 繪製 QR Code
    if (qrContainer && typeof window.QRCode !== 'undefined') {
      qrContainer.innerHTML = '';
      new window.QRCode(qrContainer, {
        text: shareUrl,
        width: 110,
        height: 110,
        colorDark: '#3A3335',
        colorLight: '#FFFFFF',
        correctLevel: window.QRCode.CorrectLevel.M
      });
    }
  } else {
    strip.classList.remove('connected');
    if (titleEl) titleEl.textContent = '尚未加入共同房間（個人單機模式）';
    if (descEl) descEl.textContent = '免登入 Google 帳號、免兩階段驗證！只要設定共同房號，不同人、不同手機或電腦皆可隨時進入，任何人打勾修改皆會即時推播給所有人！';
    if (roomPill) roomPill.classList.add('hidden');
    if (leaveBtn) leaveBtn.classList.add('hidden');
    if (manualSection) manualSection.classList.add('hidden');
    if (shareSection) shareSection.classList.add('hidden');
  }
}

/**
 * 從網址查詢參數解析房號（支援相容各版本瀏覽器）
 */
function getRoomParamFromUrl() {
  if (typeof URLSearchParams !== 'undefined') {
    const params = new URLSearchParams(window.location.search);
    if (params.has('room')) return params.get('room');
  }
  const match = /[?&]room=([^&#]+)/.exec(window.location.search || window.location.hash || '');
  return match ? decodeURIComponent(match[1]) : null;
}

/**
 * 初始化房間同步（支援網址參數 ?room=... 一鍵直接進房）
 */
function initRoomSyncFromStorageOrUrl() {
  setupRoomSyncEventListeners();

  // 1. 優先檢查網址參數 ?room=...（點開分享連結或掃 QR Code 一鍵自動進房）
  const roomParam = getRoomParamFromUrl();
  if (roomParam && roomParam.trim()) {
    const cleanId = roomParam.trim();
    connectToSharedRoom(cleanId, '訪客', false);
    return;
  }

  // 2. 檢查本機先前是否有設定連線房間
  const stored = localStorage.getItem(ROOM_STORAGE_KEY);
  if (stored) {
    try {
      const parsed = JSON.parse(stored);
      if (parsed && parsed.enabled && parsed.roomId) {
        connectToSharedRoom(parsed.roomId, parsed.nickname || '我', true);
        return;
      }
    } catch (e) {}
  }

  setRoomNavbarStatus('disconnected');
  renderRoomModalState();
}

/**
 * 綁定房間同步彈窗互動事件
 */
function setupRoomSyncEventListeners() {
  const modal = document.getElementById('roomSyncModal');
  const openBtn = document.getElementById('roomSyncBtn');
  const closeBtn = document.getElementById('closeRoomModalBtn');
  const joinBtn = document.getElementById('joinRoomBtn');
  const leaveBtn = document.getElementById('leaveRoomBtn');
  const pushBtn = document.getElementById('roomForcePushBtn');
  const pullBtn = document.getElementById('roomForcePullBtn');
  const copyBtn = document.getElementById('copyRoomUrlBtn');
  const roomIdInput = document.getElementById('roomInputId');
  const nicknameInput = document.getElementById('roomInputNickname');

  if (openBtn && modal) {
    openBtn.addEventListener('click', () => {
      renderRoomModalState();
      modal.classList.remove('hidden');
    });
  }

  if (closeBtn && modal) {
    closeBtn.addEventListener('click', () => {
      modal.classList.add('hidden');
    });
  }

  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        modal.classList.add('hidden');
      }
    });
  }

  if (joinBtn) {
    joinBtn.addEventListener('click', () => {
      const rId = (roomIdInput ? roomIdInput.value : '').trim();
      const nick = (nicknameInput ? nicknameInput.value : '').trim() || '我';
      if (!rId) {
        showToast('⚠️ 請輸入房間代碼');
        return;
      }
      connectToSharedRoom(rId, nick, false);
    });
  }

  if (leaveBtn) {
    leaveBtn.addEventListener('click', () => {
      if (window.confirm('確定要離開目前房間切回個人單機模式嗎？（本機已有的進度不會遺失）')) {
        leaveSharedRoom();
      }
    });
  }

  if (pushBtn) {
    pushBtn.addEventListener('click', () => {
      if (window.confirm('確定要將目前畫面上的完整進度廣播給房間內所有人嗎？')) {
        broadcastFullStateToRoom();
        showToast('⬆️ 已將您目前的完整進度廣播至房間！');
      }
    });
  }

  if (pullBtn) {
    pullBtn.addEventListener('click', () => {
      if (isRoomConnected && currentRoomId) {
        broadcastToRoom({ type: 'REQ_FULL', roomId: currentRoomId, senderId: myClientId, ts: Date.now() });
        pollLatestRoomSnapshot(`sakura_room_${encodeURIComponent(currentRoomId)}`);
        showToast('⬇️ 已向房間廣播索取最新進度！');
      }
    });
  }

  if (copyBtn) {
    const shareInput = document.getElementById('roomShareUrlInput');
    copyBtn.addEventListener('click', async () => {
      if (!shareInput || !shareInput.value) return;
      try {
        await navigator.clipboard.writeText(shareInput.value);
        showToast('📋 已複製專屬房間網址！傳給讀書夥伴或用手機打開即直接同步');
      } catch (err) {
        shareInput.select();
        document.execCommand('copy');
        showToast('📋 已複製專屬房間網址！');
      }
    });
  }
}

function showToast(message) {
  const container = document.getElementById('toastContainer');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.25s ease';
    setTimeout(() => toast.remove(), 260);
  }, 2800);
}

/* ==========================================================================
   啟動應用程式
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {
  loadState();
  initCurrentActiveDay();
  renderPhasesConfig();
  renderMainScheduleTable();
  renderFullDashboard();
  renderQuickTimerView();
  renderDailyPlanView();
  updateActiveTimerBanner();
  setupEventListeners();
  startGlobalTimerTicker();
  initRoomSyncFromStorageOrUrl();
  switchMainTab('quick-timer');

  // 切回分頁時立即以 Date.now() 對齊顯示（背景分頁的 setInterval 會被瀏覽器降速）
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    const active = findActiveTimerSlot();
    if (active) {
      const clockEl = document.getElementById(`ypt-clock-${active.day.dayCountdown}-${active.slotKey}`);
      if (clockEl) clockEl.textContent = formatMsToClock(getSlotLiveMs(active.slot));
      updateSingleDayRowSummaryDom(active.day);
    }
    updateActiveTimerBanner(active);
    renderAllStatistics();

    // Safari / iOS 螢幕喚醒時若 WebSocket 連線已休眠斷開，立即自動重新連線！
    if (currentRoomId) {
      if (!roomWs || roomWs.readyState === WebSocket.CLOSED || roomWs.readyState === WebSocket.CLOSING) {
        connectToSharedRoom(currentRoomId, myNickname, true);
      }
    }
  });

  // 多分頁同步：其他分頁修改資料時重新載入，避免互相覆蓋
  window.addEventListener('storage', (e) => {
    if (e.key !== STORAGE_KEY || !e.newValue) return;
    try {
      const synced = normalizeState(JSON.parse(e.newValue));
      if (!synced) return;
      appState = synced;
      renderPhasesConfig();
      renderMainScheduleTable();
      renderFullDashboard();
      renderQuickTimerView();
      renderDailyPlanView();
      updateActiveTimerBanner();
    } catch (err) {
      console.error('Cross-tab sync failed:', err);
    }
  });
});
