/**
 * 小櫻讀書計劃表 🌸 YPT 計時模式 × Numbers 讀書計劃與統計儀表板
 * 計畫期間：11月8日 (Day 80) ~ 1月26日 (Day 1)，共計 80 天
 * 考程目標：1月26日 研究所正式考試！
 */

const TOTAL_SCHEDULE_DAYS = 80;
const PLAN_START_DATE_STR = '2026-11-08'; // 明天 11月8日 第一天
const PLAN_END_DATE_STR = '2027-01-26';   // 1月26日 考試日

const STORAGE_KEY = 'sakura_study_planner_v1';
const ROOM_STORAGE_KEY = 'sakura_shared_room_v2';
const SETTINGS_STORAGE_KEY = 'sakura_user_settings_v1';

// 使用者偏好設定（僅保留兩種主題：dark 極簡深灰 / sakura 櫻花粉白）
let appSettings = {
  theme: 'dark',   // 預設深灰色護眼極簡風格
  sound: 'on',     // 'on', 'off'
  petals: 'on'     // 'on', 'off'
};

// 計時模式（自由正計時、25分鐘番茄鐘、50分鐘衝刺鐘）
let currentTimerMode = 'stopwatch'; // 'stopwatch', 'pomodoro-25', 'pomodoro-50'
let deferredPwaPrompt = null;

// 多人即時同步房全域變數（免註冊・免 Google 帳號・免兩階段驗證）
const myClientId = 'usr_' + Math.random().toString(36).slice(2, 9);
let roomWs = null;
let isRoomConnected = false;
let currentRoomId = '';
let myNickname = '我';
let roomReconnectTimeout = null;
let isReceivingRemoteUpdate = false;
let roomDebounceTimer = null;

/* ==========================================================================
   🎵 Web Audio API 柔和和弦鐘聲與專注提示音（免外載音檔、零延遲、離線可用）
   ========================================================================== */
let audioCtx = null;
function getAudioContext() {
  if (!audioCtx && typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext)) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    audioCtx = new AudioCtx();
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

function playChime(type = 'complete') {
  if (appSettings.sound === 'off') return;
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;

    if (type === 'start') {
      // 專注開始：微風柔和雙音（上升音階）
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(440, now);
      osc.frequency.exponentialRampToValueAtTime(659.25, now + 0.18);
      gain.gain.setValueAtTime(0.08, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.42);
    } else if (type === 'pause') {
      // 專注暫停：輕柔微音
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(520, now);
      gain.gain.setValueAtTime(0.06, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.26);
    } else if (type === 'complete' || type === 'pomodoro') {
      // 專注達成：悠揚櫻花四重和弦鐘聲（Crystal Bell: C5, E5, G5, C6）
      const notes = [523.25, 659.25, 783.99, 1046.50];
      notes.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        const startT = now + idx * 0.1;
        osc.frequency.setValueAtTime(freq, startT);
        gain.gain.setValueAtTime(0, startT);
        gain.gain.linearRampToValueAtTime(0.12, startT + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.0008, startT + 0.9);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(startT);
        osc.stop(startT + 0.95);
      });
    }
  } catch (e) {
    console.warn('Audio chime notice:', e);
  }
}

/* ==========================================================================
   🎨 雙主題管理器（僅保留兩種主題：sakura 櫻花粉白 vs dark 極簡深黑）
   ========================================================================== */
function loadAppSettings() {
  try {
    const s = localStorage.getItem(SETTINGS_STORAGE_KEY) || localStorage.getItem('sakura_planner_settings_v1');
    if (s) {
      appSettings = { ...appSettings, ...JSON.parse(s) };
    }
  } catch (e) {}
  // 嚴格僅保留兩種主題：'dark' (Antigravity 深灰極簡) 或 'sakura' (櫻花粉白)
  if (appSettings.theme !== 'sakura') {
    appSettings.theme = 'dark';
  }
  applyTheme();
  updateAtmosphereUi();
}

function saveAppSettings() {
  if (appSettings.theme !== 'sakura') {
    appSettings.theme = 'dark';
  }
  try {
    const serialized = JSON.stringify(appSettings);
    localStorage.setItem(SETTINGS_STORAGE_KEY, serialized);
    localStorage.setItem('sakura_planner_settings_v1', serialized);
  } catch (e) {}
  applyTheme();
  updateAtmosphereUi();
}

function applyTheme() {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const effective = appSettings.theme === 'sakura' ? 'sakura' : 'dark';
  root.setAttribute('data-theme', effective);
  if (document.body) {
    document.body.setAttribute('data-theme', effective);
  }

  const meta = document.getElementById('themeColorMeta');
  if (meta) {
    meta.content = effective === 'dark' ? '#141519' : '#FAF8F5';
  }

  const brandLogo = document.getElementById('brandLogoIcon');
  if (brandLogo) {
    brandLogo.textContent = effective === 'dark' ? '◈' : '🌸';
  }

  const roomIcon = document.getElementById('roomCloudIcon');
  if (roomIcon) {
    roomIcon.textContent = effective === 'dark' ? '◈' : '🌸';
  }
}

function updateAtmosphereUi() {
  if (typeof document === 'undefined') return;
  const isDark = appSettings.theme === 'dark';

  const btnSakura = document.getElementById('themeBtnSakura');
  const btnDark = document.getElementById('themeBtnDark');
  if (btnSakura) btnSakura.classList.toggle('active', !isDark);
  if (btnDark) btnDark.classList.toggle('active', isDark);

  const soundBtn = document.getElementById('soundToggleBtn');
  const soundIcon = document.getElementById('soundToggleIcon');
  if (soundBtn && soundIcon) {
    const on = appSettings.sound === 'on';
    soundBtn.classList.toggle('active', on);
    soundIcon.textContent = on ? '🔔' : '🔕';
  }

  const petalBtn = document.getElementById('petalToggleBtn');
  const petalIcon = document.getElementById('petalToggleIcon');
  if (petalBtn && petalIcon) {
    const on = appSettings.petals === 'on' && !isDark;
    petalBtn.classList.toggle('active', on);
    petalIcon.textContent = on ? '🌸' : '🍂';
  }

  const themeSel = document.getElementById('settingThemeSelect');
  if (themeSel) themeSel.value = isDark ? 'dark' : 'sakura';
  const soundSel = document.getElementById('settingSoundSelect');
  if (soundSel) soundSel.value = appSettings.sound;
  const petalSel = document.getElementById('settingPetalsSelect');
  if (petalSel) petalSel.value = appSettings.petals;
}

function switchThemeMode(themeChoice) {
  try {
    const isDark = (themeChoice === 'dark');
    appSettings.theme = isDark ? 'dark' : 'sakura';
    if (appState && (!appState.homeCover || appState.homeCover === 'cover-sakura' || appState.homeCover === 'cover-antigravity')) {
      appState.homeCover = isDark ? 'cover-antigravity' : 'cover-sakura';
      appState.updatedAt = Date.now();
      saveState(false, false);
    }
    saveAppSettings();
    if (typeof applyHomeCover === 'function') applyHomeCover();
    showToast(isDark ? '🖤 已切換為 Antigravity 極簡深黑主題' : '🌸 已切換為日系櫻花粉白主題');
  } catch (err) {
    console.error('switchThemeMode error:', err);
  }
}
if (typeof window !== 'undefined') {
  window.switchThemeMode = switchThemeMode;
}

/* ==========================================================================
   🌸 浪漫櫻花落瓣 Canvas 動畫 (僅於櫻花粉白主題啟用，極簡深黑主題完全關閉)
   ========================================================================== */
function initSakuraPetalsCanvas() {
  try {
    if (typeof document === 'undefined' || typeof window === 'undefined') return;
    const canvas = document.getElementById('sakuraCanvas');
    if (!canvas || !canvas.getContext) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let width = (canvas.width = window.innerWidth);
    let height = (canvas.height = window.innerHeight);

    window.addEventListener('resize', () => {
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
    });

    const petals = [];
    const TOTAL = 26;
    for (let i = 0; i < TOTAL; i++) {
      petals.push({
        x: Math.random() * width,
        y: Math.random() * height,
        size: Math.random() * 8 + 6,
        speedX: Math.random() * 1.2 - 0.2,
        speedY: Math.random() * 1.3 + 0.7,
        rotation: Math.random() * 360,
        rotSpeed: Math.random() * 2 - 1,
        opacity: Math.random() * 0.4 + 0.35
      });
    }

    function renderPetals() {
      if (appSettings.petals === 'off' || appSettings.theme === 'dark') {
        ctx.clearRect(0, 0, width, height);
        if (typeof requestAnimationFrame !== 'undefined') requestAnimationFrame(renderPetals);
        return;
      }

      ctx.clearRect(0, 0, width, height);
      for (let i = 0; i < petals.length; i++) {
        const p = petals[i];
        p.x += p.speedX;
        p.y += p.speedY;
        p.rotation += p.rotSpeed;

        if (p.y > height + 25) {
          p.y = -25;
          p.x = Math.random() * width;
        }
        if (p.x > width + 25) p.x = -25;
        if (p.x < -25) p.x = width + 25;

        if (ctx.save) {
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate((p.rotation * Math.PI) / 180);
          ctx.fillStyle = `rgba(247, 178, 194, ${p.opacity})`;
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.bezierCurveTo(p.size / 2, -p.size / 2, p.size, 0, 0, p.size * 1.5);
          ctx.bezierCurveTo(-p.size, 0, -p.size / 2, -p.size / 2, 0, 0);
          ctx.fill();
          ctx.restore();
        }
      }
      if (typeof requestAnimationFrame !== 'undefined') {
        requestAnimationFrame(renderPetals);
      }
    }

    renderPetals();
  } catch (err) {
    console.warn('Canvas init non-critical error:', err);
  }
}

// 主表格下拉選單科目選項（已依指示移除英文科目）
const SUBJECT_OPTIONS = ['', '個經', '總經', '經濟', '統計', '財管', '上課', '其他'];

// 統計表歸類之四大核心科目（個經、總經自動歸類至「經濟」，已移除英文）
const STAT_SUBJECTS = ['經濟', '統計', '財管', '上課'];

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

// 預設三階段設定 (Day 80-56, Day 55-28, Day 27-1，共 80 天)
const DEFAULT_PHASES = [
  { id: 'phase1', name: '第一階段', startDay: 80, endDay: 56 },
  { id: 'phase2', name: '第二階段', startDay: 55, endDay: 28 },
  { id: 'phase3', name: '第三階段', startDay: 27, endDay: 1 }
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
    phase3: '考古題手感維持、調整考前作息時間表'
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
let currentPhaseFilter = 'all'; // 純粹行事曆階段篩選
let currentSearchQuery = '';     // 純粹行事曆關鍵字搜尋
let currentDailyPhaseFilter = 'all';  // 每日專注總表階段篩選
let currentDailySubjectFilter = '';   // 每日專注總表科目篩選
let currentDailySearchQuery = '';     // 每日專注總表關鍵字搜尋
let isSideBySideLayout = false;
let isDashboardCollapsed = false;
let timerIntervalId = null;

/**
 * 歷史讀書進度儲存槽（依使用者指示：舊紀錄已全數清空，從 11/8 明天第一天全新開始）
 */
const RESTORED_USER_DATA = {};

/**
 * 建立空白時段物件（所有時間與紀錄從 0 開始，支援 YPT 專注與休息雙重時間追蹤）
 */
function createEmptySlot(subject = '', task = '') {
  return {
    subject: subject || '',
    task: task || '',
    startTime: '',
    endTime: '',
    durationMinutes: 0,        // 鎖定或手動設定之真實專注讀書時長（分鐘）
    accumulatedMs: 0,          // YPT 專注累計毫秒數
    timerStatus: 'idle',       // 'idle' | 'running' | 'paused' | 'ended'
    lastResumeTimestamp: null,   // 進入專注的系統時間戳記 Date.now()
    restMinutes: 0,            // ☕ YPT 累計休息時間（分鐘）
    restAccumulatedMs: 0,      // ☕ YPT 累計休息毫秒數
    lastPauseTimestamp: null,  // ☕ 進入暫停（休息）當下的系統時間戳記
    completed: false,
    updatedAt: 0               // 最後異動時間戳記 Date.now()
  };
}

/**
 * 自動生成 11月8日 (Day 80) 至 1月26日 (Day 1) 共 80 天衝刺資料（以明天 11/8 設為第一天，1/26 考試！）
 */
function generate80DaysSchedule(withPreplanned = true) {
  const days = [];
  const startDate = new Date(2026, 10, 8); // Month 10 = November, 8 = 11月8日 (明天第一天！)
  const totalDays = 80;

  for (let i = 0; i < totalDays; i++) {
    const d = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate() + i);
    const month = d.getMonth() + 1;
    const dateNum = d.getDate();
    const weekday = WEEKDAY_NAMES[d.getDay()];
    const isWeekend = d.getDay() === 0 || d.getDay() === 6;
    const dayCountdown = totalDays - i; // 80 down to 1

    const mmddKey = `${String(month).padStart(2, '0')}-${String(dateNum).padStart(2, '0')}`;
    const pre = withPreplanned ? PDF_PREPLANNED_DATA[mmddKey] : null;

    let calNote = pre ? pre.calendar : '';
    if (mmddKey === '01-26') {
      calNote = '🎯 研究所正式考試！平常心發揮';
    }

    const dayObj = {
      id: `day-${dayCountdown}`,
      isoDate: `${d.getFullYear()}-${String(month).padStart(2, '0')}-${String(dateNum).padStart(2, '0')}`,
      dateDisplay: `${month}月${dateNum}日`,
      weekdayDisplay: weekday,
      isWeekend,
      dayCountdown,
      calendar: calNote,
      calendarUpdatedAt: 0,
      morning: createEmptySlot(pre && pre.morning ? pre.morning[0] : '', pre && pre.morning ? pre.morning[1] : ''),
      afternoon: createEmptySlot(pre && pre.afternoon ? pre.afternoon[0] : '', pre && pre.afternoon ? pre.afternoon[1] : ''),
      evening: createEmptySlot(pre && pre.evening ? pre.evening[0] : '', pre && pre.evening ? pre.evening[1] : '')
    };

    if (mmddKey === '01-26' && !pre) {
      dayObj.morning.subject = '經濟';
      dayObj.morning.task = '考前重點總整理';
      dayObj.afternoon.subject = '統計';
      dayObj.afternoon.task = '核心公式閉眼默背';
      dayObj.evening.subject = '財管';
      dayObj.evening.task = '穩定發揮平常心應考';
    }

    days.push(dayObj);
  }
  return days;
}

/**
 * 為 80 天倒數區間外之月曆日期（例如 11/1~11/7 或 1/27~1/31）建立或取得單日資料物件
 */
function createExtraDayObject(isoDate, withPreplanned = true) {
  const parts = String(isoDate).split('-');
  const y = parseInt(parts[0], 10) || 2026;
  const m = parseInt(parts[1], 10) || 11;
  const dNum = parseInt(parts[2], 10) || 1;
  const d = new Date(y, m - 1, dNum);
  const weekday = WEEKDAY_NAMES[d.getDay()];
  const isWeekend = d.getDay() === 0 || d.getDay() === 6;
  const mmddKey = `${String(m).padStart(2, '0')}-${String(dNum).padStart(2, '0')}`;
  const pre = withPreplanned ? PDF_PREPLANNED_DATA[mmddKey] : null;

  return {
    id: `day-${isoDate}`,
    isoDate,
    dateDisplay: `${m}月${dNum}日`,
    weekdayDisplay: weekday,
    isWeekend,
    dayCountdown: isoDate, // 非倒數區間使用 isoDate 作為唯一識別碼
    calendar: pre ? (pre.calendar || '') : '',
    calendarUpdatedAt: 0,
    morning: createEmptySlot(pre && pre.morning ? pre.morning[0] : '', pre && pre.morning ? pre.morning[1] : ''),
    afternoon: createEmptySlot(pre && pre.afternoon ? pre.afternoon[0] : '', pre && pre.afternoon ? pre.afternoon[1] : ''),
    evening: createEmptySlot(pre && pre.evening ? pre.evening[0] : '', pre && pre.evening ? pre.evening[1] : '')
  };
}

function generateInitialExtraDays(withPreplanned = true) {
  const map = {};
  for (let d = 1; d <= 7; d++) {
    const iso = `2026-11-${String(d).padStart(2, '0')}`;
    map[iso] = createExtraDayObject(iso, withPreplanned);
  }
  return map;
}

/**
 * 統一依據 dayCountdown (80~1) 或 isoDate ('2026-11-07') 取得對應日期資料物件
 */
function findDayByKey(dayKey) {
  if (!appState || dayKey === null || dayKey === undefined || dayKey === '') return null;
  const str = String(dayKey).trim();
  if (str.includes('-')) {
    const inMain = appState.days.find(d => d.isoDate === str);
    if (inMain) return inMain;
    if (!appState.extraDays) appState.extraDays = {};
    if (!appState.extraDays[str]) {
      appState.extraDays[str] = createExtraDayObject(str, true);
    }
    return appState.extraDays[str];
  }
  const num = Number(str);
  if (!Number.isNaN(num)) {
    return appState.days.find(d => Number(d.dayCountdown) === num) || null;
  }
  return null;
}

/**
 * 建立初始完整 App 狀態
 */
function createDefaultState(withPreplanned = true) {
  return {
    version: 2,
    anchorStartDate: '2026-11-08',
    anchorEndDate: '2027-01-26',
    totalDays: 80,
    updatedAt: 0,
    homeCover: 'cover-sakura',
    phases: JSON.parse(JSON.stringify(DEFAULT_PHASES)),
    goals: JSON.parse(JSON.stringify(DEFAULT_GOALS)),
    days: generate80DaysSchedule(withPreplanned),
    extraDays: generateInitialExtraDays(withPreplanned)
  };
}

/**
 * 檢查並自動補回遺失之歷史讀書進度
 */
function applyRestoredDataIfMissing(state) {
  if (!state || !Array.isArray(state.days)) return;
  Object.keys(RESTORED_USER_DATA).forEach(dayCountdownStr => {
    const dayCountdown = Number(dayCountdownStr);
    const day = state.days.find(d => d.dayCountdown === dayCountdown);
    const restored = RESTORED_USER_DATA[dayCountdown];
    if (!day || !restored) return;

    if (restored.calendar && !day.calendar) {
      day.calendar = restored.calendar;
    }
    SLOT_KEYS.forEach(({ key }) => {
      const rSlot = restored[key];
      const lSlot = day[key];
      if (rSlot && lSlot) {
        if ((!lSlot.durationMinutes || lSlot.durationMinutes === 0) && (rSlot.durationMinutes > 0 || rSlot.task)) {
          Object.assign(lSlot, rSlot);
        }
      }
    });
  });
}

/**
 * 🌸 時段智慧校正守護：
 * 依開始時間判定規範（早上 05:00~12:00, 下午 12:00~19:00, 晚上 19:00~05:00）
 * 檢核所有時段（早、午、晚），若其 startTime 屬於其他時段且目標時段尚未被填寫，自動智慧遷移！
 */
function healMisplacedTimeSlots(state) {
  if (!state || !Array.isArray(state.days)) return;
  const slotList = ['morning', 'afternoon', 'evening'];
  state.days.forEach(day => {
    slotList.forEach(currSlotKey => {
      const currSlot = day[currSlotKey];
      if (currSlot && currSlot.startTime && (currSlot.durationMinutes > 0 || currSlot.timerStatus !== 'idle')) {
        const correctSlotKey = getSlotKeyFromStartTime(currSlot.startTime);
        if (correctSlotKey !== currSlotKey) {
          const targetSlot = day[correctSlotKey];
          if (targetSlot && (!targetSlot.durationMinutes || targetSlot.durationMinutes === 0) && targetSlot.timerStatus === 'idle') {
            const mmdd = day.isoDate ? day.isoDate.slice(5) : '';
            const pre = PDF_PREPLANNED_DATA[mmdd];
            const restoredEmpty = createEmptySlot(
              pre && pre[currSlotKey] ? pre[currSlotKey][0] : '',
              pre && pre[currSlotKey] ? pre[currSlotKey][1] : ''
            );
            day[correctSlotKey] = { ...currSlot };
            day[correctSlotKey].updatedAt = Date.now();
            day[currSlotKey] = restoredEmpty;
          }
        }
      }
    });
  });
}

/**
 * 載入或初始化狀態（含歷史進度自動補回與時段校正）
 */
function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      appState = createDefaultState(true);
      healMisplacedTimeSlots(appState);
      saveState(false);
      return;
    }
    const parsed = JSON.parse(raw);
    const isOldSchedule = !parsed.days || parsed.days.length !== 80 || !parsed.days[0] || parsed.days[0].isoDate !== '2026-11-08';
    if (isOldSchedule) {
      console.log('🌸 依使用者指示全新重置：以明天 (11/8) 為 Day 80 第一天，1/26 考試！所有舊紀錄已清空');
      appState = createDefaultState(true);
      healMisplacedTimeSlots(appState);
      saveState(true);
      return;
    }
    const normalized = normalizeState(parsed);
    if (!normalized) {
      appState = createDefaultState(true);
      healMisplacedTimeSlots(appState);
      saveState(false);
      return;
    }
    appState = normalized;
    healMisplacedTimeSlots(appState);
    saveState(false);
  } catch (err) {
    console.error('Failed to load state from localStorage:', err);
    appState = createDefaultState(true);
    healMisplacedTimeSlots(appState);
  }
}

/**
 * 驗證並補齊狀態欄位（用於 localStorage 載入與 JSON 匯入，避免缺欄位造成整頁崩潰）
 * 回傳 null 代表格式不符
 */
