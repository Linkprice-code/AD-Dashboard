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
const SESSION_STORAGE_KEY = "adsDashboardSession";

/* ---------------------------------------------------------
   2. 사이드바 메뉴 정의
   ---------------------------------------------------------
   gfaGroupBy가 있는 항목은 GFA 채널일 때 ad_performance를 해당 컬럼으로
   집계해서 보여준다 (SA 채널일 때는 아직 "준비 중" 그대로).
   gfaOnly 항목(데이터 업로드)은 GFA 채널일 때만 사이드바에 나타난다.
--------------------------------------------------------- */
const MENU_ITEMS = [
  { id: "overview", label: "성과 대시보드" },
  { id: "trend", label: "그래프 추이" },
  { id: "product", label: "상품별 데이터", gfaRawType: "adv" },
  { id: "daily", label: "일별 데이터" },
  { id: "monthly", label: "월별 데이터" },
  { id: "campaign", label: "캠페인별 성과", gfaRawType: "campaign" },
  { id: "adgroup", label: "광고그룹별 성과", gfaRawType: "adgroup" },
  { id: "creative", label: "소재별 성과" },
  { id: "upload", label: "데이터 업로드", gfaOnly: true }
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

const SA_MOCK_TOTALS = {
  impressions: 1018000,
  clicks: 24530,
  cost: 12450000,
  conversions: 1840,
  revenue: 85300000
};

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

const analysisFromInput = document.getElementById("analysisFromInput");
const analysisToInput = document.getElementById("analysisToInput");
const compareFromInput = document.getElementById("compareFromInput");
const compareToInput = document.getElementById("compareToInput");
const overviewEmptyNotice = document.getElementById("overviewEmptyNotice");
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
  analysisFromInput.value = state.analysisPeriod.from;
  analysisToInput.value = state.analysisPeriod.to;
  compareFromInput.value = state.comparisonPeriod.from;
  compareToInput.value = state.comparisonPeriod.to;

  renderSidebarMenu();
  switchView("overview");
}

// 분석기간을 바꾸면 비교기간도 "그 직전 같은 길이"로 자동 갱신한다
// (사용자가 비교기간을 따로 골라둔 상태였어도, 분석기간이 바뀌면 기본값으로 다시 맞춘다).
analysisFromInput.addEventListener("change", handlePeriodChange);
analysisToInput.addEventListener("change", handlePeriodChange);

function handlePeriodChange() {
  const from = analysisFromInput.value;
  const to = analysisToInput.value;
  if (!from || !to || from > to) return;

  state.analysisPeriod = { from, to };
  state.comparisonPeriod = computeComparisonPeriod(from, to);
  compareFromInput.value = state.comparisonPeriod.from;
  compareToInput.value = state.comparisonPeriod.to;

  if (state.currentView === "overview") {
    renderOverview();
  } else if (state.currentView === "trend") {
    renderTrendView();
  }
}

// 비교기간은 사용자가 직접 선택할 수도 있다 - 선택하면 그 값을 그대로 쓴다.
compareFromInput.addEventListener("change", handleComparePeriodChange);
compareToInput.addEventListener("change", handleComparePeriodChange);

function handleComparePeriodChange() {
  const from = compareFromInput.value;
  const to = compareToInput.value;
  if (!from || !to || from > to) return;

  state.comparisonPeriod = { from, to };

  if (state.currentView === "overview") {
    renderOverview();
  }
}

/* ---------------------------------------------------------
   6-1. 채널(SA / GFA) 전환
--------------------------------------------------------- */
channelSwitch.addEventListener("click", (e) => {
  const tab = e.target.closest(".channel-tab");
  if (!tab || tab.classList.contains("active")) return;

  state.currentChannel = tab.dataset.channel;

  channelSwitch.querySelectorAll(".channel-tab").forEach((btn) => {
    const isActive = btn === tab;
    btn.classList.toggle("active", isActive);
    btn.setAttribute("aria-selected", String(isActive));
  });

  renderSidebarMenu();
  renderCurrentView();
});

async function renderOverview() {
  overviewTitle.textContent = `${CHANNEL_LABELS[state.currentChannel]} 성과 대시보드`;
  periodLabel.textContent = formatPeriodRange(state.analysisPeriod);
  breakdownNameHeader.textContent = GFA_RAW_TYPE_NAME_LABEL[state.breakdownRawType] || "이름";

  if (state.currentChannel === "GFA") {
    await renderGfaOverview();
  } else {
    renderSaOverview();
  }
}

function renderSaOverview() {
  overviewEmptyNotice.hidden = true;

  const current = withDerivedMetrics(SA_MOCK_TOTALS);
  renderKpiCards(current, null);

  renderSaBreakdownPlaceholder();
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

function renderSaBreakdownPlaceholder() {
  state.breakdownRows = [];
  breakdownTableBody.innerHTML =
    '<tr><td colspan="9" class="grouped-empty">네이버 SA API 연동 후 제공됩니다.</td></tr>';
  updateSortIndicators();
}

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

  if (state.currentChannel !== "GFA") {
    renderCharts(SA_MOCK_TOTALS);
    return;
  }

  const token = ++state.overviewRenderToken;
  const result = await fetchGfaPerformance("campaign", {
    dateFrom: state.analysisPeriod.from,
    dateTo: state.analysisPeriod.to
  });

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
    if (item.gfaOnly && state.currentChannel !== "GFA") return;

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

  // GFA 전용 메뉴인데 지금 채널이 GFA가 아니면 성과 대시보드로 되돌린다.
  if (!item || (item.gfaOnly && state.currentChannel !== "GFA")) {
    item = MENU_ITEMS[0];
    state.currentView = item.id;
  }

  document
    .querySelectorAll(".sidebar-menu-item")
    .forEach((btn) => btn.classList.toggle("active", btn.dataset.viewId === item.id));

  viewOverview.hidden = true;
  viewTrend.hidden = true;
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
    return `<span class="kpi-sub">전기 대비 변동 없음</span>`;
  }
  const direction = change > 0 ? "up" : "down";
  const arrow = change > 0 ? "▲" : "▼";
  return `<span class="kpi-sub ${direction}">${arrow} ${Math.abs(change).toFixed(1)}% 전기 대비</span>`;
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
