/* =========================================================
   ADS PERFORMANCE DASHBOARD - app.js
   1단계: Mock 데이터 기반 정적 프론트엔드 로직
   ========================================================= */

/* ---------------------------------------------------------
   1. 광고주 설정 (하드코딩 대신 객체/배열로 관리)
   추후 Supabase 테이블(advertisers)에서 조회하도록 교체 예정
--------------------------------------------------------- */
const ADVERTISERS = [
  {
    id: "adv-001",
    name: "코스모뷰티",
    period: "2026.07.01 ~ 2026.07.31",
    kpi: {
      cost: 12450000,
      revenue: 85300000,
      roas: 685,
      clicks: 24530,
      ctr: 2.41,
      conversions: 1840,
      cvr: 7.50,
      cpa: 6766
    }
  },
  {
    id: "adv-002",
    name: "그린리빙",
    period: "2026.07.01 ~ 2026.07.31",
    kpi: {
      cost: 8320000,
      revenue: 41600000,
      roas: 500,
      clicks: 15210,
      ctr: 1.98,
      conversions: 980,
      cvr: 6.44,
      cpa: 8490
    }
  },
  {
    id: "adv-003",
    name: "스타일하우스",
    period: "2026.07.01 ~ 2026.07.31",
    kpi: {
      cost: 21870000,
      revenue: 152400000,
      roas: 697,
      clicks: 38940,
      ctr: 2.87,
      conversions: 3120,
      cvr: 8.01,
      cpa: 7010
    }
  }
];

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
   3. 인증 (현재는 Mock, 추후 Supabase Edge Function으로 교체)
   ---------------------------------------------------------
   TODO(Supabase 연동 예정):
   실 운영 단계에서는 아래 mockAuthenticate() 대신
   Supabase Edge Function(예: /functions/v1/verify-password)을
   호출하여 서버 측에서 비밀번호를 검증하도록 교체한다.
   프론트엔드에는 비밀번호를 하드코딩하지 않는다.
--------------------------------------------------------- */
function mockAuthenticate(password) {
  // 개발 테스트 전용 Mock 인증 로직 (운영 배포 금지)
  return password === "123";
}

/* ---------------------------------------------------------
   4. 차트용 Mock 데이터 생성
--------------------------------------------------------- */
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

/* ---------------------------------------------------------
   5. 상태
--------------------------------------------------------- */
const state = {
  currentAdvertiserId: ADVERTISERS[0].id,
  charts: {}
};

/* ---------------------------------------------------------
   6. DOM 참조
--------------------------------------------------------- */
const loginScreen = document.getElementById("loginScreen");
const dashboardScreen = document.getElementById("dashboardScreen");
const loginForm = document.getElementById("loginForm");
const passwordInput = document.getElementById("passwordInput");
const loginError = document.getElementById("loginError");

const sidebar = document.getElementById("sidebar");
const sidebarMenuList = document.getElementById("sidebarMenuList");
const sidebarBackdrop = document.getElementById("sidebarBackdrop");
const menuToggle = document.getElementById("menuToggle");

const advertiserSelect = document.getElementById("advertiserSelect");
const periodLabel = document.getElementById("periodLabel");
const logoutBtn = document.getElementById("logoutBtn");

const kpiGrid = document.getElementById("kpiGrid");
const viewOverview = document.getElementById("view-overview");
const viewPlaceholder = document.getElementById("view-placeholder");
const placeholderTitle = document.getElementById("placeholderTitle");

/* ---------------------------------------------------------
   7. 유틸
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

function getCurrentAdvertiser() {
  return ADVERTISERS.find((a) => a.id === state.currentAdvertiserId);
}

/* ---------------------------------------------------------
   8. 로그인 / 로그아웃
--------------------------------------------------------- */
loginForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const password = passwordInput.value;

  if (mockAuthenticate(password)) {
    loginError.hidden = true;
    passwordInput.value = "";
    showDashboard();
  } else {
    loginError.hidden = false;
  }
});

logoutBtn.addEventListener("click", () => {
  dashboardScreen.hidden = true;
  loginScreen.hidden = false;
  loginError.hidden = true;
  passwordInput.value = "";
  passwordInput.focus();
});

function showDashboard() {
  loginScreen.hidden = true;
  dashboardScreen.hidden = false;
  renderAdvertiserOptions();
  renderSidebarMenu();
  switchView("overview");
  renderAdvertiserData();
}

/* ---------------------------------------------------------
   9. 사이드바 메뉴 렌더링 / 뷰 전환
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
   10. 광고주 선택
--------------------------------------------------------- */
function renderAdvertiserOptions() {
  advertiserSelect.innerHTML = "";
  ADVERTISERS.forEach((adv) => {
    const opt = document.createElement("option");
    opt.value = adv.id;
    opt.textContent = adv.name;
    advertiserSelect.appendChild(opt);
  });
  advertiserSelect.value = state.currentAdvertiserId;
}

advertiserSelect.addEventListener("change", (e) => {
  state.currentAdvertiserId = e.target.value;
  renderAdvertiserData();
});

/* ---------------------------------------------------------
   11. KPI / 차트 렌더링
--------------------------------------------------------- */
function renderAdvertiserData() {
  const advertiser = getCurrentAdvertiser();
  periodLabel.textContent = advertiser.period;
  renderKpiCards(advertiser.kpi);
  renderCharts(advertiser.kpi);
}

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
