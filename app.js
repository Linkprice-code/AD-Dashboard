/* =========================================================
   ADS PERFORMANCE DASHBOARD - app.js
   3단계: Supabase Edge Function 기반 실제 광고주 인증
   (KPI/차트는 아직 Mock 데이터 유지, ad_performance 연동은 다음 단계)
   ========================================================= */

/* ---------------------------------------------------------
   1. Supabase 공개 설정
   ---------------------------------------------------------
   url / anonKey는 브라우저에 노출되어도 되는 공개 값이다.
   실제 데이터 접근 권한은 RLS + Edge Function이 담당하므로
   GitHub에 커밋해도 안전하다. (service_role key는 절대 여기 두지 않는다)
--------------------------------------------------------- */
const SUPABASE_CONFIG = {
  url: "https://agglowdlyduilkjskxyx.supabase.co",
  anonKey: "sb_publishable_SM4u637sEeM0Vi0HtD-DgQ_9bQU-AD9"
};

const ADVERTISER_LOGIN_ENDPOINT = `${SUPABASE_CONFIG.url}/functions/v1/advertiser-login`;
const GFA_UPLOAD_ENDPOINT = `${SUPABASE_CONFIG.url}/functions/v1/gfa-upload`;
const GFA_PERFORMANCE_ENDPOINT = `${SUPABASE_CONFIG.url}/functions/v1/gfa-performance`;
const SA_PERFORMANCE_ENDPOINT = `${SUPABASE_CONFIG.url}/functions/v1/sa-performance`;
const SESSION_STORAGE_KEY = "adsDashboardSession";

/* ---------------------------------------------------------
   2. 사이드바 메뉴 정의
   ---------------------------------------------------------
   channels에 지금 선택된 채널(SA/GFA)이 없으면 사이드바에 아예 나타나지
   않는다. gfaRawType이 있는 항목은 GFA 채널일 때 그 raw 테이블을
   집계해서 보여준다.
--------------------------------------------------------- */
const MENU_ITEMS = [
  { id: "overview", label: "성과 대시보드", channels: ["SA", "GFA"] },
  { id: "trend", label: "그래프 추이", channels: ["SA", "GFA"] },
  { id: "product", label: "상품별 데이터", channels: ["SA", "GFA"], gfaRawType: "adv" },
  { id: "powerlink", label: "파워링크", channels: ["SA"] },
  { id: "shopping", label: "쇼핑검색", channels: ["SA"] },
  { id: "brand", label: "브랜드검색", channels: ["SA"] },
  { id: "daily", label: "일별 데이터", channels: ["GFA"] },
  { id: "monthly", label: "월별 데이터", channels: ["GFA"] },
  { id: "campaign", label: "캠페인별 성과", channels: ["GFA"], gfaRawType: "campaign" },
  { id: "adgroup", label: "광고그룹별 성과", channels: ["GFA"], gfaRawType: "adgroup" },
  { id: "creative", label: "소재별 성과", channels: ["GFA"] },
  { id: "upload", label: "데이터 업로드", channels: ["GFA"] }
];

// raw_type -> "이름" 컬럼 헤더에 쓸 표시명
const GFA_RAW_TYPE_NAME_LABEL = {
  campaign: "캠페인",
  adgroup: "광고그룹",
  adv: "상품"
};

/* ---------------------------------------------------------
   3. 채널(SA / GFA) 라벨 / SA Mock 데이터
   ---------------------------------------------------------
   GFA는 실제 업로드된 데이터(gfa_campaign_raw 등)로 핵심지표를 계산한다.
   SA는 아직 네이버 API 연동 전이라 원시 지표(impressions/clicks/cost/
   conversions/revenue)만 고정된 Mock 값으로 두고, CTR/CPC/CVR/ROAS/CPA는
   GFA와 동일한 계산식(computeDerivedMetrics)으로 매번 계산한다.
--------------------------------------------------------- */
const CHANNEL_LABELS = {
  SA: "SA",
  GFA: "GFA"
};

// sa-performance가 group_by="type"로 돌려주는 네이버 캠페인 유형 코드 <-> 캠페인 유형별
// 필터 탭(data-campaign-type)의 매핑. 네이버 SA 표준 리포트 기준 코드다.
const SA_CAMPAIGN_TYPE_TO_NAVER = {
  powerlink: "WEB_SITE",
  shopping: "SHOPPING",
  brand: "BRAND_SEARCH"
};

/* ---------------------------------------------------------
   4-1. SA 상품별(모델별) 성과 - 예시 데이터
   ---------------------------------------------------------
   네이버 SA는 모델/키워드 단위 데이터를 API로 못 받아온다 (추후 수기
   raw 파일 업로드로 대체 예정). 그 전까지는 화면 구성만 먼저 보여주기
   위한 예시 데이터다. 실데이터 연동 시 이 배열만 교체하면 된다.
--------------------------------------------------------- */
const MODEL_BADGE_COLORS = {
  "냉장고 최주력": "badge-blue",
  "김치냉장고 최주력": "badge-green",
  "식기세척기 주력": "badge-orange",
  "안마의자 주력": "badge-red",
  "김치냉장고 추가": "badge-teal"
};

const SA_MODEL_MOCK = [
  {
    model: "RM70F90M1ZD", category: "냉장고 최주력",
    impressions: 530112, clicks: 3333, cost: 714340, conversions: 242, revenue: 645656260,
    keywords: [
      { keyword: "AI추천", impressions: 312500, clicks: 1980, cost: 398200, conversions: 158, revenue: 421000000 },
      { keyword: "삼성냉장고", impressions: 98200, clicks: 620, cost: 165400, conversions: 48, revenue: 128500000 },
      { keyword: "냉장고", impressions: 84200, clicks: 510, cost: 112300, conversions: 28, revenue: 71200000 },
      { keyword: "rm70f90m1zd", impressions: 35212, clicks: 223, cost: 38440, conversions: 8, revenue: 24956260 }
    ]
  },
  {
    model: "RM70F90M1GD", category: "냉장고 최주력",
    impressions: 279702, clicks: 1262, cost: 251075, conversions: 73, revenue: 190803660,
    keywords: [
      { keyword: "AI추천", impressions: 269671, clicks: 1145, cost: 116732, conversions: 59, revenue: 152567220 },
      { keyword: "삼성냉장고", impressions: 1798, clicks: 42, cost: 93951, conversions: 2, revenue: 5354820 },
      { keyword: "냉장고", impressions: 7452, clicks: 22, cost: 32879, conversions: 4, revenue: 10709640 },
      { keyword: "rm70f90m1gd", impressions: 118, clicks: 29, cost: 2871, conversions: 6, revenue: 16817160 },
      { keyword: "냉장고4도어", impressions: 12, clicks: 2, cost: 1353, conversions: 0, revenue: 0 }
    ]
  },
  {
    model: "RM70F91R1A", category: "냉장고 최주력",
    impressions: 144120, clicks: 273, cost: 30118, conversions: 2, revenue: 6107520,
    keywords: [
      { keyword: "AI추천", impressions: 98400, clicks: 165, cost: 18200, conversions: 1, revenue: 3200000 },
      { keyword: "냉장고", impressions: 32100, clicks: 74, cost: 8100, conversions: 1, revenue: 2907520 },
      { keyword: "rm70f91r1a", impressions: 13620, clicks: 34, cost: 3818, conversions: 0, revenue: 0 }
    ]
  },
  {
    model: "RK70F49M1A", category: "김치냉장고 최주력",
    impressions: 266371, clicks: 924, cost: 271865, conversions: 52, revenue: 134014900,
    keywords: [
      { keyword: "AI추천", impressions: 180200, clicks: 610, cost: 178400, conversions: 34, revenue: 89200000 },
      { keyword: "김치냉장고", impressions: 52400, clicks: 198, cost: 62100, conversions: 12, revenue: 32100000 },
      { keyword: "삼성김치냉장고", impressions: 21600, clicks: 82, cost: 21365, conversions: 5, revenue: 10500000 },
      { keyword: "rk70f49m1a", impressions: 12171, clicks: 34, cost: 10000, conversions: 1, revenue: 2214900 }
    ]
  },
  {
    model: "RK70F49M1ZG", category: "김치냉장고 최주력",
    impressions: 186557, clicks: 435, cost: 97108, conversions: 14, revenue: 36462330,
    keywords: [
      { keyword: "AI추천", impressions: 132400, clicks: 290, cost: 62800, conversions: 9, revenue: 24200000 },
      { keyword: "김치냉장고", impressions: 38200, clicks: 96, cost: 24500, conversions: 4, revenue: 9800000 },
      { keyword: "rk70f49m1zg", impressions: 15957, clicks: 49, cost: 9808, conversions: 1, revenue: 2462330 }
    ]
  },
  {
    model: "RQ33DG71J2ET", category: "김치냉장고 최주력",
    impressions: 212583, clicks: 886, cost: 137489, conversions: 72, revenue: 121449910,
    keywords: [
      { keyword: "AI추천", impressions: 142800, clicks: 610, cost: 95400, conversions: 51, revenue: 88200000 },
      { keyword: "김치냉장고", impressions: 45600, clicks: 190, cost: 30200, conversions: 15, revenue: 25100000 },
      { keyword: "rq33dg71j2et", impressions: 24183, clicks: 86, cost: 11889, conversions: 6, revenue: 8149910 }
    ]
  },
  {
    model: "DW80F73Y1FEW", category: "식기세척기 주력",
    impressions: 137175, clicks: 396, cost: 41118, conversions: 14, revenue: 17748360,
    keywords: [
      { keyword: "식기세척기", impressions: 88400, clicks: 260, cost: 27200, conversions: 9, revenue: 11300000 },
      { keyword: "삼성식기세척기", impressions: 32100, clicks: 96, cost: 10218, conversions: 4, revenue: 5200000 },
      { keyword: "dw80f73y1few", impressions: 16675, clicks: 40, cost: 3700, conversions: 1, revenue: 1248360 }
    ]
  },
  {
    model: "NZ63DG403CFK", category: "안마의자 주력",
    impressions: 20688, clicks: 18, cost: 2090, conversions: 1, revenue: 783870,
    keywords: [
      { keyword: "안마의자", impressions: 15200, clicks: 12, cost: 1500, conversions: 1, revenue: 783870 },
      { keyword: "nz63dg403cfk", impressions: 5488, clicks: 6, cost: 590, conversions: 0, revenue: 0 }
    ]
  },
  {
    model: "RQ33DB74D201", category: "김치냉장고 추가",
    impressions: 113469, clicks: 291, cost: 29920, conversions: 10, revenue: 18605330,
    keywords: [
      { keyword: "김치냉장고", impressions: 72400, clicks: 198, cost: 20100, conversions: 7, revenue: 12800000 },
      { keyword: "rq33db74d201", impressions: 41069, clicks: 93, cost: 9820, conversions: 3, revenue: 5805330 }
    ]
  }
];