function normalizeState(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.days) || raw.days.length !== 80) {
    return null;
  }
  // 嚴格拒絕舊版以非 11/8 起始之資料，確保明天 11/8 (Day 80) 作為第一天之乾淨狀態
  if (raw.days[0] && raw.days[0].isoDate && raw.days[0].isoDate !== '2026-11-08') {
    return null;
  }
  const template = generate80DaysSchedule(false);
  const validStatus = ['idle', 'running', 'paused', 'ended'];

  const days = template.map((tpl, i) => {
    const src = raw.days.find(d => d && Number(d.dayCountdown) === tpl.dayCountdown) || raw.days[i] || {};
    const day = {
      ...tpl,
      calendar: typeof src.calendar === 'string' ? src.calendar : tpl.calendar,
      calendarUpdatedAt: Number(src.calendarUpdatedAt) || 0
    };
    SLOT_KEYS.forEach(({ key }) => {
      const s = src[key] && typeof src[key] === 'object' ? src[key] : {};
      const slot = createEmptySlot();
      slot.subject = SUBJECT_OPTIONS.includes(s.subject) ? s.subject : (tpl[key] ? tpl[key].subject : '');
      slot.task = typeof s.task === 'string' ? s.task : (tpl[key] ? tpl[key].task : '');
      slot.startTime = typeof s.startTime === 'string' ? s.startTime : '';
      slot.endTime = typeof s.endTime === 'string' ? s.endTime : '';
      slot.durationMinutes = Math.min(720, Math.max(0, Math.round(Number(s.durationMinutes) || 0)));
      slot.accumulatedMs = Math.min(720 * 60000, Math.max(0, Number(s.accumulatedMs) || 0));
      slot.timerStatus = validStatus.includes(s.timerStatus) ? s.timerStatus : 'idle';
      slot.lastResumeTimestamp = Number(s.lastResumeTimestamp) || null;
      slot.restMinutes = Math.max(0, Math.round(Number(s.restMinutes) || 0));
      slot.restAccumulatedMs = Math.max(0, Number(s.restAccumulatedMs) || 0);
      slot.lastPauseTimestamp = Number(s.lastPauseTimestamp) || null;
      slot.completed = Boolean(s.completed);
      slot.updatedAt = Number(s.updatedAt) || (slot.lastResumeTimestamp || 0);
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

  // 確保同一時間只有一個時段在「計時中」（挑選最新啟動的一個保持 running，其餘轉為暫停）
  let latestRunningSlot = null;
  days.forEach(d => SLOT_KEYS.forEach(({ key }) => {
    const s = d[key];
    if (s.timerStatus === 'running' && s.lastResumeTimestamp) {
      if (!latestRunningSlot || (s.updatedAt || s.lastResumeTimestamp) >= (latestRunningSlot.updatedAt || latestRunningSlot.lastResumeTimestamp)) {
        latestRunningSlot = s;
      }
    }
  }));
  days.forEach(d => SLOT_KEYS.forEach(({ key }) => {
    const s = d[key];
    if (s.timerStatus === 'running' && s !== latestRunningSlot) {
      s.accumulatedMs += Math.max(0, Date.now() - (s.lastResumeTimestamp || Date.now()));
      s.durationMinutes = s.accumulatedMs > 0 ? Math.max(1, Math.round(s.accumulatedMs / 60000)) : 0;
      s.lastResumeTimestamp = null;
      s.timerStatus = 'paused';
    }
  }));

  let homeCover = (typeof raw.homeCover === 'string' && raw.homeCover.trim()) ? raw.homeCover.trim() : '';
  if (!homeCover || homeCover === 'cover-sakura' || homeCover === 'cover-antigravity') {
    try {
      const cachedCover = localStorage.getItem('sakura_custom_cover_v1');
      if (cachedCover && (cachedCover.startsWith('data:') || cachedCover.startsWith('url:'))) {
        homeCover = cachedCover;
      }
    } catch (e) {}
  }
  if (!homeCover) {
    homeCover = (appSettings.theme === 'dark' ? 'cover-antigravity' : 'cover-sakura');
  }
  const homeCoverUpdatedAt = Number(raw.homeCoverUpdatedAt) || (homeCover.startsWith('data:') || homeCover.startsWith('url:') ? (Number(raw.updatedAt) || 1) : 0);

  const extraDays = generateInitialExtraDays(true);
  if (raw.extraDays && typeof raw.extraDays === 'object') {
    Object.keys(raw.extraDays).forEach(iso => {
      const src = raw.extraDays[iso];
      if (!src || typeof src !== 'object') return;
      const baseExtra = extraDays[iso] || createExtraDayObject(iso, true);
      if (typeof src.calendar === 'string') baseExtra.calendar = src.calendar;
      baseExtra.calendarUpdatedAt = Number(src.calendarUpdatedAt) || 0;
      SLOT_KEYS.forEach(({ key }) => {
        if (src[key] && typeof src[key] === 'object') {
          baseExtra[key] = { ...baseExtra[key], ...src[key] };
          if (!SUBJECT_OPTIONS.includes(baseExtra[key].subject)) {
            baseExtra[key].subject = '';
          }
        }
      });
      extraDays[iso] = baseExtra;
    });
  }

  const homeCoverFit = raw.homeCoverFit === 'cover' ? 'cover' : 'contain';
  const homeCoverPosition = (raw.homeCoverPosition === 'top' || raw.homeCoverPosition === 'bottom') ? raw.homeCoverPosition : 'center';

  return {
    version: 2,
    anchorStartDate: '2026-11-08',
    anchorEndDate: '2027-01-26',
    totalDays: 80,
    updatedAt: Number(raw.updatedAt) || 0,
    homeCover,
    homeCoverUpdatedAt,
    homeCoverFit,
    homeCoverPosition,
    phases,
    goals,
    days,
    extraDays
  };
}

function clampDay(v, fallback) {
  const n = parseInt(v, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.max(1, Math.min(80, n));
}

/**
 * 檢查三階段是否完整涵蓋 Day 1~80 且彼此不重疊
 */
function validatePhases() {
  const coverage = new Array(81).fill(0);
  appState.phases.forEach(p => {
    const high = Math.max(p.startDay, p.endDay);
    const low = Math.min(p.startDay, p.endDay);
    for (let d = low; d <= high; d++) coverage[d] += 1;
  });
  const gaps = [];
  const overlaps = [];
  for (let d = 1; d <= 80; d++) {
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
    if (err && (err.name === 'QuotaExceededError' || err.name === 'NS_ERROR_DOM_QUOTA_REACHED' || (err.message && err.message.toLowerCase().includes('quota')))) {
      try {
        // 若因自訂圖片過大導致瀏覽器配額超限，優先移除暫存圖片以保全讀書與考試的核心進度！
        const safeState = Object.assign({}, appState);
        if (safeState.homeCover && safeState.homeCover.startsWith('data:')) {
          safeState.homeCover = appSettings.theme === 'dark' ? 'cover-antigravity' : 'cover-sakura';
        }
        localStorage.setItem(STORAGE_KEY, JSON.stringify(safeState));
        if (showIndicator) {
          updateSaveStatusDisplay();
        }
        showToast('⚠️ 儲存空間接近上限，已優先保護讀書時段與考試進度！');
      } catch (innerErr) {
        showToast('⚠️ 儲存失敗：瀏覽器儲存空間已滿');
      }
    } else {
      showToast('⚠️ 儲存失敗：瀏覽器儲存空間可能已滿');
    }
  }

  // 自動同步至共同房間（多人即時連線）
  if (broadcastToRoom && currentRoomId && !isReceivingRemoteUpdate) {
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
    const rawDelta = Math.max(0, Date.now() - slot.lastResumeTimestamp);
    // 永久防護：單次計時最高上限 14 小時 (840 分鐘)，防止忘記關閉導致累計數百小時
    const delta = Math.min(rawDelta, 14 * 3600 * 1000);
    return Math.min((slot.accumulatedMs || 0) + delta, 14 * 3600 * 1000);
  }
  if (slot.timerStatus === 'paused') {
    return Math.min(slot.accumulatedMs || 0, 14 * 3600 * 1000);
  }
  return Math.min((slot.durationMinutes || 0) * 60000, 14 * 3600 * 1000);
}

/**
 * 取得某個時段用於統計與每日加總的「真實讀書分鐘數」
 * 若計時器正在執行或暫停，也會即時換算為分鐘數以同步更新統計表
 */
function getSlotEffectiveMinutes(slot) {
  if (!slot) return 0;
  if (slot.timerStatus === 'running' || slot.timerStatus === 'paused') {
    const liveMs = getSlotLiveMs(slot);
    if (liveMs <= 0) return 0;
    return Math.max(1, Math.round(liveMs / 60000));
  }
  return Math.max(0, Number(slot.durationMinutes) || 0);
}

/**
 * 取得某個時段當前「單次短期休息（本次按下暫停後）」的即時毫秒數
 */
function getSlotShortRestLiveMs(slot) {
  if (!slot) return 0;
  if (slot.timerStatus === 'paused' && slot.lastPauseTimestamp) {
    const elapsed = Math.max(0, Date.now() - slot.lastPauseTimestamp);
    return Math.min(elapsed, 14 * 3600 * 1000);
  }
  return 0;
}

/**
 * 取得某個時段當前即時的「YPT 累積休息毫秒數」（歷次暫停累計 + 本次短期休息）
 */
function getSlotRestLiveMs(slot) {
  if (!slot) return 0;
  return (slot.restAccumulatedMs || 0) + getSlotShortRestLiveMs(slot);
}

/**
 * 取得某一天早中晚三個時段的「當日總累積休息毫秒數」
 */
function getDayTotalRestLiveMs(day) {
  if (!day) return 0;
  return SLOT_KEYS.reduce((sum, { key }) => sum + getSlotRestLiveMs(day[key]), 0);
}

/**
 * 取得某個時段的「YPT 累計休息分鐘數」
 */
function getSlotRestEffectiveMinutes(slot) {
  if (!slot) return 0;
  const liveRestMs = getSlotRestLiveMs(slot);
  if (liveRestMs <= 0) return 0;
  return Math.round(liveRestMs / 60000);
}

/**
 * 取得某一天早中晚三個時段的累計休息總分鐘數
 */
function getDayTotalRestMinutes(day) {
  if (!day) return 0;
  return SLOT_KEYS.reduce((sum, { key }) => sum + getSlotRestEffectiveMinutes(day[key]), 0);
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
            max="80"
            class="phase-day-input"
            data-phase-idx="${idx}"
            data-bound="startDay"
            value="${phase.startDay}"
            title="起始倒數天數 (1~80)"
          />
          <span>～ Day</span>
          <input
            type="number"
            min="1"
            max="80"
            class="phase-day-input"
            data-phase-idx="${idx}"
            data-bound="endDay"
            value="${phase.endDay}"
            title="結束倒數天數 (1~80)"
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
    const dailyBtn = document.getElementById(`dailyFilterTabPhase${idx}`);
    if (dailyBtn) {
      dailyBtn.textContent = `${p.name} (Day ${p.startDay}-${p.endDay})`;
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
  renderStudyDiagnostics(stats);
}

/**
 * 🌸 80 天衝刺智能讀書診斷報告卡片渲染
 */
function renderStudyDiagnostics(stats) {
  if (typeof document === 'undefined') return;
  const diagText = document.getElementById('diagAdviceText');
  const paceBadge = document.getElementById('diagPaceBadge');
  const morningBar = document.getElementById('ratioMorningBar');
  const noonBar = document.getElementById('ratioNoonBar');
  const nightBar = document.getElementById('ratioNightBar');
  const balanceEl = document.getElementById('diagSubjectBalance');

  if (!diagText || !stats) return;

  // 1. 計算早中晚三時段累積時長比例
  let mTotal = 0, nTotal = 0, eTotal = 0;
  appState.days.forEach(d => {
    mTotal += getSlotEffectiveMinutes(d.morning);
    nTotal += getSlotEffectiveMinutes(d.afternoon);
    eTotal += getSlotEffectiveMinutes(d.evening);
  });
  const sumPeriod = mTotal + nTotal + eTotal;
  let mPct = 33, nPct = 33, ePct = 34;
  if (sumPeriod > 0) {
    mPct = Math.round((mTotal / sumPeriod) * 100);
    nPct = Math.round((nTotal / sumPeriod) * 100);
    ePct = Math.max(0, 100 - mPct - nPct);
  }

  if (morningBar) {
    morningBar.style.width = `${Math.max(12, mPct)}%`;
    morningBar.textContent = `早 ${mPct}% (${formatMinutesToHM(mTotal)})`;
  }
  if (noonBar) {
    noonBar.style.width = `${Math.max(12, nPct)}%`;
    noonBar.textContent = `中 ${nPct}% (${formatMinutesToHM(nTotal)})`;
  }
  if (nightBar) {
    nightBar.style.width = `${Math.max(12, ePct)}%`;
    nightBar.textContent = `晚 ${ePct}% (${formatMinutesToHM(eTotal)})`;
  }

  // 2. 核心考科均衡度分析
  const subjMins = (stats.overall && stats.overall.overallSubjectMinutes) || {};
  const mainSubjs = ['經濟', '統計', '財管'];
  let maxSubj = mainSubjs[0], maxM = subjMins[maxSubj] || 0;
  let minSubj = mainSubjs[0], minM = subjMins[minSubj] || 0;
  mainSubjs.forEach(s => {
    const val = subjMins[s] || 0;
    if (val > maxM) { maxM = val; maxSubj = s; }
    if (val < minM) { minM = val; minSubj = s; }
  });

  if (balanceEl) {
    if (sumPeriod === 0) {
      balanceEl.textContent = '尚無讀書紀錄，點選快捷計時即可獲得診斷！';
    } else {
      balanceEl.innerHTML = `最高時數：<strong style="color:var(--sakura-deep)">${escapeHtml(maxSubj)} (${formatMinutesToHM(maxM)})</strong> ｜ 最需加強：<strong>${escapeHtml(minSubj)} (${formatMinutesToHM(minM)})</strong>`;
    }
  }

  // 3. 目前衝刺階段與個人化智慧診斷建議
  const todayCd = getTodayDayCountdown();
  const phaseIdx = getPhaseIndexForDay(todayCd);
  const currentPhase = appState.phases[phaseIdx] || DEFAULT_PHASES[0];
  const phaseDaysLeft = Math.max(0, todayCd - (currentPhase.endDay || 1) + 1);

  if (paceBadge) {
    paceBadge.textContent = `${currentPhase.name}（倒數剩餘 ${phaseDaysLeft} 天）`;
  }

  if (sumPeriod === 0) {
    diagText.textContent = `🌸 歡迎使用 80 天衝刺讀書計劃！今天是 Day ${todayCd}，處於「${currentPhase.name}」。建議每天保持 5~7 小時高效專注，立即在「快捷計時」點選科目開始你的第一堂自習吧！`;
  } else {
    const totalHours = (sumPeriod / 60).toFixed(1);
    let bestPeriodName = '早晨時段';
    if (nTotal >= mTotal && nTotal >= eTotal) bestPeriodName = '下午時段';
    if (eTotal >= mTotal && eTotal >= nTotal) bestPeriodName = '晚間時段';

    let advice = `🌸 目前 80 天累計專注達 <strong>${totalHours} 小時</strong>！你在 <strong>${bestPeriodName}</strong> 的專注力最高。`;
    if (maxM > 0 && minM === 0) {
      advice += ` 目前 ${maxSubj} 投入時數最多，建議今日適度排入 <strong>${minSubj}</strong> 進行基礎章節鞏固，避免考科落差。`;
    } else if (maxM > minM * 2.5 && minM > 0) {
      advice += ` 各科分配中 ${maxSubj} 遙遙領先，可適度分流 30% 時間給 <strong>${minSubj}</strong> 刷考古題，維持多科並進手感！`;
    } else {
      advice += ` 各主要考科時間分佈良好且均衡！繼續保持「${escapeHtml(currentPhase.name)}」的穩定節奏，金榜題名必在眼前！🌸`;
    }
    diagText.innerHTML = advice;
  }
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

  // 全期 80 天總計
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
      totalDays: 80,
      totalSlots: 240,
      overallCompletedSlots,
      overallCompletionRate: (overallCompletedSlots / 240) * 100,
      overallAvgCompletedPerDay: overallCompletedSlots / 80,
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
  if (elActiveDays) elActiveDays.textContent = `有效讀書天數：${overall.overallActiveStudyDays} / 80 天`;
  if (elTotalComp) {
    elTotalComp.textContent = `${overall.overallCompletedSlots} / 240 (${Math.round(overall.overallCompletionRate)}%)`;
  }
  if (elAvgSlot) {
    elAvgSlot.textContent = `每日平均完成：${overall.overallAvgCompletedPerDay.toFixed(2)} 時段`;
  }

  const activeDayMean = calculateMean(overall.overallDailyTotalMinutesList);
  const all80DayMean = overall.overallStudyMinutesAll / 80;
  const activeDayMedian = calculateMedian(overall.overallDailyTotalMinutesList);

  if (elDailyMean) elDailyMean.textContent = formatMinutesToHM(activeDayMean);
  if (elDailyMeanAll) elDailyMeanAll.textContent = `全80天日均：${formatMinutesToHM(all80DayMean)}`;
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
        <td>全期總計<span class="stat-sub-val">Day 80–1 (80天 / 240時段)</span></td>
        <td><strong>${ov.overallCompletedSlots}</strong><span class="stat-sub-val">共 240 時段</span></td>
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
  const overallDailyAllMean = ov.overallStudyMinutesAll / 80;

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
          <span class="stat-sub-val">全期 80 天日均：${formatMinutesToHM(overallDailyAllMean)}</span>
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
   全新 5 大分頁導航與視圖管理模組（首頁、計時器、行事曆、每日專注、統計列表）
   ========================================================================== */

let currentActiveTab = 'home';
let currentActiveDayCountdown = 80;
let homeActiveDayCountdown = null;
let calendarEditorDayKey = null;
let currentCalendarMonth = '2026-11';
let isCalendarDayEditorOpen = false;

/**
 * 取得當前學習日基準日期（嚴格以凌晨 05:00 作為一日之分界）
 * 規則：00:00:00 ~ 04:59:59.999 跨午夜時段，一律歸入前一日之學習日（晚上時段 19:00~05:00）！
 */
function getEffectiveStudyDate(baseDate = new Date()) {
  const d = new Date(baseDate.getTime());
  if (d.getHours() < 5) {
    d.setDate(d.getDate() - 1);
  }
  return d;
}

function getTodayIsoString(baseDate = new Date()) {
  const eff = getEffectiveStudyDate(baseDate);
  const y = eff.getFullYear();
  const m = String(eff.getMonth() + 1).padStart(2, '0');
  const d = String(eff.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getTodayDayCountdown(baseDate = new Date()) {
  const eff = getEffectiveStudyDate(baseDate);
  const m = eff.getMonth() + 1;
  const d = eff.getDate();
  const match = (appState && appState.days) ? appState.days.find(item => item.dateDisplay === `${m}月${d}日`) : null;
  return match ? match.dayCountdown : 80;
}

/**
 * 取得計時器專屬之目標學習日：
 * 鎖定當下即時時刻！若有正在計時或暫停之時段，以該時段之學習日為準；
 * 若無，則始終以當下即時學習日 (getTodayDayCountdown) 為準，絕不受行事曆或每日專注其他天點選影響！
 */
function getTimerTargetDay() {
  const active = findActiveTimerSlot();
  if (active) return active.day;
  const todayCd = getTodayDayCountdown();
  return findDayByKey(todayCd) || (appState && appState.days ? appState.days[0] : null);
}

function getHomeActiveDay() {
  if (homeActiveDayCountdown) {
    const d = findDayByKey(homeActiveDayCountdown);
    if (d) return d;
  }
  const todayCd = getTodayDayCountdown();
  return findDayByKey(todayCd) || appState.days[0];
}

function getCalendarEditorDay() {
  if (calendarEditorDayKey) {
    const d = findDayByKey(calendarEditorDayKey);
    if (d) return d;
  }
  const todayCd = getTodayDayCountdown();
  return findDayByKey(todayCd) || appState.days[0];
}

function initCurrentActiveDay() {
  const eff = getEffectiveStudyDate();
  const m = eff.getMonth() + 1;
  const d = eff.getDate();
  const match = appState.days.find(item => item.dateDisplay === `${m}月${d}日`);
  currentActiveDayCountdown = match ? match.dayCountdown : 80;
  homeActiveDayCountdown = currentActiveDayCountdown;
  calendarEditorDayKey = currentActiveDayCountdown;

  const ym = `${eff.getFullYear()}-${String(m).padStart(2, '0')}`;
  if (['2026-11', '2026-12', '2027-01'].includes(ym)) {
    currentCalendarMonth = ym;
  } else {
    currentCalendarMonth = '2026-11';
  }
}

function switchMainTab(tabId) {
  currentActiveTab = tabId;
  const navBtns = document.querySelectorAll('.tab-nav-btn');
  navBtns.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabId);
  });

  const views = {
    'home': document.getElementById('tabHome'),
    'quick-timer': document.getElementById('tabQuickTimer'),
    'calendar-schedule': document.getElementById('tabCalendarSchedule'),
    'daily-plan': document.getElementById('tabDailyPlan'),
    'statistics-dashboard': document.getElementById('tabStatisticsDashboard')
  };

  Object.keys(views).forEach(key => {
    if (views[key]) {
      views[key].classList.toggle('active', key === tabId);
    }
  });

  if (tabId === 'home') {
    renderHomeView();
  } else if (tabId === 'quick-timer') {
    renderQuickTimerView();
  } else if (tabId === 'calendar-schedule') {
    renderMainScheduleTable();
  } else if (tabId === 'daily-plan') {
    renderDailyFocusScheduleTable();
  } else if (tabId === 'statistics-dashboard') {
    renderAllStatistics();
  }
}

function changeDailyPlanDay(targetDayKey) {
  if (typeof targetDayKey === 'number' || (!String(targetDayKey).includes('-') && !Number.isNaN(Number(targetDayKey)))) {
    let num = Number(targetDayKey);
    if (num > 80) num = 80;
    if (num < 1) num = 1;
    calendarEditorDayKey = num;
  } else {
    calendarEditorDayKey = String(targetDayKey);
  }
  renderDailyPlanView(calendarEditorDayKey);
}

function openCalendarDayEditor(dayKey) {
  calendarEditorDayKey = dayKey;
  renderPureCalendarTable();
  renderDailyPlanView(dayKey);
  const modal = document.getElementById('notionDayModal');
  if (modal) {
    modal.classList.remove('hidden');
    const memo = document.getElementById('dailyCalendarInput');
    if (memo) setTimeout(() => memo.focus(), 80);
  }
}

function closeCalendarDayEditor() {
  const modal = document.getElementById('notionDayModal');
  if (modal) {
    modal.classList.add('hidden');
  }
  renderPureCalendarTable();
}

/* ==========================================================================
   第 1 頁：🏠 極簡首頁（Notion 背板、日期、考試倒數、當日待辦、行事曆）
   ========================================================================== */

function updateCoverControlsUi(isCustom, fitMode, posMode) {
  if (typeof document === 'undefined') return;
  const card = document.getElementById('coverSettingsCard');
  if (card) {
    card.style.display = isCustom ? 'flex' : 'none';
  }
  const fitPills = document.querySelectorAll('#coverFitPills .cover-pill-btn');
  fitPills.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.fitChoice === fitMode);
  });

  const posRow = document.getElementById('coverPositionRow');
  if (posRow) {
    posRow.style.display = (fitMode === 'cover') ? 'flex' : 'none';
  }

  const posPills = document.querySelectorAll('#coverPositionPills .cover-pill-btn');
  posPills.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.posChoice === posMode);
  });
}

/**
 * 驗證是否為安全之圖片 URL 或 Base64 Data URI，防止 XSS 或協定偽造
 */
