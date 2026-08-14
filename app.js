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
  url: "https://agglowdlyduilkjskxyx.supabase.co", // TODO: 실제 Supabase 프로젝트 URL로 교체
  anonKey: sb_publishable_SM4u637sEeM0Vi0HtD-DgQ_9bQU-AD9 // TODO: 실제 anon(public) key로 교체
};

const ADVERTISER_LOGIN_ENDPOINT = `${SUPABASE_CONFIG.url}/functions/v1/advertiser-login`;
const SESSION_STORAGE_KEY = "adsDashboardSession";

/* ---------------------------------------------------------
   2. 사이드바 메뉴 정의
--------------------------------------------------------- */
const MENU_ITEMS = [
  { id: "overview", label: "성과 대시보드", implemented: true },
  { id: "trend", label: "그래프 추이", implemented: false },
  { id: "product", label: "상품별 데이터", implemented: false },
  { id: "daily", label: "일별 데이터", implemented: false },
  { id: "monthly", label: "월별 데이터", implemented: false },
  { id: "category", label: "카테고리별 데이터", implemented: false },
  { id: "campaign", label: "캠페인별 성과", implemented: false },
  { id: "adgroup", label: "광고그룹별 성과", implemented: false },
  { id: "creative", label: "소재별 성과", implemented: false }
];

/* ---------------------------------------------------------
   3. KPI / 차트 Mock 데이터
   ---------------------------------------------------------
   ad_performance 테이블 연동 전까지는 로그인한 광고주와 무관하게
   동일한 Mock 데이터를 보여준다.
--------------------------------------------------------- */
const MOCK_PERIOD = "2026.07.01 ~ 2026.07.31";

const MOCK_KPI = {
  cost: 12450000,
  revenue: 85300000,
  roas: 685,
  clicks: 24530,
  ctr: 2.41,
  conversions: 1840,
  cvr: 7.50,
  cpa: 6766
};

/* ---------------------------------------------------------
   4. 인증
   ---------------------------------------------------------
   비밀번호 검증은 항상 Supabase Edge Function(advertiser-login)에서
   수행한다. 브라우저는 결과로 받은 광고주 정보 + 서명된 세션 토큰만
   보관하며, password / password_hash는 어떤 경우에도 다루지 않는다.
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
    return { success: false, message: payload.message || "비밀번호가 올바르지 않습니다." };
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

const advertiserNameEl = document.getElementById("advertiserName");
const periodLabel = document.getElementById("periodLabel");
const logoutBtn = document.getElementById("logoutBtn");

const kpiGrid = document.getElementById("kpiGrid");
const viewOverview = document.getElementById("view-overview");
const viewPlaceholder = document.getElementById("view-placeholder");
const placeholderTitle = document.getElementById("placeholderTitle");

const state = {
  charts: {}
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

  loginSubmitBtn.disabled = false;
  loginSubmitBtn.textContent = originalLabel;

  if (result.success) {
    passwordInput.value = "";
    showDashboard(result.advertiser);
  } else {
    loginError.textContent = result.message;
    loginError.hidden = false;
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
  renderKpiCards(MOCK_KPI);
  renderCharts(MOCK_KPI);
}

/* ---------------------------------------------------------
   7. 사이드바 메뉴 렌더링 / 뷰 전환
--------------------------------------------------------- */
function renderSidebarMenu() {
  sidebarMenuList.innerHTML = "";

  MENU_ITEMS.forEach((item) => {
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
  const item = MENU_ITEMS.find((m) => m.id === viewId) || MENU_ITEMS[0];

  document
    .querySelectorAll(".sidebar-menu-item")
    .forEach((btn) => btn.classList.toggle("active", btn.dataset.viewId === item.id));

  if (item.implemented) {
    viewOverview.hidden = false;
    viewPlaceholder.hidden = true;
  } else {
    viewOverview.hidden = true;
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