/* ---------------------------------------------------------
   4. 인증
   ---------------------------------------------------------
   로그인 크리덴셜(광고주 naver_customer_id) 검증은 항상 Supabase Edge
   Function(advertiser-login)에서 수행한다. 브라우저는 결과로 받은 광고주
   정보 + 서명된 세션 토큰만 보관하며, password / password_hash는 어떤
   경우에도 다루지 않는다.
--------------------------------------------------------- */
async function authenticateAdvertiser(password) {
  let res;
  try {
    res = await fetch(ADVERTISER_LOGIN_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${SUPABASE_CONFIG.anonKey}`,
        "apikey": SUPABASE_CONFIG.anonKey
      },
      body: JSON.stringify({ password })
    });
  } catch {
    return { success: false, message: "서버에 연결할 수 없습니다. 잠시 후 다시 시도해주세요." };
  }

  let payload;
  try {
    payload = await res.json();
  } catch {
    return { success: false, message: "서버 응답을 처리할 수 없습니다." };
  }

  if (!res.ok || !payload.success) {
    return { success: false, message: payload.message || "고객번호가 올바르지 않습니다." };
  }

  saveSession(payload.advertiser, payload.session_token);
  return { success: true, advertiser: payload.advertiser };
}

function saveSession(advertiser, token) {
  sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({ advertiser, token }));
}

function clearSession() {
  sessionStorage.removeItem(SESSION_STORAGE_KEY);
}

// advertiser_id 등은 여기서 신뢰용으로 쓰지 않는다 - UI 표시용일 뿐이며,
// 이후 실제 데이터 조회 Edge Function은 매 요청마다 토큰을 서버에서 다시 검증한다.
function getSession() {
  const raw = sessionStorage.getItem(SESSION_STORAGE_KEY);
  if (!raw) return null;

  let session;
  try {
    session = JSON.parse(raw);
  } catch {
    clearSession();
    return null;
  }

  if (!session?.token || !session?.advertiser || isTokenExpired(session.token)) {
    clearSession();
    return null;
  }

  return session;
}

function isTokenExpired(token) {
  const parts = token.split(".");
  if (parts.length !== 3) return true;

  try {
    const payloadJson = atob(parts[1].replace(/-/g, "+").replace(/_/g, "/"));
    const payload = JSON.parse(payloadJson);
    return typeof payload.exp !== "number" || Date.now() >= payload.exp * 1000;
  } catch {
    return true;
  }
}

/* ---------------------------------------------------------
   4-1. GFA 데이터 업로드 / 조회
   ---------------------------------------------------------
   두 요청 모두 advertiser-login에서 받은 세션 토큰을 X-Session-Token
   헤더로 보낸다. advertiser_id는 서버가 이 토큰을 검증해서 알아내므로
   프론트엔드에서 advertiser_id를 별도로 보내지 않는다.
   rawType은 "campaign" / "adgroup" / "adv" 중 하나이며, 각각
   gfa_campaign_raw / gfa_adgroup_raw / gfa_adv_raw 테이블에 대응한다.
--------------------------------------------------------- */
async function uploadGfaData(rawType, rows) {
  const session = getSession();
  if (!session) {
    return { success: false, message: "세션이 만료되었습니다. 다시 로그인해주세요." };
  }

  let res;
  try {
    res = await fetch(GFA_UPLOAD_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${SUPABASE_CONFIG.anonKey}`,
        "apikey": SUPABASE_CONFIG.anonKey,
        "X-Session-Token": session.token
      },
      body: JSON.stringify({ raw_type: rawType, rows })
    });
  } catch {
    return { success: false, message: "서버에 연결할 수 없습니다. 잠시 후 다시 시도해주세요." };
  }

  let payload;
  try {
    payload = await res.json();
  } catch {
    return { success: false, message: "서버 응답을 처리할 수 없습니다." };
  }

  if (!res.ok || !payload.success) {
    return { success: false, message: payload.message || "업로드에 실패했습니다." };
  }

  return payload;
}

async function fetchGfaPerformance(rawType, { dateFrom, dateTo, campaign } = {}) {
  const session = getSession();
  if (!session) {
    return { success: false, message: "세션이 만료되었습니다. 다시 로그인해주세요." };
  }

  let res;
  try {
    res = await fetch(GFA_PERFORMANCE_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${SUPABASE_CONFIG.anonKey}`,
        "apikey": SUPABASE_CONFIG.anonKey,
        "X-Session-Token": session.token
      },
      body: JSON.stringify({
        raw_type: rawType,
        date_from: dateFrom,
        date_to: dateTo,
        campaign
      })
    });
  } catch {
    return { success: false, message: "서버에 연결할 수 없습니다. 잠시 후 다시 시도해주세요." };
  }

  let payload;
  try {
    payload = await res.json();
  } catch {
    return { success: false, message: "서버 응답을 처리할 수 없습니다." };
  }

  if (!res.ok || !payload.success) {
    return { success: false, message: payload.message || "데이터를 불러오지 못했습니다." };
  }

  return payload;
}

async function fetchSaPerformance(groupBy, { dateFrom, dateTo } = {}) {
  const session = getSession();
  if (!session) {
    return { success: false, message: "세션이 만료되었습니다. 다시 로그인해주세요." };
  }

  let res;
  try {
    res = await fetch(SA_PERFORMANCE_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${SUPABASE_CONFIG.anonKey}`,
        "apikey": SUPABASE_CONFIG.anonKey,
        "X-Session-Token": session.token
      },
      body: JSON.stringify({
        group_by: groupBy,
        date_from: dateFrom,
        date_to: dateTo
      })
    });
  } catch {
    return { success: false, message: "서버에 연결할 수 없습니다. 잠시 후 다시 시도해주세요." };
  }

  let payload;
  try {
    payload = await res.json();
  } catch {
    return { success: false, message: "서버 응답을 처리할 수 없습니다." };
  }

  if (!res.ok || !payload.success) {
    return { success: false, message: payload.message || "데이터를 불러오지 못했습니다." };
  }

  return payload;
}

/* ---------------------------------------------------------
   5. DOM 참조
--------------------------------------------------------- */
const loginScreen = document.getElementById("loginScreen");
const dashboardScreen = document.getElementById("dashboardScreen");
const loginForm = document.getElementById("loginForm");
const passwordInput = document.getElementById("passwordInput");
const loginError = document.getElementById("loginError");
const loginSubmitBtn = loginForm.querySelector("button[type=submit]");

const sidebar = document.getElementById("sidebar");
const sidebarMenuList = document.getElementById("sidebarMenuList");
const sidebarBackdrop = document.getElementById("sidebarBackdrop");
const menuToggle = document.getElementById("menuToggle");
const channelSwitch = document.getElementById("channelSwitch");
const overviewTitle = document.getElementById("overviewTitle");

const advertiserNameEl = document.getElementById("advertiserName");
const periodLabel = document.getElementById("periodLabel");
const logoutBtn = document.getElementById("logoutBtn");

const kpiGrid = document.getElementById("kpiGrid");
const viewOverview = document.getElementById("view-overview");
const viewPlaceholder = document.getElementById("view-placeholder");
const placeholderTitle = document.getElementById("placeholderTitle");

const viewGrouped = document.getElementById("view-grouped");
const groupedTitle = document.getElementById("groupedTitle");
const groupedNameHeader = document.getElementById("groupedNameHeader");
const groupedTableBody = document.getElementById("groupedTableBody");

const viewUpload = document.getElementById("view-upload");

const viewTrend = document.getElementById("view-trend");
const trendTitle = document.getElementById("trendTitle");

