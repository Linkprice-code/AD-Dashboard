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
  { id: "product", label: "상품별 데이터", gfaGroupBy: "product" },
  { id: "daily", label: "일별 데이터" },
  { id: "monthly", label: "월별 데이터" },
  { id: "category", label: "카테고리별 데이터" },
  { id: "campaign", label: "캠페인별 성과", gfaGroupBy: "campaign" },
  { id: "adgroup", label: "광고그룹별 성과", gfaGroupBy: "ad_group" },
  { id: "creative", label: "소재별 성과" },
  { id: "upload", label: "데이터 업로드", gfaOnly: true }
];

/* ---------------------------------------------------------
   3. 채널(SA / GFA) / KPI / 차트 Mock 데이터
   ---------------------------------------------------------
   ad_performance 테이블 연동 전까지는 로그인한 광고주와 무관하게
   채널별로 고정된 Mock 데이터를 보여준다. SA는 네이버 검색광고(파워링크 등),
   GFA는 네이버 GFA(디스플레이) 광고를 뜻한다. 실데이터 연동 시
   CHANNEL_MOCK_DATA 자리에 광고주+채널별 ad_performance 집계 결과가 들어간다.
--------------------------------------------------------- */
const MOCK_PERIOD = "2026.07.01 ~ 2026.07.31";

const CHANNEL_LABELS = {
  SA: "SA",
  GFA: "GFA"
};