function isValidImageUrl(url) {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (/^https?:\/\/[^\s"']+/i.test(trimmed)) return true;
  if (/^data:image\/(png|jpeg|jpg|webp|gif|svg\+xml);base64,[A-Za-z0-9+/=\s]+$/i.test(trimmed)) return true;
  return false;
}

function applyHomeCover() {
  if (typeof document === 'undefined' || !appState) return;
  const banner = document.getElementById('homeCoverBanner');
  if (!banner) return;
  const backdrop = document.getElementById('homeCoverBackdrop');
  const foreground = document.getElementById('homeCoverForeground');

  let cover = appState.homeCover;
  if (!cover || cover === 'cover-sakura' || cover === 'cover-antigravity') {
    try {
      const cached = localStorage.getItem('sakura_custom_cover_v1');
      if (cached && (cached.startsWith('data:') || cached.startsWith('url:'))) {
        cover = cached;
        appState.homeCover = cached;
      }
    } catch (e) {}
  }
  if (!cover || cover === 'cover-sakura' || cover === 'cover-antigravity') {
    cover = appSettings.theme === 'dark' ? 'cover-antigravity' : 'cover-sakura';
  }

  const isCustom = cover.startsWith('url:') || cover.startsWith('data:');
  const fitMode = appState.homeCoverFit || (isCustom ? 'contain' : 'cover');
  const posMode = appState.homeCoverPosition || 'center';

  updateCoverControlsUi(isCustom, fitMode, posMode);

  if (isCustom) {
    const rawUrl = cover.startsWith('url:') ? cover.slice(4).trim() : cover.trim();
    if (!isValidImageUrl(rawUrl)) {
      console.warn('[Security] Ignored unsafe or invalid cover URL:', rawUrl);
      cover = appSettings.theme === 'dark' ? 'cover-antigravity' : 'cover-sakura';
      appState.homeCover = cover;
      return applyHomeCover();
    }
    const cssUrl = `url("${rawUrl.replace(/"/g, '\\"')}")`;

    banner.removeAttribute('data-cover');
    banner.style.backgroundImage = '';

    if (backdrop) {
      if (fitMode === 'contain') {
        backdrop.style.display = 'block';
        backdrop.style.backgroundImage = cssUrl;
      } else {
        backdrop.style.display = 'none';
        backdrop.style.backgroundImage = '';
      }
    }

    if (foreground) {
      foreground.style.display = 'block';
      foreground.style.backgroundImage = cssUrl;
      foreground.style.backgroundSize = (fitMode === 'contain') ? 'contain' : 'cover';

      let bgPos = 'center center';
      if (posMode === 'top') bgPos = 'center 15%';
      else if (posMode === 'bottom') bgPos = 'center 85%';
      foreground.style.backgroundPosition = bgPos;
    }
  } else {
    if (backdrop) {
      backdrop.style.display = 'none';
      backdrop.style.backgroundImage = '';
    }
    if (foreground) {
      foreground.style.display = 'none';
      foreground.style.backgroundImage = '';
    }
    banner.style.backgroundImage = '';
    banner.setAttribute('data-cover', cover);
  }

  const presetBtns = document.querySelectorAll('.cover-preset-item');
  presetBtns.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.coverId === cover);
  });
}

function renderHomeView() {
  if (typeof document === 'undefined' || !appState) return;
  applyHomeCover();

  const day = getHomeActiveDay();
  if (!day) return;

  // 1. 日期與即時時鐘、考試倒數計算
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  const liveClockEl = document.getElementById('homeLiveClock');
  if (liveClockEl) liveClockEl.textContent = `${hh}:${mm}:${ss}`;

  const dateHeadingEl = document.getElementById('homeDateHeading');
  const selectedLabelEl = document.getElementById('homeSelectedDayLabel');
  const todayTagEl = document.getElementById('homeTodayTag');
  const todayIso = getTodayIsoString();

  if (dateHeadingEl) {
    const yr = day.isoDate ? day.isoDate.split('-')[0] : '2026';
    dateHeadingEl.textContent = `${yr}年 ${day.dateDisplay}（${day.weekdayDisplay}）`;
  }

  const isNumericCountdown = typeof day.dayCountdown === 'number';
  if (selectedLabelEl) {
    if (isNumericCountdown) {
      const pIdx = getPhaseIndexForDay(day.dayCountdown);
      const pName = pIdx >= 0 ? appState.phases[pIdx].name : '衝刺階段';
      selectedLabelEl.textContent = `Day ${day.dayCountdown} · ${pName}`;
    } else {
      selectedLabelEl.textContent = `${day.dateDisplay} · 考前暖身與行程`;
    }
  }
  if (todayTagEl) {
    todayTagEl.textContent = day.isoDate === todayIso ? 'TODAY' : (isNumericCountdown ? `DAY ${day.dayCountdown}` : 'CALENDAR');
  }

  // 距離 2027-01-26 考試倒數天數（以凌晨 05:00 分界之學習日計算）
  const examDate = new Date(2027, 0, 26);
  const effDate = getEffectiveStudyDate(now);
  const todayMidnight = new Date(effDate.getFullYear(), effDate.getMonth(), effDate.getDate());
  const diffDaysReal = Math.max(1, Math.min(80, Math.round((examDate - todayMidnight) / 86400000) + 1));
  const displayCountdown = isNumericCountdown ? day.dayCountdown : diffDaysReal;

  const countdownNumEl = document.getElementById('homeExamCountdownNum');
  const countdownMetaEl = document.getElementById('homeExamCountdownMeta');
  const progressBarEl = document.getElementById('homeExamProgressBar');

  if (countdownNumEl) countdownNumEl.textContent = String(displayCountdown);
  const completedDaysPct = Math.max(0, Math.min(100, Math.round(((80 - displayCountdown) / 80) * 100)));
  if (countdownMetaEl) {
    countdownMetaEl.textContent = `11/8 (Day 80) → 1/26 (Day 1) · 衝刺進度 ${completedDaysPct}%`;
  }
  if (progressBarEl) {
    progressBarEl.style.width = `${completedDaysPct}%`;
  }

  // 2. 當日要做的事情（早、午、晚三時段）
  const slotsListEl = document.getElementById('homeSlotsList');
  const doneCounterEl = document.getElementById('homeDoneCounter');
  const doneCount = SLOT_KEYS.filter(({ key }) => day[key].completed).length;
  if (doneCounterEl) doneCounterEl.textContent = `${doneCount} / 3 完成`;

  if (slotsListEl) {
    slotsListEl.innerHTML = SLOT_KEYS.map(({ key, label, timeRange, icon }) => {
      const s = day[key];
      const effMins = getSlotEffectiveMinutes(s);
      const isRunning = s.timerStatus === 'running';
      const isPaused = s.timerStatus === 'paused';
      const subjOpts = SUBJECT_OPTIONS.map(opt => `
        <option value="${escapeHtml(opt)}" ${s.subject === opt ? 'selected' : ''}>${escapeHtml(opt || '選擇科目')}</option>
      `).join('');

      return `
        <div class="home-slot-item ${s.completed ? 'is-completed' : ''}">
          <div class="home-slot-top">
            <div class="home-slot-period">
              <input
                type="checkbox"
                class="done-checkbox home-slot-checkbox"
                data-day="${day.dayCountdown}"
                data-slot="${key}"
                ${s.completed ? 'checked' : ''}
              />
              <span>${icon} ${label}時段</span>
              <span style="font-size:11.5px; color:var(--text-muted); font-weight:500;">(${timeRange})</span>
            </div>
            <div style="display:flex; align-items:center; gap:8px;">
              ${isRunning ? '<span class="status-pill status-active" style="font-size:11px; padding:2px 8px;">⚡ 計時中</span>' : (isPaused ? '<span class="status-pill status-paused" style="font-size:11px; padding:2px 8px;">⏸ 休息中</span>' : '')}
              <span style="font-size:12.5px; color:var(--text-secondary); font-weight:600;">
                ${effMins > 0 ? `已讀 ${formatMinutesToHM(effMins)}` : '0分'}
              </span>
            </div>
          </div>
          <div class="home-slot-controls-row">
            <select class="subject-select home-slot-subj" data-day="${day.dayCountdown}" data-slot="${key}" data-subj="${escapeHtml(s.subject)}">
              ${subjOpts}
            </select>
            <input
              type="text"
              class="task-input home-slot-task"
              data-day="${day.dayCountdown}"
              data-slot="${key}"
              value="${escapeHtml(s.task)}"
              placeholder="點此輸入${label}要做的工作事項..."
            />
          </div>
        </div>
      `;
    }).join('');
  }

  // 3. 當日行事曆備忘 & 近期重要日程
  const memoInput = document.getElementById('homeCalendarMemoInput');
  if (memoInput && document.activeElement !== memoInput) {
    memoInput.value = day.calendar || '';
    memoInput.dataset.day = day.dayCountdown;
  }

  const upcomingListEl = document.getElementById('homeUpcomingList');
  if (upcomingListEl) {
    const milestones = appState.days.filter(d => d.calendar && d.calendar.trim());
    if (milestones.length === 0) {
      upcomingListEl.innerHTML = `<div style="font-size:12px; color:var(--text-muted); padding:8px 0;">尚無特別備忘行程，可於上方或行事曆新增</div>`;
    } else {
      upcomingListEl.innerHTML = milestones.slice(0, 8).map(m => `
        <div class="home-upcoming-item" data-home-jump-day="${m.dayCountdown}">
          <div>
            <strong>${m.dateDisplay}（${m.weekdayDisplay}）</strong>
            <span style="margin-left:6px; color:var(--text-primary);">${escapeHtml(m.calendar)}</span>
          </div>
          <span class="day-badge" style="font-size:11px;">Day ${m.dayCountdown}</span>
        </div>
      `).join('');
    }
  }

  // 4. 當日專注與休息統計速覽
  const focusEl = document.getElementById('homeStatFocusTime');
  const shortRestEl = document.getElementById('homeStatShortRest');
  const active = findActiveTimerSlot();

  if (focusEl) focusEl.textContent = formatMinutesToHM(getDayTotalEffectiveMinutes(day));
  if (shortRestEl) {
    const shortMs = (active && active.slot.timerStatus === 'paused') ? getSlotShortRestLiveMs(active.slot) : 0;
    shortRestEl.textContent = formatMsToClock(shortMs);
  }
}

/* ==========================================================================
   第 2 頁：⏱️ 計時器（YPT 模式：依開始時間自動判定時段，下方顯示休息時間）
   ========================================================================== */

function getDayTotalEffectiveMinutes(day) {
  if (!day) return 0;
  return SLOT_KEYS.reduce((acc, { key }) => acc + getSlotEffectiveMinutes(day[key]), 0);
}