const analysisYearSelect = document.getElementById("analysisYearSelect");
const analysisMonthSelect = document.getElementById("analysisMonthSelect");
const analysisWeekSelect = document.getElementById("analysisWeekSelect");
const analysisDaySelect = document.getElementById("analysisDaySelect");
const analysisConfirmBtn = document.getElementById("analysisConfirmBtn");
const analysisThisMonthBtn = document.getElementById("analysisThisMonthBtn");
const analysisAllYearBtn = document.getElementById("analysisAllYearBtn");
const analysisResetBtn = document.getElementById("analysisResetBtn");

const compareYearSelect = document.getElementById("compareYearSelect");
const compareMonthSelect = document.getElementById("compareMonthSelect");
const compareWeekSelect = document.getElementById("compareWeekSelect");
const compareDaySelect = document.getElementById("compareDaySelect");
const compareConfirmBtn = document.getElementById("compareConfirmBtn");
const compareResetBtn = document.getElementById("compareResetBtn");

const viewModel = document.getElementById("view-model");
const modelCardGrid = document.getElementById("modelCardGrid");
const modelSearchInput = document.getElementById("modelSearchInput");
const modelDetailModal = document.getElementById("modelDetailModal");
const modelDetailCloseBtn = document.getElementById("modelDetailCloseBtn");
const modelDetailBadge = document.getElementById("modelDetailBadge");
const modelDetailTitle = document.getElementById("modelDetailTitle");
const modelDetailPeriodLabel = document.getElementById("modelDetailPeriodLabel");
const modelDetailImpressions = document.getElementById("modelDetailImpressions");
const modelDetailClicks = document.getElementById("modelDetailClicks");
const modelDetailCpc = document.getElementById("modelDetailCpc");
const modelDetailCtr = document.getElementById("modelDetailCtr");
const modelDetailCvr = document.getElementById("modelDetailCvr");
const modelDetailCost = document.getElementById("modelDetailCost");
const modelDetailConversions = document.getElementById("modelDetailConversions");
const modelDetailRevenue = document.getElementById("modelDetailRevenue");
const modelDetailRoas = document.getElementById("modelDetailRoas");
const modelDetailKeywordBody = document.getElementById("modelDetailKeywordBody");

const overviewEmptyNotice = document.getElementById("overviewEmptyNotice");

const campaignTypeSection = document.getElementById("campaignTypeSection");
const campaignTypeFilter = document.getElementById("campaignTypeFilter");
const campaignTypeTableBody = document.getElementById("campaignTypeTableBody");

const breakdownTitle = document.getElementById("breakdownTitle");
const breakdownFilter = document.getElementById("breakdownFilter");
const breakdownTable = document.getElementById("breakdownTable");
const breakdownTableBody = document.getElementById("breakdownTableBody");
const breakdownNameHeader = document.getElementById("breakdownNameHeader");

const state = {
  charts: {},
  currentChannel: "SA",
  currentView: "overview",
  analysisPeriod: null,
  comparisonPeriod: null,
  breakdownRawType: "campaign",
  breakdownRows: [],
  campaignTypeRows: [],
  breakdownSort: { key: "cost", dir: "desc" },
  overviewRenderToken: 0
};

/* ---------------------------------------------------------
   5-1. 분석기간 / 비교기간 유틸
   ---------------------------------------------------------
   비교기간은 분석기간과 같은 길이만큼, 분석기간 바로 직전으로 자동 계산한다.
   (예: 분석기간이 8/1~8/14면 비교기간은 7/18~7/31)
--------------------------------------------------------- */
// toISOString()은 UTC 기준이라, UTC+9(한국)처럼 UTC보다 앞선 시간대에서는
// 자정 근처 날짜가 하루 밀려서 계산될 수 있다. 항상 로컬 날짜 기준으로 뽑는다.
function toISODate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function daysBetweenInclusive(fromStr, toStr) {
  const from = new Date(`${fromStr}T00:00:00`);
  const to = new Date(`${toStr}T00:00:00`);
  return Math.round((to - from) / 86400000) + 1;
}

function defaultAnalysisPeriod() {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 29); // 최근 30일
  return { from: toISODate(from), to: toISODate(to) };
}

function computeComparisonPeriod(fromStr, toStr) {
  const lengthDays = Math.max(daysBetweenInclusive(fromStr, toStr), 1);
  const compareTo = new Date(`${fromStr}T00:00:00`);
  compareTo.setDate(compareTo.getDate() - 1);
  const compareFrom = new Date(compareTo);
  compareFrom.setDate(compareFrom.getDate() - (lengthDays - 1));
  return { from: toISODate(compareFrom), to: toISODate(compareTo) };
}

function formatPeriodRange(period) {
  if (!period) return "-";
  return `${period.from.replace(/-/g, ".")} ~ ${period.to.replace(/-/g, ".")}`;
}

// --- 주별(월 기준 N주차, 월~일) / 월별 선택 -> 실제 from~to 날짜로 변환 ---
// ISO 8601 주차 대신, "그 달 안에서 몇 번째 월~일 구간인가"로 주차를 나눈다.
// 예: 8월 1일이 토요일이면 8/1~8/2(2일뿐)가 1주차, 8/3(월)~8/9가 2주차.
function computeMonthWeeks(year, month) {
  const first = new Date(year, month - 1, 1);
  const last = new Date(year, month, 0);
  const weeks = [];
  let cursor = new Date(first);
  let weekNum = 1;

  while (cursor <= last) {
    const dow = cursor.getDay(); // 0=일 ~ 6=토
    const chunkEnd = new Date(cursor);
    if (dow === 1) {
      chunkEnd.setDate(chunkEnd.getDate() + 6); // 월요일 시작 -> 그 주 일요일까지
    } else {
      const daysUntilMonday = (8 - dow) % 7; // 다음 월요일 전날까지
      chunkEnd.setDate(chunkEnd.getDate() + Math.max(daysUntilMonday - 1, 0));
    }
    if (chunkEnd > last) chunkEnd.setTime(last.getTime());

    weeks.push({ label: `${month}월 ${weekNum}주차`, from: toISODate(cursor), to: toISODate(chunkEnd) });

    cursor = new Date(chunkEnd);
    cursor.setDate(cursor.getDate() + 1);
    weekNum += 1;
  }

  return weeks;
}

function daysInMonthCount(year, month) {
  return new Date(year, month, 0).getDate();
}

// year/fromMonth~toMonth(둘 다 1-12) 범위의 1일부터 말일까지. 그 범위 끝이 아직 안 지난
// 미래 날짜를 포함하면(=오늘이 걸쳐 있는 달이면) 어제까지로 잘라서, 안 끝난 오늘 데이터가
// 섞여 어색하게 보이지 않게 한다.
function monthsToRange(year, fromMonth, toMonth) {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);

  const first = new Date(year, fromMonth - 1, 1);
  const lastOfToMonth = new Date(year, toMonth, 0);
  const end = lastOfToMonth > yesterday ? yesterday : lastOfToMonth;

  return { from: toISODate(first), to: toISODate(end) };
}

function populateYearOptions(selectEl, year) {
  selectEl.innerHTML = [year - 1, year, year + 1].map((y) => `<option value="${y}">${y}년</option>`).join("");
  selectEl.value = String(year);
}

function populateMonthOptions(selectEl, month) {
  selectEl.innerHTML = Array.from({ length: 12 }, (_, i) => i + 1).map((m) => `<option value="${m}">${m}월</option>`).join("");
  selectEl.value = String(month);
}

function populateWeekOptions(selectEl, year, month) {
  const weeks = computeMonthWeeks(year, month);
  selectEl.innerHTML =
    '<option value="">주차별 선택 (선택 안 함 = 월 전체)</option>' +
    weeks.map((w) => `<option value="${w.label}">${w.label}</option>`).join("");
  selectEl.value = "";
}

function populateDayOptions(selectEl, year, month) {
  const days = daysInMonthCount(year, month);
  selectEl.innerHTML =
    '<option value="">일별 선택</option>' +
    Array.from({ length: days }, (_, i) => i + 1).map((d) => `<option value="${d}">${month}월 ${d}일</option>`).join("");
  selectEl.value = "";
}

// 연/월/주차/일 드롭다운의 현재 선택값을 실제 {from, to} 날짜 범위로 바꾼다.
// 일 > 주차 > (둘 다 안 골랐으면) 월 전체 순서로 우선한다.
function readPickerRange(yearSelect, monthSelect, weekSelect, daySelect) {
  const year = Number(yearSelect.value);
  const month = Number(monthSelect.value);
  const day = daySelect.value;
  const weekLabel = weekSelect.value;

  if (day) {
    const d = `${year}-${String(month).padStart(2, "0")}-${String(Number(day)).padStart(2, "0")}`;
    return { from: d, to: d };
  }
  if (weekLabel) {
    const weeks = computeMonthWeeks(year, month);
    const w = weeks.find((w) => w.label === weekLabel);
    if (w) return { from: w.from, to: w.to };
  }
  return monthsToRange(year, month, month);
}

function setPickerToMonth(yearSelect, monthSelect, weekSelect, daySelect, year, month) {
  populateYearOptions(yearSelect, year);
  populateMonthOptions(monthSelect, month);
  populateWeekOptions(weekSelect, year, month);
  populateDayOptions(daySelect, year, month);
}