const CHANNEL_MOCK_DATA = {
  SA: {
    cost: 12450000,
    revenue: 85300000,
    roas: 685,
    clicks: 24530,
    ctr: 2.41,
    conversions: 1840,
    cvr: 7.50,
    cpa: 6766
  },
  GFA: {
    cost: 6820000,
    revenue: 31450000,
    roas: 461,
    clicks: 158420,
    ctr: 0.68,
    conversions: 612,
    cvr: 0.39,
    cpa: 11144
  }
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
--------------------------------------------------------- */
async function uploadGfaData(rows) {
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
      body: JSON.stringify({ channel: "GFA", rows })
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

async function fetchGfaPerformance(groupBy) {
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
      body: JSON.stringify({ group_by: groupBy })
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
const uploadForm = document.getElementById("uploadForm");
const uploadFileInput = document.getElementById("uploadFileInput");
const uploadStatus = document.getElementById("uploadStatus");
const downloadTemplateLink = document.getElementById("downloadTemplateLink");

const state = {
  charts: {},
  currentChannel: "SA",
  currentView: "overview"
};

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
  periodLabel.textContent = MOCK_PERIOD;

  renderSidebarMenu();
  switchView("overview");
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

function renderOverview() {
  const kpi = CHANNEL_MOCK_DATA[state.currentChannel];
  overviewTitle.textContent = `${CHANNEL_LABELS[state.currentChannel]} 성과 대시보드`;
  renderKpiCards(kpi);
  renderCharts(kpi);
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
  viewGrouped.hidden = true;
  viewUpload.hidden = true;
  viewPlaceholder.hidden = true;

  const isGfa = state.currentChannel === "GFA";

  if (item.id === "overview") {
    viewOverview.hidden = false;
    renderOverview();
  } else if (item.id === "upload") {
    viewUpload.hidden = false;
  } else if (item.gfaGroupBy && isGfa) {
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
  groupedNameHeader.textContent = item.label.replace("성과", "").replace("데이터", "").trim() || "이름";
  groupedTableBody.innerHTML = `<tr><td colspan="9" class="grouped-empty">불러오는 중...</td></tr>`;

  const result = await fetchGfaPerformance(item.gfaGroupBy);

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
   7-2. GFA 데이터 업로드 (CSV)
--------------------------------------------------------- */
const GFA_CSV_COLUMNS = [
  "date",
  "campaign",
  "ad_group",
  "product",
  "impressions",
  "clicks",
  "cost",
  "conversions",
  "revenue"
];
const GFA_MAX_UPLOAD_ROWS = 5000;

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

function parseGfaCsv(text) {
  const lines = text.split(/\r\n|\n|\r/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) {
    throw new Error("업로드할 데이터가 없습니다 (헤더 다음 줄부터 데이터가 있어야 합니다).");
  }

  const header = splitCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  const missing = GFA_CSV_COLUMNS.filter((col) => !header.includes(col));
  if (missing.length > 0) {
    throw new Error(`CSV 헤더에 다음 컬럼이 없습니다: ${missing.join(", ")}`);
  }

  return lines.slice(1).map((line) => {
    const cells = splitCsvLine(line);
    const raw = {};
    header.forEach((col, i) => {
      raw[col] = (cells[i] ?? "").trim();
    });

    return {
      date: raw.date,
      campaign: raw.campaign,
      ad_group: raw.ad_group,
      product: raw.product,
      impressions: Number(raw.impressions),
      clicks: Number(raw.clicks),
      cost: Number(raw.cost),
      conversions: Number(raw.conversions),
      revenue: Number(raw.revenue)
    };
  });
}

uploadForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  const file = uploadFileInput.files[0];
  if (!file) return;

  uploadStatus.hidden = true;
  const submitBtn = uploadForm.querySelector("button[type=submit]");
  submitBtn.disabled = true;
  const originalLabel = submitBtn.textContent;
  submitBtn.textContent = "업로드 중...";

  try {
    const text = await file.text();
    const rows = parseGfaCsv(text);

    if (rows.length === 0) {
      throw new Error("업로드할 데이터가 없습니다.");
    }
    if (rows.length > GFA_MAX_UPLOAD_ROWS) {
      throw new Error(`한 번에 최대 ${GFA_MAX_UPLOAD_ROWS}행까지 업로드할 수 있습니다.`);
    }

    const result = await uploadGfaData(rows);
    if (!result.success) {
      throw new Error(result.message);
    }

    showUploadStatus(
      `업로드 완료: ${result.inserted}건 저장 (${result.dates_replaced.length}개 날짜 갱신)`,
      "success"
    );
    uploadForm.reset();
  } catch (err) {
    showUploadStatus(err.message || "업로드 중 오류가 발생했습니다.", "error");
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = originalLabel;
  }
});

function showUploadStatus(message, type) {
  uploadStatus.textContent = message;
  uploadStatus.className = `upload-status upload-status-${type}`;
  uploadStatus.hidden = false;
}

// CSV 템플릿 다운로드 링크 (정적 파일 없이 브라우저에서 즉석으로 생성)
(function setupGfaTemplateLink() {
  const templateCsv =
    "date,campaign,ad_group,product,impressions,clicks,cost,conversions,revenue\n" +
    "2026-08-01,여름신상프로모션,배너그룹A,ADVoost,15200,320,540000,18,3200000\n";
  downloadTemplateLink.href = "data:text/csv;charset=utf-8," + encodeURIComponent(templateCsv);
})();

/* ---------------------------------------------------------
   8. 유틸
--------------------------------------------------------- */
function formatWon(n) {
  return `${n.toLocaleString("ko-KR")}원`;
}

function formatNumber(n) {
  return n.toLocaleString("ko-KR");
}

function formatPercent(n) {
  return `${n.toFixed(2)}%`;
}

/* ---------------------------------------------------------
   9. KPI / 차트 렌더링 (Mock)
--------------------------------------------------------- */
const KPI_DEFS = [
  { key: "cost", label: "광고비", format: formatWon },
  { key: "revenue", label: "광고매출", format: formatWon },
  { key: "roas", label: "ROAS", format: (n) => `${n}%` },
  { key: "clicks", label: "클릭수", format: formatNumber },
  { key: "ctr", label: "CTR", format: formatPercent },
  { key: "conversions", label: "전환수", format: formatNumber },
  { key: "cvr", label: "CVR", format: formatPercent },
  { key: "cpa", label: "CPA", format: formatWon }
];

function renderKpiCards(kpi) {
  kpiGrid.innerHTML = "";
  KPI_DEFS.forEach((def) => {
    const card = document.createElement("div");
    card.className = "kpi-card";
    card.innerHTML = `
      <span class="kpi-label">${def.label}</span>
      <span class="kpi-value">${def.format(kpi[def.key])}</span>
    `;
    kpiGrid.appendChild(card);
  });
}

function generateDailySeries(baseCost, baseRevenue, days = 14) {
  const labels = [];
  const cost = [];
  const revenue = [];
  const roas = [];

  const today = new Date(2026, 6, 31); // 2026-07-31 기준

  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    labels.push(`${d.getMonth() + 1}/${d.getDate()}`);

    const noiseA = 0.8 + Math.random() * 0.4;
    const noiseB = 0.8 + Math.random() * 0.4;
    const dailyCost = Math.round((baseCost / days) * noiseA);
    const dailyRevenue = Math.round((baseRevenue / days) * noiseB);

    cost.push(dailyCost);
    revenue.push(dailyRevenue);
    roas.push(Math.round((dailyRevenue / dailyCost) * 100));
  }

  return { labels, cost, revenue, roas };
}

function renderCharts(kpi) {
  const series = generateDailySeries(kpi.cost, kpi.revenue);

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