function renderQuickTimerView() {
  const day = getTimerTargetDay();
  if (!day) return;

  const quickDayBadge = document.getElementById('quickDayBadge');
  const quickDateTitle = document.getElementById('quickDateTitle');
  const quickPhaseTag = document.getElementById('quickPhaseTag');
  const quickTodayTotalTime = document.getElementById('quickTodayTotalTime');

  const isNumeric = typeof day.dayCountdown === 'number';
  if (quickDayBadge) quickDayBadge.textContent = isNumeric ? `Day ${day.dayCountdown}` : day.dateDisplay;
  if (quickDateTitle) quickDateTitle.textContent = `${day.dateDisplay}（${day.weekdayDisplay}）`;
  if (quickPhaseTag) {
    if (isNumeric) {
      const phaseIdx = getPhaseIndexForDay(day.dayCountdown);
      const p = appState.phases[phaseIdx] || DEFAULT_PHASES[phaseIdx] || { name: '衝刺階段' };
      quickPhaseTag.textContent = p.name;
    } else {
      quickPhaseTag.textContent = '考前暖身';
    }
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

  // 休息時間面板元素（已取消累積休息，短期休息統一更名為休息時間）
  const restPanel = document.getElementById('quickRestTimerPanel');
  const shortRestClockEl = document.getElementById('quickShortRestClock');
  const shortRestHintEl = document.getElementById('quickShortRestHint');

  if (!clockEl || !textEl) return;

  const active = findActiveTimerSlot();

  if (active) {
    const isRunning = active.slot.timerStatus === 'running';
    const isPaused = active.slot.timerStatus === 'paused';
    const liveFocusMs = getSlotLiveMs(active.slot);
    const shortRestMs = getSlotShortRestLiveMs(active.slot);

    // 主時鐘始終顯示「讀書專注時間」（暫停時保持定格於已讀時間，不與下方休息時鐘混淆）
    if (currentTimerMode === 'pomodoro-25') {
      const targetMs = 25 * 60 * 1000;
      clockEl.textContent = formatMsToClock(Math.max(0, targetMs - liveFocusMs));
    } else if (currentTimerMode === 'pomodoro-50') {
      const targetMs = 50 * 60 * 1000;
      clockEl.textContent = formatMsToClock(Math.max(0, targetMs - liveFocusMs));
    } else {
      clockEl.textContent = formatMsToClock(liveFocusMs);
    }
    clockEl.style.color = isPaused ? 'var(--text-secondary)' : 'var(--sakura-deep)';

    if (dotEl) {
      dotEl.className = 'quick-status-dot ' + (isRunning ? 'running' : 'paused');
    }

    const slotObj = SLOT_KEYS.find(k => k.key === active.slotKey);
    const slotLabel = slotObj ? `${slotObj.icon} ${slotObj.label}時段` : active.slotLabel;
    const modeName = currentTimerMode === 'pomodoro-25' ? '【25分番茄鐘】' : (currentTimerMode === 'pomodoro-50' ? '【50分衝刺鐘】' : '');
    const effFocusMins = getSlotEffectiveMinutes(active.slot);

    if (isRunning) {
      textEl.innerHTML = `⏱️ 正在專注：<strong style="color:var(--sakura-deep);font-size:15px;">${escapeHtml(active.slot.subject || '自訂科目')}</strong> ${modeName}（依開始時間 ${active.slot.startTime || ''} 歸於 ${slotLabel}）`;
    } else if (isPaused) {
      textEl.innerHTML = `⏸ 已暫停專注（休息中）：<strong style="color:var(--text-primary);font-size:15px;">${escapeHtml(active.slot.subject || '自訂科目')}</strong> · 已專注 ${formatMinutesToHM(effFocusMins)}`;
    } else {
      textEl.innerHTML = `⏹️ 計時已結束：<strong style="color:var(--text-secondary);">${escapeHtml(active.slot.subject || '自訂科目')}</strong>`;
    }

    if (actionsRow) actionsRow.style.display = 'flex';
    if (pauseResumeBtn) {
      pauseResumeBtn.textContent = isRunning ? '暫停（開始休息）⏸' : '結束休息・繼續專注 ▶';
      pauseResumeBtn.className = 'btn btn-lg ' + (isRunning ? 'btn-pause' : 'btn-resume');
    }

    // 更新下方「休息時間」面板
    if (restPanel) {
      restPanel.classList.toggle('is-resting', isPaused);
    }
    if (shortRestClockEl) {
      shortRestClockEl.textContent = formatMsToClock(shortRestMs);
    }
    if (shortRestHintEl) {
      shortRestHintEl.textContent = isPaused
        ? '☕ 正在計時本次休息（按繼續專注後結算）'
        : '按下暫停鍵後，將從 00:00:00 開始計時本次休息';
    }
  } else {
    clockEl.style.color = 'var(--sakura-deep)';
    if (currentTimerMode === 'pomodoro-25') {
      clockEl.textContent = '00:25:00';
      textEl.textContent = '🍅 已就緒！點選下方科目，即刻開始 25 分鐘番茄鐘專注倒數';
    } else if (currentTimerMode === 'pomodoro-50') {
      clockEl.textContent = '00:50:00';
      textEl.textContent = '🎯 已就緒！點選下方科目，即刻開始 50 分鐘衝刺專注倒數';
    } else {
      clockEl.textContent = '00:00:00';
      textEl.textContent = '點選下方科目，即刻開始專注計時';
    }
    if (dotEl) dotEl.className = 'quick-status-dot';
    if (actionsRow) actionsRow.style.display = 'none';

    if (restPanel) restPanel.classList.remove('is-resting');
    if (shortRestClockEl) shortRestClockEl.textContent = '00:00:00';
    if (shortRestHintEl) shortRestHintEl.textContent = '按下暫停鍵後自動開始計時';
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

  // 已依指示移除「英文」科目
  const subjects = [
    { name: '經濟', icon: '✦', colorVar: '--subj-econ-border' },
    { name: '統計', icon: '📊', colorVar: '--subj-stat-border' },
    { name: '財管', icon: '📈', colorVar: '--subj-fin-border' },
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
    const isThisActive = active && String(active.day.dayCountdown) === String(day.dayCountdown) && active.slotKey === key;
    const isRunning = s.timerStatus === 'running';
    const isPaused = s.timerStatus === 'paused';
    const effMins = getSlotEffectiveMinutes(s);
    const effRestMins = getSlotRestEffectiveMinutes(s);

    let statusBadge = '';
    if (isRunning) {
      statusBadge = '<span class="quick-slot-badge" style="background:var(--timer-running-bg);color:var(--timer-running);">⏱️ 計時中</span>';
    } else if (isPaused) {
      statusBadge = '<span class="quick-slot-badge" style="background:var(--timer-paused-bg);color:var(--timer-paused);">☕ 休息中</span>';
    } else if (s.completed) {
      statusBadge = '<span class="quick-slot-badge" style="background:var(--timer-done-bg);color:var(--timer-done);">✅ 已完成</span>';
    } else if (effMins > 0) {
      statusBadge = '<span class="quick-slot-badge" style="background:var(--bg-subtle);color:var(--text-secondary);">已記錄</span>';
    } else {
      statusBadge = '<span class="quick-slot-badge" style="background:var(--bg-subtle);color:var(--text-muted);">尚未開始</span>';
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
          <div><strong>時間：</strong>${timeDetails}（專注 ${formatMinutesToHM(effMins)}）</div>
        </div>
      </div>
    `;
  }).join('');
}

function handleQuickSubjectClick(subjectName) {
  const active = findActiveTimerSlot();
  const now = new Date();
  const currentSlotKey = getSlotKeyFromStartTime(now);
  const realTodayDay = findDayByKey(getTodayDayCountdown()) || appState.days[0];
  if (!realTodayDay) return;

  if (active && active.slot.timerStatus === 'running') {
    if (active.slot.subject === subjectName) {
      handleYptTimerAction('ypt-pause', active.day.dayCountdown, active.slotKey);
      renderQuickTimerView();
      return;
    } else {
      handleYptTimerAction('ypt-pause', active.day.dayCountdown, active.slotKey);
    }
  } else if (
    active &&
    active.slot.timerStatus === 'paused' &&
    active.slot.subject === subjectName
  ) {
    handleYptTimerAction('ypt-resume', active.day.dayCountdown, active.slotKey);
    renderQuickTimerView();
    return;
  }

  // 依當前即時學習日與開始時間嚴格判定時段（鎖定當下即時時刻，絕不跳到其他天！）
  const slotKey = currentSlotKey;
  const slot = realTodayDay[slotKey];

  slot.subject = subjectName;
  slot.updatedAt = Date.now();
  if (!slot.startTime || slot.timerStatus === 'idle' || slot.timerStatus === 'ended') {
    slot.startTime = getCurrentTimeHM();
  }

  handleYptTimerAction('ypt-start', realTodayDay.dayCountdown, slotKey);
  renderQuickTimerView();
}

/* ==========================================================================
   第 3 頁子視圖 B：當日行事曆與三時段詳細編輯畫面（點擊 Notion 月曆第一格進入）
   ========================================================================== */

function renderDailyPlanView(optionalDayKey) {
  if (optionalDayKey) {
    calendarEditorDayKey = optionalDayKey;
  }
  const day = getCalendarEditorDay();
  if (!day) return;

  const badgeEl = document.getElementById('dailyDayBadge');
  const headingEl = document.getElementById('dailyDateHeading');
  const phaseBadgeEl = document.getElementById('dailyPhaseBadge');
  const calendarInput = document.getElementById('dailyCalendarInput');
  const selectEl = document.getElementById('dailyDaySelect');

  const isNumeric = typeof day.dayCountdown === 'number';
  if (badgeEl) badgeEl.textContent = isNumeric ? `Day ${day.dayCountdown}` : day.dateDisplay;
  if (headingEl) headingEl.textContent = `${day.dateDisplay}（${day.weekdayDisplay}）`;
  if (phaseBadgeEl) {
    if (isNumeric) {
      const phaseIdx = getPhaseIndexForDay(day.dayCountdown);
      const p = appState.phases[phaseIdx] || DEFAULT_PHASES[phaseIdx] || { name: '衝刺階段' };
      phaseBadgeEl.textContent = p.name;
    } else {
      phaseBadgeEl.textContent = '月曆自訂日';
    }
  }
  if (calendarInput && document.activeElement !== calendarInput) {
    calendarInput.value = day.calendar || '';
  }

  if (selectEl) {
    const extraOpts = appState.extraDays
      ? Object.keys(appState.extraDays).sort().map(iso => {
          const ed = appState.extraDays[iso];
          return `<option value="${ed.dayCountdown}" ${String(ed.dayCountdown) === String(day.dayCountdown) ? 'selected' : ''}>${ed.dateDisplay} (${ed.weekdayDisplay})</option>`;
        }).join('')
      : '';
    const mainOpts = appState.days.map(d => `
      <option value="${d.dayCountdown}" ${String(d.dayCountdown) === String(day.dayCountdown) ? 'selected' : ''}>
        Day ${d.dayCountdown} - ${d.dateDisplay} (${d.weekdayDisplay})
      </option>
    `).join('');
    selectEl.innerHTML = extraOpts + mainOpts;
  }

  renderDailySlotsDetailed(day);
  renderDailyFocusScheduleTable();

  const doneCount = SLOT_KEYS.filter(({ key }) => day[key].completed).length;
  const rate = Math.round((doneCount / 3) * 100);
  const totalMins = getDayTotalEffectiveMinutes(day);

  const doneCountEl = document.getElementById('dailyDoneCount');
  const doneRateEl = document.getElementById('dailyDoneRate');
  const totalTimeEl = document.getElementById('dailyTotalTime');
  const totalRestTimeEl = document.getElementById('dailyTotalRestTime');

  if (doneCountEl) doneCountEl.textContent = `${doneCount} / 3`;
  if (doneRateEl) doneRateEl.textContent = `${rate}%`;
  if (totalTimeEl) totalTimeEl.textContent = formatMinutesToHM(totalMins);
  if (totalRestTimeEl) totalRestTimeEl.textContent = formatMinutesToHM(getDayTotalRestMinutes(day));
}

function renderDailySlotsDetailed(day) {
  const container = document.getElementById('dailySlotsContainer');
  if (!container) return;

  container.innerHTML = SLOT_KEYS.map(({ key, label, timeRange, icon }) => {
    const s = day[key];

    const subjectOptionsHtml = SUBJECT_OPTIONS.map(opt => `
      <option value="${escapeHtml(opt)}" ${s.subject === opt ? 'selected' : ''}>${escapeHtml(opt || '— 選擇科目 —')}</option>
    `).join('');

    return `
      <div class="daily-slot-card ${s.completed ? 'completed' : ''}" id="daily-card-${day.dayCountdown}-${key}">
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
        </div>
      </div>
    `;
  }).join('');
}

function updateDailyPlanLiveClocks(active) {
  const viewedDay = getCalendarEditorDay();
  if (!active || !viewedDay || String(active.day.dayCountdown) !== String(viewedDay.dayCountdown)) return;
  const clockEl = document.getElementById(`daily-clock-${active.day.dayCountdown}-${active.slotKey}`);
  if (clockEl) {
    if (active.slot.timerStatus === 'paused') {
      const focusStr = formatMsToClock(getSlotLiveMs(active.slot));
      const restStr = formatMsToClock(getSlotShortRestLiveMs(active.slot));
      clockEl.textContent = `⏸ 專注 ${focusStr}（☕ 休息 ${restStr}）`;
    } else {
      clockEl.textContent = formatMsToClock(getSlotLiveMs(active.slot));
    }
  }
}

/* ==========================================================================
   第 3 頁子視圖 A：Notion 日曆資料庫（月曆形態 + 每格 3 條橫線直接輸入工作）
   ========================================================================== */

function renderPureCalendarTable() {
  const gridEl = document.getElementById('notionCalendarGrid');
  if (!gridEl) return;

  // 更新月份切換按鈕狀態
  const monthTabs = document.querySelectorAll('#calMonthTabs .month-tab');
  monthTabs.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.month === currentCalendarMonth);
  });

  const [yrStr, moStr] = currentCalendarMonth.split('-');
  const year = parseInt(yrStr, 10) || 2026;
  const month = parseInt(moStr, 10) || 11; // 1..12

  // 計算該月第一天與最後一天（以週一為每週第一欄：週一=0 ... 週日=6）
  const firstDate = new Date(year, month - 1, 1);
  const lastDate = new Date(year, month, 0);
  const daysInMonth = lastDate.getDate();

  const firstWeekdayMon0 = (firstDate.getDay() + 6) % 7; // Sun(0)->6, Mon(1)->0
  const totalCells = Math.ceil((firstWeekdayMon0 + daysInMonth) / 7) * 7;
  const startCellDate = new Date(year, month - 1, 1 - firstWeekdayMon0);

  const todayIso = getTodayIsoString();
  const q = (currentSearchQuery || '').trim().toLowerCase();

  const cellsHtml = [];
  for (let i = 0; i < totalCells; i++) {
    const cellDate = new Date(startCellDate.getFullYear(), startCellDate.getMonth(), startCellDate.getDate() + i);
    const cY = cellDate.getFullYear();
    const cM = cellDate.getMonth() + 1;
    const cD = cellDate.getDate();
    const isoDate = `${cY}-${String(cM).padStart(2, '0')}-${String(cD).padStart(2, '0')}`;
    const isOutsideMonth = cM !== month;
    const isToday = isoDate === todayIso;

    const dayObj = findDayByKey(isoDate);
    const dayKey = dayObj ? dayObj.dayCountdown : isoDate;
    const isNumericCountdown = dayObj && typeof dayObj.dayCountdown === 'number';
    const totalMins = dayObj ? getDayTotalEffectiveMinutes(dayObj) : 0;

    // 關鍵字搜尋高光過濾
    let matchesSearch = true;
    if (q && dayObj) {
      const hay = [
        dayObj.dateDisplay,
        dayObj.calendar || '',
        dayObj.morning.subject, dayObj.morning.task,
        dayObj.afternoon.subject, dayObj.afternoon.task,
        dayObj.evening.subject, dayObj.evening.task
      ].join(' ').toLowerCase();
      matchesSearch = hay.includes(q);
    }

    const dateLabel = cD === 1 ? `${cM}月1日` : String(cD);

    const slotRowsHtml = [
      { key: 'morning', shortLabel: '早' },
      { key: 'afternoon', shortLabel: '午' },
      { key: 'evening', shortLabel: '晚' }
    ].map(({ key, shortLabel }) => {
      const s = dayObj ? dayObj[key] : { subject: '', task: '', completed: false };
      const tagText = s.subject ? s.subject : shortLabel;
      return `
        <div class="cal-cell-slot-row">
          <span
            class="cal-slot-tag ${s.subject ? 'has-subj' : ''}"
            data-cycle-subj-day="${dayKey}"
            data-cycle-subj-slot="${key}"
            title="點擊切換科目（${shortLabel}）"
          >${escapeHtml(tagText)}</span>
          <input
            type="text"
            class="cal-slot-input"
            data-day="${dayKey}"
            data-slot="${key}"
            value="${escapeHtml(s.task || '')}"
            placeholder="${shortLabel}：輸入工作..."
          />
          ${s.completed ? '<span class="cal-slot-done-dot" title="已完成">✓</span>' : ''}
        </div>
      `;
    }).join('');

    const isSelected = String(dayKey) === String(calendarEditorDayKey);

    cellsHtml.push(`
      <div
        class="notion-cal-cell ${isOutsideMonth ? 'outside-month' : ''} ${isToday ? 'is-today' : ''} ${isSelected ? 'is-selected-day' : ''}"
        style="${!matchesSearch ? 'opacity: 0.25;' : ''}"
        data-cal-cell-day="${dayKey}"
      >
        <!-- 第一格：點擊開啟 Notion 風格當日快捷頁面彈窗 -->
        <div class="cal-cell-date-row" data-open-day-editor="${dayKey}" title="點擊開啟 ${cM}月${cD}日 快捷編輯頁面">
          <div class="cal-date-left-meta">
            ${isNumericCountdown ? `<span class="cal-countdown-mini">D-${dayObj.dayCountdown}</span>` : ''}
            ${dayObj && dayObj.calendar ? `<span class="cal-memo-pill" title="${escapeHtml(dayObj.calendar)}">${escapeHtml(dayObj.calendar)}</span>` : ''}
            ${totalMins > 0 ? `<span class="cal-countdown-mini" style="color:var(--sakura-deep);">${formatMinutesToHM(totalMins)}</span>` : ''}
          </div>
          <span class="cal-date-num ${isToday ? 'today-circle' : ''}">${dateLabel}</span>
        </div>

        <!-- 日期下方三個橫線格：直接點擊輸入當日早、午、晚要做的工作 -->
        ${slotRowsHtml}
      </div>
    `);
  }

  gridEl.innerHTML = cellsHtml.join('');
}


/* ==========================================================================
   UI 渲染：每日專注總表（80天早中晚專注時間與各時段詳細紀錄）
   ========================================================================== */

function renderDailyFocusScheduleTable() {
  const tbody = document.getElementById('dailyFocusTableBody');
  if (!tbody) return;

  const filteredDays = appState.days.filter(day => {
    if (currentDailyPhaseFilter === 'phase-0' && getPhaseIndexForDay(day.dayCountdown) !== 0) return false;
    if (currentDailyPhaseFilter === 'phase-1' && getPhaseIndexForDay(day.dayCountdown) !== 1) return false;
    if (currentDailyPhaseFilter === 'phase-2' && getPhaseIndexForDay(day.dayCountdown) !== 2) return false;
    if (currentDailyPhaseFilter === 'has-record') {
      const hasRec = SLOT_KEYS.some(({ key }) => {
        const s = day[key];
        return s.completed || getSlotEffectiveMinutes(s) > 0 || s.timerStatus === 'running' || s.timerStatus === 'paused';
      });
      if (!hasRec) return false;
    }

    if (currentDailySubjectFilter) {
      const matchSubj = SLOT_KEYS.some(({ key }) => {
        const subj = day[key].subject;
        if (currentDailySubjectFilter === '經濟') {
          return subj === '經濟' || subj === '個經' || subj === '總經';
        }
        return subj === currentDailySubjectFilter;
      });
      if (!matchSubj) return false;
    }

    if (currentDailySearchQuery) {
      const q = currentDailySearchQuery.toLowerCase();
      const hay = [
        day.dateDisplay,
        day.weekdayDisplay,
        `day ${day.dayCountdown}`,
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
          找不到符合條件的專注紀錄列 🌸
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = filteredDays.map(day => buildDailyFocusRowHtml(day)).join('');
}

function buildDailyFocusRowHtml(day) {
  const phaseIdx = getPhaseIndexForDay(day.dayCountdown);
  const phaseName = phaseIdx >= 0 ? appState.phases[phaseIdx].name : '未分類';
  const hasActiveTimer = SLOT_KEYS.some(({ key }) => day[key].timerStatus === 'running' || day[key].timerStatus === 'paused');
  const doneCount = SLOT_KEYS.reduce((acc, { key }) => acc + (day[key].completed ? 1 : 0), 0);
  const ratePct = doneCount === 0 ? 0 : doneCount === 1 ? 33 : doneCount === 2 ? 67 : 100;
  const totalDayMins = SLOT_KEYS.reduce((acc, { key }) => acc + getSlotEffectiveMinutes(day[key]), 0);

  const rowClasses = [
    hasActiveTimer ? 'row-active-timer' : '',
    doneCount === 3 ? 'row-complete-all' : ''
  ].filter(Boolean).join(' ');

  return `
    <tr id="row-day-${day.dayCountdown}" class="${rowClasses}" data-day="${day.dayCountdown}">
      <td class="sticky-col-1">
        <div class="date-cell-content">
          <span class="date-main">${day.dateDisplay}</span>
          <span class="date-weekday ${day.isWeekend ? 'weekend' : ''}">${day.weekdayDisplay}</span>
        </div>
      </td>
      <td class="sticky-col-2" style="text-align:center;">
        <span class="day-badge">Day ${day.dayCountdown}</span>
        <span class="phase-mini-tag">${escapeHtml(phaseName)}</span>
      </td>
      ${SLOT_KEYS.map(({ key }) => buildSlotCellHtml(day.dayCountdown, key, day[key])).join('')}
      <td class="summary-cell">
        <span class="daily-done-count" id="summary-done-${day.dayCountdown}">${doneCount}</span>
        <span class="stat-sub-val">/ 3 時段</span>
      </td>
      <td class="summary-cell">
        <div class="daily-rate-wrap">
          <span class="daily-rate-text" id="summary-rate-${day.dayCountdown}">${ratePct}%</span>
          <div class="mini-progress-bar">
            <div class="mini-progress-fill" id="summary-bar-${day.dayCountdown}" style="width: ${ratePct}%;"></div>
          </div>
        </div>
      </td>
      <td class="summary-cell">
        <span class="daily-total-time ${totalDayMins > 0 ? 'has-time' : ''}" id="summary-time-${day.dayCountdown}">
          ${formatMinutesToHM(totalDayMins)}
        </span>
      </td>
      <td style="text-align: center;">
        <button type="button" class="btn btn-xs btn-subtle jump-to-daily-btn" data-jump-day="${day.dayCountdown}" title="進入此日詳細行事曆">
          詳情 ↵
        </button>
      </td>
    </tr>
  `;
}

function renderMainScheduleTable() {
  if (!calendarEditorDayKey) {
    calendarEditorDayKey = getTodayDayCountdown();
  }
  renderPureCalendarTable();
  renderDailyPlanView(calendarEditorDayKey);
  renderDailyFocusScheduleTable();
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
            data-subj="${escapeHtml(slot.subject)}"
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
            ${isPaused
              ? `⏸ 專注 ${formatMsToClock(liveMs)}（☕ ${formatMsToClock(getSlotShortRestLiveMs(slot))}）`
              : formatMsToClock(liveMs)}
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
 * 局部更新單日彙總（同時更新每日專注總表、行事曆與頂部資訊卡）
 */
function updateSingleDayRowSummaryDom(day) {
  if (!day) return;
  const doneCount = SLOT_KEYS.reduce((acc, { key }) => acc + (day[key].completed ? 1 : 0), 0);
  const ratePct = doneCount === 0 ? 0 : doneCount === 1 ? 33 : doneCount === 2 ? 67 : 100;
  const totalDayMins = SLOT_KEYS.reduce((acc, { key }) => acc + getSlotEffectiveMinutes(day[key]), 0);
  const hasActive = SLOT_KEYS.some(({ key }) => day[key].timerStatus === 'running' || day[key].timerStatus === 'paused');

  // 1. 每日專注總表對應列
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
    rowEl.classList.toggle('row-active-timer', hasActive);
    rowEl.classList.toggle('row-complete-all', doneCount === 3);
  }

  // 2. 若為當前單日詳細編輯日或快捷計時目標日，分別同步更新頂部指標
  const editorDay = getCalendarEditorDay();
  if (editorDay && String(day.dayCountdown) === String(editorDay.dayCountdown)) {
    const dailyDoneCount = document.getElementById('dailyDoneCount');
    const dailyDoneRate = document.getElementById('dailyDoneRate');
    const dailyTotalTime = document.getElementById('dailyTotalTime');
    if (dailyDoneCount) dailyDoneCount.textContent = `${doneCount} / 3`;
    if (dailyDoneRate) dailyDoneRate.textContent = `${ratePct}%`;
    if (dailyTotalTime) dailyTotalTime.textContent = formatMinutesToHM(totalDayMins);
  }

  const timerDay = getTimerTargetDay();
  if (timerDay && String(day.dayCountdown) === String(timerDay.dayCountdown)) {
    const quickTodayTotalTime = document.getElementById('quickTodayTotalTime');
    if (quickTodayTotalTime) quickTodayTotalTime.textContent = formatMinutesToHM(totalDayMins);
  }
}

/* ==========================================================================
   YPT 模式計時器核心控制（Date.now() 時間戳記差值計算，背景不掉秒）
   ========================================================================== */

// 螢幕常亮鎖（Wake Lock API：支援手機/平板開著畫面時不自動暗屏，關屏則自動由時間戳記接手）
let wakeLockSentinel = null;
async function syncScreenWakeLock() {
  try {
    if (typeof navigator === 'undefined' || !('wakeLock' in navigator)) return;
    const active = findActiveTimerSlot();
    const isRunning = Boolean(active && active.slot.timerStatus === 'running');
    if (isRunning && document.visibilityState === 'visible') {
      if (!wakeLockSentinel) {
        wakeLockSentinel = await navigator.wakeLock.request('screen');
        wakeLockSentinel.addEventListener('release', () => {
          wakeLockSentinel = null;
        });
      }
    } else if (!isRunning && wakeLockSentinel) {
      await wakeLockSentinel.release();
      wakeLockSentinel = null;
    }
  } catch (e) {
    // 忽略瀏覽器權限或背景狀態下的 WakeLock 例外
  }
}

function getAllDaysList() {
  const extras = appState && appState.extraDays ? Object.values(appState.extraDays) : [];
  return [...((appState && appState.days) ? appState.days : []), ...extras];
}

function findActiveTimerSlot() {
  let runningCandidate = null;
  let pausedCandidate = null;

  for (const day of getAllDaysList()) {
    for (const { key, label } of SLOT_KEYS) {
      const slot = day[key];
      if (!slot) continue;
      if (slot.timerStatus === 'running') {
        const ts = slot.updatedAt || slot.lastResumeTimestamp || 0;
        const bestTs = runningCandidate ? (runningCandidate.slot.updatedAt || runningCandidate.slot.lastResumeTimestamp || 0) : -1;
        if (!runningCandidate || ts >= bestTs) {
          runningCandidate = { day, slotKey: key, slotLabel: label, slot };
        }
      } else if (slot.timerStatus === 'paused') {
        const ts = slot.updatedAt || 0;
        const bestTs = pausedCandidate ? (pausedCandidate.slot.updatedAt || 0) : -1;
        if (!pausedCandidate || ts >= bestTs) {
          pausedCandidate = { day, slotKey: key, slotLabel: label, slot };
        }
      }
    }
  }

  return runningCandidate || pausedCandidate;
}

function handleYptTimerAction(action, dayCountdown, slotKey) {
  const day = findDayByKey(dayCountdown);
  if (!day) return;
  const slot = day[slotKey];
  if (!slot) return;

  const now = Date.now();

  if (action === 'ypt-start') {
    // 若有其他正在跑的時段，先自動將其暫停以確保單一專注計時準確
    pauseOtherActiveSlots(day.dayCountdown, slotKey, now - 1);

    if (!slot.startTime) {
      slot.startTime = getCurrentTimeHM();
    }
    // 若先前已有手動輸入的時長，從該時長基礎上繼續或從 0 開始
    if (slot.timerStatus === 'idle' || slot.timerStatus === 'ended') {
      slot.accumulatedMs = (slot.durationMinutes || 0) * 60000;
      slot.endTime = ''; // 重新開始計時時清除舊的結束時間，待按「結束」再重新記錄
    }
    // 結算先前暫停的休息時間
    if (slot.lastPauseTimestamp) {
      slot.restAccumulatedMs = (slot.restAccumulatedMs || 0) + Math.max(0, now - slot.lastPauseTimestamp);
      slot.restMinutes = Math.round(slot.restAccumulatedMs / 60000);
      slot.lastPauseTimestamp = null;
    }
    slot.timerStatus = 'running';
    slot.lastResumeTimestamp = now;
    slot.updatedAt = now;
    appState.updatedAt = now;

    showToast(`▶ 開始計時：${day.dateDisplay} ${getSlotLabel(slotKey)} ${slot.subject ? `(${slot.subject})` : ''}`);
    playChime('start');
  } else if (action === 'ypt-pause') {
    if (slot.timerStatus === 'running' && slot.lastResumeTimestamp) {
      slot.accumulatedMs = (slot.accumulatedMs || 0) + Math.max(0, now - slot.lastResumeTimestamp);
    }
    slot.lastResumeTimestamp = null;
    slot.timerStatus = 'paused';
    slot.durationMinutes = slot.accumulatedMs > 0 ? Math.max(1, Math.round(slot.accumulatedMs / 60000)) : 0;

    // 開啟 YPT 短期休息與累積休息時間記錄模式
    slot.lastPauseTimestamp = now;
    slot.updatedAt = now;
    appState.updatedAt = now;

    showToast(`☕ 已暫停專注，開始計算休息時間（目前累計專注 ${formatMinutesToHM(slot.durationMinutes)}）`);
    playChime('pause');
  } else if (action === 'ypt-resume') {
    pauseOtherActiveSlots(day.dayCountdown, slotKey, now - 1);

    // 結束本次休息
    if (slot.lastPauseTimestamp) {
      slot.restAccumulatedMs = (slot.restAccumulatedMs || 0) + Math.max(0, now - slot.lastPauseTimestamp);
      slot.restMinutes = Math.round(slot.restAccumulatedMs / 60000);
      slot.lastPauseTimestamp = null;
    }
    slot.timerStatus = 'running';
    slot.lastResumeTimestamp = now;
    slot.updatedAt = now;
    appState.updatedAt = now;

    showToast(`▶ 結束休息，繼續專注計時：${day.dateDisplay} ${getSlotLabel(slotKey)} ${slot.subject ? `(${slot.subject})` : ''}`);
    playChime('start');
  } else if (action === 'ypt-stop') {
    if (slot.timerStatus === 'running' && slot.lastResumeTimestamp) {
      slot.accumulatedMs = (slot.accumulatedMs || 0) + Math.max(0, now - slot.lastResumeTimestamp);
    }
    if (slot.lastPauseTimestamp) {
      slot.restAccumulatedMs = (slot.restAccumulatedMs || 0) + Math.max(0, now - slot.lastPauseTimestamp);
      slot.restMinutes = Math.round(slot.restAccumulatedMs / 60000);
      slot.lastPauseTimestamp = null;
    }
    slot.lastResumeTimestamp = null;
    slot.timerStatus = 'ended';
    slot.endTime = getCurrentTimeHM();

    // 計算鎖定淨時長（若累積大於 1 秒但未滿 1 分鐘，以 1 分鐘計；超過 1 分鐘則四捨五入至分鐘）
    const totalMs = slot.accumulatedMs || 0;
    const netMinutes = totalMs >= 1000 ? Math.max(1, Math.round(totalMs / 60000)) : 0;
    slot.durationMinutes = netMinutes;
    slot.accumulatedMs = netMinutes * 60000;
    slot.updatedAt = now;
    appState.updatedAt = now;

    showToast(`⏹ 結束計時！已記錄專注：${formatMinutesToHM(netMinutes)}`);
    playChime('complete');
  }

  // 立即寫入本機 localStorage，並立即雙通道廣播給所有跨裝置
  saveState(true, false);
  syncScreenWakeLock();
  refreshSlotDom(day, slotKey);
  updateSingleDayRowSummaryDom(day);
  updateActiveTimerBanner();
  renderAllStatistics();
  renderQuickTimerView();
  renderDailyPlanView();
  renderHomeView();
  renderPureCalendarTable();

  if (currentRoomId && !isReceivingRemoteUpdate) {
    broadcastRoomDelta({
      kind: 'timer',
      day: day.dayCountdown,
      slot: slotKey,
      subject: slot.subject,
      task: slot.task,
      timerStatus: slot.timerStatus,
      startTime: slot.startTime,
      endTime: slot.endTime,
      durationMinutes: slot.durationMinutes,
      accumulatedMs: slot.accumulatedMs,
      lastResumeTimestamp: slot.lastResumeTimestamp,
      restMinutes: slot.restMinutes || 0,
      restAccumulatedMs: slot.restAccumulatedMs || 0,
      lastPauseTimestamp: slot.lastPauseTimestamp || null,
      updatedAt: slot.updatedAt,
      label: `${day.dateDisplay} ${getSlotLabel(slotKey)}`
    });
    if (roomDebounceTimer) {
      clearTimeout(roomDebounceTimer);
      roomDebounceTimer = null;
    }
    broadcastFullStateToRoom();
  }
}

function pauseOtherActiveSlots(currentDayCountdown, currentSlotKey, tsOverride = Date.now()) {
  const now = Date.now();
  getAllDaysList().forEach(d => {
    SLOT_KEYS.forEach(({ key }) => {
      if (String(d.dayCountdown) === String(currentDayCountdown) && key === currentSlotKey) return;
      const s = d[key];
      if (s && s.timerStatus === 'running') {
        if (s.lastResumeTimestamp) {
          s.accumulatedMs = (s.accumulatedMs || 0) + Math.max(0, now - s.lastResumeTimestamp);
        }
        s.lastResumeTimestamp = null;
        s.timerStatus = 'paused';
        s.lastPauseTimestamp = now;
        s.durationMinutes = s.accumulatedMs > 0 ? Math.max(1, Math.round(s.accumulatedMs / 60000)) : 0;
        s.updatedAt = tsOverride;
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
 * 凌晨 05:00 跨日自動結算檢查：
 * 規則：
 * 1. 若凌晨五點前忘記按掉結束，只按下暫停則默認結束！
 * 2. 若跨過隔日凌晨五點且前一日時段仍處於 paused，自動以當前累計專注時長結束結算，標記為完成；
 * 3. 若連暫停都沒按一直處於 running，自動截斷至 05:00 並結算結束。
 */
function checkAndAutoFinalizeOvernightSlots() {
  const currentStudyIso = getTodayIsoString();
  let changed = false;
  const now = Date.now();

  for (const day of getAllDaysList()) {
    if (!day || !day.isoDate || day.isoDate >= currentStudyIso) continue;

    for (const { key } of SLOT_KEYS) {
      const slot = day[key];
      if (!slot) continue;

      if (slot.timerStatus === 'paused') {
        const totalMs = slot.accumulatedMs || 0;
        const netMinutes = totalMs >= 1000 ? Math.max(1, Math.round(totalMs / 60000)) : 0;
        slot.durationMinutes = netMinutes;
        slot.accumulatedMs = netMinutes * 60000;
        slot.timerStatus = 'ended';
        slot.completed = true;
        slot.lastPauseTimestamp = null;
        slot.lastResumeTimestamp = null;
        if (!slot.endTime) {
          slot.endTime = '05:00';
        }
        slot.updatedAt = now;
        changed = true;
      } else if (slot.timerStatus === 'running') {
        if (slot.lastResumeTimestamp) {
          const dayParts = day.isoDate.split('-').map(Number);
          const cutoffDate = new Date(dayParts[0], dayParts[1] - 1, dayParts[2] + 1, 5, 0, 0, 0);
          const capTs = Math.min(now, cutoffDate.getTime());
          if (capTs > slot.lastResumeTimestamp) {
            slot.accumulatedMs = (slot.accumulatedMs || 0) + (capTs - slot.lastResumeTimestamp);
          }
        }
        const totalMs = slot.accumulatedMs || 0;
        const netMinutes = totalMs >= 1000 ? Math.max(1, Math.round(totalMs / 60000)) : 0;
        slot.durationMinutes = netMinutes;
        slot.accumulatedMs = netMinutes * 60000;
        slot.timerStatus = 'ended';
        slot.completed = true;
        slot.lastResumeTimestamp = null;
        slot.lastPauseTimestamp = null;
        if (!slot.endTime) {
          slot.endTime = '05:00';
        }
        slot.updatedAt = now;
        changed = true;
      }
    }
  }

  if (changed) {
    appState.updatedAt = now;
    saveState(true, false);
    renderAllStatistics();
    updateActiveTimerBanner();
    renderQuickTimerView();
    renderDailyPlanView();
    renderHomeView();
    renderPureCalendarTable();
    if (currentRoomId && !isReceivingRemoteUpdate) {
      broadcastFullStateToRoom();
    }
  }
}

/**
 * 每秒定時更新正在運行或暫停中的時鐘與統計（背景分頁、關螢幕或滑掉重開時自動以 Date.now() 差值無縫接續）
 */
function startGlobalTimerTicker() {
  if (timerIntervalId) clearInterval(timerIntervalId);
  let lastMinuteBucket = -1;

  timerIntervalId = setInterval(() => {
    checkAndAutoFinalizeOvernightSlots();
    const active = findActiveTimerSlot();
    updateActiveTimerBanner(active);

    if (currentActiveTab === 'home') {
      const liveClockEl = document.getElementById('homeLiveClock');
      if (liveClockEl) {
        const now = new Date();
        liveClockEl.textContent = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
      }
      if (active && active.slot.timerStatus === 'paused') {
        const homeShortRestEl = document.getElementById('homeStatShortRest');
        if (homeShortRestEl) {
          homeShortRestEl.textContent = formatMsToClock(getSlotShortRestLiveMs(active.slot));
        }
      }
    } else if (currentActiveTab === 'quick-timer') {
      updateQuickTimerDom();
    } else if (currentActiveTab === 'calendar-schedule' || currentActiveTab === 'daily-plan') {
      updateDailyPlanLiveClocks(active);
    }

    if (active && active.slot.timerStatus === 'running') {
      const liveMs = getSlotLiveMs(active.slot);

      // 番茄鐘倒數達成自動結算與打勾
      if (currentTimerMode === 'pomodoro-25' || currentTimerMode === 'pomodoro-50') {
        const targetM = currentTimerMode === 'pomodoro-25' ? 25 : 50;
        const targetMs = targetM * 60000;
        if (liveMs >= targetMs) {
          handleYptTimerAction('ypt-stop', active.day.dayCountdown, active.slotKey);
          active.slot.completed = true;
          saveState();
          playChime('pomodoro');
          showToast(`🍅 恭喜達成 ${targetM} 分鐘專注目標！已鎖定讀書時長並自動為您打勾！`);
          renderQuickTimerView();
          renderDailyPlanView();
          renderHomeView();
          return;
        }
      }

      const clockStr = formatMsToClock(liveMs);
      const clockEl = document.getElementById(`ypt-clock-${active.day.dayCountdown}-${active.slotKey}`);
      if (clockEl) {
        clockEl.textContent = clockStr;
      }

      if (typeof document !== 'undefined' && document.title !== undefined) {
        const subj = active.slot.subject || '專注中';
        const titleTime = (currentTimerMode === 'pomodoro-25' || currentTimerMode === 'pomodoro-50')
          ? formatMsToClock(Math.max(0, (currentTimerMode === 'pomodoro-25' ? 25 : 50) * 60000 - liveMs))
          : clockStr;
        document.title = `⏱️ ${titleTime} ${subj}｜讀書計劃表`;
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
          renderQuickSubjectsGrid(active.day);
          renderQuickSlotsOverview(active.day);
        }
      }
    } else if (active && active.slot.timerStatus === 'paused') {
      const shortRestMs = getSlotShortRestLiveMs(active.slot);
      const shortRestStr = formatMsToClock(shortRestMs);
      const focusMs = getSlotLiveMs(active.slot);
      const focusStr = formatMsToClock(focusMs);
      const clockEl = document.getElementById(`ypt-clock-${active.day.dayCountdown}-${active.slotKey}`);
      if (clockEl) {
        clockEl.textContent = `⏸ 專注 ${focusStr}（☕ ${shortRestStr}）`;
      }
      const effectiveMins = getSlotEffectiveMinutes(active.slot);
      const hrEl = document.getElementById(`dur-hr-${active.day.dayCountdown}-${active.slotKey}`);
      const minEl = document.getElementById(`dur-min-${active.day.dayCountdown}-${active.slotKey}`);
      if (hrEl && document.activeElement !== hrEl) hrEl.value = Math.floor(effectiveMins / 60);
      if (minEl && document.activeElement !== minEl) minEl.value = effectiveMins % 60;

      if (typeof document !== 'undefined' && document.title !== undefined) {
        document.title = `⏸ 專注 ${focusStr} ☕ 休息 ${shortRestStr}｜讀書計劃表`;
      }
    } else {
      if (typeof document !== 'undefined' && document.title && (document.title.startsWith('⏱️') || document.title.startsWith('☕') || document.title.startsWith('⏸'))) {
        document.title = appSettings.theme === 'dark' ? '讀書計劃表 ◈' : '小櫻讀書計劃表 🌸';
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
    const dayTag = typeof day.dayCountdown === 'number' ? ` (Day ${day.dayCountdown})` : '';
    labelEl.textContent = `${day.dateDisplay}${dayTag} ${slotLabel}`;
  }
  if (pillEl) {
    const subjText = slot.subject || '未選科目';
    pillEl.textContent = subjText;
    pillEl.setAttribute('data-subj', slot.subject || '其他');
  }
  if (clockEl) {
    if (isPaused) {
      const focusStr = formatMsToClock(getSlotLiveMs(slot));
      const restStr = formatMsToClock(getSlotShortRestLiveMs(slot));
      clockEl.textContent = `⏸ 專注 ${focusStr} ｜ ☕ 休息 ${restStr}`;
    } else {
      clockEl.textContent = formatMsToClock(getSlotLiveMs(slot));
    }
  }
  if (toggleBtn) {
    if (isPaused) {
      toggleBtn.textContent = '結束休息繼續 ▶';
      toggleBtn.className = 'ypt-btn btn-resume';
    } else {
      toggleBtn.textContent = '暫停 ⏸';
      toggleBtn.className = 'ypt-btn btn-pause';
    }
  }

  if (!banner.dataset) banner.dataset = {};
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
        val = Math.max(1, Math.min(80, val));
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
        if (currentRoomId && !isReceivingRemoteUpdate) {
          broadcastRoomDelta({ kind: 'phases', phases: appState.phases });
        }
      }
    });

    // 失焦時把被夾限的數值寫回輸入框（例如輸入 99 → 80）
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
      showToast('🌸 已還原預設三階段區間（Day 80-56、55-28、27-1）');
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
      if (currentRoomId && !isReceivingRemoteUpdate) {
        broadcastRoomDelta({ kind: 'goal', subj, phaseKey, val: target.value });
      }
    });
  }

  // 3A. Notion 日曆資料庫（月曆網格）委派
  const notionCalendarGrid = document.getElementById('notionCalendarGrid');
  if (notionCalendarGrid) {
    // 點擊第一格日期標題進入當日行事曆與時間編輯，或點擊科目小標籤快速輪替科目
    notionCalendarGrid.addEventListener('click', (e) => {
      const openEditorEl = e.target.closest('[data-open-day-editor]');
      if (openEditorEl) {
        openCalendarDayEditor(openEditorEl.dataset.openDayEditor);
        return;
      }

      const cycleSubjEl = e.target.closest('[data-cycle-subj-day]');
      if (cycleSubjEl) {
        const dayKey = cycleSubjEl.dataset.cycleSubjDay;
        const slotKey = cycleSubjEl.dataset.cycleSubjSlot;
        const day = findDayByKey(dayKey);
        if (day && day[slotKey]) {
          const curSubj = day[slotKey].subject || '';
          const curIdx = SUBJECT_OPTIONS.indexOf(curSubj);
          const nextIdx = (curIdx + 1) % SUBJECT_OPTIONS.length;
          const nextSubj = SUBJECT_OPTIONS[nextIdx];
          const nowTs = Date.now();
          day[slotKey].subject = nextSubj;
          day[slotKey].updatedAt = nowTs;
          appState.updatedAt = nowTs;
          saveState();
          renderPureCalendarTable();
          renderHomeView();
          renderQuickTimerView();
          renderDailyPlanView();
          renderAllStatistics();
          showToast(`已切換科目：${nextSubj || '未指定'}`);
          if (currentRoomId && !isReceivingRemoteUpdate) {
            broadcastRoomDelta({ kind: 'subject', day: dayKey, slot: slotKey, val: nextSubj, updatedAt: nowTs });
          }
        }
        return;
      }
    });

    // 點擊日期下方三條橫線格子，直接輸入當日早、午、晚工作
    notionCalendarGrid.addEventListener('input', (e) => {
      const inp = e.target;
      if (!inp.classList.contains('cal-slot-input')) return;
      const dayKey = inp.dataset.day;
      const slotKey = inp.dataset.slot;
      const day = findDayByKey(dayKey);
      if (day && day[slotKey]) {
        const nowTs = Date.now();
        day[slotKey].task = inp.value;
        day[slotKey].updatedAt = nowTs;
        appState.updatedAt = nowTs;
        saveState();
        if (currentRoomId && !isReceivingRemoteUpdate) {
          broadcastRoomDeltaDebounced({ kind: 'task', day: dayKey, slot: slotKey, val: inp.value, updatedAt: nowTs });
        }
      }
    });
  }

  // 3B. 每日專注總表（80天早中晚專注時間表）委派
  const dailyFocusTableBody = document.getElementById('dailyFocusTableBody');
  if (dailyFocusTableBody) {
    dailyFocusTableBody.addEventListener('click', (e) => {
      const jumpBtn = e.target.closest('.jump-to-daily-btn');
      if (jumpBtn && jumpBtn.dataset.jumpDay) {
        openCalendarDayEditor(jumpBtn.dataset.jumpDay);
        switchMainTab('calendar-schedule');
        return;
      }

      const btn = e.target.closest('button[data-action]');
      if (!btn) return;
      const action = btn.dataset.action;
      const dayCountdown = Number(btn.dataset.day);
      const slotKey = btn.dataset.slot;
      handleYptTimerAction(action, dayCountdown, slotKey);
    });

    // 每日專注總表：科目下拉、完成勾選、開始/結束時間、真實時長手動微調
    dailyFocusTableBody.addEventListener('change', (e) => {
      const target = e.target;
      const dayCountdown = Number(target.dataset.day);
      const day = appState.days.find(d => d.dayCountdown === dayCountdown);
      if (!day) return;

      const field = target.dataset.field;
      const slotKey = target.dataset.slot;
      const slot = slotKey ? day[slotKey] : null;
      const nowTs = Date.now();

      if (field === 'subject' && slot) {
        slot.subject = target.value;
        slot.updatedAt = nowTs;
        appState.updatedAt = nowTs;
        target.setAttribute('data-subj', slot.subject);
        saveState();
        updateActiveTimerBanner();
        renderAllStatistics();
        const editorDay = getCalendarEditorDay();
        if (editorDay && String(editorDay.dayCountdown) === String(dayCountdown)) {
          renderDailySlotsDetailed(day);
        }
        const timerDay = getTimerTargetDay();
        if (timerDay && String(timerDay.dayCountdown) === String(dayCountdown)) {
          renderQuickTimerView();
        }
        if (currentRoomId && !isReceivingRemoteUpdate) {
          broadcastRoomDelta({ kind: 'subject', day: dayCountdown, slot: slotKey, val: slot.subject, updatedAt: nowTs });
        }
      } else if (field === 'completed' && slot) {
        slot.completed = target.checked;
        slot.updatedAt = nowTs;
        appState.updatedAt = nowTs;
        const cardEl = document.getElementById(`slot-card-${dayCountdown}-${slotKey}`);
        if (cardEl) cardEl.classList.toggle('slot-completed', slot.completed);
        saveState();
        updateSingleDayRowSummaryDom(day);
        renderAllStatistics();
        const editorDay = getCalendarEditorDay();
        if (editorDay && String(editorDay.dayCountdown) === String(dayCountdown)) {
          renderDailySlotsDetailed(day);
        }
        const timerDay = getTimerTargetDay();
        if (timerDay && String(timerDay.dayCountdown) === String(dayCountdown)) {
          renderQuickTimerView();
        }
        if (currentRoomId && !isReceivingRemoteUpdate) {
          broadcastRoomDelta({
            kind: 'completed',
            day: dayCountdown,
            slot: slotKey,
            val: slot.completed,
            updatedAt: nowTs,
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
        slot.updatedAt = nowTs;
        appState.updatedAt = nowTs;
        target.value = normalizedTime;
        // 若使用者手動輸入了開始與結束時間，且目前真實讀書時長為 0，自動試算時長
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
        const editorDay = getCalendarEditorDay();
        if (editorDay && String(editorDay.dayCountdown) === String(dayCountdown)) {
          renderDailySlotsDetailed(day);
        }
        const timerDay = getTimerTargetDay();
        if (timerDay && String(timerDay.dayCountdown) === String(dayCountdown)) {
          renderQuickTimerView();
        }
        if (currentRoomId && !isReceivingRemoteUpdate) {
          broadcastRoomDelta({
            kind: 'time',
            day: dayCountdown,
            slot: slotKey,
            startTime: slot.startTime,
            endTime: slot.endTime,
            durationMinutes: slot.durationMinutes,
            updatedAt: nowTs
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
        slot.updatedAt = nowTs;
        appState.updatedAt = nowTs;
        if (slot.timerStatus === 'running') {
          slot.lastResumeTimestamp = nowTs;
        }

        const clockEl = document.getElementById(`ypt-clock-${dayCountdown}-${slotKey}`);
        if (clockEl) clockEl.textContent = formatMsToClock(slot.accumulatedMs);

        saveState();
        updateSingleDayRowSummaryDom(day);
        updateActiveTimerBanner();
        renderAllStatistics();
        const editorDay = getCalendarEditorDay();
        if (editorDay && String(editorDay.dayCountdown) === String(dayCountdown)) {
          renderDailySlotsDetailed(day);
        }
        const timerDay = getTimerTargetDay();
        if (timerDay && String(timerDay.dayCountdown) === String(dayCountdown)) {
          renderQuickTimerView();
        }
        if (currentRoomId && !isReceivingRemoteUpdate) {
          broadcastRoomDelta({
            kind: 'time',
            day: dayCountdown,
            slot: slotKey,
            startTime: slot.startTime,
            endTime: slot.endTime,
            durationMinutes: slot.durationMinutes,
            updatedAt: nowTs
          });
        }
      }
    });

    // 每日專注總表：範圍任務文字與手動時長即時輸入儲存
    dailyFocusTableBody.addEventListener('input', (e) => {
      const target = e.target;
      const dayCountdown = Number(target.dataset.day);
      const day = appState.days.find(d => d.dayCountdown === dayCountdown);
      if (!day) return;

      const field = target.dataset.field;
      const slotKey = target.dataset.slot;
      const nowTs = Date.now();

      if (field === 'task' && slotKey && day[slotKey]) {
        day[slotKey].task = target.value;
        day[slotKey].updatedAt = nowTs;
        appState.updatedAt = nowTs;
        saveState();
        const editorDay = getCalendarEditorDay();
        if (editorDay && String(editorDay.dayCountdown) === String(dayCountdown)) {
          const dailyCard = document.getElementById(`daily-card-${dayCountdown}-${slotKey}`);
          if (dailyCard) {
            const inp = dailyCard.querySelector('.daily-task-input');
            if (inp && document.activeElement !== inp) inp.value = target.value;
          }
        }
        if (currentRoomId && !isReceivingRemoteUpdate) {
          broadcastRoomDeltaDebounced({ kind: 'task', day: dayCountdown, slot: slotKey, val: day[slotKey].task, updatedAt: nowTs });
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
        slot.updatedAt = nowTs;
        appState.updatedAt = nowTs;
        if (slot.timerStatus === 'running') {
          slot.lastResumeTimestamp = nowTs;
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

  // 5A. 純粹行事曆篩選 Tabs 與搜尋框
  const phaseFilterTabs = document.getElementById('phaseFilterTabs');
  if (phaseFilterTabs) {
    phaseFilterTabs.addEventListener('click', (e) => {
      const btn = e.target.closest('.filter-tab');
      if (!btn) return;
      phaseFilterTabs.querySelectorAll('.filter-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentPhaseFilter = btn.dataset.filter || 'all';
      renderPureCalendarTable();
    });
  }

  const searchInput = document.getElementById('searchScheduleInput');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      currentSearchQuery = e.target.value.trim();
      renderPureCalendarTable();
    });
  }

  const jumpBtn = document.getElementById('jumpToTodayOrTopBtn');
  if (jumpBtn) {
    jumpBtn.addEventListener('click', () => {
      const targetCountdown = getTodayDayCountdown();
      scrollToDayRow(targetCountdown);
    });
  }

  // 5B. 每日專注總表篩選 Tabs、科目篩選與搜尋框
  const dailyPhaseFilterTabs = document.getElementById('dailyPhaseFilterTabs');
  if (dailyPhaseFilterTabs) {
    dailyPhaseFilterTabs.addEventListener('click', (e) => {
      const btn = e.target.closest('.filter-tab');
      if (!btn) return;
      dailyPhaseFilterTabs.querySelectorAll('.filter-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentDailyPhaseFilter = btn.dataset.filter || 'all';
      renderDailyFocusScheduleTable();
    });
  }

  const dailySubjectFilterSelect = document.getElementById('dailySubjectFilterSelect');
  if (dailySubjectFilterSelect) {
    dailySubjectFilterSelect.addEventListener('change', (e) => {
      currentDailySubjectFilter = e.target.value;
      renderDailyFocusScheduleTable();
    });
  }

  const dailySearchInput = document.getElementById('dailySearchScheduleInput');
  if (dailySearchInput) {
    dailySearchInput.addEventListener('input', (e) => {
      currentDailySearchQuery = e.target.value.trim();
      renderDailyFocusScheduleTable();
    });
  }

  const dailyJumpBtn = document.getElementById('dailyJumpToTodayBtn');
  if (dailyJumpBtn) {
    dailyJumpBtn.addEventListener('click', () => {
      const todayCountdown = getTodayDayCountdown();
      let row = document.getElementById(`row-day-${todayCountdown}`);
      if (!row) {
        currentDailyPhaseFilter = 'all';
        currentDailySubjectFilter = '';
        currentDailySearchQuery = '';
        if (dailyPhaseFilterTabs) {
          dailyPhaseFilterTabs.querySelectorAll('.filter-tab').forEach(b => b.classList.toggle('active', b.dataset.filter === 'all'));
        }
        renderDailyFocusScheduleTable();
        row = document.getElementById(`row-day-${todayCountdown}`);
      }
      if (row) {
        row.scrollIntoView({ behavior: 'smooth', block: 'center' });
        row.classList.add('row-pulse-highlight');
        setTimeout(() => row.classList.remove('row-pulse-highlight'), 1800);
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
      const nowTs = Date.now();
      appState.days.forEach(day => {
        const mmdd = day.isoDate.slice(5);
        const pre = PDF_PREPLANNED_DATA[mmdd];
        if (!pre) return;
        if (!day.calendar && pre.calendar) {
          day.calendar = pre.calendar;
          day.calendarUpdatedAt = nowTs;
        }
        SLOT_KEYS.forEach(({ key }) => {
          if (!day[key].subject && pre[key][0]) {
            day[key].subject = pre[key][0];
            day[key].updatedAt = nowTs;
          }
          if (!day[key].task && pre[key][1]) {
            day[key].task = pre[key][1];
            day[key].updatedAt = nowTs;
          }
        });
      });
      appState.updatedAt = nowTs;
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
        '確定要將所有讀書時間、計時器與打勾紀錄「從零開始重新計算」嗎？\n\n（將重置 11/8~1/26 共 80 天的開始/結束時間、真實讀書時長與打勾；已填寫的科目、範圍、行事曆與小櫻目標會保留。建議先「匯出 JSON」備份）'
      );
      if (!confirmed) return;
      const nowTs = Date.now();
      appState.days.forEach(day => {
        SLOT_KEYS.forEach(({ key }) => {
          day[key] = createEmptySlot(day[key].subject, day[key].task);
          day[key].updatedAt = nowTs;
        });
      });
      appState.updatedAt = nowTs;
      saveState();
      renderPhasesConfig();
      renderMainScheduleTable();
      renderFullDashboard();
      renderQuickTimerView();
      renderDailyPlanView();
      updateActiveTimerBanner();
      showToast('✨ 已將 80 天所有時間、計時器與打勾紀錄全新重置為 0（科目、範圍、行事曆與目標保留）');
    });
  }

  // 10. 主要分頁導航切換（首頁、快捷計時、行事曆、每日專注、統計列表）
  const mainTabsNav = document.getElementById('mainTabsNav');
  if (mainTabsNav) {
    mainTabsNav.addEventListener('click', (e) => {
      const btn = e.target.closest('.tab-nav-btn');
      if (btn && btn.dataset.tab) {
        switchMainTab(btn.dataset.tab);
      }
    });
  }

  // 10B. 雙主題切換器（🌸 日系櫻花粉白 vs 🖤 Antigravity 極簡深灰）
  const dualSwitcher = document.getElementById('themeDualSwitcher');
  if (dualSwitcher) {
    dualSwitcher.addEventListener('click', (e) => {
      const btn = e.target.closest('.theme-switch-pill, .theme-switch-btn, button');
      if (!btn) return;
      const themeVal = btn.dataset.themeChoice || btn.dataset.themeVal || (btn.id === 'themeBtnDark' ? 'dark' : 'sakura');
      if (!themeVal) return;
      switchThemeMode(themeVal);
    });
  }

  const btnSakuraDirect = document.getElementById('themeBtnSakura');
  if (btnSakuraDirect) {
    btnSakuraDirect.addEventListener('click', (e) => {
      e.stopPropagation();
      switchThemeMode('sakura');
    });
  }

  const btnDarkDirect = document.getElementById('themeBtnDark');
  if (btnDarkDirect) {
    btnDarkDirect.addEventListener('click', (e) => {
      e.stopPropagation();
      switchThemeMode('dark');
    });
  }

  // 10C. 第 1 頁：首頁（#tabHome）互動處理
  const toggleCoverPickerBtn = document.getElementById('toggleCoverPickerBtn');
  const closeCoverPickerBtn = document.getElementById('closeCoverPickerBtn');
  const coverPickerPopover = document.getElementById('coverPickerPopover');

  if (toggleCoverPickerBtn && coverPickerPopover) {
    toggleCoverPickerBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      coverPickerPopover.classList.toggle('hidden');
    });
  }
  if (closeCoverPickerBtn && coverPickerPopover) {
    closeCoverPickerBtn.addEventListener('click', () => {
      coverPickerPopover.classList.add('hidden');
    });
  }
  if (coverPickerPopover) {
    coverPickerPopover.addEventListener('click', (e) => {
      e.stopPropagation();
    });
  }

  const coverPresetsGrid = document.getElementById('coverPresetsGrid');
  if (coverPresetsGrid) {
    coverPresetsGrid.addEventListener('click', (e) => {
      const item = e.target.closest('.cover-preset-item');
      if (item && item.dataset.coverId) {
        const nowTs = Date.now();
        appState.homeCover = item.dataset.coverId;
        appState.homeCoverUpdatedAt = nowTs;
        appState.updatedAt = nowTs;
        saveState();
        applyHomeCover();
        showToast(`已更換背景看板：${item.title || ''}`);
        if (!isReceivingRemoteUpdate) {
          broadcastRoomDelta({ kind: 'homeCover', val: appState.homeCover, updatedAt: nowTs });
          broadcastFullStateToRoom();
        }
      }
    });
  }

  const applyCustomCoverUrlBtn = document.getElementById('applyCustomCoverUrlBtn');
  const customCoverUrlInput = document.getElementById('customCoverUrlInput');
  if (applyCustomCoverUrlBtn && customCoverUrlInput) {
    applyCustomCoverUrlBtn.addEventListener('click', () => {
      const url = customCoverUrlInput.value.trim();
      if (!url) {
        showToast('⚠️ 請先輸入圖片網址');
        return;
      }
      if (!isValidImageUrl(url)) {
        showToast('⚠️ 請輸入有效的 https:// 或 http:// 圖片網址');
        return;
      }
      const nowTs = Date.now();
      appState.homeCover = 'url:' + url;
      appState.homeCoverUpdatedAt = nowTs;
      appState.updatedAt = nowTs;
      try { localStorage.setItem('sakura_custom_cover_v1', appState.homeCover); } catch (e) {}
      saveState();
      applyHomeCover();
      showToast('🎨 已成功套用自訂圖片背板！');
      if (currentRoomId && !isReceivingRemoteUpdate) {
        broadcastRoomDelta({ kind: 'homeCover', val: appState.homeCover, updatedAt: nowTs });
        broadcastFullStateToRoom();
      }
    });
  }

  /**
   * 壓縮上傳之首頁看板圖片為高畫質羽量 JPEG 格式（支援寬達 1440px 視網膜螢幕與行動裝置零差異）
   */
  function compressCoverImageFile(file, maxWidth = 1440, maxHeight = 720, quality = 0.76) {
    return new Promise((resolve, reject) => {
      if (!file) return reject(new Error('未選擇圖片檔案'));
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('讀取圖片檔案失敗'));
      reader.onload = (evt) => {
        const img = new Image();
        img.onerror = () => reject(new Error('解析圖片檔案失敗'));
        img.onload = () => {
          let w = img.width || 1440;
          let h = img.height || 720;
          const scale = Math.min(maxWidth / w, maxHeight / h, 1);
          const targetW = Math.max(1, Math.round(w * scale));
          const targetH = Math.max(1, Math.round(h * scale));

          const canvas = document.createElement('canvas');
          canvas.width = targetW;
          canvas.height = targetH;
          const ctx = canvas.getContext('2d');
          if (!ctx) return reject(new Error('Canvas 繪圖元件無法初始化'));
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(img, 0, 0, targetW, targetH);

          const dataUrl = canvas.toDataURL('image/jpeg', quality);
          resolve(dataUrl);
        };
        img.src = evt.target.result;
      };
      reader.readAsDataURL(file);
    });
  }

  const customCoverFileInput = document.getElementById('customCoverFileInput');
  if (customCoverFileInput) {
    customCoverFileInput.addEventListener('change', async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      if (file.size > 15 * 1024 * 1024) {
        showToast('⚠️ 圖片過大（請選擇 15MB 以內的圖片）');
        return;
      }
      showToast('⏳ 正在壓縮並同步背景看板至所有裝置...');
      try {
        const compressed = await compressCoverImageFile(file, 1440, 720, 0.76);
        const nowTs = Date.now();
        appState.homeCover = compressed;
        appState.homeCoverUpdatedAt = nowTs;
        appState.homeCoverFit = 'contain'; // 預設完整全圖，保證手機與電腦截圖顯示完全相同
        appState.homeCoverPosition = 'center';
        appState.updatedAt = nowTs;
        try { localStorage.setItem('sakura_custom_cover_v1', compressed); } catch (e) {}
        saveState();
        applyHomeCover();
        showToast('📁 已成功上傳並同步自訂封面至所有裝置！');
        if (!isReceivingRemoteUpdate) {
          broadcastRoomDelta({ kind: 'homeCover', val: appState.homeCover, fit: 'contain', position: 'center', updatedAt: nowTs });
          broadcastFullStateToRoom();
        }
      } catch (err) {
        console.error('Cover upload compression error:', err);
        showToast('⚠️ 圖片處理失敗，請重試');
      }
    });
  }

  // 跨裝置背板顯示比例微調（完整全圖 vs 滿版裁切）
  const coverFitPills = document.getElementById('coverFitPills');
  if (coverFitPills) {
    coverFitPills.addEventListener('click', (e) => {
      const btn = e.target.closest('.cover-pill-btn');
      if (btn && btn.dataset.fitChoice) {
        appState.homeCoverFit = btn.dataset.fitChoice;
        appState.updatedAt = Date.now();
        saveState();
        applyHomeCover();
        showToast(appState.homeCoverFit === 'contain' ? '🖼️ 已切換為「完整全圖」模式（手機與電腦畫面統一不裁切）' : '✂️ 已切換為「滿版裁切」模式');
        if (currentRoomId && !isReceivingRemoteUpdate) {
          broadcastRoomDelta({ kind: 'homeCoverSettings', fit: appState.homeCoverFit, position: appState.homeCoverPosition, updatedAt: Date.now() });
          broadcastFullStateToRoom();
        }
      }
    });
  }

  // 滿版裁切視角對齊焦點微調（偏上 / 置中 / 偏下）
  const coverPositionPills = document.getElementById('coverPositionPills');
  if (coverPositionPills) {
    coverPositionPills.addEventListener('click', (e) => {
      const btn = e.target.closest('.cover-pill-btn');
      if (btn && btn.dataset.posChoice) {
        appState.homeCoverPosition = btn.dataset.posChoice;
        appState.updatedAt = Date.now();
        saveState();
        applyHomeCover();
        showToast(`🎯 已調整視角焦點為：${btn.textContent.trim()}`);
        if (currentRoomId && !isReceivingRemoteUpdate) {
          broadcastRoomDelta({ kind: 'homeCoverSettings', fit: appState.homeCoverFit, position: appState.homeCoverPosition, updatedAt: Date.now() });
          broadcastFullStateToRoom();
        }
      }
    });
  }

  const homePrevDayBtn = document.getElementById('homePrevDayBtn');
  if (homePrevDayBtn) {
    homePrevDayBtn.addEventListener('click', () => {
      const cur = getHomeActiveDay();
      if (typeof cur.dayCountdown === 'number') {
        homeActiveDayCountdown = Math.min(80, cur.dayCountdown + 1);
      } else {
        const d = new Date(cur.isoDate);
        d.setDate(d.getDate() - 1);
        homeActiveDayCountdown = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      }
      renderHomeView();
    });
  }
  const homeNextDayBtn = document.getElementById('homeNextDayBtn');
  if (homeNextDayBtn) {
    homeNextDayBtn.addEventListener('click', () => {
      const cur = getHomeActiveDay();
      if (typeof cur.dayCountdown === 'number') {
        homeActiveDayCountdown = Math.max(1, cur.dayCountdown - 1);
      } else {
        const d = new Date(cur.isoDate);
        d.setDate(d.getDate() + 1);
        homeActiveDayCountdown = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      }
      renderHomeView();
    });
  }
  const homeTodayBtn = document.getElementById('homeTodayBtn');
  if (homeTodayBtn) {
    homeTodayBtn.addEventListener('click', () => {
      homeActiveDayCountdown = getTodayDayCountdown();
      renderHomeView();
    });
  }

  const homeSlotsList = document.getElementById('homeSlotsList');
  if (homeSlotsList) {
    homeSlotsList.addEventListener('change', (e) => {
      const target = e.target;
      const dayKey = target.dataset.day;
      const slotKey = target.dataset.slot;
      const day = findDayByKey(dayKey);
      if (!day || !day[slotKey]) return;
      const slot = day[slotKey];
      const nowTs = Date.now();

      if (target.classList.contains('home-slot-checkbox')) {
        slot.completed = target.checked;
        slot.updatedAt = nowTs;
        appState.updatedAt = nowTs;
        saveState();
        refreshSlotDom(day, slotKey);
        updateSingleDayRowSummaryDom(day);
        renderHomeView();
        renderQuickTimerView();
        renderDailyPlanView();
        renderAllStatistics();
        if (currentRoomId && !isReceivingRemoteUpdate) {
          broadcastRoomDelta({ kind: 'completed', day: dayKey, slot: slotKey, val: slot.completed, updatedAt: nowTs, label: `${day.dateDisplay} ${getSlotLabel(slotKey)}` });
        }
      } else if (target.classList.contains('home-slot-subj')) {
        slot.subject = target.value;
        slot.updatedAt = nowTs;
        appState.updatedAt = nowTs;
        saveState();
        refreshSlotDom(day, slotKey);
        renderHomeView();
        renderQuickTimerView();
        renderDailyPlanView();
        renderAllStatistics();
        if (currentRoomId && !isReceivingRemoteUpdate) {
          broadcastRoomDelta({ kind: 'subject', day: dayKey, slot: slotKey, val: slot.subject, updatedAt: nowTs });
        }
      }
    });

    homeSlotsList.addEventListener('input', (e) => {
      const target = e.target;
      if (target.classList.contains('home-slot-task')) {
        const dayKey = target.dataset.day;
        const slotKey = target.dataset.slot;
        const day = findDayByKey(dayKey);
        if (!day || !day[slotKey]) return;
        const nowTs = Date.now();
        day[slotKey].task = target.value;
        day[slotKey].updatedAt = nowTs;
        appState.updatedAt = nowTs;
        saveState();
        if (currentRoomId && !isReceivingRemoteUpdate) {
          broadcastRoomDeltaDebounced({ kind: 'task', day: dayKey, slot: slotKey, val: target.value, updatedAt: nowTs });
        }
      }
    });
  }

  const homeCalendarMemoInput = document.getElementById('homeCalendarMemoInput');
  if (homeCalendarMemoInput) {
    homeCalendarMemoInput.addEventListener('input', (e) => {
      const day = getHomeActiveDay();
      if (!day) return;
      const nowTs = Date.now();
      day.calendar = e.target.value;
      day.calendarUpdatedAt = nowTs;
      appState.updatedAt = nowTs;
      saveState();
      const dailyInp = document.getElementById('dailyCalendarInput');
      if (dailyInp && document.activeElement !== dailyInp) dailyInp.value = day.calendar;
      if (currentRoomId && !isReceivingRemoteUpdate) {
        broadcastRoomDeltaDebounced({ kind: 'calendar', day: day.dayCountdown, val: day.calendar, updatedAt: nowTs });
      }
    });
  }

  const homeUpcomingList = document.getElementById('homeUpcomingList');
  if (homeUpcomingList) {
    homeUpcomingList.addEventListener('click', (e) => {
      const item = e.target.closest('[data-home-jump-day]');
      if (item && item.dataset.homeJumpDay) {
        openCalendarDayEditor(item.dataset.homeJumpDay);
        switchMainTab('calendar-schedule');
      }
    });
  }

  const tabHome = document.getElementById('tabHome');
  if (tabHome) {
    tabHome.addEventListener('click', (e) => {
      const shortcut = e.target.closest('.home-nav-shortcut[data-goto-tab]');
      if (shortcut && shortcut.dataset.gotoTab) {
        switchMainTab(shortcut.dataset.gotoTab);
      }
    });
  }

  // 11. 分頁 2（快捷計時）互動處理
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
      switchMainTab('calendar-schedule');
    });
  }

  const quickJumpToDailyBtn = document.getElementById('quickJumpToDailyBtn');
  if (quickJumpToDailyBtn) {
    quickJumpToDailyBtn.addEventListener('click', () => {
      const targetDay = getTimerTargetDay();
      openCalendarDayEditor(targetDay.dayCountdown);
      switchMainTab('calendar-schedule');
    });
  }

  // 12. 分頁 3（Notion 行事曆）子視圖切換與月份導航
  const calMonthTabs = document.getElementById('calMonthTabs');
  if (calMonthTabs) {
    calMonthTabs.addEventListener('click', (e) => {
      const tab = e.target.closest('.month-tab');
      if (tab && tab.dataset.month) {
        currentCalendarMonth = tab.dataset.month;
        renderPureCalendarTable();
      }
    });
  }

  const calPrevMonthBtn = document.getElementById('calPrevMonthBtn');
  if (calPrevMonthBtn) {
    calPrevMonthBtn.addEventListener('click', () => {
      const [y, m] = currentCalendarMonth.split('-').map(Number);
      let newY = y;
      let newM = m - 1;
      if (newM < 1) { newM = 12; newY -= 1; }
      currentCalendarMonth = `${newY}-${String(newM).padStart(2, '0')}`;
      renderPureCalendarTable();
    });
  }

  const calNextMonthBtn = document.getElementById('calNextMonthBtn');
  if (calNextMonthBtn) {
    calNextMonthBtn.addEventListener('click', () => {
      const [y, m] = currentCalendarMonth.split('-').map(Number);
      let newY = y;
      let newM = m + 1;
      if (newM > 12) { newM = 1; newY += 1; }
      currentCalendarMonth = `${newY}-${String(newM).padStart(2, '0')}`;
      renderPureCalendarTable();
    });
  }

  const calTodayMonthBtn = document.getElementById('calTodayMonthBtn');
  if (calTodayMonthBtn) {
    calTodayMonthBtn.addEventListener('click', () => {
      const now = new Date();
      currentCalendarMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      renderPureCalendarTable();
    });
  }

  const backToCalendarGridBtn = document.getElementById('backToCalendarGridBtn');
  if (backToCalendarGridBtn) {
    backToCalendarGridBtn.addEventListener('click', () => {
      closeCalendarDayEditor();
    });
  }

  // 12B. 子視圖 B（單日詳細行事曆備忘與三時段讀書科目）
  const dailyPrevDayBtn = document.getElementById('dailyPrevDayBtn');
  const dailyNextDayBtn = document.getElementById('dailyNextDayBtn');
  const dailyTodayBtn = document.getElementById('dailyTodayBtn');
  const dailyDaySelect = document.getElementById('dailyDaySelect');
  const dailyCalendarInput = document.getElementById('dailyCalendarInput');
  const dailySlotsContainer = document.getElementById('dailySlotsContainer');

  if (dailyPrevDayBtn) {
    dailyPrevDayBtn.addEventListener('click', () => {
      const cur = getCalendarEditorDay();
      if (typeof cur.dayCountdown === 'number') {
        calendarEditorDayKey = Math.min(80, cur.dayCountdown + 1);
      } else {
        const d = new Date(cur.isoDate);
        d.setDate(d.getDate() - 1);
        calendarEditorDayKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      }
      renderPureCalendarTable();
      renderDailyPlanView(calendarEditorDayKey);
    });
  }
  if (dailyNextDayBtn) {
    dailyNextDayBtn.addEventListener('click', () => {
      const cur = getCalendarEditorDay();
      if (typeof cur.dayCountdown === 'number') {
        calendarEditorDayKey = Math.max(1, cur.dayCountdown - 1);
      } else {
        const d = new Date(cur.isoDate);
        d.setDate(d.getDate() + 1);
        calendarEditorDayKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      }
      renderPureCalendarTable();
      renderDailyPlanView(calendarEditorDayKey);
    });
  }
  if (dailyTodayBtn) {
    dailyTodayBtn.addEventListener('click', () => {
      calendarEditorDayKey = getTodayDayCountdown();
      renderPureCalendarTable();
      renderDailyPlanView(calendarEditorDayKey);
    });
  }
  if (dailyDaySelect) {
    dailyDaySelect.addEventListener('change', (e) => {
      changeDailyPlanDay(e.target.value);
      renderPureCalendarTable();
    });
  }
  if (dailyCalendarInput) {
    dailyCalendarInput.addEventListener('input', (e) => {
      const day = getCalendarEditorDay();
      if (!day) return;
      const nowTs = Date.now();
      day.calendar = e.target.value;
      day.calendarUpdatedAt = nowTs;
      appState.updatedAt = nowTs;
      saveState();
      renderPureCalendarTable();
      const homeDay = getHomeActiveDay();
      if (homeDay && String(homeDay.dayCountdown) === String(day.dayCountdown)) {
        const homeInp = document.getElementById('homeCalendarMemoInput');
        if (homeInp && document.activeElement !== homeInp) homeInp.value = day.calendar;
      }
      broadcastRoomDeltaDebounced({ kind: 'calendar', day: day.dayCountdown, val: day.calendar, updatedAt: nowTs });
    });
  }

  if (dailySlotsContainer) {
    dailySlotsContainer.addEventListener('change', (e) => {
      const target = e.target;
      const dayKey = target.dataset.day;
      const slotKey = target.dataset.slot;
      const day = findDayByKey(dayKey);
      if (!day || !day[slotKey]) return;
      const slot = day[slotKey];
      const nowTs = Date.now();

      if (target.classList.contains('daily-subject-select')) {
        slot.subject = target.value;
        slot.updatedAt = nowTs;
        appState.updatedAt = nowTs;
        saveState();
        refreshSlotDom(day, slotKey);
        renderPureCalendarTable();
        renderDailyPlanView();
        renderQuickTimerView();
        renderHomeView();
        renderAllStatistics();
        broadcastRoomDeltaDebounced({ kind: 'subject', day: dayKey, slot: slotKey, val: slot.subject, updatedAt: nowTs });
      } else if (target.classList.contains('daily-done-checkbox')) {
        slot.completed = target.checked;
        slot.updatedAt = nowTs;
        appState.updatedAt = nowTs;
        saveState();
        refreshSlotDom(day, slotKey);
        renderPureCalendarTable();
        renderDailyPlanView();
        renderQuickTimerView();
        renderHomeView();
        renderAllStatistics();
        broadcastRoomDelta({ kind: 'completed', day: dayKey, slot: slotKey, val: slot.completed, updatedAt: nowTs, label: `${day.dateDisplay} ${getSlotLabel(slotKey)}` });
      }
    });

    dailySlotsContainer.addEventListener('input', (e) => {
      const target = e.target;
      if (target.classList.contains('daily-task-input')) {
        const dayKey = target.dataset.day;
        const slotKey = target.dataset.slot;
        const day = findDayByKey(dayKey);
        if (!day || !day[slotKey]) return;
        const nowTs = Date.now();
        day[slotKey].task = target.value;
        day[slotKey].updatedAt = nowTs;
        appState.updatedAt = nowTs;
        saveState();
        renderPureCalendarTable();
        renderHomeView();
        broadcastRoomDeltaDebounced({ kind: 'task', day: dayKey, slot: slotKey, val: target.value, updatedAt: nowTs });
      }
    });
  }

  // 12C. Notion 當日快捷頁面彈窗（關閉按鈕、點擊遮罩關閉、Escape 鍵關閉）
  const closeNotionDayModalBtn = document.getElementById('closeNotionDayModalBtn');
  const notionDayModal = document.getElementById('notionDayModal');
  if (closeNotionDayModalBtn) {
    closeNotionDayModalBtn.addEventListener('click', closeCalendarDayEditor);
  }
  if (notionDayModal) {
    notionDayModal.addEventListener('click', (e) => {
      if (e.target === notionDayModal) {
        closeCalendarDayEditor();
      }
    });
  }

  // 全域 Escape 鍵監聽：快捷關閉彈窗
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const dayModal = document.getElementById('notionDayModal');
      if (dayModal && !dayModal.classList.contains('hidden')) {
        closeCalendarDayEditor();
      }
      const setModal = document.getElementById('settingsModal');
      if (setModal && !setModal.classList.contains('hidden')) {
        setModal.classList.add('hidden');
      }
    }
  });

  // 13. 設定彈窗（⚙️ 開啟 / 關閉）
  const openSettingsModalBtn = document.getElementById('openSettingsModalBtn');
  const closeSettingsModalBtn = document.getElementById('closeSettingsModalBtn');
  const settingsModal = document.getElementById('settingsModal');

  if (openSettingsModalBtn && settingsModal) {
    openSettingsModalBtn.addEventListener('click', () => {
      updateAtmosphereUi();
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

  // 14. 專注氛圍控制（提示音、櫻花落瓣動效）
  const themeToggleBtn = document.getElementById('themeToggleBtn');
  if (themeToggleBtn) {
    themeToggleBtn.addEventListener('click', () => {
      switchThemeMode(appSettings.theme === 'dark' ? 'sakura' : 'dark');
    });
  }

  const soundToggleBtn = document.getElementById('soundToggleBtn');
  if (soundToggleBtn) {
    soundToggleBtn.addEventListener('click', () => {
      appSettings.sound = appSettings.sound === 'on' ? 'off' : 'on';
      saveAppSettings();
      showToast(appSettings.sound === 'on' ? '🔔 已開啟專注和弦鐘聲提示音' : '🔕 已切換為靜音模式');
      if (appSettings.sound === 'on') playChime('start');
    });
  }

  const petalToggleBtn = document.getElementById('petalToggleBtn');
  if (petalToggleBtn) {
    petalToggleBtn.addEventListener('click', () => {
      appSettings.petals = appSettings.petals === 'on' ? 'off' : 'on';
      saveAppSettings();
      showToast(appSettings.petals === 'on' ? '🌸 已開啟落櫻飄落動效' : '🍂 已關閉落櫻動效');
    });
  }

  const settingThemeSelect = document.getElementById('settingThemeSelect');
  if (settingThemeSelect) {
    settingThemeSelect.addEventListener('change', (e) => {
      switchThemeMode(e.target.value === 'dark' ? 'dark' : 'sakura');
    });
  }

  const settingSoundSelect = document.getElementById('settingSoundSelect');
  if (settingSoundSelect) {
    settingSoundSelect.addEventListener('change', (e) => {
      appSettings.sound = e.target.value;
      saveAppSettings();
    });
  }

  const settingPetalsSelect = document.getElementById('settingPetalsSelect');
  if (settingPetalsSelect) {
    settingPetalsSelect.addEventListener('change', (e) => {
      appSettings.petals = e.target.value;
      saveAppSettings();
    });
  }

  // 15. 番茄鐘 / 自由計時模式切換
  const timerModeSelector = document.getElementById('timerModeSelector');
  if (timerModeSelector) {
    timerModeSelector.addEventListener('click', (e) => {
      const chip = e.target.closest('.mode-chip');
      if (!chip || !chip.dataset.mode) return;
      timerModeSelector.querySelectorAll('.mode-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      currentTimerMode = chip.dataset.mode;
      updateQuickTimerDom();
      if (currentTimerMode === 'pomodoro-25') {
        showToast('🍅 已切換為 25 分鐘番茄鐘模式');
      } else if (currentTimerMode === 'pomodoro-50') {
        showToast('🎯 已切換為 50 分鐘衝刺專注模式');
      } else {
        showToast('⏱️ 已切換為自由正計時模式');
      }
    });
  }

  // 16. PWA 桌面應用程式安裝按鈕
  const pwaInstallBtn = document.getElementById('pwaInstallBtn');
  if (pwaInstallBtn) {
    pwaInstallBtn.addEventListener('click', async () => {
      if (deferredPwaPrompt) {
        deferredPwaPrompt.prompt();
        const { outcome } = await deferredPwaPrompt.userChoice;
        if (outcome === 'accepted') {
          showToast('🌸 感謝安裝！已成功將讀書計劃表加到桌面！');
        }
        deferredPwaPrompt = null;
        pwaInstallBtn.style.display = 'none';
      } else {
        showToast('💡 提示：在瀏覽器選單點選「加到主畫面」或「安裝應用程式」即可！');
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
  if (currentActiveTab === 'daily-plan') {
    let row = document.getElementById(`row-day-${dayCountdown}`);
    if (!row) {
      currentDailyPhaseFilter = 'all';
      currentDailySubjectFilter = '';
      currentDailySearchQuery = '';
      const tabs = document.querySelectorAll('#dailyPhaseFilterTabs .filter-tab');
      tabs.forEach(t => t.classList.toggle('active', t.dataset.filter === 'all'));
      renderDailyFocusScheduleTable();
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
  } else {
    switchMainTab('calendar-schedule');
    setTimeout(() => {
      let row = document.getElementById(`pure-row-day-${dayCountdown}`);
      if (!row) {
        currentPhaseFilter = 'all';
        currentSearchQuery = '';
        const tabs = document.querySelectorAll('#phaseFilterTabs .filter-tab');
        tabs.forEach(t => t.classList.toggle('active', t.dataset.filter === 'all'));
        const searchEl = document.getElementById('searchScheduleInput');
        if (searchEl) searchEl.value = '';
        renderPureCalendarTable();
        row = document.getElementById(`pure-row-day-${dayCountdown}`);
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
        showToast('⚠️ 匯入格式不符：請選擇有效的 80 天小櫻讀書計劃表 JSON 備份檔');
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
 * 壓縮狀態以節省頻寬與即時傳輸量（僅保留有內容的日期與時段，並完整保留計時器時間戳與更新時間）
 */
function compactState(st) {
  const compactDays = {};
  st.days.forEach(d => {
    const dayEntry = {};
    if (d.calendar && d.calendar.trim()) dayEntry.c = d.calendar.trim();
    if (d.calendarUpdatedAt) dayEntry.cu = d.calendarUpdatedAt;
    SLOT_KEYS.forEach(({ key }) => {
      const s = d[key];
      const hasTimerState = s.timerStatus && s.timerStatus !== 'idle';
      if (
        s.subject ||
        s.task ||
        s.durationMinutes ||
        s.completed ||
        s.startTime ||
        s.endTime ||
        hasTimerState ||
        (s.accumulatedMs && s.accumulatedMs > 0) ||
        (s.lastResumeTimestamp && s.lastResumeTimestamp > 0) ||
        (s.updatedAt && s.updatedAt > 0) ||
        (s.restMinutes && s.restMinutes > 0) ||
        (s.restAccumulatedMs && s.restAccumulatedMs > 0) ||
        (s.lastPauseTimestamp && s.lastPauseTimestamp > 0)
      ) {
        const arr = [
          s.subject || '',
          s.task || '',
          s.durationMinutes || 0,
          s.completed ? 1 : 0,
          s.startTime || '',
          s.endTime || '',
          s.timerStatus || 'idle',
          s.accumulatedMs || 0,
          s.lastResumeTimestamp || 0,
          s.updatedAt || 0,
          s.restMinutes || 0,
          s.restAccumulatedMs || 0,
          s.lastPauseTimestamp || 0
        ];
        // 移除尾部預設值以極度精簡傳輸體積
        while (arr.length > 2 && (
          (arr.length === 13 && arr[12] === 0) ||
          (arr.length === 12 && arr[11] === 0) ||
          (arr.length === 11 && arr[10] === 0) ||
          (arr.length === 10 && arr[9] === 0) ||
          (arr.length === 9 && arr[8] === 0) ||
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

  const compactExtra = {};
  if (st.extraDays && typeof st.extraDays === 'object') {
    Object.keys(st.extraDays).forEach(iso => {
      const ed = st.extraDays[iso];
      const entry = {};
      if (ed.calendar && ed.calendar.trim()) entry.c = ed.calendar.trim();
      if (ed.calendarUpdatedAt) entry.cu = ed.calendarUpdatedAt;
      SLOT_KEYS.forEach(({ key }) => {
        const s = ed[key];
        if (s && (s.subject || s.task || s.durationMinutes || s.completed)) {
          entry[key[0]] = [
            s.subject || '',
            s.task || '',
            s.durationMinutes || 0,
            s.completed ? 1 : 0,
            s.startTime || '',
            s.endTime || '',
            s.timerStatus || 'idle',
            s.accumulatedMs || 0,
            s.lastResumeTimestamp || 0,
            s.updatedAt || 0,
            s.restMinutes || 0,
            s.restAccumulatedMs || 0,
            s.lastPauseTimestamp || 0
          ];
        }
      });
      if (Object.keys(entry).length > 0) {
        compactExtra[iso] = entry;
      }
    });
  }

  return {
    p: st.phases,
    g: st.goals,
    d: compactDays,
    ex: compactExtra,
    hc: st.homeCover || '',
    hcu: st.homeCoverUpdatedAt || (st.homeCover && (st.homeCover.startsWith('data:') || st.homeCover.startsWith('url:')) ? Date.now() : 0),
    hcf: st.homeCoverFit || 'contain',
    hcp: st.homeCoverPosition || 'center',
    u: st.updatedAt || Date.now()
  };
}

/**
 * 解壓縮還原完整 80 天狀態（保留 lastResumeTimestamp、restMinutes、lastPauseTimestamp 與 updatedAt）
 */
function unpackCompactState(compact) {
  const base = generate80DaysSchedule(false);
  const phases = (compact.p && Array.isArray(compact.p) && compact.p.length === 3) ? compact.p : DEFAULT_PHASES;
  const goals = compact.g || DEFAULT_GOALS;
  const compactDays = compact.d || {};

  const days = base.map(day => {
    const saved = compactDays[day.dayCountdown];
    if (saved) {
      if (typeof saved.c === 'string') day.calendar = saved.c;
      if (saved.cu) day.calendarUpdatedAt = Number(saved.cu) || 0;
      SLOT_KEYS.forEach(({ key }) => {
        const slotData = saved[key[0]];
        if (Array.isArray(slotData)) {
          const timerStatus = slotData[6] || 'idle';
          const resumeTs = Number(slotData[8]) || 0;
          const updatedAt = Number(slotData[9]) || 0;
          const restMinutes = Number(slotData[10]) || 0;
          const restAccumulatedMs = Number(slotData[11]) || 0;
          const pauseTs = Number(slotData[12]) || 0;
          day[key] = {
            subject: slotData[0] || '',
            task: slotData[1] || '',
            durationMinutes: Number(slotData[2]) || 0,
            completed: Boolean(slotData[3]),
            startTime: slotData[4] || '',
            endTime: slotData[5] || '',
            timerStatus,
            accumulatedMs: Number(slotData[7]) || 0,
            lastResumeTimestamp: timerStatus === 'running' ? (resumeTs || updatedAt || Number(compact.u) || Date.now()) : null,
            restMinutes,
            restAccumulatedMs,
            lastPauseTimestamp: timerStatus === 'paused' ? (pauseTs || updatedAt || null) : null,
            updatedAt
          };
        }
      });
    }
    return day;
  });

  const res = normalizeState({
    version: 2,
    updatedAt: Number(compact.u) || 0,
    homeCover: compact.hc || '',
    homeCoverUpdatedAt: Number(compact.hcu) || (compact.hc && (compact.hc.startsWith('data:') || compact.hc.startsWith('url:')) ? (Number(compact.u) || 1) : 0),
    homeCoverFit: compact.hcf || 'contain',
    homeCoverPosition: compact.hcp || 'center',
    phases,
    goals,
    days
  });
  if (compact.ex && res && res.extraDays) {
    Object.keys(compact.ex).forEach(iso => {
      const saved = compact.ex[iso];
      const ed = res.extraDays[iso] || createExtraDayObject(iso, true);
      if (typeof saved.c === 'string') ed.calendar = saved.c;
      if (saved.cu) ed.calendarUpdatedAt = Number(saved.cu) || 0;
      SLOT_KEYS.forEach(({ key }) => {
        const slotData = saved[key[0]];
        if (Array.isArray(slotData)) {
          ed[key] = {
            subject: slotData[0] || '',
            task: slotData[1] || '',
            durationMinutes: Number(slotData[2]) || 0,
            completed: Boolean(slotData[3]),
            startTime: slotData[4] || '',
            endTime: slotData[5] || '',
            timerStatus: slotData[6] || 'idle',
            accumulatedMs: Number(slotData[7]) || 0,
            lastResumeTimestamp: slotData[6] === 'running' ? (Number(slotData[8]) || Date.now()) : null,
            updatedAt: Number(slotData[9]) || 0,
            restMinutes: Number(slotData[10]) || 0,
            restAccumulatedMs: Number(slotData[11]) || 0,
            lastPauseTimestamp: slotData[6] === 'paused' ? (Number(slotData[12]) || null) : null
          };
        }
      });
      res.extraDays[iso] = ed;
    });
  }
  if (res) healMisplacedTimeSlots(res);
  return res;
}

/**
 * 智慧合併遠端完整狀態與本機狀態（依每個時段的 updatedAt 判斷誰比較新，防止舊裝置覆蓋新計時器）
 */
function mergeRemoteState(remote) {
  if (!remote || !Array.isArray(remote.days) || remote.days.length !== 80 || !remote.days[0] || remote.days[0].isoDate !== '2026-11-08') return false;

  if (remote.updatedAt >= (appState.updatedAt || 0)) {
    if (Array.isArray(remote.phases) && remote.phases.length === 3) {
      appState.phases = remote.phases;
    }
    if (remote.goals) {
      appState.goals = remote.goals;
    }
  }

  // 🌸 關鍵封面同步防覆蓋保護：若遠端為自訂圖片，優先更新並永久快取；若本地已是自訂圖，絕不被預設主題刷掉
  let remoteCover = typeof remote.homeCover === 'string' ? remote.homeCover.trim() : '';
  const remoteIsCustom = remoteCover && (remoteCover.startsWith('data:') || remoteCover.startsWith('url:'));
  if (remoteIsCustom) {
    const rawCoverUrl = remoteCover.startsWith('url:') ? remoteCover.slice(4).trim() : remoteCover.trim();
    if (!isValidImageUrl(rawCoverUrl)) {
      remoteCover = '';
    }
  }
  const localIsCustom = appState.homeCover && (appState.homeCover.startsWith('data:') || appState.homeCover.startsWith('url:'));

  if (remoteCover && (remoteCover.startsWith('data:') || remoteCover.startsWith('url:'))) {
    if (!localIsCustom || (remote.homeCoverUpdatedAt || 0) >= (appState.homeCoverUpdatedAt || 0)) {
      appState.homeCover = remoteCover;
      appState.homeCoverUpdatedAt = remote.homeCoverUpdatedAt || Date.now();
      try { localStorage.setItem('sakura_custom_cover_v1', remoteCover); } catch (e) {}
      applyHomeCover();
    }
  } else if (remoteCover) {
    if (!localIsCustom && (remote.homeCoverUpdatedAt || 0) >= (appState.homeCoverUpdatedAt || 0)) {
      appState.homeCover = remoteCover;
      appState.homeCoverUpdatedAt = remote.homeCoverUpdatedAt || Date.now();
      applyHomeCover();
    }
  }

  if (remote.homeCoverFit) {
    appState.homeCoverFit = remote.homeCoverFit;
  }
  if (remote.homeCoverPosition) {
    appState.homeCoverPosition = remote.homeCoverPosition;
  }

  if (remote.extraDays && typeof remote.extraDays === 'object') {
    if (!appState.extraDays) appState.extraDays = generateInitialExtraDays(true);
    Object.keys(remote.extraDays).forEach(iso => {
      const rExtra = remote.extraDays[iso];
      const lExtra = appState.extraDays[iso] || createExtraDayObject(iso, true);
      if (rExtra.calendar && (!lExtra.calendar || (rExtra.calendarUpdatedAt || 0) >= (lExtra.calendarUpdatedAt || 0))) {
        lExtra.calendar = rExtra.calendar;
        lExtra.calendarUpdatedAt = rExtra.calendarUpdatedAt || 0;
      }
      SLOT_KEYS.forEach(({ key }) => {
        const rSlot = rExtra[key];
        const lSlot = lExtra[key];
        if (rSlot && ((rSlot.updatedAt || 0) >= (lSlot.updatedAt || 0) || !lSlot.subject)) {
          lExtra[key] = { ...rSlot };
        }
      });
      appState.extraDays[iso] = lExtra;
    });
  }

  let latestRunning = null;
  let latestRunningTs = -1;
  let latestPaused = null;
  let latestPausedTs = -1;

  appState.days.forEach((localDay, idx) => {
    const remoteDay = remote.days[idx] || remote.days.find(d => d.dayCountdown === localDay.dayCountdown);
    if (!remoteDay) return;

    const rCalTs = Number(remoteDay.calendarUpdatedAt) || 0;
    const lCalTs = Number(localDay.calendarUpdatedAt) || 0;
    if (rCalTs > lCalTs || (!localDay.calendar && remoteDay.calendar)) {
      localDay.calendar = remoteDay.calendar || '';
      localDay.calendarUpdatedAt = rCalTs;
    }

    SLOT_KEYS.forEach(({ key }) => {
      const lSlot = localDay[key];
      const rSlot = remoteDay[key];
      if (!rSlot) return;

      const lTs = Number(lSlot.updatedAt) || Number(lSlot.lastResumeTimestamp) || 0;
      const rTs = Number(rSlot.updatedAt) || Number(rSlot.lastResumeTimestamp) || 0;

      const lEmpty = !lSlot.subject && !lSlot.task && lSlot.durationMinutes === 0 && !lSlot.completed && lSlot.timerStatus === 'idle' && (lSlot.accumulatedMs || 0) === 0;
      const rHasData = Boolean(rSlot.subject || rSlot.task || rSlot.durationMinutes > 0 || rSlot.completed || rSlot.timerStatus !== 'idle' || (rSlot.accumulatedMs || 0) > 0);

      // 重要保護：絕不允許空遠端覆蓋有實質讀書紀錄的本機資料！
      if (!rHasData && (lSlot.durationMinutes > 0 || (lSlot.accumulatedMs || 0) > 0)) return;

      if (rTs > lTs || (rTs === lTs && rHasData && lEmpty) || (lTs === 0 && rHasData)) {
        localDay[key] = {
          ...rSlot,
          restMinutes: rSlot.restMinutes || 0,
          restAccumulatedMs: rSlot.restAccumulatedMs || 0,
          lastPauseTimestamp: rSlot.lastPauseTimestamp || null
        };
      }

      const finalSlot = localDay[key];
      if (finalSlot.timerStatus === 'running') {
        const startScore = Number(finalSlot.updatedAt) || Number(finalSlot.lastResumeTimestamp) || 0;
        if (startScore >= latestRunningTs) {
          latestRunningTs = startScore;
          latestRunning = { dayCountdown: localDay.dayCountdown, slotKey: key };
        }
      } else if (finalSlot.timerStatus === 'paused') {
        const pauseScore = Number(finalSlot.updatedAt) || Number(finalSlot.lastPauseTimestamp) || 0;
        if (pauseScore >= latestPausedTs) {
          latestPausedTs = pauseScore;
          latestPaused = { dayCountdown: localDay.dayCountdown, slotKey: key };
        }
      }
    });
  });

  // 確保全表最多只有一個 active 時段（若遠端為 running，其他時段暫停；若為 paused，其他時段亦不應 running）
  if (latestRunning) {
    pauseOtherActiveSlots(latestRunning.dayCountdown, latestRunning.slotKey, latestRunningTs);
    currentActiveDayCountdown = latestRunning.dayCountdown;
  } else if (latestPaused) {
    pauseOtherActiveSlots(latestPaused.dayCountdown, latestPaused.slotKey, latestPausedTs);
    currentActiveDayCountdown = latestPaused.dayCountdown;
  }

  appState.updatedAt = Math.max(appState.updatedAt || 0, remote.updatedAt || 0);
  return true;
}

/**
 * 向共同房間廣播即時訊息（透過 HTTPS POST，啟用 keepalive 確保手機按開始後立刻鎖屏也能送達）
 */
async function broadcastToRoom(messageObj) {
  const roomId = (currentRoomId || 'sakura-study-2026').trim();
  if (!roomId) return;
  const topic = `sakura_room_${encodeURIComponent(roomId)}`;
  const bodyStr = JSON.stringify(messageObj);
  try {
    await fetch(`https://ntfy.sh/${topic}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: bodyStr,
      keepalive: bodyStr.length < 60000
    });
  } catch (err) {
    console.warn('Room broadcast failed:', err);
  }
}

/**
 * 廣播個別細項異動（打勾、修改時間、寫筆記等毫秒級同步）
 */
function broadcastRoomDelta(payload) {
  if (isReceivingRemoteUpdate) return;
  const roomId = (currentRoomId || 'sakura-study-2026').trim();
  if (!roomId) return;
  const nowTs = Date.now();
  broadcastToRoom({
    type: 'DELTA',
    roomId: roomId,
    senderId: myClientId,
    senderName: myNickname,
    ts: nowTs,
    payload: { updatedAt: nowTs, ...payload }
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
  if (isReceivingRemoteUpdate) return;
  const roomId = (currentRoomId || 'sakura-study-2026').trim();
  if (!roomId) return;
  lastFullBroadcastTs = Date.now();
  broadcastToRoom({
    type: 'FULL',
    roomId: roomId,
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
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000);
      const res = await fetch(msgEvent.attachment.url, { signal: controller.signal });
      clearTimeout(timeoutId);
      if (res.ok) {
        return await res.json();
      }
    } catch (e) {
      // 附件逾期或網路阻斷時忽略
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

    roomWs.onopen = async () => {
      isRoomConnected = true;
      try {
        localStorage.setItem(ROOM_STORAGE_KEY, JSON.stringify({
          enabled: true,
          roomId: currentRoomId,
          nickname: myNickname
        }));
      } catch (e) {}

      setRoomNavbarStatus('connected');
      renderRoomModalState();

      // 先向伺服器快取拉取最新進度（包含其他裝置或自己稍早廣播的計時狀態），再發送 JOIN
      await pollLatestRoomSnapshot(topic);

      // 發送加入通知，請求房間內其他在線成員同步最新進度
      broadcastToRoom({
        type: 'JOIN',
        roomId: currentRoomId,
        senderId: myClientId,
        senderName: myNickname,
        ts: Date.now()
      });

      if (!isInitial) {
        showToast(`🌸 已成功加入房間【${currentRoomId}】！跨裝置即時同步中`);
      }
    };

    roomWs.onmessage = async (event) => {
      try {
        const msgEvent = JSON.parse(event.data);
        if (msgEvent.event === 'message') {
          const data = await extractRoomMessagePayload(msgEvent);
          if (data) {
            handleRoomIncomingMessage(data, false);
          }
        }
      } catch (err) {
        // 忽略非預期訊息
      }
    };

    roomWs.onclose = () => {
      isRoomConnected = false;
      renderRoomModalState();

      // 若使用者仍處於連線設定中，則 4 秒後自動重連
      const stored = localStorage.getItem(ROOM_STORAGE_KEY);
      if (stored) {
        try {
          const parsed = JSON.parse(stored);
          if (parsed && parsed.enabled) {
            roomReconnectTimeout = setTimeout(() => {
              connectToSharedRoom(currentRoomId, myNickname, true);
            }, 4000);
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
 * @param {object} msg 訊息物件
 * @param {boolean} isHistoryReplay 是否為重連/喚醒時的歷史快取回放
 */
function handleRoomIncomingMessage(msg, isHistoryReplay = false) {
  if (!msg) return;
  // 若為即時推播且是自己剛發出的則略過；若是歷史回放則允許用雲端快取補齊本機可能遺漏的狀態
  if (!isHistoryReplay && msg.senderId === myClientId) return;

  if (msg.type === 'JOIN') {
    if (isHistoryReplay) return;
    const now = Date.now();
    // 夥伴加入通知防洗版（同一個人在 15 秒內只彈一次提示）
    if (now - lastJoinToastTs > 15000 || lastKnownJoinSender !== msg.senderId) {
      lastJoinToastTs = now;
      lastKnownJoinSender = msg.senderId;
      showToast(`👋 夥伴【${escapeHtml(msg.senderName || '新成員')}】已連線！`);
    }

    // 關鍵防循環保護：6 秒內只回應一次 FULL，避免手機與電腦互相 JOIN 形成無窮發送風暴
    if (now - lastJoinResponseTs > 6000) {
      lastJoinResponseTs = now;
      broadcastFullStateToRoom();
    }
    return;
  }

  if (msg.type === 'REQ_FULL') {
    if (isHistoryReplay) return;
    const now = Date.now();
    if (now - lastJoinResponseTs > 3000) {
      lastJoinResponseTs = now;
      broadcastFullStateToRoom();
    }
    return;
  }

  if (msg.type === 'FULL' && msg.compact) {
    const remote = unpackCompactState(msg.compact);
    if (!remote) return;

    isReceivingRemoteUpdate = true;
    mergeRemoteState(remote);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(appState)); } catch (e) {}

    renderPhasesConfig();
    renderMainScheduleTable();
    renderFullDashboard();
    renderQuickTimerView();
    renderDailyPlanView();
    renderHomeView();
    applyHomeCover();
    updateActiveTimerBanner();
    syncScreenWakeLock();

    isReceivingRemoteUpdate = false;
    updateSaveStatusDisplay();
    if (!isHistoryReplay) {
      showToast(`🌸 已同步【${escapeHtml(msg.senderName || '跨裝置')}】的最新進度！`);
    }
    return;
  }

  if (msg.type === 'DELTA' && msg.payload) {
    const p = msg.payload;
    const eventTs = Number(p.updatedAt) || Number(msg.ts) || Date.now();
    isReceivingRemoteUpdate = true;

    if (p.kind === 'completed') {
      const day = findDayByKey(p.day);
      if (day && day[p.slot]) {
        if (eventTs >= (day[p.slot].updatedAt || 0)) {
          day[p.slot].completed = Boolean(p.val);
          day[p.slot].updatedAt = eventTs;
          appState.updatedAt = Math.max(appState.updatedAt || 0, eventTs);
          const cardEl = document.getElementById(`slot-card-${p.day}-${p.slot}`);
          if (cardEl) cardEl.classList.toggle('slot-completed', day[p.slot].completed);
          const chk = cardEl ? cardEl.querySelector('.done-checkbox') : null;
          if (chk) chk.checked = day[p.slot].completed;

          // 同步更新 Notion 日曆上的完成小勾
          const calCell = document.querySelector(`[data-cal-cell-day="${p.day}"]`);
          if (calCell) {
            const slotIndex = p.slot === 'morning' ? 0 : (p.slot === 'afternoon' ? 1 : 2);
            const slotRows = calCell.querySelectorAll('.cal-cell-slot-row');
            if (slotRows && slotRows[slotIndex]) {
              let dot = slotRows[slotIndex].querySelector('.cal-slot-done-dot');
              if (day[p.slot].completed) {
                if (!dot) {
                  dot = document.createElement('span');
                  dot.className = 'cal-slot-done-dot';
                  dot.title = '已完成';
                  dot.textContent = '✓';
                  slotRows[slotIndex].appendChild(dot);
                }
              } else if (dot) {
                dot.remove();
              }
            }
          }

          updateSingleDayRowSummaryDom(day);
          renderAllStatistics();
          saveState(false, false);
          if (!isHistoryReplay) {
            showToast(`🌸 ${escapeHtml(msg.senderName || '夥伴')} ${p.val ? '打勾完成了' : '取消了'} ${p.label || '時段'}！`);
          }
        }
      }
    } else if (p.kind === 'subject') {
      const day = findDayByKey(p.day);
      if (day && day[p.slot]) {
        if (eventTs >= (day[p.slot].updatedAt || 0)) {
          day[p.slot].subject = p.val;
          day[p.slot].updatedAt = eventTs;
          appState.updatedAt = Math.max(appState.updatedAt || 0, eventTs);
          refreshSlotDom(day, p.slot);

          // 同步更新 Notion 日曆上的科目標籤
          const calTag = document.querySelector(`.cal-slot-tag[data-cycle-subj-day="${p.day}"][data-cycle-subj-slot="${p.slot}"]`);
          if (calTag) {
            const shortLabel = p.slot === 'morning' ? '早' : (p.slot === 'afternoon' ? '午' : '晚');
            calTag.textContent = day[p.slot].subject || shortLabel;
            calTag.classList.toggle('has-subj', Boolean(day[p.slot].subject));
          }

          renderAllStatistics();
          saveState(false, false);
        }
      }
    } else if (p.kind === 'time') {
      const day = findDayByKey(p.day);
      if (day && day[p.slot]) {
        if (eventTs >= (day[p.slot].updatedAt || 0)) {
          if (p.startTime !== undefined) day[p.slot].startTime = p.startTime;
          if (p.endTime !== undefined) day[p.slot].endTime = p.endTime;
          if (p.durationMinutes !== undefined) {
            day[p.slot].durationMinutes = p.durationMinutes;
            day[p.slot].accumulatedMs = p.durationMinutes * 60000;
          }
          day[p.slot].updatedAt = eventTs;
          appState.updatedAt = Math.max(appState.updatedAt || 0, eventTs);
          refreshSlotDom(day, p.slot);
          updateSingleDayRowSummaryDom(day);
          renderAllStatistics();
          saveState(false, false);
        }
      }
    } else if (p.kind === 'timer') {
      const day = findDayByKey(p.day);
      if (day && day[p.slot]) {
        const localSlot = day[p.slot];
        if (eventTs >= (localSlot.updatedAt || 0)) {
          if (p.timerStatus === 'running' || p.timerStatus === 'paused') {
            if (p.timerStatus === 'running') {
              pauseOtherActiveSlots(day.dayCountdown, p.slot, eventTs);
            }
            currentActiveDayCountdown = day.dayCountdown;
          }
          if (p.subject !== undefined && p.subject !== '') {
            localSlot.subject = p.subject;
          }
          if (p.task !== undefined && p.task !== '') {
            localSlot.task = p.task;
          }
          localSlot.timerStatus = p.timerStatus || 'idle';
          localSlot.startTime = p.startTime !== undefined ? p.startTime : localSlot.startTime;
          localSlot.endTime = p.endTime !== undefined ? p.endTime : localSlot.endTime;
          localSlot.durationMinutes = p.durationMinutes !== undefined ? p.durationMinutes : localSlot.durationMinutes;
          localSlot.accumulatedMs = p.accumulatedMs !== undefined ? p.accumulatedMs : localSlot.accumulatedMs;
          if (p.restMinutes !== undefined) localSlot.restMinutes = p.restMinutes;
          if (p.restAccumulatedMs !== undefined) localSlot.restAccumulatedMs = p.restAccumulatedMs;
          if (p.timerStatus === 'paused') {
            localSlot.lastPauseTimestamp = (p.lastPauseTimestamp !== undefined && p.lastPauseTimestamp !== null)
              ? Number(p.lastPauseTimestamp)
              : (Number(msg.ts) || Date.now());
          } else if (p.timerStatus === 'running' || p.timerStatus === 'idle' || p.timerStatus === 'ended') {
            localSlot.lastPauseTimestamp = null;
          }
          // 關鍵：保留原裝置按下開始/繼續時的真實毫秒時間戳，絕不用收到訊息的當下時間覆蓋！
          localSlot.lastResumeTimestamp = (p.timerStatus === 'running')
            ? (Number(p.lastResumeTimestamp) || Number(msg.ts) || Date.now())
            : null;
          localSlot.updatedAt = eventTs;
          appState.updatedAt = Math.max(appState.updatedAt || 0, eventTs);

          refreshSlotDom(day, p.slot);
          updateSingleDayRowSummaryDom(day);
          updateActiveTimerBanner();
          renderAllStatistics();
          renderQuickTimerView();
          renderDailyPlanView();
          renderHomeView();
          renderPureCalendarTable();
          syncScreenWakeLock();
          saveState(false, false);

          if (!isHistoryReplay) {
            if (p.timerStatus === 'running') {
              showToast(`⏱️ ${escapeHtml(msg.senderName || '跨裝置')} 開始了 ${p.label || ''} 專注計時！`);
            } else if (p.timerStatus === 'paused') {
              showToast(`⏸️ ${escapeHtml(msg.senderName || '跨裝置')} 暫停了 ${p.label || ''} 計時`);
            } else if (p.timerStatus === 'ended') {
              showToast(`⏹️ ${escapeHtml(msg.senderName || '跨裝置')} 結束了計時（鎖定 ${formatMinutesToHM(localSlot.durationMinutes)}）`);
            }
          }
        }
      }
    } else if (p.kind === 'task') {
      const day = findDayByKey(p.day);
      if (day && day[p.slot]) {
        if (eventTs >= (day[p.slot].updatedAt || 0)) {
          day[p.slot].task = p.val || '';
          day[p.slot].updatedAt = eventTs;
          appState.updatedAt = Math.max(appState.updatedAt || 0, eventTs);
          const cardEl = document.getElementById(`slot-card-${p.day}-${p.slot}`);
          const inputEl = cardEl ? cardEl.querySelector('.task-input') : null;
          if (inputEl && document.activeElement !== inputEl) {
            inputEl.value = day[p.slot].task;
          }
          // 同步更新 Notion 日曆中的工作輸入框
          const calInput = document.querySelector(`.cal-slot-input[data-day="${p.day}"][data-slot="${p.slot}"]`);
          if (calInput && document.activeElement !== calInput) {
            calInput.value = day[p.slot].task;
          }
          saveState(false, false);
        }
      }
    } else if (p.kind === 'calendar') {
      const day = findDayByKey(p.day);
      if (day) {
        if (eventTs >= (day.calendarUpdatedAt || 0)) {
          day.calendar = p.val || '';
          day.calendarUpdatedAt = eventTs;
          appState.updatedAt = Math.max(appState.updatedAt || 0, eventTs);
          const pureRow = document.getElementById(`pure-row-day-${p.day}`);
          const inputEl = pureRow ? pureRow.querySelector('.pure-calendar-input') : null;
          if (inputEl && document.activeElement !== inputEl) {
            inputEl.value = day.calendar;
          }
          if (String(currentActiveDayCountdown) === String(day.dayCountdown)) {
            const dailyInp = document.getElementById('dailyCalendarInput');
            if (dailyInp && document.activeElement !== dailyInp) dailyInp.value = day.calendar;
            const homeInp = document.getElementById('homeCalendarMemoInput');
            if (homeInp && document.activeElement !== homeInp) homeInp.value = day.calendar;
          }
          // 同步更新 Notion 日曆格子上的備忘標籤
          const calCell = document.querySelector(`[data-cal-cell-day="${p.day}"]`);
          if (calCell) {
            const dateMeta = calCell.querySelector('.cal-date-left-meta');
            if (dateMeta) {
              let memoPill = dateMeta.querySelector('.cal-memo-pill');
              if (day.calendar) {
                if (!memoPill) {
                  memoPill = document.createElement('span');
                  memoPill.className = 'cal-memo-pill';
                  dateMeta.appendChild(memoPill);
                }
                memoPill.title = day.calendar;
                memoPill.textContent = day.calendar;
              } else if (memoPill) {
                memoPill.remove();
              }
            }
          }
          saveState(false, false);
        }
      }
    } else if (p.kind === 'homeCover') {
      if (p.val && typeof p.val === 'string') {
        const val = p.val.trim();
        const nowTs = Number(p.updatedAt) || Date.now();
        const remoteIsCustom = val.startsWith('data:') || val.startsWith('url:');
        if (remoteIsCustom) {
          const rawUrl = val.startsWith('url:') ? val.slice(4).trim() : val.trim();
          if (!isValidImageUrl(rawUrl)) {
            console.warn('[Security] Ignored unsafe remote cover payload:', rawUrl);
            return;
          }
        }
        const localIsCustom = appState.homeCover && (appState.homeCover.startsWith('data:') || appState.homeCover.startsWith('url:'));
        if (remoteIsCustom || !localIsCustom || nowTs >= (appState.homeCoverUpdatedAt || 0)) {
          appState.homeCover = val;
          appState.homeCoverUpdatedAt = nowTs;
          if (p.fit) appState.homeCoverFit = p.fit;
          if (p.position) appState.homeCoverPosition = p.position;
          if (remoteIsCustom) {
            try { localStorage.setItem('sakura_custom_cover_v1', val); } catch (e) {}
          }
          applyHomeCover();
          saveState(false, false);
          if (!isHistoryReplay) {
            showToast(`🎨 ${escapeHtml(msg.senderName || '跨裝置')} 更新了首頁看板背景！`);
          }
        }
      }
    } else if (p.kind === 'homeCoverSettings') {
      if (p.fit) appState.homeCoverFit = p.fit;
      if (p.position) appState.homeCoverPosition = p.position;
      saveState(false, false);
      applyHomeCover();
    } else if (p.kind === 'goal') {
      if (!appState.goals[p.subj]) appState.goals[p.subj] = {};
      appState.goals[p.subj][p.phaseKey] = p.val || '';
      appState.updatedAt = Math.max(appState.updatedAt || 0, eventTs);
      saveState(false, false);
      const textarea = document.querySelector(`.goal-textarea[data-goal-subj="${p.subj}"][data-goal-phase="${p.phaseKey}"]`);
      if (textarea && document.activeElement !== textarea) {
        textarea.value = p.val || '';
      }
    } else if (p.kind === 'phases') {
      if (Array.isArray(p.phases) && p.phases.length === 3) {
        appState.phases = p.phases;
        appState.updatedAt = Math.max(appState.updatedAt || 0, eventTs);
        saveState(false, false);
        renderPhasesConfig();
        updateAllRowPhaseTags();
        renderFullDashboard();
      }
    }

    renderHomeView();
    renderQuickTimerView();
    renderPureCalendarTable();
    renderDailyPlanView();
    isReceivingRemoteUpdate = false;
  }
}

/**
 * 從 GitHub 靜態雲端備份還原最新進度（永久備份，解決 ntfy 附件 3 小時過期問題）
 */
async function fallbackToGitHubBackup() {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000);
    const backupRes = await fetch(`./data/backup-latest.json?t=${Date.now()}`, {
      cache: 'no-store',
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    if (backupRes.ok) {
      const backupData = await backupRes.json();
      if (backupData && backupData.type === 'FULL' && backupData.compact) {
        handleRoomIncomingMessage(backupData, true);
        console.log('🌸 已自動自 GitHub 雲端備份還原最新進度與背景封面！');
      }
    }
  } catch (e) {
    console.warn('Fallback to GitHub backup error:', e);
  }
}

/**
 * 查詢房間最近快取進度並依序回放最新異動（支援跨裝置與手機重開瀏覽器無縫接續）
 */
let isPollingRoomSnapshot = false;
async function pollLatestRoomSnapshot(topic) {
  if (!topic || isPollingRoomSnapshot) return;
  isPollingRoomSnapshot = true;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(`https://ntfy.sh/${topic}/json?poll=1`, {
      cache: 'no-store',
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    if (!res.ok) {
      await fallbackToGitHubBackup();
      return;
    }
    const text = await res.text();
    if (!text || !text.trim()) {
      await fallbackToGitHubBackup();
      return;
    }
    const lines = text.trim().split('\n');
    let fullSnapshotData = null;
    let fullSnapshotLineIndex = -1;

    // 🌸 關鍵倒序掃描（Reverse Scan）：從最新的一筆往回搜尋最新 FULL 快照
    // 避免前面數十筆過期的 404 附件阻塞連線達數十秒，0.2 秒極速抓取最新快照與自訂背景封面！
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const item = JSON.parse(lines[i]);
        if (item.event === 'message') {
          if ((item.message && item.message.includes('"FULL"')) || (item.attachment && item.attachment.url)) {
            const data = await extractRoomMessagePayload(item);
            if (data && data.type === 'FULL' && data.compact) {
              fullSnapshotData = data;
              fullSnapshotLineIndex = i;
              break;
            }
          }
        }
      } catch (e) {}
    }

    if (fullSnapshotData) {
      handleRoomIncomingMessage(fullSnapshotData, true);
    } else {
      // 若 ntfy 上的所有 FULL 附件皆已過期，立即從 GitHub 雲端備份還原
      await fallbackToGitHubBackup();
    }

    // 依序回放最新快照之後發生的所有 DELTA 異動
    const deltaStartLine = fullSnapshotLineIndex >= 0 ? fullSnapshotLineIndex + 1 : 0;
    for (let i = deltaStartLine; i < lines.length; i++) {
      try {
        const item = JSON.parse(lines[i]);
        if (item.event === 'message') {
          const data = await extractRoomMessagePayload(item);
          if (data && data.type === 'DELTA') {
            handleRoomIncomingMessage(data, true);
          }
        }
      } catch (e) {}
    }
  } catch (err) {
    console.warn('Poll room snapshot warning:', err);
    await fallbackToGitHubBackup();
  } finally {
    isPollingRoomSnapshot = false;
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
  try {
    localStorage.setItem(ROOM_STORAGE_KEY, JSON.stringify({
      enabled: false,
      roomId: '',
      nickname: myNickname
    }));
  } catch (e) {}
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
    if (descEl) descEl.textContent = `跨裝置即時協作已啟動！手機開始計時、平板或電腦可隨時接手暫停或結束，關螢幕或滑掉瀏覽器皆會持續精準計時！`;
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
    if (descEl) descEl.textContent = '免登入 Google 帳號、免兩階段驗證！只要設定共同房號，手機、平板、電腦皆可隨時連動計時與同步！';
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
 * 初始化房間同步（預設自動連線至 sakura-study-2026，確保手機、平板、電腦打開即自動聯通）
 */
function initRoomSyncFromStorageOrUrl() {
  setupRoomSyncEventListeners();

  // 1. 優先檢查網址參數 ?room=...（點開分享連結或掃 QR Code 一鍵自動進房）
  const roomParam = getRoomParamFromUrl();
  if (roomParam && roomParam.trim()) {
    const cleanId = roomParam.trim();
    connectToSharedRoom(cleanId, '我', true);
    return;
  }

  // 2. 檢查本機先前是否有設定連線房間
  const stored = localStorage.getItem(ROOM_STORAGE_KEY);
  if (stored) {
    try {
      const parsed = JSON.parse(stored);
      if (parsed && parsed.enabled === false) {
        // 使用者明確點選過「離開房間」
        setRoomNavbarStatus('disconnected');
        renderRoomModalState();
        return;
      }
      if (parsed && parsed.enabled && parsed.roomId) {
        connectToSharedRoom(parsed.roomId, parsed.nickname || '我', true);
        return;
      }
    } catch (e) {}
  }

  // 3. 若未設定過，預設自動加入 sakura-study-2026，讓手機、平板、電腦免設定直接跨裝置聯通
  connectToSharedRoom('sakura-study-2026', '我', true);
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
      if (currentRoomId) {
        broadcastToRoom({ type: 'REQ_FULL', roomId: currentRoomId, senderId: myClientId, ts: Date.now() });
        pollLatestRoomSnapshot(`sakura_room_${encodeURIComponent(currentRoomId)}`);
        showToast('⬇️ 已向房間索取並同步最新進度！');
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

/**
 * 當裝置從鎖屏、其他 App、或重新開啟瀏覽器回到畫面時，立即對齊真實時間並同步跨裝置狀態
 */
function handleAppWakeOrFocus() {
  checkAndAutoFinalizeOvernightSlots();
  const active = findActiveTimerSlot();
  if (active) {
    currentActiveDayCountdown = active.day.dayCountdown;
    const liveMs = getSlotLiveMs(active.slot);
    const liveMins = Math.floor(liveMs / 60000);
    if (liveMins !== active.slot.durationMinutes) {
      active.slot.durationMinutes = liveMins;
    }
    const clockEl = document.getElementById(`ypt-clock-${active.day.dayCountdown}-${active.slotKey}`);
    if (clockEl) clockEl.textContent = formatMsToClock(liveMs);
    updateSingleDayRowSummaryDom(active.day);
  }
  renderQuickTimerView();
  renderDailyPlanView();
  renderHomeView();
  renderPureCalendarTable();
  updateActiveTimerBanner(active);
  renderAllStatistics();
  syncScreenWakeLock();

  if (currentRoomId) {
    const topic = `sakura_room_${encodeURIComponent(currentRoomId)}`;
    if (!roomWs || roomWs.readyState === WebSocket.CLOSED || roomWs.readyState === WebSocket.CLOSING) {
      connectToSharedRoom(currentRoomId, myNickname, true);
    } else {
      pollLatestRoomSnapshot(topic);
    }
  }
}

/* ==========================================================================
   啟動應用程式
   ========================================================================== */

function bootstrapApp() {
  try {
    loadAppSettings();
    loadState();
    initCurrentActiveDay();
  } catch (err) {
    console.error('State load error:', err);
  }

  // 🌸 關鍵：優先綁定所有按鈕與互動監聽器，確保任何畫面皆 100% 可點擊！
  try {
    setupEventListeners();
  } catch (err) {
    console.error('Setup event listeners error:', err);
  }

  try {
    initSakuraPetalsCanvas();
  } catch (err) {
    console.warn('Canvas init error:', err);
  }

  // 檢查並自動結算隔夜遺漏結束之時段（凌晨五點分界）
  try {
    checkAndAutoFinalizeOvernightSlots();
  } catch (err) {
    console.warn('Overnight check warning:', err);
  }

  // 若重新打開瀏覽器時有正在計時或暫停的項目，維持該時段目標
  try {
    const initialActive = findActiveTimerSlot();
    if (initialActive && (initialActive.slot.timerStatus === 'running' || initialActive.slot.timerStatus === 'paused')) {
      currentActiveDayCountdown = initialActive.day.dayCountdown;
    }
  } catch (err) {
    console.warn('Active timer recovery warning:', err);
  }

  try {
    renderPhasesConfig();
    renderMainScheduleTable();
    renderFullDashboard();
    renderHomeView();
    renderQuickTimerView();
    renderDailyPlanView();
    updateActiveTimerBanner();
  } catch (err) {
    console.error('Initial rendering error:', err);
  }

  try {
    startGlobalTimerTicker();
    initRoomSyncFromStorageOrUrl();
    switchMainTab('home');
    syncScreenWakeLock();
    // 🌸 關鍵：打開網頁時立即非同步載入 GitHub 最新雲端備份，確保若本地無自訂封面或為新開瀏覽器時，立刻秒級同步！
    fallbackToGitHubBackup();
  } catch (err) {
    console.error('App bootstrap error:', err);
  }
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrapApp);
  } else {
    bootstrapApp();
  }
}

  // 註冊 PWA Service Worker (支援離線秒開與快取)
  if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js?v=20261109_v14').then((reg) => {
        console.log('🌸 PWA ServiceWorker registered:', reg.scope);
      }).catch((err) => {
        console.warn('PWA registration warning:', err);
      });
    });
  }

  // 攔截 PWA 安裝提示事件
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPwaPrompt = e;
    const pwaBtn = document.getElementById('pwaInstallBtn');
    if (pwaBtn) pwaBtn.style.display = 'inline-block';
  });

  // 1. 螢幕關閉、切換其他 App、或滑掉瀏覽器瞬間：強制把最新計時狀態寫入本機快取
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(appState)); } catch (e) {}
    } else if (document.visibilityState === 'visible') {
      handleAppWakeOrFocus();
    }
  });

  window.addEventListener('pagehide', () => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(appState)); } catch (e) {}
  });

  window.addEventListener('pageshow', () => {
    handleAppWakeOrFocus();
  });

  window.addEventListener('focus', () => {
    if (document.visibilityState === 'visible') {
      handleAppWakeOrFocus();
    }
  });

  window.addEventListener('online', () => {
    handleAppWakeOrFocus();
  });

  // 2. 定期背景輪詢保活（每 8 秒檢查一次房間快取與 WebSocket 狀態，確保跨裝置秒級穩定聯通）
  setInterval(() => {
    if (document.visibilityState === 'visible' && currentRoomId) {
      if (!roomWs || roomWs.readyState === WebSocket.CLOSED || roomWs.readyState === WebSocket.CLOSING) {
        connectToSharedRoom(currentRoomId, myNickname, true);
      } else {
        pollLatestRoomSnapshot(`sakura_room_${encodeURIComponent(currentRoomId)}`);
      }
    }
  }, 8000);

  // 3. 多分頁同步：同瀏覽器其他分頁修改資料時立即同步
  window.addEventListener('storage', (e) => {
    if (e.key !== STORAGE_KEY || !e.newValue) return;
    try {
      const synced = normalizeState(JSON.parse(e.newValue));
      if (!synced) return;
      mergeRemoteState(synced);
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