/* ---------------------------------------------------------
   6. 로그인 / 로그아웃
--------------------------------------------------------- */
loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const password = passwordInput.value;

  loginError.hidden = true;
  loginSubmitBtn.disabled = true;
  const originalLabel = loginSubmitBtn.textContent;
  loginSubmitBtn.textContent = "확인 중...";

  const result = await authenticateAdvertiser(password);
  console.debug("[login] result:", result);

  loginSubmitBtn.disabled = false;
  loginSubmitBtn.textContent = originalLabel;

  if (result.success) {
    passwordInput.value = "";
    showDashboard(result.advertiser);
  } else {
    loginError.textContent = result.message;
    loginError.hidden = false;
    console.debug("[login] loginError state:", {
      textContent: loginError.textContent,
      hidden: loginError.hidden,
      computedDisplay: getComputedStyle(loginError).display
    });
  }
});

logoutBtn.addEventListener("click", () => {
  clearSession();
  dashboardScreen.hidden = true;
  loginScreen.hidden = false;
  loginError.hidden = true;
  passwordInput.value = "";
  passwordInput.focus();
});

function showDashboard(advertiser) {
  loginScreen.hidden = true;
  dashboardScreen.hidden = false;

  advertiserNameEl.textContent = advertiser.name;

  state.analysisPeriod = defaultAnalysisPeriod();
  state.comparisonPeriod = computeComparisonPeriod(state.analysisPeriod.from, state.analysisPeriod.to);

  const today = new Date();
  setPickerToMonth(analysisYearSelect, analysisMonthSelect, analysisWeekSelect, analysisDaySelect, today.getFullYear(), today.getMonth() + 1);
  const compareDate = new Date(`${state.comparisonPeriod.from}T00:00:00`);
  setPickerToMonth(compareYearSelect, compareMonthSelect, compareWeekSelect, compareDaySelect, compareDate.getFullYear(), compareDate.getMonth() + 1);

  applyChannelVisibility();
  renderSidebarMenu();
  switchView("overview");
}

function refreshCurrentPeriodView() {
  if (state.currentView === "overview") {
    renderOverview();
  } else if (state.currentView === "trend") {
    renderTrendView();
  }
}

/* ---------------------------------------------------------
   6-0. 분석기간 / 비교기간 선택 - 연도 → 월 → (선택)주차 → (선택)일
   ---------------------------------------------------------
   드롭다운을 고르는 것만으로는 바로 조회하지 않고, "확인"을 눌러야
   실제로 반영된다 (고를 때마다 매번 다시 불러오면 느려지기 때문).
   주차와 일은 서로 배타적이다 - 하나를 고르면 다른 하나는 비워진다.
   둘 다 안 고르면 그 달 전체가 기간이 된다.
--------------------------------------------------------- */
function onPickerMonthChange(yearSelect, monthSelect, weekSelect, daySelect) {
  const year = Number(yearSelect.value);
  const month = Number(monthSelect.value);
  populateWeekOptions(weekSelect, year, month);
  populateDayOptions(daySelect, year, month);
}

analysisYearSelect.addEventListener("change", () =>
  onPickerMonthChange(analysisYearSelect, analysisMonthSelect, analysisWeekSelect, analysisDaySelect)
);
analysisMonthSelect.addEventListener("change", () =>
  onPickerMonthChange(analysisYearSelect, analysisMonthSelect, analysisWeekSelect, analysisDaySelect)
);
analysisWeekSelect.addEventListener("change", () => {
  if (analysisWeekSelect.value) analysisDaySelect.value = "";
});
analysisDaySelect.addEventListener("change", () => {
  if (analysisDaySelect.value) analysisWeekSelect.value = "";
});
analysisConfirmBtn.addEventListener("click", () => {
  state.analysisPeriod = readPickerRange(analysisYearSelect, analysisMonthSelect, analysisWeekSelect, analysisDaySelect);
  refreshCurrentPeriodView();
});

compareYearSelect.addEventListener("change", () =>
  onPickerMonthChange(compareYearSelect, compareMonthSelect, compareWeekSelect, compareDaySelect)
);
compareMonthSelect.addEventListener("change", () =>
  onPickerMonthChange(compareYearSelect, compareMonthSelect, compareWeekSelect, compareDaySelect)
);
compareWeekSelect.addEventListener("change", () => {
  if (compareWeekSelect.value) compareDaySelect.value = "";
});
compareDaySelect.addEventListener("change", () => {
  if (compareDaySelect.value) compareWeekSelect.value = "";
});
compareConfirmBtn.addEventListener("click", () => {
  state.comparisonPeriod = readPickerRange(compareYearSelect, compareMonthSelect, compareWeekSelect, compareDaySelect);
  refreshCurrentPeriodView();
});

// 분석기간 바로가기: 이번달 보기 / 전체 선택(연도 전체) / 전체 해제(이번달로 되돌리기)
analysisThisMonthBtn.addEventListener("click", () => {
  const now = new Date();
  setPickerToMonth(analysisYearSelect, analysisMonthSelect, analysisWeekSelect, analysisDaySelect, now.getFullYear(), now.getMonth() + 1);
  state.analysisPeriod = monthsToRange(now.getFullYear(), now.getMonth() + 1, now.getMonth() + 1);
  refreshCurrentPeriodView();
});
analysisAllYearBtn.addEventListener("click", () => {
  const year = Number(analysisYearSelect.value);
  state.analysisPeriod = monthsToRange(year, 1, 12);
  refreshCurrentPeriodView();
});
analysisResetBtn.addEventListener("click", () => {
  const now = new Date();
  setPickerToMonth(analysisYearSelect, analysisMonthSelect, analysisWeekSelect, analysisDaySelect, now.getFullYear(), now.getMonth() + 1);
  state.analysisPeriod = monthsToRange(now.getFullYear(), now.getMonth() + 1, now.getMonth() + 1);
  refreshCurrentPeriodView();
});

// 비교기간 초기화: 분석기간 기준으로 자동 계산한 "직전 같은 길이" 기간으로 되돌린다.
compareResetBtn.addEventListener("click", () => {
  state.comparisonPeriod = computeComparisonPeriod(state.analysisPeriod.from, state.analysisPeriod.to);
  const d = new Date(`${state.comparisonPeriod.from}T00:00:00`);
  setPickerToMonth(compareYearSelect, compareMonthSelect, compareWeekSelect, compareDaySelect, d.getFullYear(), d.getMonth() + 1);
  refreshCurrentPeriodView();
});

/* ---------------------------------------------------------
   6-1. 채널(SA / GFA) 전환
--------------------------------------------------------- */
// ADVoost 쇼핑은 GFA 전용 - SA에서는 탭 자체를 숨기고, 그 탭이 선택된
// 상태로 SA로 넘어왔으면 캠페인별로 되돌린다. 채널 전환 시뿐 아니라
// 최초 로그인 시(SA가 기본값)에도 반영되어야 하므로 함수로 분리한다.
function applyChannelVisibility() {
  const isGfa = state.currentChannel === "GFA";
  breakdownFilter.querySelectorAll(".gfa-only-tab").forEach((btn) => {
    btn.hidden = !isGfa;
  });
  if (!isGfa && state.breakdownRawType === "adv") {
    state.breakdownRawType = "campaign";
    breakdownFilter.querySelectorAll(".breakdown-filter-btn").forEach((b) => {
      b.classList.toggle("active", b.dataset.rawType === "campaign");
    });
    breakdownTitle.textContent = "캠페인별 성과";
  }
  state.breakdownSort = { key: "cost", dir: "desc" };
}

channelSwitch.addEventListener("click", (e) => {
  const tab = e.target.closest(".channel-tab");
  if (!tab || tab.classList.contains("active")) return;

  state.currentChannel = tab.dataset.channel;

  channelSwitch.querySelectorAll(".channel-tab").forEach((btn) => {
    const isActive = btn === tab;
    btn.classList.toggle("active", isActive);
    btn.setAttribute("aria-selected", String(isActive));
  });

  applyChannelVisibility();

  renderSidebarMenu();
  renderCurrentView();
});

async function renderOverview() {
  overviewTitle.textContent = `${CHANNEL_LABELS[state.currentChannel]} 성과 대시보드`;
  periodLabel.textContent = formatPeriodRange(state.analysisPeriod);
  breakdownNameHeader.textContent = GFA_RAW_TYPE_NAME_LABEL[state.breakdownRawType] || "이름";

  // 캠페인 유형별(파워링크/쇼핑검색/브랜드검색)은 SA 전용 섹션이라 GFA에서는 숨긴다.
  campaignTypeSection.hidden = state.currentChannel !== "SA";

  if (state.currentChannel === "GFA") {
    await renderGfaOverview();
  } else {
    await renderSaOverview();
  }
}

/* ---------------------------------------------------------
   6-1a. SA 성과 대시보드 - 실데이터 (sa-sync가 매일 동기화해둔 sa_campaign_daily 기준)
   ---------------------------------------------------------
   광고그룹(그룹별) 단위는 아직 범위 밖이라, 그 탭을 고르면 계속 안내 문구가 나온다.
--------------------------------------------------------- */
async function renderSaOverview() {
  const token = ++state.overviewRenderToken;
  const { from, to } = state.analysisPeriod;
  const { from: compareFrom, to: compareTo } = state.comparisonPeriod;

  const [currentResult, comparisonResult] = await Promise.all([
    fetchSaPerformance("type", { dateFrom: from, dateTo: to }),
    fetchSaPerformance("type", { dateFrom: compareFrom, dateTo: compareTo })
  ]);

  if (token !== state.overviewRenderToken) return;

  if (!currentResult.success) {
    overviewEmptyNotice.hidden = false;
    overviewEmptyNotice.textContent = currentResult.message;
    renderKpiCards(withDerivedMetrics({ impressions: 0, clicks: 0, cost: 0, conversions: 0, revenue: 0 }), null);
    state.campaignTypeRows = [];
    renderCampaignTypeRows();
    state.breakdownRows = [];
    breakdownTableBody.innerHTML = `<tr><td colspan="9" class="grouped-empty">${escapeHtml(currentResult.message)}</td></tr>`;
    return;
  }

  const currentTotals = sumRawTotals(currentResult.rows);
  const comparisonTotals = comparisonResult.success ? sumRawTotals(comparisonResult.rows) : null;
  const hasData = currentResult.rows.length > 0;

  overviewEmptyNotice.hidden = hasData;
  if (!hasData) {
    overviewEmptyNotice.textContent =
      "표시할 데이터가 없습니다. 네이버 SA 자동 동기화가 아직 실행되지 않았거나, 선택한 기간에 데이터가 없습니다.";
  }

  renderKpiCards(
    withDerivedMetrics(currentTotals),
    comparisonTotals ? withDerivedMetrics(comparisonTotals) : null
  );

  state.campaignTypeRows = currentResult.rows;
  renderCampaignTypeRows();

  if (state.breakdownRawType === "campaign") {
    await loadSaBreakdownData();
  } else {
    renderSaBreakdownPlaceholder();
  }
}

/* ---------------------------------------------------------
   6-1b. 캠페인 유형별 성과 (SA 전용: 파워링크 / 쇼핑검색 / 브랜드검색)
--------------------------------------------------------- */
campaignTypeFilter.addEventListener("click", (e) => {
  const btn = e.target.closest(".breakdown-filter-btn");
  if (!btn || btn.classList.contains("active")) return;

  campaignTypeFilter.querySelectorAll(".breakdown-filter-btn").forEach((b) => b.classList.toggle("active", b === btn));
  renderCampaignTypeRows();
});

function renderCampaignTypeRows() {
  const activeBtn = campaignTypeFilter.querySelector(".breakdown-filter-btn.active");
  const key = activeBtn ? activeBtn.dataset.campaignType : "powerlink";
  const naverType = SA_CAMPAIGN_TYPE_TO_NAVER[key];
  const row = state.campaignTypeRows.find((r) => r.name === naverType);
  const label = activeBtn ? activeBtn.textContent : "";

  if (!row) {
    campaignTypeTableBody.innerHTML =
      '<tr><td colspan="9" class="grouped-empty">이 기간에 해당 유형 데이터가 없습니다.</td></tr>';
    return;
  }

  campaignTypeTableBody.innerHTML = `
    <tr>
      <td>${escapeHtml(label)}</td>
      <td>${formatWon(row.cost)}</td>
      <td>${formatWon(row.revenue)}</td>
      <td>${row.roas}%</td>
      <td>${formatNumber(row.clicks)}</td>
      <td>${row.ctr.toFixed(2)}%</td>
      <td>${formatNumber(row.conversions)}</td>
      <td>${row.cvr.toFixed(2)}%</td>
      <td>${formatWon(row.cpa)}</td>
    </tr>
  `;
}

/* ---------------------------------------------------------
   6-2. GFA 성과 대시보드 - 실데이터 (분석기간/비교기간 기준)
--------------------------------------------------------- */
function sumRawTotals(rows) {
  const totals = { impressions: 0, clicks: 0, cost: 0, conversions: 0, revenue: 0 };
  rows.forEach((row) => {
    totals.impressions += row.impressions;
    totals.clicks += row.clicks;
    totals.cost += row.cost;
    totals.conversions += row.conversions;
    totals.revenue += row.revenue;
  });
  return totals;
}

async function renderGfaOverview() {
  const token = ++state.overviewRenderToken;
  const { from, to } = state.analysisPeriod;
  const { from: compareFrom, to: compareTo } = state.comparisonPeriod;

  const [currentResult, comparisonResult] = await Promise.all([
    fetchGfaPerformance("campaign", { dateFrom: from, dateTo: to }),
    fetchGfaPerformance("campaign", { dateFrom: compareFrom, dateTo: compareTo })
  ]);

  if (token !== state.overviewRenderToken) return; // 그 사이 다른 요청으로 대체됨

  if (!currentResult.success) {
    overviewEmptyNotice.hidden = false;
    overviewEmptyNotice.textContent = currentResult.message;
    renderKpiCards(withDerivedMetrics({ impressions: 0, clicks: 0, cost: 0, conversions: 0, revenue: 0 }), null);
    state.breakdownRows = [];
    breakdownTableBody.innerHTML = `<tr><td colspan="9" class="grouped-empty">${escapeHtml(currentResult.message)}</td></tr>`;
    return;
  }

  const currentTotals = sumRawTotals(currentResult.rows);
  const comparisonTotals = comparisonResult.success ? sumRawTotals(comparisonResult.rows) : null;
  const hasData = currentResult.rows.length > 0;

  overviewEmptyNotice.hidden = hasData;
  if (!hasData) {
    overviewEmptyNotice.textContent =
      '표시할 데이터가 없습니다. GFA는 "데이터 업로드" 메뉴에서 CSV를 먼저 업로드해주세요.';
  }

  renderKpiCards(
    withDerivedMetrics(currentTotals),
    comparisonTotals ? withDerivedMetrics(comparisonTotals) : null
  );

  await loadBreakdownData();
}

/* ---------------------------------------------------------
   6-3. 캠페인별 / 그룹별 / ADVoost 쇼핑 필터 (성과 대시보드 하단)
   ---------------------------------------------------------
   세 카테고리를 표 2개로 나란히 보여주던 이전 방식 대신, 필터 탭
   하나로 캠페인별/그룹별/ADVoost 쇼핑(상품별)을 전환한다. 컬럼 헤더를
   클릭하면 그 지표 기준으로 오름차순/내림차순 정렬된다.
--------------------------------------------------------- */
breakdownFilter.addEventListener("click", (e) => {
  const btn = e.target.closest(".breakdown-filter-btn");
  if (!btn || btn.classList.contains("active")) return;

  state.breakdownRawType = btn.dataset.rawType;
  breakdownFilter.querySelectorAll(".breakdown-filter-btn").forEach((b) => b.classList.toggle("active", b === btn));
  breakdownTitle.textContent = `${btn.textContent} 성과`;
  breakdownNameHeader.textContent = GFA_RAW_TYPE_NAME_LABEL[state.breakdownRawType] || "이름";
  state.breakdownSort = { key: "cost", dir: "desc" };

  if (state.currentChannel === "GFA") {
    loadBreakdownData();
  } else if (state.breakdownRawType === "campaign") {
    loadSaBreakdownData();
  } else {
    renderSaBreakdownPlaceholder();
  }
});

breakdownTable.querySelector("thead").addEventListener("click", (e) => {
  const th = e.target.closest("th.sortable");
  if (!th) return;

  const key = th.dataset.sortKey;
  if (state.breakdownSort.key === key) {
    state.breakdownSort.dir = state.breakdownSort.dir === "desc" ? "asc" : "desc";
  } else {
    state.breakdownSort = { key, dir: key === "name" ? "asc" : "desc" };
  }
  renderBreakdownRows();
});

async function loadBreakdownData() {
  const token = ++state.overviewRenderToken;
  breakdownTableBody.innerHTML = '<tr><td colspan="9" class="grouped-empty">불러오는 중...</td></tr>';

  const result = await fetchGfaPerformance(state.breakdownRawType, {
    dateFrom: state.analysisPeriod.from,
    dateTo: state.analysisPeriod.to
  });

  if (token !== state.overviewRenderToken) return;

  if (!result.success) {
    state.breakdownRows = [];
    breakdownTableBody.innerHTML = `<tr><td colspan="9" class="grouped-empty">${escapeHtml(result.message)}</td></tr>`;
    updateSortIndicators();
    return;
  }

  state.breakdownRows = result.rows;
  renderBreakdownRows();
}

async function loadSaBreakdownData() {
  const token = ++state.overviewRenderToken;
  breakdownTableBody.innerHTML = '<tr><td colspan="9" class="grouped-empty">불러오는 중...</td></tr>';

  const result = await fetchSaPerformance("campaign", {
    dateFrom: state.analysisPeriod.from,
    dateTo: state.analysisPeriod.to
  });

  if (token !== state.overviewRenderToken) return;

  if (!result.success) {
    state.breakdownRows = [];
    breakdownTableBody.innerHTML = `<tr><td colspan="9" class="grouped-empty">${escapeHtml(result.message)}</td></tr>`;
    updateSortIndicators();
    return;
  }

  state.breakdownRows = result.rows;
  renderBreakdownRows();
}

// 그룹별(광고그룹) 단위는 아직 범위 밖이라 안내 문구만 보여준다.
function renderSaBreakdownPlaceholder() {
  state.breakdownRows = [];
  breakdownTableBody.innerHTML =
    '<tr><td colspan="9" class="grouped-empty">광고그룹별 데이터는 다음 업데이트에서 제공될 예정입니다.</td></tr>';
  updateSortIndicators();
}

/* ---------------------------------------------------------
   6-2. SA 상품별(모델별) 성과 뷰 - 도넛/막대+선 차트 + 모델 카드 + 키워드 모달
--------------------------------------------------------- */
function renderSaModelView() {
  const models = SA_MODEL_MOCK.map((m) => ({ ...m, ...withDerivedMetrics(m) }));
  const top5 = [...models].sort((a, b) => b.revenue - a.revenue).slice(0, 5);

  renderModelDonutChart(top5);
  renderModelCvrRoasChart(top5);
  modelSearchInput.value = "";
  renderModelCardGrid(models);
}

function renderModelDonutChart(top5) {
  destroyChart("modelDonut");
  const colors = ["#2563eb", "#38bdf8", "#22c55e", "#f59e0b", "#a855f7"];
  state.charts.modelDonut = new Chart(document.getElementById("modelRevenueDonutChart"), {
    type: "doughnut",
    data: {
      labels: top5.map((m) => m.model),
      datasets: [{ data: top5.map((m) => m.revenue), backgroundColor: colors, borderWidth: 0 }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: "right", labels: { boxWidth: 12, font: { size: 12 } } },
        tooltip: { callbacks: { label: (ctx) => ` ${ctx.label}: ${formatWon(ctx.parsed)}` } }
      }
    }
  });
}

function renderModelCvrRoasChart(top5) {
  destroyChart("modelCvrRoas");
  state.charts.modelCvrRoas = new Chart(document.getElementById("modelCvrRoasChart"), {
    data: {
      labels: top5.map((m) => m.model),
      datasets: [
        {
          type: "bar",
          label: "전환율(CVR) %",
          data: top5.map((m) => Number(m.cvr.toFixed(1))),
          backgroundColor: "#2563eb",
          yAxisID: "y"
        },
        {
          type: "line",
          label: "ROAS (천%)",
          data: top5.map((m) => Number((m.roas / 1000).toFixed(1))),
          borderColor: "#ef4444",
          backgroundColor: "#ef4444",
          yAxisID: "y1",
          tension: 0.3
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: "top", labels: { boxWidth: 12, font: { size: 11 } } } },
      scales: {
        y: { position: "left", title: { display: true, text: "CVR (%)" }, grid: { color: "rgba(0,0,0,0.05)" } },
        y1: { position: "right", title: { display: true, text: "ROAS (천%)" }, grid: { drawOnChartArea: false } }
      }
    }
  });
}

function renderModelCardGrid(models) {
  const q = modelSearchInput.value.trim().toLowerCase();
  const filtered = q
    ? models.filter((m) => m.model.toLowerCase().includes(q) || m.category.toLowerCase().includes(q))
    : models;

  if (filtered.length === 0) {
    modelCardGrid.innerHTML = '<p class="grouped-empty">검색 결과가 없습니다.</p>';
    return;
  }

  modelCardGrid.innerHTML = filtered
    .map((m) => {
      const badgeClass = MODEL_BADGE_COLORS[m.category] || "badge-blue";
      const idx = SA_MODEL_MOCK.findIndex((x) => x.model === m.model);
      return `
        <div class="model-card" data-model-index="${idx}">
          <div class="model-card-top">
            <span class="model-card-name">${escapeHtml(m.model)}</span>
            <span class="model-badge ${badgeClass}">${escapeHtml(m.category)}</span>
          </div>
          <div class="model-card-metrics">
            <div><span class="model-metric-label">노출수</span><span class="model-metric-value">${formatNumber(m.impressions)}</span></div>
            <div><span class="model-metric-label">클릭수</span><span class="model-metric-value">${formatNumber(m.clicks)}</span></div>
            <div><span class="model-metric-label">총비용</span><span class="model-metric-value">${formatWon(m.cost)}</span></div>
            <div><span class="model-metric-label">전환수</span><span class="model-metric-value">${formatNumber(m.conversions)}건</span></div>
          </div>
          <div class="model-card-bottom">
            <div><span class="model-metric-label">총매출</span><span class="model-metric-value strong">${formatWon(m.revenue)}</span></div>
            <div class="model-card-bottom-right">
              <span class="model-metric-label">CVR ${formatPercent(m.cvr)}</span>
              <span class="model-metric-value accent">ROAS ${formatPercent(m.roas)}</span>
            </div>
          </div>
        </div>
      `;
    })
    .join("");
}

modelCardGrid.addEventListener("click", (e) => {
  const card = e.target.closest(".model-card");
  if (!card) return;
  const model = SA_MODEL_MOCK[Number(card.dataset.modelIndex)];
  if (model) openModelDetailModal(model);
});

modelSearchInput.addEventListener("input", () => {
  const models = SA_MODEL_MOCK.map((m) => ({ ...m, ...withDerivedMetrics(m) }));
  renderModelCardGrid(models);
});

function openModelDetailModal(model) {
  const d = withDerivedMetrics(model);
  const badgeClass = MODEL_BADGE_COLORS[model.category] || "badge-blue";

  modelDetailBadge.className = `model-badge ${badgeClass}`;
  modelDetailBadge.textContent = model.category;
  modelDetailTitle.textContent = model.model;
  modelDetailPeriodLabel.textContent = state.analysisPeriod ? formatPeriodRange(state.analysisPeriod) : "";

  modelDetailImpressions.textContent = formatNumber(d.impressions);
  modelDetailClicks.textContent = formatNumber(d.clicks);
  modelDetailCpc.textContent = formatWon(d.cpc);
  modelDetailCtr.textContent = formatPercent(d.ctr);
  modelDetailCvr.textContent = formatPercent(d.cvr);

  modelDetailCost.textContent = formatWon(d.cost);
  modelDetailConversions.textContent = `${formatNumber(d.conversions)}건`;
  modelDetailRevenue.textContent = formatWon(d.revenue);
  modelDetailRoas.textContent = formatPercent(d.roas);

  modelDetailKeywordBody.innerHTML = (model.keywords || [])
    .map(
      (k) => `
        <tr>
          <td>${escapeHtml(k.keyword)}</td>
          <td>${formatNumber(k.impressions)}</td>
          <td>${formatNumber(k.clicks)}</td>
          <td>${formatWon(k.cost)}</td>
          <td>${formatNumber(k.conversions)}</td>
          <td>${formatWon(k.revenue)}</td>
        </tr>
      `
    )
    .join("");

  modelDetailModal.hidden = false;
}

function closeModelDetailModal() {
  modelDetailModal.hidden = true;
}

modelDetailCloseBtn.addEventListener("click", closeModelDetailModal);
modelDetailModal.addEventListener("click", (e) => {
  if (e.target === modelDetailModal) closeModelDetailModal();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !modelDetailModal.hidden) closeModelDetailModal();
});

function renderBreakdownRows() {
  updateSortIndicators();

  if (state.breakdownRows.length === 0) {
    breakdownTableBody.innerHTML =
      '<tr><td colspan="9" class="grouped-empty">이 기간에 업로드된 데이터가 없습니다.</td></tr>';
    return;
  }

  const { key, dir } = state.breakdownSort;
  const sorted = [...state.breakdownRows].sort((a, b) => {
    const cmp = key === "name" ? String(a.name).localeCompare(String(b.name), "ko") : a[key] - b[key];
    return dir === "asc" ? cmp : -cmp;
  });

  breakdownTableBody.innerHTML = sorted
    .map(
      (row) => `
        <tr>
          <td>${escapeHtml(row.name)}</td>
          <td>${formatWon(row.cost)}</td>
          <td>${formatWon(row.revenue)}</td>
          <td>${row.roas}%</td>
          <td>${formatNumber(row.clicks)}</td>
          <td>${row.ctr.toFixed(2)}%</td>
          <td>${formatNumber(row.conversions)}</td>
          <td>${row.cvr.toFixed(2)}%</td>
          <td>${formatWon(row.cpa)}</td>
        </tr>
      `
    )
    .join("");
}

function updateSortIndicators() {
  breakdownTable.querySelectorAll("th.sortable").forEach((th) => {
    const isSorted = th.dataset.sortKey === state.breakdownSort.key;
    th.classList.toggle("sorted", isSorted);
    let arrow = th.querySelector(".sort-arrow");
    if (!arrow) {
      arrow = document.createElement("span");
      arrow.className = "sort-arrow";
      th.appendChild(arrow);
    }
    arrow.textContent = isSorted && state.breakdownSort.dir === "asc" ? "▲" : "▼";
  });
}

/* ---------------------------------------------------------
   6-4. 그래프 추이 (SA/GFA 공통, 분석기간 총합 기준)
--------------------------------------------------------- */
async function renderTrendView() {
  trendTitle.textContent = `${CHANNEL_LABELS[state.currentChannel]} 그래프 추이`;

  const token = ++state.overviewRenderToken;
  const result =
    state.currentChannel === "GFA"
      ? await fetchGfaPerformance("campaign", { dateFrom: state.analysisPeriod.from, dateTo: state.analysisPeriod.to })
      : await fetchSaPerformance("campaign", { dateFrom: state.analysisPeriod.from, dateTo: state.analysisPeriod.to });

  if (token !== state.overviewRenderToken) return;

  const totals = result.success ? sumRawTotals(result.rows) : { cost: 0, revenue: 0 };
  renderCharts(totals);
}

/* ---------------------------------------------------------
   7. 사이드바 메뉴 렌더링 / 뷰 전환
--------------------------------------------------------- */
function renderSidebarMenu() {
  sidebarMenuList.innerHTML = "";

  MENU_ITEMS.forEach((item) => {
    if (!item.channels.includes(state.currentChannel)) return;

    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.className = "sidebar-menu-item";
    btn.dataset.viewId = item.id;
    btn.innerHTML = `<span class="menu-icon"></span><span>${item.label}</span>`;
    btn.addEventListener("click", () => {
      switchView(item.id);
      closeSidebarOnMobile();
    });
    li.appendChild(btn);
    sidebarMenuList.appendChild(li);
  });
}

function switchView(viewId) {
  state.currentView = viewId;
  renderCurrentView();
}

function renderCurrentView() {
  let item = MENU_ITEMS.find((m) => m.id === state.currentView);

  // 지금 채널의 사이드바에 없는 메뉴면(예: SA에서 GFA 전용 메뉴) 성과 대시보드로 되돌린다.
  if (!item || !item.channels.includes(state.currentChannel)) {
    item = MENU_ITEMS[0];
    state.currentView = item.id;
  }

  document
    .querySelectorAll(".sidebar-menu-item")
    .forEach((btn) => btn.classList.toggle("active", btn.dataset.viewId === item.id));

  viewOverview.hidden = true;
  viewTrend.hidden = true;
  viewModel.hidden = true;
  viewGrouped.hidden = true;
  viewUpload.hidden = true;
  viewPlaceholder.hidden = true;

  const isGfa = state.currentChannel === "GFA";

  if (item.id === "overview") {
    viewOverview.hidden = false;
    renderOverview();
  } else if (item.id === "trend") {
    viewTrend.hidden = false;
    renderTrendView();
  } else if (item.id === "upload") {
    viewUpload.hidden = false;
  } else if (item.id === "product" && !isGfa) {
    viewModel.hidden = false;
    renderSaModelView();
  } else if (item.gfaRawType && isGfa) {
    viewGrouped.hidden = false;
    renderGroupedPerformance(item);
  } else {
    viewPlaceholder.hidden = false;
    placeholderTitle.textContent = item.label;
  }
}

function closeSidebarOnMobile() {
  sidebar.classList.remove("open");
}

menuToggle.addEventListener("click", () => sidebar.classList.toggle("open"));
sidebarBackdrop.addEventListener("click", () => sidebar.classList.remove("open"));

/* ---------------------------------------------------------
   7-1. GFA 그룹별 성과 (캠페인별 / 광고그룹별 / 상품별 공용)
--------------------------------------------------------- */
async function renderGroupedPerformance(item) {
  groupedTitle.textContent = `GFA ${item.label}`;
  groupedNameHeader.textContent = GFA_RAW_TYPE_NAME_LABEL[item.gfaRawType] || "이름";
  groupedTableBody.innerHTML = `<tr><td colspan="9" class="grouped-empty">불러오는 중...</td></tr>`;

  const result = await fetchGfaPerformance(item.gfaRawType);

  // 그 사이에 다른 메뉴로 이동했다면 낡은 응답으로 화면을 덮어쓰지 않는다.
  if (state.currentView !== item.id || state.currentChannel !== "GFA") return;

  if (!result.success) {
    groupedTableBody.innerHTML = `<tr><td colspan="9" class="grouped-empty">${escapeHtml(result.message)}</td></tr>`;
    return;
  }

  if (result.rows.length === 0) {
    groupedTableBody.innerHTML =
      `<tr><td colspan="9" class="grouped-empty">업로드된 GFA 데이터가 없습니다. "데이터 업로드" 메뉴에서 먼저 업로드해주세요.</td></tr>`;
    return;
  }

  groupedTableBody.innerHTML = result.rows
    .map(
      (row) => `
        <tr>
          <td>${escapeHtml(row.name)}</td>
          <td>${formatWon(row.cost)}</td>
          <td>${formatWon(row.revenue)}</td>
          <td>${row.roas}%</td>
          <td>${formatNumber(row.clicks)}</td>
          <td>${row.ctr.toFixed(2)}%</td>
          <td>${formatNumber(row.conversions)}</td>
          <td>${row.cvr.toFixed(2)}%</td>
          <td>${formatWon(row.cpa)}</td>
        </tr>
      `
    )
    .join("");
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

/* ---------------------------------------------------------
   7-2. GFA 데이터 업로드 (CSV, raw_type별 3개 폼)
   ---------------------------------------------------------
   네이버 GFA에서 그대로 다운로드한 리포트는 헤더가 한글이고
   ("캠페인 이름", "노출수", "총비용", "구매완료 수", "구매완료 전환매출액" 등),
   전환/매출 관련 컬럼도 여러 종류(총 전환수, 구매완료 수, 회원가입 수...)가
   같이 들어있다. 우리는 그중 "구매완료" 기준만 쓰기로 했으므로, 아래
   GFA_RAW_TYPE_HEADER_ALIASES에서 내부 필드(date/campaign/...)마다
   실제로 올 수 있는 헤더 이름 후보들을 등록해두고, 업로드된 CSV 헤더에서
   그중 하나라도 찾아서 매칭한다. 우리가 만든 템플릿(date, campaign, ...
   영문 헤더)도 계속 지원한다.
--------------------------------------------------------- */
const GFA_RAW_TYPE_COLUMNS = {
  campaign: ["date", "campaign", "impressions", "clicks", "cost", "conversions", "revenue"],
  adgroup: ["date", "campaign", "ad_group", "impressions", "clicks", "cost", "conversions", "revenue"],
  adv: ["date", "product", "impressions", "clicks", "cost", "conversions", "revenue"]
};

// 내부 필드명 -> 실제 CSV에 올 수 있는 헤더 이름 후보 (전부 소문자/trim 비교)
const GFA_HEADER_ALIASES = {
  date: ["date", "기간", "날짜", "일자"],
  campaign: ["campaign", "캠페인 이름", "캠페인명"],
  ad_group: ["ad_group", "광고 그룹 이름", "광고그룹 이름", "광고그룹명"],
  product: ["product", "상품명", "상품 이름"],
  impressions: ["impressions", "노출수"],
  clicks: ["clicks", "클릭수"],
  cost: ["cost", "총비용", "비용"],
  // 전환/매출은 종류가 여러 개(총 전환수, 회원가입 수 등) 나오는데
  // "구매완료" 기준만 쓴다.
  conversions: ["conversions", "구매완료 수", "구매완료수"],
  revenue: ["revenue", "구매완료 전환매출액", "구매완료 매출액", "구매완료전환매출액"]
};

const GFA_RAW_TYPE_TEMPLATE_CSV = {
  campaign:
    "date,campaign,impressions,clicks,cost,conversions,revenue\n" +
    "2026-08-01,여름신상프로모션,15200,320,540000,18,3200000\n",
  adgroup:
    "date,campaign,ad_group,impressions,clicks,cost,conversions,revenue\n" +
    "2026-08-01,여름신상프로모션,배너그룹A,15200,320,540000,18,3200000\n",
  adv:
    "date,product,impressions,clicks,cost,conversions,revenue\n" +
    "2026-08-01,ADVoost,15200,320,540000,18,3200000\n"
};

const GFA_MAX_UPLOAD_ROWS = 20000;
const GFA_NUMERIC_FIELDS = ["impressions", "clicks", "cost", "conversions", "revenue"];

function splitCsvLine(line) {
  const cells = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      cells.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  cells.push(current);
  return cells;
}

// "2026.08.17." / "2026.08.17. ~ 2026.08.31." (네이버 "기간" 컬럼) -> "2026-08-17"
// 이미 "2026-08-17" 형식이면 그대로 둔다. 범위로 나오면 시작일을 쓴다.
function normalizeGfaDate(raw) {
  const trimmed = String(raw ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;

  const match = trimmed.match(/(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.?/);
  if (match) {
    const [, y, m, d] = match;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  return trimmed;
}

function toGfaNumber(raw) {
  const cleaned = String(raw ?? "").replace(/,/g, "").trim();
  return cleaned === "" ? 0 : Number(cleaned);
}

// header(첫 줄) 안에서 후보 이름들 중 하나라도 있는 컬럼의 인덱스를 찾는다.
function findColumnIndex(header, aliases) {
  for (const alias of aliases) {
    const idx = header.indexOf(alias.trim().toLowerCase());
    if (idx !== -1) return idx;
  }
  return -1;
}

function parseGfaCsv(text, requiredColumns) {
  const lines = text.split(/\r\n|\n|\r/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) {
    throw new Error("업로드할 데이터가 없습니다 (헤더 다음 줄부터 데이터가 있어야 합니다).");
  }

  const header = splitCsvLine(lines[0]).map((h) => h.trim().toLowerCase());

  const columnIndex = {};
  const missing = [];
  requiredColumns.forEach((field) => {
    const idx = findColumnIndex(header, GFA_HEADER_ALIASES[field] || [field]);
    if (idx === -1) {
      missing.push((GFA_HEADER_ALIASES[field] || [field])[0]);
    } else {
      columnIndex[field] = idx;
    }
  });

  if (missing.length > 0) {
    throw new Error(`CSV에서 다음 컬럼을 찾지 못했습니다: ${missing.join(", ")}`);
  }

  return lines.slice(1).map((line) => {
    const cells = splitCsvLine(line);
    const row = {};

    requiredColumns.forEach((field) => {
      const cellValue = (cells[columnIndex[field]] ?? "").trim();
      if (field === "date") {
        row.date = normalizeGfaDate(cellValue);
      } else if (GFA_NUMERIC_FIELDS.includes(field)) {
        row[field] = toGfaNumber(cellValue);
      } else {
        row[field] = cellValue;
      }
    });

    return row;
  });
}

// 캠페인 / 그룹 / ADV 3개 업로드 폼에 공통 로직을 붙인다.
document.querySelectorAll("#view-upload .upload-form").forEach((form) => {
  const rawType = form.dataset.rawType;
  const fileInput = form.querySelector(".upload-file-input");
  const statusEl = form.closest(".upload-card").querySelector(".upload-status");
  const submitBtn = form.querySelector("button[type=submit]");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const file = fileInput.files[0];
    if (!file) return;

    statusEl.hidden = true;
    submitBtn.disabled = true;
    const originalLabel = submitBtn.textContent;
    submitBtn.textContent = "업로드 중...";

    try {
      const text = await file.text();
      const rows = parseGfaCsv(text, GFA_RAW_TYPE_COLUMNS[rawType]);

      if (rows.length === 0) {
        throw new Error("업로드할 데이터가 없습니다.");
      }
      if (rows.length > GFA_MAX_UPLOAD_ROWS) {
        throw new Error(`한 번에 최대 ${GFA_MAX_UPLOAD_ROWS}행까지 업로드할 수 있습니다.`);
      }

      const result = await uploadGfaData(rawType, rows);
      if (!result.success) {
        throw new Error(result.message);
      }

      showUploadStatus(
        statusEl,
        `업로드 완료: ${result.inserted}건 저장 (${result.dates_replaced.length}개 날짜 갱신)`,
        "success"
      );
      form.reset();
    } catch (err) {
      showUploadStatus(statusEl, err.message || "업로드 중 오류가 발생했습니다.", "error");
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = originalLabel;
    }
  });
});

function showUploadStatus(statusEl, message, type) {
  statusEl.textContent = message;
  statusEl.className = `upload-status upload-status-${type}`;
  statusEl.hidden = false;
}

// CSV 템플릿 다운로드 링크 (정적 파일 없이 브라우저에서 즉석으로 생성)
document.querySelectorAll("#view-upload .upload-template-link").forEach((link) => {
  const template = GFA_RAW_TYPE_TEMPLATE_CSV[link.dataset.template];
  if (template) {
    link.href = "data:text/csv;charset=utf-8," + encodeURIComponent(template);
  }
});

/* ---------------------------------------------------------
   8. 유틸
--------------------------------------------------------- */
function formatWon(n) {
  return `${Math.round(n).toLocaleString("ko-KR")}원`;
}

function formatNumber(n) {
  return n.toLocaleString("ko-KR");
}

function formatPercent(n) {
  return `${n.toFixed(2)}%`;
}

/* ---------------------------------------------------------
   9. 핵심지표(KPI) 계산 / 렌더링
   ---------------------------------------------------------
   저장은 원시 지표(impressions/clicks/cost/conversions/revenue)로만 하고,
   CTR/CPC/CVR/ROAS/CPA는 항상 이 값들로부터 계산한다 (GFA 실데이터,
   SA Mock 데이터 모두 동일한 계산식을 탄다).
--------------------------------------------------------- */
function withDerivedMetrics(totals) {
  const { impressions, clicks, cost, conversions, revenue } = totals;
  return {
    impressions,
    clicks,
    cost,
    conversions,
    revenue,
    ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
    cpc: clicks > 0 ? cost / clicks : 0,
    cvr: clicks > 0 ? (conversions / clicks) * 100 : 0,
    roas: cost > 0 ? Math.round((revenue / cost) * 100) : 0,
    cpa: conversions > 0 ? Math.round(cost / conversions) : 0
  };
}

const KPI_DEFS = [
  { key: "impressions", label: "노출수", format: formatNumber },
  { key: "clicks", label: "클릭수", format: formatNumber },
  { key: "ctr", label: "클릭률", format: formatPercent },
  { key: "cpc", label: "CPC", format: formatWon },
  { key: "cost", label: "총비용", format: formatWon },
  { key: "conversions", label: "전환수", format: formatNumber },
  { key: "cvr", label: "전환율", format: formatPercent },
  { key: "revenue", label: "전환매출액", format: formatWon },
  { key: "roas", label: "ROAS", format: (n) => `${n}%` },
  { key: "cpa", label: "전환당비용", format: formatWon }
];

function renderKpiCards(current, comparison) {
  kpiGrid.innerHTML = "";
  KPI_DEFS.forEach((def) => {
    const card = document.createElement("div");
    card.className = "kpi-card";
    card.innerHTML = `
      <span class="kpi-label">${def.label}</span>
      <span class="kpi-value">${def.format(current[def.key])}</span>
      ${comparison ? buildDeltaHtml(current[def.key], comparison[def.key]) : ""}
    `;
    kpiGrid.appendChild(card);
  });
}

function buildDeltaHtml(current, previous) {
  if (!previous) {
    return current ? `<span class="kpi-sub up">신규</span>` : "";
  }
  const change = ((current - previous) / previous) * 100;
  if (Math.abs(change) < 0.05) {
    return `<span class="kpi-sub">변동 없음</span>`;
  }
  const direction = change > 0 ? "up" : "down";
  const arrow = change > 0 ? "▲" : "▼";
  const word = change > 0 ? "증가" : "감소";
  return `<span class="kpi-sub ${direction}">${arrow} ${Math.abs(change).toFixed(1)}% ${word}</span>`;
}

function generateDailySeries(baseCost, baseRevenue, days = 14) {
  const labels = [];
  const cost = [];
  const revenue = [];
  const roas = [];

  const endDate = state.analysisPeriod ? new Date(`${state.analysisPeriod.to}T00:00:00`) : new Date();

  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(endDate);
    d.setDate(d.getDate() - i);
    labels.push(`${d.getMonth() + 1}/${d.getDate()}`);

    const noiseA = 0.8 + Math.random() * 0.4;
    const noiseB = 0.8 + Math.random() * 0.4;
    const dailyCost = Math.round((baseCost / days) * noiseA);
    const dailyRevenue = Math.round((baseRevenue / days) * noiseB);

    cost.push(dailyCost);
    revenue.push(dailyRevenue);
    roas.push(dailyCost > 0 ? Math.round((dailyRevenue / dailyCost) * 100) : 0);
  }

  return { labels, cost, revenue, roas };
}

function renderCharts(kpi) {
  const periodDays = state.analysisPeriod
    ? daysBetweenInclusive(state.analysisPeriod.from, state.analysisPeriod.to)
    : 14;
  const chartDays = Math.min(Math.max(periodDays, 1), 60);
  const series = generateDailySeries(kpi.cost, kpi.revenue, chartDays);

  destroyChart("spend");
  destroyChart("revenue");
  destroyChart("roas");

  state.charts.spend = new Chart(document.getElementById("spendChart"), {
    type: "line",
    data: {
      labels: series.labels,
      datasets: [
        {
          label: "광고비",
          data: series.cost,
          borderColor: "#2563eb",
          backgroundColor: "rgba(37, 99, 235, 0.1)",
          tension: 0.35,
          fill: true,
          pointRadius: 2
        }
      ]
    },
    options: chartOptions((v) => `${(v / 10000).toFixed(0)}만`)
  });

  state.charts.revenue = new Chart(document.getElementById("revenueChart"), {
    type: "line",
    data: {
      labels: series.labels,
      datasets: [
        {
          label: "광고매출",
          data: series.revenue,
          borderColor: "#16a34a",
          backgroundColor: "rgba(22, 163, 74, 0.1)",
          tension: 0.35,
          fill: true,
          pointRadius: 2
        }
      ]
    },
    options: chartOptions((v) => `${(v / 10000).toFixed(0)}만`)
  });

  state.charts.roas = new Chart(document.getElementById("roasChart"), {
    type: "line",
    data: {
      labels: series.labels,
      datasets: [
        {
          label: "ROAS",
          data: series.roas,
          borderColor: "#f59e0b",
          backgroundColor: "rgba(245, 158, 11, 0.1)",
          tension: 0.35,
          fill: true,
          pointRadius: 2
        }
      ]
    },
    options: chartOptions((v) => `${v}%`)
  });
}

function destroyChart(key) {
  if (state.charts[key]) {
    state.charts[key].destroy();
    delete state.charts[key];
  }
}

function chartOptions(yTickFormatter) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false }
    },
    scales: {
      x: {
        grid: { display: false },
        ticks: { color: "#9aa3b5", font: { size: 11 } }
      },
      y: {
        grid: { color: "#eef0f5" },
        ticks: {
          color: "#9aa3b5",
          font: { size: 11 },
          callback: yTickFormatter
        }
      }
    }
  };
}

/* ---------------------------------------------------------
   10. 초기화 - 유효한 세션이 남아있으면 로그인 화면을 건너뛴다
--------------------------------------------------------- */
(function init() {
  const session = getSession();
  if (session) {
    showDashboard(session.advertiser);
  }
})();
