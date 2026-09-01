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
const SA_KEYWORD_PERFORMANCE_ENDPOINT = `${SUPABASE_CONFIG.url}/functions/v1/sa-keyword-performance`;
const SA_PRODUCT_MAPPING_UPLOAD_ENDPOINT = `${SUPABASE_CONFIG.url}/functions/v1/sa-product-mapping-upload`;
const SA_PRODUCT_MODEL_MAPPING_UPLOAD_ENDPOINT = `${SUPABASE_CONFIG.url}/functions/v1/sa-product-model-mapping-upload`;
const SA_PRODUCT_PERFORMANCE_ENDPOINT = `${SUPABASE_CONFIG.url}/functions/v1/sa-product-performance`;
const SA_BRAND_SEARCH_CONTRACT_ENDPOINT = `${SUPABASE_CONFIG.url}/functions/v1/sa-brand-search-contract`;
const SA_CONVERSION_OVERRIDE_ENDPOINT = `${SUPABASE_CONFIG.url}/functions/v1/sa-conversion-override`;
const SA_MANUAL_KEYWORD_PERFORMANCE_ENDPOINT = `${SUPABASE_CONFIG.url}/functions/v1/sa-manual-keyword-performance`;
const SA_MANUAL_PRODUCT_PERFORMANCE_ENDPOINT = `${SUPABASE_CONFIG.url}/functions/v1/sa-manual-product-performance`;
// 이베이/11번가처럼 API 연동 없이 수기 업로드로만 운영하는 채널(문성전자 전용) - 성과 조회/업로드.
const CHANNEL_PERFORMANCE_ENDPOINT = `${SUPABASE_CONFIG.url}/functions/v1/channel-performance`;
const CHANNEL_UPLOAD_ENDPOINT = `${SUPABASE_CONFIG.url}/functions/v1/channel-upload`;
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
  { id: "powerlink", label: "파워링크", channels: ["SA"], naverCampaignType: "WEB_SITE" },
  { id: "shopping", label: "쇼핑검색", channels: ["SA"], naverCampaignType: "SHOPPING" },
  { id: "brand", label: "브랜드검색", channels: ["SA"], naverCampaignType: "BRAND_SEARCH" },
  { id: "creative", label: "소재별 성과", channels: ["GFA"], gfaRawType: "creative" },
  { id: "upload", label: "데이터 업로드", channels: ["GFA"] },
  // SA API 연동이 없는 광고주(naver_api_customer_id 없음, 예: 쉬어)에게만 보인다.
  { id: "sa-upload", label: "SA 데이터 업로드", channels: ["SA"], requiresSaManual: true },
  // SA API 연동 광고주(naver_api_customer_id 있음)에게만 보인다 - 구매완료수 보정값 업로드용.
  { id: "sa-conversion-upload", label: "데이터 업로드", channels: ["SA"], requiresSaApi: true },
  // 이베이/11번가 - API 연동 없이 CSV 수기 업로드만 하는 채널(문성전자 전용).
  // enabled_channels에 EBAY/ELEVENST가 있는 광고주에게만 채널 탭 자체가 보인다.
  { id: "channel-overview", label: "성과 대시보드", channels: ["EBAY", "ELEVENST"] },
  { id: "channel-upload", label: "데이터 업로드", channels: ["EBAY", "ELEVENST"] }
];

// raw_type -> "이름" 컬럼 헤더에 쓸 표시명
const GFA_RAW_TYPE_NAME_LABEL = {
  campaign: "캠페인",
  adgroup: "광고그룹",
  adv: "상품",
  creative: "소재"
};

// GFA 캠페인 유형별 성과 표에 고정으로 보여줄 유형 순서 (네이버 GFA "캠페인 목적" 값)
const GFA_CAMPAIGN_TYPE_ORDER = ["웹사이트 전환", "인지도 및 트래픽", "쇼핑 프로모션", "카탈로그 판매", "동영상 조회"];

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
  GFA: "GFA",
  EBAY: "이베이",
  ELEVENST: "11번가"
};

// sa-performance가 group_by="type"로 돌려주는 네이버 캠페인 유형 코드 <-> 캠페인 유형별
// 필터 탭(data-campaign-type)의 매핑. 네이버 SA 표준 리포트 기준 코드다.
const SA_CAMPAIGN_TYPE_TO_NAVER = {
  powerlink: "WEB_SITE",
  shopping: "SHOPPING",
  brand: "BRAND_SEARCH"
};

// 이베이/11번가 - 채널별 허용 광고 유형 (channel-upload/channel-performance Edge Function과
// 동일한 목록을 프론트에도 둔다. "광고 유형별 성과" 표의 고정 행 순서로도 쓴다).
const CHANNEL_AD_TYPES = {
  EBAY: ["통합운영형", "집중운영형", "직접운영형"],
  ELEVENST: ["포커스클릭", "AI캠페인", "전시입찰광고"]
};

// 상품 카테고리별 뱃지 색상 (현재는 카테고리를 넘겨주는 데이터가 없어 항상 기본색으로
// 표시되지만, 값이 들어오면 자동으로 매칭되도록 남겨둔다).
const MODEL_BADGE_COLORS = {};

/* ---------------------------------------------------------
   4. 인증
   ---------------------------------------------------------
   로그인 크리덴셜(광고주 naver_customer_id) 검증은 항상 Supabase Edge
   Function(advertiser-login)에서 수행한다. 브라우저는 결과로 받은 광고주
   정보 + 서명된 세션 토큰만 보관하며, password / password_hash는 어떤
   경우에도 다루지 않는다.
--------------------------------------------------------- */
// advertiserId를 넘기지 않고 호출했을 때, 같은 고객번호로 스토어가 여러 개 매칭되면
// 세션 토큰 없이 { requiresSelection: true, stores: [...] }만 돌아온다 - 이때는 사용자가
// 스토어를 고른 뒤 advertiserId를 넣어서 다시 한 번 호출해야 실제 로그인이 완료된다.
async function authenticateAdvertiser(password, advertiserId) {
  let res;
  try {
    res = await fetch(ADVERTISER_LOGIN_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${SUPABASE_CONFIG.anonKey}`,
        "apikey": SUPABASE_CONFIG.anonKey
      },
      body: JSON.stringify(advertiserId ? { password, advertiser_id: advertiserId } : { password })
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

  if (payload.requires_selection) {
    return { success: true, requiresSelection: true, stores: payload.stores };
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
   4-1a. 이베이/11번가(EBAY/ELEVENST) 성과 조회 / 업로드
   ---------------------------------------------------------
   SA/GFA와 별개로, API 연동 없이 CSV 수기 업로드만 하는 채널(문성전자 전용).
   ad_performance 테이블을 channel-performance/channel-upload Edge Function으로 조회/저장한다.
--------------------------------------------------------- */
async function fetchChannelPerformance(channel, groupBy, { dateFrom, dateTo, adType } = {}) {
  const session = getSession();
  if (!session) {
    return { success: false, message: "세션이 만료되었습니다. 다시 로그인해주세요." };
  }

  let res;
  try {
    res = await fetch(CHANNEL_PERFORMANCE_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${SUPABASE_CONFIG.anonKey}`,
        "apikey": SUPABASE_CONFIG.anonKey,
        "X-Session-Token": session.token
      },
      body: JSON.stringify({
        channel,
        group_by: groupBy,
        date_from: dateFrom,
        date_to: dateTo,
        ad_type: adType
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

async function uploadChannelData(channel, adType, rows) {
  const session = getSession();
  if (!session) {
    return { success: false, message: "세션이 만료되었습니다. 다시 로그인해주세요." };
  }

  let res;
  try {
    res = await fetch(CHANNEL_UPLOAD_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${SUPABASE_CONFIG.anonKey}`,
        "apikey": SUPABASE_CONFIG.anonKey,
        "X-Session-Token": session.token
      },
      body: JSON.stringify({ channel, ad_type: adType, rows })
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

// 파워링크/쇼핑검색/브랜드검색 키워드별 성과 - sa-sync처럼 미리 저장해둔 게 아니라
// 호출할 때마다 네이버 API에서 그 기간을 바로 조회해온다 (그래서 시간이 좀 걸릴 수 있다).
async function fetchSaKeywordPerformance(campaignType, { dateFrom, dateTo } = {}) {
  const session = getSession();
  if (!session) {
    return { success: false, message: "세션이 만료되었습니다. 다시 로그인해주세요." };
  }

  let res;
  try {
    res = await fetch(SA_KEYWORD_PERFORMANCE_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${SUPABASE_CONFIG.anonKey}`,
        "apikey": SUPABASE_CONFIG.anonKey,
        "X-Session-Token": session.token
      },
      body: JSON.stringify({
        campaign_type: campaignType,
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

// sa-keyword-performance(API 실시간 조회)의 수기 업로드 버전. sa_keyword_raw에서
// 조회하며, 응답 모양이 같아서 renderKeywordTable() 등 렌더링 코드는 그대로 재사용한다.
async function fetchSaManualKeywordPerformance(campaignType, { dateFrom, dateTo } = {}) {
  const session = getSession();
  if (!session) {
    return { success: false, message: "세션이 만료되었습니다. 다시 로그인해주세요." };
  }

  let res;
  try {
    res = await fetch(SA_MANUAL_KEYWORD_PERFORMANCE_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${SUPABASE_CONFIG.anonKey}`,
        "apikey": SUPABASE_CONFIG.anonKey,
        "X-Session-Token": session.token
      },
      body: JSON.stringify({
        campaign_type: campaignType,
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

// state.saMode에 따라 API(sa-performance) 또는 수기 업로드(sa_campaign_raw, gfa-performance
// 재사용)로 자동 분기한다. groupBy는 "type"(캠페인 유형별) 또는 "campaign"(캠페인별).
function fetchSaPerformanceAny(groupBy, opts) {
  if (state.saMode === "manual") {
    return fetchGfaPerformance(groupBy === "type" ? "sa_campaign_type" : "sa_campaign", opts);
  }
  return fetchSaPerformance(groupBy, opts);
}

// state.saMode에 따라 API(sa-keyword-performance) 또는 수기 업로드
// (sa-manual-keyword-performance)로 자동 분기한다.
function fetchSaKeywordPerformanceAny(campaignType, opts) {
  if (state.saMode === "manual") {
    return fetchSaManualKeywordPerformance(campaignType, opts);
  }
  return fetchSaKeywordPerformance(campaignType, opts);
}

// sa-product-performance(API 모드)의 수기 업로드 버전. sa_product_raw는 상품명이 아니라
// 소재ID로 올라오기 때문에, sa-manual-product-performance가 sa_product_mapping(소재ID<->
// 상품명, "상품별 데이터" 페이지에서 업로드)과 서버에서 조인해서 상품명 기준으로 합산해준다.
async function fetchSaManualProductPerformance({ dateFrom, dateTo } = {}) {
  const session = getSession();
  if (!session) {
    return { success: false, message: "세션이 만료되었습니다. 다시 로그인해주세요." };
  }

  let res;
  try {
    res = await fetch(SA_MANUAL_PRODUCT_PERFORMANCE_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${SUPABASE_CONFIG.anonKey}`,
        "apikey": SUPABASE_CONFIG.anonKey,
        "X-Session-Token": session.token
      },
      body: JSON.stringify({ date_from: dateFrom, date_to: dateTo })
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

// state.saMode에 따라 API(sa-product-performance) 또는 수기 업로드
// (sa-manual-product-performance, 소재ID<->상품명 매핑 조인)로 자동 분기한다.
function fetchSaProductPerformanceAny(opts) {
  if (state.saMode === "manual") {
    return fetchSaManualProductPerformance(opts);
  }
  return fetchSaProductPerformance(opts);
}

async function uploadSaProductMapping(rows) {
  const session = getSession();
  if (!session) {
    return { success: false, message: "세션이 만료되었습니다. 다시 로그인해주세요." };
  }

  let res;
  try {
    res = await fetch(SA_PRODUCT_MAPPING_UPLOAD_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${SUPABASE_CONFIG.anonKey}`,
        "apikey": SUPABASE_CONFIG.anonKey,
        "X-Session-Token": session.token
      },
      body: JSON.stringify({ rows })
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

async function uploadSaProductModelMapping(rows) {
  const session = getSession();
  if (!session) {
    return { success: false, message: "세션이 만료되었습니다. 다시 로그인해주세요." };
  }

  let res;
  try {
    res = await fetch(SA_PRODUCT_MODEL_MAPPING_UPLOAD_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${SUPABASE_CONFIG.anonKey}`,
        "apikey": SUPABASE_CONFIG.anonKey,
        "X-Session-Token": session.token
      },
      body: JSON.stringify({ rows })
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

async function fetchSaProductPerformance({ dateFrom, dateTo } = {}) {
  const session = getSession();
  if (!session) {
    return { success: false, message: "세션이 만료되었습니다. 다시 로그인해주세요." };
  }

  let res;
  try {
    res = await fetch(SA_PRODUCT_PERFORMANCE_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${SUPABASE_CONFIG.anonKey}`,
        "apikey": SUPABASE_CONFIG.anonKey,
        "X-Session-Token": session.token
      },
      body: JSON.stringify({ date_from: dateFrom, date_to: dateTo })
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
   4-2. 브랜드검색 계약비용 (네이버 API로 못 가져와서 직접 입력/저장)
--------------------------------------------------------- */
async function callBrandSearchContract(body) {
  const session = getSession();
  if (!session) {
    return { success: false, message: "세션이 만료되었습니다. 다시 로그인해주세요." };
  }

  let res;
  try {
    res = await fetch(SA_BRAND_SEARCH_CONTRACT_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${SUPABASE_CONFIG.anonKey}`,
        "apikey": SUPABASE_CONFIG.anonKey,
        "X-Session-Token": session.token
      },
      body: JSON.stringify(body)
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
    return { success: false, message: payload.message || "요청 처리에 실패했습니다." };
  }

  return payload;
}

function fetchBrandSearchContracts() {
  return callBrandSearchContract({ action: "list" });
}

function saveBrandSearchContract(dateFrom, dateTo, contractCost) {
  return callBrandSearchContract({ action: "save", date_from: dateFrom, date_to: dateTo, contract_cost: contractCost });
}

function deleteBrandSearchContract(id) {
  return callBrandSearchContract({ action: "delete", id });
}

/* ---------------------------------------------------------
   4-3. SA 구매완료수 보정값 (네이버 API 전환수가 화면 값과 달라서 직접 입력)
--------------------------------------------------------- */
async function callConversionOverride(body) {
  const session = getSession();
  if (!session) {
    return { success: false, message: "세션이 만료되었습니다. 다시 로그인해주세요." };
  }

  let res;
  try {
    res = await fetch(SA_CONVERSION_OVERRIDE_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${SUPABASE_CONFIG.anonKey}`,
        "apikey": SUPABASE_CONFIG.anonKey,
        "X-Session-Token": session.token
      },
      body: JSON.stringify(body)
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
    return { success: false, message: payload.message || "요청 처리에 실패했습니다." };
  }

  return payload;
}

function fetchConversionOverrides() {
  return callConversionOverride({ action: "list" });
}

function saveConversionOverride(date, campaignType, conversions) {
  return callConversionOverride({ action: "save", date, campaign_type: campaignType, conversions });
}

// rows: [{date, campaign_type, conversions}] - "캠페인 유형별 구매완료수 보고서" 업로드용.
// 매번 전체 스냅샷으로 그 광고주의 기존 보정값을 통째로 교체한다.
function bulkSaveConversionOverrides(rows) {
  return callConversionOverride({ action: "bulk_save", rows });
}

function deleteConversionOverride(id) {
  return callConversionOverride({ action: "delete", id });
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

const storePickerScreen = document.getElementById("storePickerScreen");
const storePickerList = document.getElementById("storePickerList");
const storePickerError = document.getElementById("storePickerError");
const storePickerBackBtn = document.getElementById("storePickerBackBtn");

const sidebar = document.getElementById("sidebar");
const sidebarMenuList = document.getElementById("sidebarMenuList");
const sidebarBackdrop = document.getElementById("sidebarBackdrop");
const menuToggle = document.getElementById("menuToggle");
const channelSwitch = document.getElementById("channelSwitch");
const overviewTitle = document.getElementById("overviewTitle");

const advertiserNameEl = document.getElementById("advertiserName");
const periodLabel = document.getElementById("periodLabel");
const logoutBtn = document.getElementById("logoutBtn");
const pdfExportBtn = document.getElementById("pdfExportBtn");
const htmlReportBtn = document.getElementById("htmlReportBtn");

const kpiGrid = document.getElementById("kpiGrid");
const viewOverview = document.getElementById("view-overview");
const viewPlaceholder = document.getElementById("view-placeholder");
const placeholderTitle = document.getElementById("placeholderTitle");

const viewGrouped = document.getElementById("view-grouped");
const groupedTitle = document.getElementById("groupedTitle");
const groupedNameHeader = document.getElementById("groupedNameHeader");
const groupedTableBody = document.getElementById("groupedTableBody");

const viewUpload = document.getElementById("view-upload");
const viewSaUpload = document.getElementById("view-sa-upload");
const viewSaConversionUpload = document.getElementById("view-sa-conversion-upload");

const viewChannelOverview = document.getElementById("view-channel-overview");
const channelOverviewTitle = document.getElementById("channelOverviewTitle");
const channelOverviewEmptyNotice = document.getElementById("channelOverviewEmptyNotice");
const channelKpiGrid = document.getElementById("channelKpiGrid");
const channelAdTypeTableBody = document.getElementById("channelAdTypeTableBody");
const channelCampaignTableBody = document.getElementById("channelCampaignTableBody");

const viewChannelUpload = document.getElementById("view-channel-upload");
const channelUploadTitle = document.getElementById("channelUploadTitle");

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
const analysisCustomFrom = document.getElementById("analysisCustomFrom");
const analysisCustomTo = document.getElementById("analysisCustomTo");
const analysisCustomConfirmBtn = document.getElementById("analysisCustomConfirmBtn");

const compareYearSelect = document.getElementById("compareYearSelect");
const compareMonthSelect = document.getElementById("compareMonthSelect");
const compareWeekSelect = document.getElementById("compareWeekSelect");
const compareDaySelect = document.getElementById("compareDaySelect");
const compareConfirmBtn = document.getElementById("compareConfirmBtn");
const compareResetBtn = document.getElementById("compareResetBtn");
const compareCustomFrom = document.getElementById("compareCustomFrom");
const compareCustomTo = document.getElementById("compareCustomTo");
const compareCustomConfirmBtn = document.getElementById("compareCustomConfirmBtn");

const viewModel = document.getElementById("view-model");
const modelViewTitle = document.getElementById("modelViewTitle");
const modelViewNotice = document.getElementById("modelViewNotice");
const productMappingUploadCard = document.getElementById("productMappingUploadCard");
const productMappingUploadForm = document.getElementById("productMappingUploadForm");
const productMappingFileInput = document.getElementById("productMappingFileInput");
const productMappingUploadStatus = document.getElementById("productMappingUploadStatus");
const productModelMappingUploadCard = document.getElementById("productModelMappingUploadCard");
const productModelMappingUploadForm = document.getElementById("productModelMappingUploadForm");
const productModelMappingFileInput = document.getElementById("productModelMappingFileInput");
const productModelMappingUploadStatus = document.getElementById("productModelMappingUploadStatus");
const modelListCard = document.getElementById("modelListCard");
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

const viewKeyword = document.getElementById("view-keyword");
const keywordViewTitle = document.getElementById("keywordViewTitle");
const keywordViewNotice = document.getElementById("keywordViewNotice");
const keywordViewSubtitle = document.getElementById("keywordViewSubtitle");
const keywordSearchInput = document.getElementById("keywordSearchInput");
const keywordTableBody = document.getElementById("keywordTableBody");

const brandSearchContractCard = document.getElementById("brandSearchContractCard");
const brandSearchContractForm = document.getElementById("brandSearchContractForm");
const brandSearchContractFrom = document.getElementById("brandSearchContractFrom");
const brandSearchContractTo = document.getElementById("brandSearchContractTo");
const brandSearchContractCost = document.getElementById("brandSearchContractCost");
const brandSearchContractStatus = document.getElementById("brandSearchContractStatus");
const brandSearchContractTableBody = document.getElementById("brandSearchContractTableBody");

const overviewEmptyNotice = document.getElementById("overviewEmptyNotice");

const conversionOverrideCard = document.getElementById("conversionOverrideCard");
const conversionOverrideForm = document.getElementById("conversionOverrideForm");
const conversionOverrideDate = document.getElementById("conversionOverrideDate");
const conversionOverrideType = document.getElementById("conversionOverrideType");
const conversionOverrideValue = document.getElementById("conversionOverrideValue");
const conversionOverrideStatus = document.getElementById("conversionOverrideStatus");
const conversionOverrideTableBody = document.getElementById("conversionOverrideTableBody");
const conversionOverrideUploadForm = document.getElementById("conversionOverrideUploadForm");
const conversionOverrideFileInput = document.getElementById("conversionOverrideFileInput");
const conversionOverrideUploadStatus = document.getElementById("conversionOverrideUploadStatus");

const campaignTypeSection = document.getElementById("campaignTypeSection");
const campaignTypeFilter = document.getElementById("campaignTypeFilter");
const campaignTypeTableBody = document.getElementById("campaignTypeTableBody");

const gfaCampaignTypeSection = document.getElementById("gfaCampaignTypeSection");
const gfaCampaignTypeTableBody = document.getElementById("gfaCampaignTypeTableBody");

const topProductSection = document.getElementById("topProductSection");
const topProductAnalysisTitle = document.getElementById("topProductAnalysisTitle");
const topProductAnalysisGrid = document.getElementById("topProductAnalysisGrid");
const topProductCompareTitle = document.getElementById("topProductCompareTitle");
const topProductCompareGrid = document.getElementById("topProductCompareGrid");

const breakdownTitle = document.getElementById("breakdownTitle");
const breakdownFilter = document.getElementById("breakdownFilter");
const breakdownTable = document.getElementById("breakdownTable");
const breakdownTableBody = document.getElementById("breakdownTableBody");
const breakdownNameHeader = document.getElementById("breakdownNameHeader");

const state = {
  charts: {},
  currentChannel: "SA",
  // 로그인한 광고주에게 보여줄 채널 탭 목록. showDashboard()에서 advertiser.enabled_channels로 정해진다.
  enabledChannels: ["SA", "GFA"],
  // "api" = sa-sync 자동 동기화(네이버 API), "manual" = sa_campaign_raw 등 수기 업로드.
  // showDashboard()에서 로그인 응답의 advertiser.sa_manual로 정해진다.
  saMode: "api",
  currentView: "overview",
  analysisPeriod: null,
  comparisonPeriod: null,
  breakdownRawType: "campaign",
  breakdownRows: [],
  campaignTypeRows: [],
  modelViewRows: [],
  modelViewOpts: null,
  keywordViewRows: [],
  brandSearchContractRows: [],
  conversionOverrideRows: [],
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
   ---------------------------------------------------------
   같은 고객번호로 스토어(광고주)가 여러 개 매칭되면, advertiser-login이
   세션 토큰 없이 스토어 목록만 돌려준다. 그 목록을 선택 화면에 보여주고,
   사용자가 카드를 고르면 advertiser_id를 같이 넣어 다시 로그인 요청을
   보내 실제 세션 토큰을 받는다. 비밀번호는 그 사이 변수에만 잠깐 담아두고
   저장소(sessionStorage 등)에는 절대 쓰지 않는다.
--------------------------------------------------------- */
let pendingLoginPassword = null;

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

  if (result.success && result.requiresSelection) {
    pendingLoginPassword = password;
    passwordInput.value = "";
    renderStorePicker(result.stores);
    loginScreen.hidden = true;
    storePickerScreen.hidden = false;
  } else if (result.success) {
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

function renderStorePicker(stores) {
  storePickerError.hidden = true;
  storePickerList.innerHTML = stores
    .map(
      (store) => `
        <button type="button" class="store-picker-item" data-advertiser-id="${escapeHtml(store.id)}">
          <span class="store-picker-item-name">${escapeHtml(store.name)}</span>
          <span class="store-picker-item-arrow">→</span>
        </button>
      `
    )
    .join("");
}

storePickerList.addEventListener("click", async (e) => {
  const btn = e.target.closest(".store-picker-item");
  if (!btn || btn.disabled || !pendingLoginPassword) return;

  storePickerError.hidden = true;
  storePickerList.querySelectorAll(".store-picker-item").forEach((el) => (el.disabled = true));

  const result = await authenticateAdvertiser(pendingLoginPassword, btn.dataset.advertiserId);

  if (result.success && result.advertiser) {
    pendingLoginPassword = null;
    storePickerScreen.hidden = true;
    showDashboard(result.advertiser);
  } else {
    storePickerList.querySelectorAll(".store-picker-item").forEach((el) => (el.disabled = false));
    storePickerError.textContent = result.message || "선택한 스토어로 접속하지 못했습니다.";
    storePickerError.hidden = false;
  }
});

storePickerBackBtn.addEventListener("click", () => {
  pendingLoginPassword = null;
  storePickerScreen.hidden = true;
  loginScreen.hidden = false;
  passwordInput.value = "";
  passwordInput.focus();
});

logoutBtn.addEventListener("click", () => {
  clearSession();
  dashboardScreen.hidden = true;
  loginScreen.hidden = false;
  loginError.hidden = true;
  passwordInput.value = "";
  passwordInput.focus();
});

/* ---------------------------------------------------------
   현재 화면(지금 열려있는 뷰) 그대로 PDF로 저장
--------------------------------------------------------- */
pdfExportBtn.addEventListener("click", exportCurrentViewToPdf);
htmlReportBtn.addEventListener("click", generateHtmlReport);

// jsPDF 내장 폰트(Helvetica 등)는 한글 글리프가 없어서 pdf.text()로 직접 그리면
// 깨진 문자가 나온다. 그래서 헤더도 본문처럼 html2canvas로 화면 그대로 캡처해서
// 이미지로 넣는다 (브라우저가 렌더링하므로 한글이 정상적으로 나온다).
// 로고/브랜드 컬러(로그인 화면과 동일한 그라디언트)를 넣어 톤앤매너를 맞춘다.
let pdfHeaderLogoUidCounter = 0;
function buildPdfHeaderElement(titleText, subtitleText) {
  const uid = `pdfhdr${++pdfHeaderLogoUidCounter}`;
  const el = document.createElement("div");
  el.style.cssText =
    "position:fixed; left:-9999px; top:0; width:900px; box-sizing:border-box; padding:18px 24px; " +
    "background:#ffffff; border:1px solid #e4e8f0; border-radius:12px; " +
    "font-family:'Malgun Gothic', 'Apple SD Gothic Neo', sans-serif; " +
    "display:flex; align-items:center; gap:14px;";
  el.innerHTML = `
    <svg width="40" height="36" viewBox="0 0 100 90" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="${uid}Blue" cx="35%" cy="30%" r="75%">
          <stop offset="0%" stop-color="#eaf1fc"/>
          <stop offset="55%" stop-color="#5f8ad9"/>
          <stop offset="100%" stop-color="#1f4a9b"/>
        </radialGradient>
        <radialGradient id="${uid}Red" cx="35%" cy="30%" r="75%">
          <stop offset="0%" stop-color="#fceceb"/>
          <stop offset="50%" stop-color="#e2545a"/>
          <stop offset="100%" stop-color="#b81f2d"/>
        </radialGradient>
        <radialGradient id="${uid}Yellow" cx="35%" cy="30%" r="75%">
          <stop offset="0%" stop-color="#fffbe8"/>
          <stop offset="55%" stop-color="#f6cf4b"/>
          <stop offset="100%" stop-color="#e2a41a"/>
        </radialGradient>
      </defs>
      <line x1="26" y1="60" x2="58" y2="24" stroke="#e08a2e" stroke-width="3"/>
      <line x1="58" y1="24" x2="84" y2="16" stroke="#eab54a" stroke-width="3"/>
      <circle cx="26" cy="60" r="24" fill="url(#${uid}Blue)"/>
      <circle cx="58" cy="24" r="14" fill="url(#${uid}Red)"/>
      <circle cx="84" cy="16" r="11" fill="url(#${uid}Yellow)"/>
    </svg>
    <div style="border-left:3px solid #1f4a9b; padding-left:14px; flex:1;">
      <div style="font-size:11px; font-weight:700; letter-spacing:1px; color:#1f4a9b; text-transform:uppercase; margin-bottom:2px;">LinkPrice · ADS PERFORMANCE</div>
      <div style="font-size:22px; font-weight:700; color:#1a1f2b; margin-bottom:4px;">${escapeHtml(titleText)}</div>
      <div style="font-size:13px; color:#5a6275;">${escapeHtml(subtitleText)}</div>
    </div>
  `;
  document.body.appendChild(el);
  return el;
}

// html2canvas는 Chart.js가 그려둔 <canvas>를 직접 캡처하려고 하면 멈춰버리는 경우가
// 있다(무한 대기). 그래서 캡처 직전에 각 canvas를 현재 그려진 그림을 담은 <img>로
// 잠깐 바꿔치기하고(같은 자리에 겹쳐서), 캡처가 끝나면 원래대로 되돌린다.
function swapCanvasesForImages(root) {
  const canvases = [...root.querySelectorAll("canvas")];
  const restore = canvases.map((canvas) => {
    const rect = canvas.getBoundingClientRect();
    const img = document.createElement("img");
    img.src = canvas.toDataURL("image/png");
    img.style.cssText = `width:${rect.width}px; height:${rect.height}px; display:block;`;
    canvas.insertAdjacentElement("afterend", img);
    const prevDisplay = canvas.style.display;
    canvas.style.display = "none";
    return () => {
      img.remove();
      canvas.style.display = prevDisplay;
    };
  });
  return () => restore.forEach((fn) => fn());
}

async function captureElementAsCanvas(el) {
  const restore = swapCanvasesForImages(el);
  try {
    return await html2canvas(el, { scale: 2, backgroundColor: "#f3f5f9", useCORS: true });
  } finally {
    restore();
  }
}

// pdf에 [헤더 이미지 + target 캡처 이미지]를 한 구역으로 추가한다. 내용이 한
// 페이지보다 길면 이어서 새 페이지를 계속 만든다. isFirstSection이 false면
// 이 구역 자체를 새 페이지에서 시작한다(SA/GFA를 각각 별도 페이지로 나눌 때 사용).
async function addPdfSection(pdf, target, titleText, subtitleText, isFirstSection) {
  const headerEl = buildPdfHeaderElement(titleText, subtitleText);
  const headerCanvas = await captureElementAsCanvas(headerEl);
  document.body.removeChild(headerEl);

  const contentCanvas = await captureElementAsCanvas(target);

  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 28;
  const imgWidth = pageWidth - margin * 2;

  if (!isFirstSection) pdf.addPage();

  const headerImgHeight = (headerCanvas.height * imgWidth) / headerCanvas.width;
  pdf.addImage(headerCanvas.toDataURL("image/png"), "PNG", margin, margin, imgWidth, headerImgHeight);

  const contentImgHeight = (contentCanvas.height * imgWidth) / contentCanvas.width;
  const contentImgData = contentCanvas.toDataURL("image/png");
  let position = margin + headerImgHeight + 16;
  pdf.addImage(contentImgData, "PNG", margin, position, imgWidth, contentImgHeight);

  let heightLeft = contentImgHeight - (pageHeight - position);
  while (heightLeft > 0) {
    pdf.addPage();
    position = -(contentImgHeight - heightLeft);
    pdf.addImage(contentImgData, "PNG", margin, position, imgWidth, contentImgHeight);
    heightLeft -= pageHeight;
  }
}

async function exportCurrentViewToPdf() {
  const originalLabel = pdfExportBtn.textContent;
  pdfExportBtn.disabled = true;
  pdfExportBtn.textContent = "생성 중...";

  const savedChannel = state.currentChannel;
  const advertiserName = advertiserNameEl.textContent || "";

  try {
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF("p", "pt", "a4");
    const viewLabel = (MENU_ITEMS.find((m) => m.id === state.currentView) || {}).label || "";
    let fileLabel = viewLabel;

    if (state.currentView === "overview") {
      // "성과 대시보드"는 지금 보고 있는 채널과 상관없이 SA를 먼저, GFA를 그 다음
      // 페이지로 항상 같이 뽑는다 (SA/GFA를 한 리포트로 같이 보고 싶어함). 채널별로
      // 성과 대시보드 다음 페이지에 상품별 데이터도 이어서 넣는다.
      fileLabel = "성과대시보드";
      const channels = ["SA", "GFA"];
      let isFirstSection = true;
      for (const channel of channels) {
        state.currentChannel = channel;
        applyChannelVisibility();

        viewModel.hidden = true;
        viewOverview.hidden = false;
        await renderOverview();
        let target = document.querySelector("#content .view:not([hidden])");
        await addPdfSection(
          pdf,
          target,
          advertiserName,
          `${CHANNEL_LABELS[channel]} 성과 대시보드 · ${periodLabel.textContent || ""}`,
          isFirstSection
        );
        isFirstSection = false;

        viewOverview.hidden = true;
        viewModel.hidden = false;
        await renderModelView();
        // 리포트에는 업로드용 위젯이 들어갈 필요가 없으니(데이터가 아니라 조작용 UI라)
        // 캡처 직전에만 숨긴다. 채널을 다시 바꾸면 renderModelView가 알아서 원래 상태로
        // 되돌려두니 따로 복원할 필요는 없다.
        productMappingUploadCard.hidden = true;
        productModelMappingUploadCard.hidden = true;
        // Chart.js는 캔버스에 실제로 그리는 게 requestAnimationFrame 기준이라, renderModelView가
        // resolve된 시점에는 아직 안 그려져 있을 수 있다. 캡처 전에 두 프레임 정도 기다려서
        // 차트가 빈 이미지로 캡처되는 걸 막는다.
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        target = document.querySelector("#content .view:not([hidden])");
        await addPdfSection(
          pdf,
          target,
          advertiserName,
          `${CHANNEL_LABELS[channel]} 상품별 데이터 · ${periodLabel.textContent || ""}`,
          false
        );
      }
      // 마지막이 GFA로 끝나면 아래 finally의 채널 복원 로직이 화면을 다시 안 그릴 수 있어
      // (원래 채널도 GFA였던 경우), 뷰 표시 상태만 먼저 "성과 대시보드"로 되돌려둔다.
      viewModel.hidden = true;
      viewOverview.hidden = false;
    } else {
      const target = document.querySelector("#content .view:not([hidden])");
      if (!target) return;
      await addPdfSection(pdf, target, advertiserName, `${viewLabel} · ${periodLabel.textContent || ""}`, true);
    }

    const advertiserSlug = (advertiserName || "advertiser").replace(/\s+/g, "_");
    const dateStr = new Date().toISOString().slice(0, 10);
    pdf.save(`${advertiserSlug}_${fileLabel}_${dateStr}.pdf`);
  } catch (e) {
    console.error("[pdf export]", e);
    alert("PDF 생성 중 오류가 발생했습니다.");
  } finally {
    // 내보내는 동안 화면이 채널별로 바뀌었을 수 있으니, 원래 보고 있던 채널로 되돌린다.
    if (state.currentChannel !== savedChannel) {
      state.currentChannel = savedChannel;
      applyChannelVisibility();
      channelSwitch.querySelectorAll(".channel-tab").forEach((btn) => {
        const isActive = btn.dataset.channel === savedChannel;
        btn.classList.toggle("active", isActive);
        btn.setAttribute("aria-selected", String(isActive));
      });
      renderSidebarMenu();
      renderCurrentView();
    }

    pdfExportBtn.disabled = false;
    pdfExportBtn.textContent = originalLabel;
  }
}

/* ---------------------------------------------------------
   광고주에게 보낼 수 있는 독립 실행형 HTML 보고서 다운로드
   ---------------------------------------------------------
   지금 로그인된 광고주 + 지금 선택된 분석기간 기준으로 SA/GFA 데이터를 모두
   가져와서, Supabase 세션 없이도 브라우저에서 그냥 열어볼 수 있는 정적 HTML
   파일 하나로 묶어 다운로드한다 (Tailwind/Chart.js는 CDN으로 불러오지만,
   데이터 자체는 파일 안에 그대로 박아넣는다).
--------------------------------------------------------- */
const SA_KEYWORD_CAMPAIGN_TYPES = [
  { code: "WEB_SITE", label: "파워링크" },
  { code: "SHOPPING", label: "쇼핑검색" },
  { code: "BRAND_SEARCH", label: "브랜드검색" }
];

async function generateHtmlReport() {
  const originalLabel = htmlReportBtn.textContent;
  htmlReportBtn.disabled = true;
  htmlReportBtn.textContent = "생성 중...";

  try {
    const { from, to } = state.analysisPeriod;
    const advertiserName = advertiserNameEl.textContent || "광고주";

    const [
      saTypeResult,
      saProductResult,
      ...saKeywordResults
    ] = await Promise.all([
      // "campaign" 그룹이 아니라 "type"(캠페인 유형별) 그룹으로 가져와야 구매완료수
      // 보정값(sa_conversion_overrides)이 반영된다 (sa-performance는 group_by="type"일
      // 때만 보정값을 더해준다 - renderSaOverview의 성과 대시보드 KPI와 동일한 방식).
      fetchSaPerformanceAny("type", { dateFrom: from, dateTo: to }),
      fetchSaProductPerformanceAny({ dateFrom: from, dateTo: to }),
      ...SA_KEYWORD_CAMPAIGN_TYPES.map((t) => fetchSaKeywordPerformanceAny(t.code, { dateFrom: from, dateTo: to }))
    ]);

    const [gfaCampaignResult, gfaAdvResult, gfaCreativeResult] = await Promise.all([
      fetchGfaPerformance("campaign", { dateFrom: from, dateTo: to }),
      fetchGfaPerformance("adv", { dateFrom: from, dateTo: to }),
      fetchGfaPerformance("creative", { dateFrom: from, dateTo: to })
    ]);

    const saKeywords = [];
    SA_KEYWORD_CAMPAIGN_TYPES.forEach((t, i) => {
      const r = saKeywordResults[i];
      if (r.success) {
        r.rows.forEach((row) => saKeywords.push({ ...row, campaignType: t.label }));
      }
    });

    const report = {
      advertiserName,
      periodLabel: formatPeriodRange(state.analysisPeriod),
      generatedAt: new Date().toISOString().slice(0, 10),
      sa: {
        kpi: withDerivedMetrics(saTypeResult.success ? sumRawTotals(saTypeResult.rows) : { impressions: 0, clicks: 0, cost: 0, conversions: 0, revenue: 0 }),
        products: saProductResult.success ? saProductResult.rows.map((r) => ({ name: r.name, impressions: r.impressions, clicks: r.clicks, cost: r.cost, conversions: r.conversions, revenue: r.revenue, ctr: r.ctr, cvr: r.cvr, roas: r.roas })) : [],
        keywords: saKeywords
      },
      gfa: {
        kpi: withDerivedMetrics(gfaCampaignResult.success ? sumRawTotals(gfaCampaignResult.rows) : { impressions: 0, clicks: 0, cost: 0, conversions: 0, revenue: 0 }),
        products: gfaAdvResult.success ? gfaAdvResult.rows.map((r) => ({ name: extractModelCodeFromProductName(r.name) || r.name, impressions: r.impressions, clicks: r.clicks, cost: r.cost, conversions: r.conversions, revenue: r.revenue, ctr: r.ctr, cvr: r.cvr, roas: r.roas })) : [],
        creatives: gfaCreativeResult.success ? gfaCreativeResult.rows.map((r) => ({ name: r.name, impressions: r.impressions, clicks: r.clicks, cost: r.cost, conversions: r.conversions, revenue: r.revenue, ctr: r.ctr, cvr: r.cvr, roas: r.roas })) : []
      }
    };

    const html = buildReportHtmlDocument(report);
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const slug = advertiserName.replace(/\s+/g, "_");
    a.href = url;
    a.download = `${slug}_광고운영보고서_${from}~${to}.html`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (e) {
    console.error("[html report]", e);
    alert("보고서 생성 중 오류가 발생했습니다.");
  } finally {
    htmlReportBtn.disabled = false;
    htmlReportBtn.textContent = originalLabel;
  }
}

function buildReportHtmlDocument(report) {
  const dataScript = "const REPORT = " + JSON.stringify(report) + ";";

  const renderScript = [
    "function esc(s){ s = String(s == null ? '' : s); return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\"/g,'&quot;'); }",
    "function fmtNum(n){ return Math.round(n).toLocaleString('ko-KR'); }",
    "function fmtWon(n){ return Math.round(n).toLocaleString('ko-KR') + '원'; }",
    "function fmtPct(n){ return n.toFixed(2) + '%'; }",
    "var KPI_DEFS = [",
    "  {key:'impressions', label:'노출수', fmt:fmtNum},",
    "  {key:'clicks', label:'클릭수', fmt:fmtNum},",
    "  {key:'ctr', label:'클릭률', fmt:fmtPct},",
    "  {key:'cpc', label:'CPC', fmt:fmtWon},",
    "  {key:'cost', label:'총비용', fmt:fmtWon},",
    "  {key:'conversions', label:'전환수', fmt:fmtNum},",
    "  {key:'cvr', label:'전환율', fmt:fmtPct},",
    "  {key:'revenue', label:'전환매출액', fmt:fmtWon},",
    "  {key:'roas', label:'ROAS', fmt:function(n){return n+'%';}},",
    "  {key:'cpa', label:'전환당비용', fmt:fmtWon}",
    "];",
    "function renderKpi(gridId, kpi){",
    "  var el = document.getElementById(gridId);",
    "  var html = '';",
    "  for (var i=0;i<KPI_DEFS.length;i++){",
    "    var d = KPI_DEFS[i];",
    "    html += '<div class=\"bg-white rounded-xl shadow-sm border border-slate-200 p-4\">' +",
    "      '<p class=\"text-xs text-slate-500 font-medium\">' + d.label + '</p>' +",
    "      '<p class=\"text-xl font-bold text-slate-900 mt-1\">' + d.fmt(kpi[d.key]) + '</p>' +",
    "      '</div>';",
    "  }",
    "  el.innerHTML = html;",
    "}",
    "function top5ByRevenue(list){",
    "  return list.slice().sort(function(a,b){ return b.revenue - a.revenue; }).slice(0,5);",
    "}",
    "function renderProductCharts(prefix, products){",
    "  var top5 = top5ByRevenue(products);",
    "  var colors = ['#2563eb','#38bdf8','#22c55e','#f59e0b','#a855f7'];",
    "  var total = top5.reduce(function(s,m){ return s + m.revenue; }, 0);",
    "  var pctOf = function(rev){ return total > 0 ? ((rev/total)*100).toFixed(1) : '0.0'; };",
    "  new Chart(document.getElementById(prefix + 'DonutChart'), {",
    "    type: 'doughnut',",
    "    data: {",
    "      labels: top5.map(function(m){ return m.name + ' (' + pctOf(m.revenue) + '%)'; }),",
    "      datasets: [{ data: top5.map(function(m){ return m.revenue; }), backgroundColor: colors, borderWidth: 0 }]",
    "    },",
    "    options: { responsive:true, maintainAspectRatio:false, plugins:{ legend:{ position:'right', labels:{ boxWidth:12, font:{size:12} } } } }",
    "  });",
    "  new Chart(document.getElementById(prefix + 'BarChart'), {",
    "    data: {",
    "      labels: top5.map(function(m){ return m.name; }),",
    "      datasets: [",
    "        { type:'bar', label:'전환율(CVR) %', data: top5.map(function(m){ return Number(m.cvr.toFixed(1)); }), backgroundColor:'#2563eb', yAxisID:'y' },",
    "        { type:'line', label:'ROAS (천%)', data: top5.map(function(m){ return Number((m.roas/1000).toFixed(1)); }), borderColor:'#ef4444', backgroundColor:'#ef4444', yAxisID:'y1', tension:0.3 }",
    "      ]",
    "    },",
    "    options: {",
    "      responsive:true, maintainAspectRatio:false,",
    "      plugins:{ legend:{ position:'top', labels:{ boxWidth:12, font:{size:11} } } },",
    "      scales:{",
    "        y:{ position:'left', title:{display:true, text:'CVR (%)'}, grid:{ color:'rgba(0,0,0,0.05)' } },",
    "        y1:{ position:'right', title:{display:true, text:'ROAS (천%)'}, grid:{ drawOnChartArea:false } }",
    "      }",
    "    }",
    "  });",
    "}",
    "function productCardHtml(p){",
    "  return '<div class=\"bg-white rounded-xl shadow-sm border border-slate-200 p-5\">' +",
    "    '<h3 class=\"text-base font-bold text-slate-800 mb-2\">' + esc(p.name) + '</h3>' +",
    "    '<div class=\"bg-slate-50 rounded-lg p-3 text-xs text-slate-700 grid grid-cols-2 gap-y-2 mb-3 border border-slate-100\">' +",
    "      '<div><span class=\"text-slate-400\">노출수:</span> ' + fmtNum(p.impressions) + '</div>' +",
    "      '<div><span class=\"text-slate-400\">클릭수:</span> ' + fmtNum(p.clicks) + '</div>' +",
    "      '<div><span class=\"text-slate-400\">총비용:</span> ' + fmtWon(p.cost) + '</div>' +",
    "      '<div><span class=\"text-slate-400\">전환수:</span> ' + fmtNum(p.conversions) + '건</div>' +",
    "      '<div class=\"col-span-2 pt-2 border-t border-slate-200 text-sm\"><span class=\"text-slate-400\">총매출:</span> <span class=\"font-bold text-slate-900\">' + fmtWon(p.revenue) + '</span></div>' +",
    "      '<div class=\"col-span-2 flex justify-between font-bold\"><span><span class=\"text-slate-400 font-normal\">CVR:</span> <span class=\"text-blue-600\">' + fmtPct(p.cvr) + '</span></span><span><span class=\"text-slate-400 font-normal\">ROAS:</span> <span class=\"text-indigo-600\">' + p.roas + '%</span></span></div>' +",
    "    '</div>' +",
    "  '</div>';",
    "}",
    "function renderProductSection(prefix, products){",
    "  var sorted = products.slice().sort(function(a,b){ return b.revenue - a.revenue; });",
    "  var grid = document.getElementById(prefix + 'ProductGrid');",
    "  var moreBtn = document.getElementById(prefix + 'ProductMoreBtn');",
    "  if (sorted.length === 0){ grid.innerHTML = '<p class=\"text-sm text-slate-400\">표시할 상품 데이터가 없습니다.</p>'; moreBtn.hidden = true; return; }",
    "  renderProductCharts(prefix, sorted);",
    "  var expanded = false;",
    "  function draw(){",
    "    var list = expanded ? sorted : sorted.slice(0,3);",
    "    grid.innerHTML = list.map(productCardHtml).join('');",
    "  }",
    "  draw();",
    "  if (sorted.length <= 3){ moreBtn.hidden = true; } else {",
    "    moreBtn.hidden = false;",
    "    moreBtn.textContent = '더보기 (' + (sorted.length - 3) + '개 더 있음)';",
    "    moreBtn.addEventListener('click', function(){",
    "      expanded = !expanded;",
    "      draw();",
    "      moreBtn.textContent = expanded ? '접기' : '더보기 (' + (sorted.length - 3) + '개 더 있음)';",
    "    });",
    "  }",
    "}",
    "function renderKeywordSection(rows){",
    "  var sorted = rows.slice().sort(function(a,b){ return b.cost - a.cost; });",
    "  var tbody = document.getElementById('saKeywordTableBody');",
    "  var moreBtn = document.getElementById('saKeywordMoreBtn');",
    "  var filterWrap = document.getElementById('saKeywordFilter');",
    "  var currentType = '';",
    "  var expanded = false;",
    "  function rowHtml(r){",
    "    return '<tr>' +",
    "      '<td class=\"px-3 py-2\">' + esc(r.keyword) + '</td>' +",
    "      '<td class=\"px-3 py-2\">' + esc(r.campaign) + '</td>' +",
    "      '<td class=\"px-3 py-2\">' + esc(r.ad_group) + '</td>' +",
    "      '<td class=\"px-3 py-2\"><span class=\"text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded\">' + esc(r.campaignType) + '</span></td>' +",
    "      '<td class=\"px-3 py-2 text-right\">' + fmtNum(r.impressions) + '</td>' +",
    "      '<td class=\"px-3 py-2 text-right\">' + fmtNum(r.clicks) + '</td>' +",
    "      '<td class=\"px-3 py-2 text-right\">' + r.ctr.toFixed(2) + '%</td>' +",
    "      '<td class=\"px-3 py-2 text-right\">' + fmtWon(r.cost) + '</td>' +",
    "      '<td class=\"px-3 py-2 text-right\">' + fmtWon(r.cpc) + '</td>' +",
    "      '</tr>';",
    "  }",
    "  function draw(){",
    "    var filtered = currentType ? sorted.filter(function(r){ return r.campaignType === currentType; }) : sorted;",
    "    if (filtered.length === 0){ tbody.innerHTML = '<tr><td colspan=\"9\" class=\"px-3 py-6 text-center text-slate-400\">데이터가 없습니다.</td></tr>'; moreBtn.hidden = true; return; }",
    "    var list = expanded ? filtered : filtered.slice(0,10);",
    "    tbody.innerHTML = list.map(rowHtml).join('');",
    "    if (filtered.length <= 10){ moreBtn.hidden = true; } else {",
    "      moreBtn.hidden = false;",
    "      moreBtn.textContent = expanded ? '접기' : '더보기 (' + (filtered.length - 10) + '개 더 있음)';",
    "    }",
    "  }",
    "  filterWrap.querySelectorAll('button').forEach(function(btn){",
    "    btn.addEventListener('click', function(){",
    "      filterWrap.querySelectorAll('button').forEach(function(b){ b.classList.remove('bg-blue-600','text-white'); b.classList.add('bg-slate-100','text-slate-600'); });",
    "      btn.classList.remove('bg-slate-100','text-slate-600'); btn.classList.add('bg-blue-600','text-white');",
    "      currentType = btn.dataset.type || '';",
    "      expanded = false;",
    "      draw();",
    "    });",
    "  });",
    "  moreBtn.addEventListener('click', function(){ expanded = !expanded; draw(); });",
    "  draw();",
    "}",
    "function renderCreativeSection(rows){",
    "  var sorted = rows.slice().sort(function(a,b){ return b.revenue - a.revenue; });",
    "  var tbody = document.getElementById('gfaCreativeTableBody');",
    "  var moreBtn = document.getElementById('gfaCreativeMoreBtn');",
    "  if (sorted.length === 0){ tbody.innerHTML = '<tr><td colspan=\"9\" class=\"px-3 py-6 text-center text-slate-400\">데이터가 없습니다.</td></tr>'; moreBtn.hidden = true; return; }",
    "  var expanded = false;",
    "  function rowHtml(r){",
    "    return '<tr>' +",
    "      '<td class=\"px-3 py-2\">' + esc(r.name) + '</td>' +",
    "      '<td class=\"px-3 py-2 text-right\">' + fmtNum(r.impressions) + '</td>' +",
    "      '<td class=\"px-3 py-2 text-right\">' + fmtNum(r.clicks) + '</td>' +",
    "      '<td class=\"px-3 py-2 text-right\">' + r.ctr.toFixed(2) + '%</td>' +",
    "      '<td class=\"px-3 py-2 text-right\">' + fmtWon(r.cost) + '</td>' +",
    "      '<td class=\"px-3 py-2 text-right\">' + fmtNum(r.conversions) + '</td>' +",
    "      '<td class=\"px-3 py-2 text-right\">' + r.cvr.toFixed(2) + '%</td>' +",
    "      '<td class=\"px-3 py-2 text-right\">' + fmtWon(r.revenue) + '</td>' +",
    "      '<td class=\"px-3 py-2 text-right\">' + r.roas + '%</td>' +",
    "      '</tr>';",
    "  }",
    "  function draw(){",
    "    var list = expanded ? sorted : sorted.slice(0,10);",
    "    tbody.innerHTML = list.map(rowHtml).join('');",
    "    if (sorted.length <= 10){ moreBtn.hidden = true; } else {",
    "      moreBtn.hidden = false;",
    "      moreBtn.textContent = expanded ? '접기' : '더보기 (' + (sorted.length - 10) + '개 더 있음)';",
    "    }",
    "  }",
    "  draw();",
    "  moreBtn.addEventListener('click', function(){ expanded = !expanded; draw(); });",
    "}",
    "function setupReviewBox(id){",
    "  var el = document.getElementById(id);",
    "  var placeholder = el.textContent;",
    "  el.addEventListener('focus', function(){ if (el.textContent === placeholder){ el.textContent = ''; } });",
    "  el.addEventListener('blur', function(){ if (el.textContent.trim() === ''){ el.textContent = placeholder; } });",
    "}",
    "renderKpi('saKpiGrid', REPORT.sa.kpi);",
    "renderKpi('gfaKpiGrid', REPORT.gfa.kpi);",
    "renderProductSection('sa', REPORT.sa.products);",
    "renderProductSection('gfa', REPORT.gfa.products);",
    "renderKeywordSection(REPORT.sa.keywords);",
    "renderCreativeSection(REPORT.gfa.creatives);",
    "setupReviewBox('saReviewBox');",
    "setupReviewBox('gfaReviewBox');"
  ].join("\n");

  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(report.advertiserName)} 광고 운영 보고서</title>
<script src="https://cdn.tailwindcss.com"><\/script>
<script src="https://cdn.jsdelivr.net/npm/chart.js"><\/script>
<style>
  @import url('https://cdn.jsdelivr.net/gh/orioncactus/pretendard/dist/web/static/pretendard.css');
  html { scroll-behavior: smooth; }
  section { scroll-margin-top: 5rem; }
  body { font-family: 'Pretendard', sans-serif; background-color: #f8fafc; }
  [contenteditable]:focus { outline: none; border-color: #60a5fa; }
</style>
</head>
<body class="text-slate-800">
  <div class="fixed top-4 right-4 flex gap-2 z-40">
    <a href="#sa-section" class="px-4 py-2 bg-blue-600 text-white text-xs font-semibold rounded-full shadow-md hover:bg-blue-700">SA</a>
    <a href="#gfa-section" class="px-4 py-2 bg-indigo-600 text-white text-xs font-semibold rounded-full shadow-md hover:bg-indigo-700">GFA</a>
  </div>

  <div class="max-w-7xl mx-auto py-12 px-4 sm:px-6 lg:px-8">
    <header class="mb-12 border-b border-slate-200 pb-8">
      <h1 class="text-3xl md:text-4xl font-extrabold text-slate-900 tracking-tight">${escapeHtml(report.advertiserName)} 광고 운영 보고서</h1>
      <p class="mt-2 text-slate-500">분석 기간: ${escapeHtml(report.periodLabel)} · 생성일: ${escapeHtml(report.generatedAt)}</p>
    </header>

    <section id="sa-section" class="mb-20">
      <h2 class="text-2xl font-bold text-slate-900 mb-6">SA 성과 대시보드</h2>
      <h3 class="text-sm font-bold text-slate-500 mb-3">핵심지표</h3>
      <div class="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8" id="saKpiGrid"></div>

      <div class="bg-white rounded-xl shadow-sm border border-slate-200 p-6 mb-12">
        <h3 class="font-bold text-slate-800 mb-2">운영 리뷰</h3>
        <p class="text-xs text-slate-400 mb-3">아래 영역을 클릭해 이번 기간 운영 리뷰를 작성하세요. 작성 후 브라우저에서 Ctrl+S(다른 이름으로 저장)로 다시 저장하면 내용이 그대로 보존됩니다.</p>
        <div id="saReviewBox" contenteditable="true" class="min-h-[120px] rounded-lg border-2 border-dashed border-slate-300 p-4 text-sm text-slate-700">이번 기간 운영 리뷰를 입력하세요...</div>
      </div>

      <h2 class="text-2xl font-bold text-slate-900 mb-6">SA 상품별 데이터</h2>
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <div class="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
          <h3 class="font-bold text-slate-700 mb-4 text-center">Top 5 상품 매출 비중</h3>
          <div class="h-64 relative w-full"><canvas id="saDonutChart"></canvas></div>
        </div>
        <div class="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
          <h3 class="font-bold text-slate-700 mb-4 text-center">주요 5대 상품 전환율(CVR) & ROAS</h3>
          <div class="h-64 relative w-full"><canvas id="saBarChart"></canvas></div>
        </div>
      </div>
      <div class="flex justify-between items-end mb-4">
        <h3 class="text-lg font-bold text-slate-900">전 품목 모델별 성과 상세</h3>
      </div>
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-4" id="saProductGrid"></div>
      <div class="text-center mb-16">
        <button id="saProductMoreBtn" class="px-5 py-2 bg-slate-800 text-white text-sm font-semibold rounded-full hover:bg-slate-700">더보기</button>
      </div>

      <h2 class="text-2xl font-bold text-slate-900 mb-4">캠페인 유형별 키워드 데이터</h2>
      <div class="flex gap-2 mb-4" id="saKeywordFilter">
        <button type="button" data-type="" class="px-4 py-1.5 rounded-full text-xs font-semibold bg-blue-600 text-white">전체</button>
        <button type="button" data-type="파워링크" class="px-4 py-1.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-600">파워링크</button>
        <button type="button" data-type="쇼핑검색" class="px-4 py-1.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-600">쇼핑검색</button>
        <button type="button" data-type="브랜드검색" class="px-4 py-1.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-600">브랜드검색</button>
      </div>
      <div class="overflow-x-auto rounded-lg border border-slate-200 shadow-sm bg-white">
        <table class="w-full text-sm text-left whitespace-nowrap">
          <thead class="bg-slate-100 text-slate-600">
            <tr>
              <th class="px-3 py-3 font-bold">키워드</th>
              <th class="px-3 py-3 font-bold">캠페인</th>
              <th class="px-3 py-3 font-bold">그룹</th>
              <th class="px-3 py-3 font-bold">캠페인 유형</th>
              <th class="px-3 py-3 font-bold text-right">노출수</th>
              <th class="px-3 py-3 font-bold text-right">클릭수</th>
              <th class="px-3 py-3 font-bold text-right">CTR</th>
              <th class="px-3 py-3 font-bold text-right">총비용</th>
              <th class="px-3 py-3 font-bold text-right">CPC</th>
            </tr>
          </thead>
          <tbody id="saKeywordTableBody" class="divide-y divide-slate-100"></tbody>
        </table>
      </div>
      <div class="text-center mt-4">
        <button id="saKeywordMoreBtn" class="px-5 py-2 bg-slate-800 text-white text-sm font-semibold rounded-full hover:bg-slate-700">더보기</button>
      </div>
    </section>

    <section id="gfa-section" class="mb-16">
      <h2 class="text-2xl font-bold text-slate-900 mb-6">GFA 성과 대시보드</h2>
      <h3 class="text-sm font-bold text-slate-500 mb-3">핵심지표</h3>
      <div class="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8" id="gfaKpiGrid"></div>

      <div class="bg-white rounded-xl shadow-sm border border-slate-200 p-6 mb-12">
        <h3 class="font-bold text-slate-800 mb-2">운영 리뷰</h3>
        <p class="text-xs text-slate-400 mb-3">아래 영역을 클릭해 이번 기간 운영 리뷰를 작성하세요. 작성 후 브라우저에서 Ctrl+S(다른 이름으로 저장)로 다시 저장하면 내용이 그대로 보존됩니다.</p>
        <div id="gfaReviewBox" contenteditable="true" class="min-h-[120px] rounded-lg border-2 border-dashed border-slate-300 p-4 text-sm text-slate-700">이번 기간 운영 리뷰를 입력하세요...</div>
      </div>

      <h2 class="text-2xl font-bold text-slate-900 mb-6">GFA 상품별 데이터 (ADVoost)</h2>
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <div class="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
          <h3 class="font-bold text-slate-700 mb-4 text-center">Top 5 상품 매출 비중</h3>
          <div class="h-64 relative w-full"><canvas id="gfaDonutChart"></canvas></div>
        </div>
        <div class="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
          <h3 class="font-bold text-slate-700 mb-4 text-center">주요 5대 상품 전환율(CVR) & ROAS</h3>
          <div class="h-64 relative w-full"><canvas id="gfaBarChart"></canvas></div>
        </div>
      </div>
      <div class="flex justify-between items-end mb-4">
        <h3 class="text-lg font-bold text-slate-900">전 품목 모델별 성과 상세</h3>
      </div>
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-4" id="gfaProductGrid"></div>
      <div class="text-center mb-16">
        <button id="gfaProductMoreBtn" class="px-5 py-2 bg-slate-800 text-white text-sm font-semibold rounded-full hover:bg-slate-700">더보기</button>
      </div>

      <h2 class="text-2xl font-bold text-slate-900 mb-4">소재별 성과</h2>
      <div class="overflow-x-auto rounded-lg border border-slate-200 shadow-sm bg-white">
        <table class="w-full text-sm text-left whitespace-nowrap">
          <thead class="bg-slate-100 text-slate-600">
            <tr>
              <th class="px-3 py-3 font-bold">소재명</th>
              <th class="px-3 py-3 font-bold text-right">노출수</th>
              <th class="px-3 py-3 font-bold text-right">클릭수</th>
              <th class="px-3 py-3 font-bold text-right">CTR</th>
              <th class="px-3 py-3 font-bold text-right">총비용</th>
              <th class="px-3 py-3 font-bold text-right">전환수</th>
              <th class="px-3 py-3 font-bold text-right">CVR</th>
              <th class="px-3 py-3 font-bold text-right">총매출</th>
              <th class="px-3 py-3 font-bold text-right">ROAS</th>
            </tr>
          </thead>
          <tbody id="gfaCreativeTableBody" class="divide-y divide-slate-100"></tbody>
        </table>
      </div>
      <div class="text-center mt-4">
        <button id="gfaCreativeMoreBtn" class="px-5 py-2 bg-slate-800 text-white text-sm font-semibold rounded-full hover:bg-slate-700">더보기</button>
      </div>
    </section>

    <footer class="text-center text-sm text-slate-500 mt-12 border-t border-slate-200 pt-6 pb-8">
      <p>본 보고서는 Linkprice 광고 운영 대시보드에서 생성되었습니다.</p>
    </footer>
  </div>

  <script>
${dataScript}
${renderScript}
  <\/script>
</body>
</html>`;
}

function showDashboard(advertiser) {
  loginScreen.hidden = true;
  dashboardScreen.hidden = false;

  advertiserNameEl.textContent = advertiser.name;
  state.saMode = advertiser.sa_manual ? "manual" : "api";
  state.enabledChannels = advertiser.enabled_channels || ["SA", "GFA"];
  state.currentChannel = "SA";
  channelSwitch.querySelectorAll(".channel-tab").forEach((btn) => {
    const isActive = btn.dataset.channel === "SA";
    btn.classList.toggle("active", isActive);
    btn.setAttribute("aria-selected", String(isActive));
  });
  applyEnabledChannelsVisibility();

  state.analysisPeriod = defaultAnalysisPeriod();
  state.comparisonPeriod = computeComparisonPeriod(state.analysisPeriod.from, state.analysisPeriod.to);

  const today = new Date();
  setPickerToMonth(analysisYearSelect, analysisMonthSelect, analysisWeekSelect, analysisDaySelect, today.getFullYear(), today.getMonth() + 1);
  const compareDate = new Date(`${state.comparisonPeriod.from}T00:00:00`);
  setPickerToMonth(compareYearSelect, compareMonthSelect, compareWeekSelect, compareDaySelect, compareDate.getFullYear(), compareDate.getMonth() + 1);

  syncCustomPeriodInputs();

  applyChannelVisibility();
  renderSidebarMenu();
  switchView("overview");
}

function refreshCurrentPeriodView() {
  if (state.currentView === "overview") {
    renderOverview();
  } else if (state.currentView === "trend") {
    renderTrendView();
  } else if (state.currentView === "product") {
    renderModelView();
  } else {
    const item = MENU_ITEMS.find((m) => m.id === state.currentView);
    if (item && item.naverCampaignType) renderKeywordView(item);
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
// 연/월/주/일 드롭다운이나 바로가기로 기간이 바뀌어도, 직접 기간 선택 입력칸이
// 지금 실제로 적용된 기간을 그대로 보여주도록 맞춰준다.
function syncCustomPeriodInputs() {
  analysisCustomFrom.value = state.analysisPeriod.from;
  analysisCustomTo.value = state.analysisPeriod.to;
  compareCustomFrom.value = state.comparisonPeriod.from;
  compareCustomTo.value = state.comparisonPeriod.to;
}

analysisConfirmBtn.addEventListener("click", () => {
  state.analysisPeriod = readPickerRange(analysisYearSelect, analysisMonthSelect, analysisWeekSelect, analysisDaySelect);
  syncCustomPeriodInputs();
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
  syncCustomPeriodInputs();
  refreshCurrentPeriodView();
});

// 직접 기간 선택 - 연/월/주/일 드롭다운으로는 "하루", "그 주", "그 달"처럼 미리 정해진
// 단위만 고를 수 있어서, "8/1~8/2" 이틀만 보거나 "7~9월" 처럼 달 경계와 상관없이
// 원하는 범위를 그대로 보고 싶을 때 여기 두 날짜를 직접 입력해서 쓴다.
analysisCustomConfirmBtn.addEventListener("click", () => {
  if (!analysisCustomFrom.value || !analysisCustomTo.value) return;
  if (analysisCustomFrom.value > analysisCustomTo.value) {
    alert("시작일이 종료일보다 늦을 수 없습니다.");
    return;
  }
  state.analysisPeriod = { from: analysisCustomFrom.value, to: analysisCustomTo.value };
  refreshCurrentPeriodView();
});

compareCustomConfirmBtn.addEventListener("click", () => {
  if (!compareCustomFrom.value || !compareCustomTo.value) return;
  if (compareCustomFrom.value > compareCustomTo.value) {
    alert("시작일이 종료일보다 늦을 수 없습니다.");
    return;
  }
  state.comparisonPeriod = { from: compareCustomFrom.value, to: compareCustomTo.value };
  refreshCurrentPeriodView();
});

// 분석기간 바로가기: 이번달 보기 / 전체 선택(연도 전체) / 전체 해제(이번달로 되돌리기)
analysisThisMonthBtn.addEventListener("click", () => {
  const now = new Date();
  setPickerToMonth(analysisYearSelect, analysisMonthSelect, analysisWeekSelect, analysisDaySelect, now.getFullYear(), now.getMonth() + 1);
  state.analysisPeriod = monthsToRange(now.getFullYear(), now.getMonth() + 1, now.getMonth() + 1);
  syncCustomPeriodInputs();
  refreshCurrentPeriodView();
});
analysisAllYearBtn.addEventListener("click", () => {
  const year = Number(analysisYearSelect.value);
  state.analysisPeriod = monthsToRange(year, 1, 12);
  syncCustomPeriodInputs();
  refreshCurrentPeriodView();
});
analysisResetBtn.addEventListener("click", () => {
  const now = new Date();
  setPickerToMonth(analysisYearSelect, analysisMonthSelect, analysisWeekSelect, analysisDaySelect, now.getFullYear(), now.getMonth() + 1);
  state.analysisPeriod = monthsToRange(now.getFullYear(), now.getMonth() + 1, now.getMonth() + 1);
  syncCustomPeriodInputs();
  refreshCurrentPeriodView();
});

// 비교기간 초기화: 분석기간 기준으로 자동 계산한 "직전 같은 길이" 기간으로 되돌린다.
compareResetBtn.addEventListener("click", () => {
  state.comparisonPeriod = computeComparisonPeriod(state.analysisPeriod.from, state.analysisPeriod.to);
  const d = new Date(`${state.comparisonPeriod.from}T00:00:00`);
  setPickerToMonth(compareYearSelect, compareMonthSelect, compareWeekSelect, compareDaySelect, d.getFullYear(), d.getMonth() + 1);
  syncCustomPeriodInputs();
  refreshCurrentPeriodView();
});

/* ---------------------------------------------------------
   6-1. 채널(SA / GFA) 전환
--------------------------------------------------------- */
// ADVoost 쇼핑은 GFA 전용 - SA에서는 탭 자체를 숨기고, 그 탭이 선택된
// 상태로 SA로 넘어왔으면 캠페인별로 되돌린다. 채널 전환 시뿐 아니라
// 최초 로그인 시(SA가 기본값)에도 반영되어야 하므로 함수로 분리한다.
// 로그인한 광고주(advertiser.enabled_channels)에게 허용된 채널 탭만 보여준다.
// 문성전자처럼 EBAY/ELEVENST가 추가된 광고주가 아니면 그 탭 자체가 DOM에서 숨겨진다.
function applyEnabledChannelsVisibility() {
  channelSwitch.querySelectorAll(".channel-tab").forEach((btn) => {
    btn.hidden = !state.enabledChannels.includes(btn.dataset.channel);
  });
}

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
  // GFA 캠페인 유형별(웹사이트 전환/인지도 및 트래픽/쇼핑 프로모션/카탈로그 판매/동영상 조회)은 그 반대.
  gfaCampaignTypeSection.hidden = state.currentChannel !== "GFA";
  // 주요 상품 분석(전환수/ROAS/전환율 1위)도 SA 전용.
  topProductSection.hidden = state.currentChannel !== "SA";

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

  const [currentResult, comparisonResult, topProductAnalysisResult, topProductCompareResult] = await Promise.all([
    fetchSaPerformanceAny("type", { dateFrom: from, dateTo: to }),
    fetchSaPerformanceAny("type", { dateFrom: compareFrom, dateTo: compareTo }),
    fetchSaProductPerformanceAny({ dateFrom: from, dateTo: to }),
    fetchSaProductPerformanceAny({ dateFrom: compareFrom, dateTo: compareTo })
  ]);

  if (token === state.overviewRenderToken) {
    topProductAnalysisTitle.textContent = `분석 기간 상품 분석 (${formatPeriodRange(state.analysisPeriod)})`;
    topProductCompareTitle.textContent = `비교 기간 상품 분석 (${formatPeriodRange(state.comparisonPeriod)})`;
    renderTopProductGrid(topProductAnalysisGrid, topProductAnalysisResult.success ? topProductAnalysisResult.rows : [], state.analysisPeriod);
    renderTopProductGrid(topProductCompareGrid, topProductCompareResult.success ? topProductCompareResult.rows : [], state.comparisonPeriod);
  }

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
      state.saMode === "manual"
        ? '표시할 데이터가 없습니다. "SA 데이터 업로드" 메뉴에서 SA 캠페인 Raw를 먼저 올려주세요.'
        : "표시할 데이터가 없습니다. 네이버 SA 자동 동기화가 아직 실행되지 않았거나, 선택한 기간에 데이터가 없습니다.";
  }

  renderKpiCards(
    withDerivedMetrics(currentTotals),
    comparisonTotals ? withDerivedMetrics(comparisonTotals) : null
  );

  state.campaignTypeRows = currentResult.rows;
  renderCampaignTypeRows();

  if (state.breakdownRawType === "campaign") {
    await loadSaBreakdownData();
  } else if (state.breakdownRawType === "adgroup" && state.saMode === "manual") {
    await loadSaAdgroupBreakdownData();
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
   6-1c. 주요 상품 분석 (SA 전용) - 분석기간/비교기간 각각 전환수 1위 /
   ROAS 1위 / 전환율 1위 상품 카드 3개씩. ROAS·전환율은 클릭수가 너무
   적으면 우연히 극단적인 값이 나올 수 있어서, 최소 클릭수 이상인
   상품 중에서만 뽑는다 (전환수 1위는 그 제한 없이 전체에서 뽑는다).
--------------------------------------------------------- */
const TOP_PRODUCT_MIN_CLICKS = 30;

function computeTopProducts(rows, minClicks) {
  const withConversions = rows.filter((r) => r.conversions > 0);
  const topConversions = withConversions.length
    ? withConversions.reduce((best, r) => (r.conversions > best.conversions ? r : best))
    : null;

  const eligible = rows.filter((r) => r.clicks >= minClicks && r.cost > 0);
  const topRoas = eligible.length ? eligible.reduce((best, r) => (r.revenue / r.cost > best.revenue / best.cost ? r : best)) : null;
  const topCvr = eligible.length ? eligible.reduce((best, r) => (r.cvr > best.cvr ? r : best)) : null;

  return { topConversions, topRoas, topCvr };
}

// card: { label, row, mainValue } - row가 없으면(조건을 만족하는 상품이 없으면) 빈 카드를 보여준다.
// idx가 있으면(=row도 있으면) 클릭 가능한 카드로 만든다 (data-idx로 표시, 클릭 핸들러는
// renderTopProductGrid에서 붙인다 - "상품별 데이터" 페이지의 모델 카드와 같은 상세 모달을 연다).
function renderTopProductCard(card, idx) {
  const { label, row, mainValue } = card;

  if (!row) {
    return `
      <div class="top-product-card top-product-card-empty">
        <span class="top-product-card-label">${escapeHtml(label)}</span>
        <p class="top-product-card-empty-text">조건을 만족하는 상품이 없습니다</p>
      </div>
    `;
  }

  const roasPercent = row.cost > 0 ? ((row.revenue / row.cost) * 100).toFixed(2) : "0.00";

  return `
    <div class="top-product-card top-product-card-clickable" data-idx="${idx}">
      <span class="top-product-card-label">${escapeHtml(label)}</span>
      <span class="top-product-card-name">${escapeHtml(row.name)}</span>
      <span class="top-product-card-value">${mainValue}</span>
      <span class="top-product-card-desc">전환 ${formatNumber(row.conversions)}건 · 전환매출 ${formatWon(row.revenue)} · ROAS ${roasPercent}%</span>
    </div>
  `;
}

// period: 이 grid가 어느 기간(분석기간/비교기간) 카드인지 - 카드를 클릭해서 여는 상세
// 모달에 그 기간을 그대로 표시해주기 위해 필요하다.
function renderTopProductGrid(gridEl, rows, period) {
  const { topConversions, topRoas, topCvr } = computeTopProducts(rows, TOP_PRODUCT_MIN_CLICKS);

  const cards = [
    {
      label: "전환수 1위",
      row: topConversions,
      mainValue: topConversions ? `${formatNumber(topConversions.conversions)}건` : ""
    },
    {
      label: `ROAS 1위 (클릭 ${TOP_PRODUCT_MIN_CLICKS}건↑)`,
      row: topRoas,
      mainValue: topRoas ? `${((topRoas.revenue / topRoas.cost) * 100).toFixed(2)}%` : ""
    },
    {
      label: `전환율 1위 (클릭 ${TOP_PRODUCT_MIN_CLICKS}건↑)`,
      row: topCvr,
      mainValue: topCvr ? `${topCvr.cvr.toFixed(2)}%` : ""
    }
  ];

  gridEl.innerHTML = cards.map(renderTopProductCard).join("");

  gridEl.querySelectorAll(".top-product-card-clickable").forEach((cardEl) => {
    const row = cards[Number(cardEl.dataset.idx)].row;
    cardEl.addEventListener("click", () => {
      openModelDetailModal(
        {
          model: row.name,
          category: null,
          keywords: null,
          impressions: row.impressions,
          clicks: row.clicks,
          cost: row.cost,
          conversions: row.conversions,
          revenue: row.revenue
        },
        period
      );
    });
  });
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

  const [currentResult, comparisonResult, campaignTypeResult] = await Promise.all([
    fetchGfaPerformance("campaign", { dateFrom: from, dateTo: to }),
    fetchGfaPerformance("campaign", { dateFrom: compareFrom, dateTo: compareTo }),
    fetchGfaPerformance("campaign_type", { dateFrom: from, dateTo: to })
  ]);

  if (token !== state.overviewRenderToken) return; // 그 사이 다른 요청으로 대체됨

  if (!currentResult.success) {
    overviewEmptyNotice.hidden = false;
    overviewEmptyNotice.textContent = currentResult.message;
    renderKpiCards(withDerivedMetrics({ impressions: 0, clicks: 0, cost: 0, conversions: 0, revenue: 0 }), null);
    renderGfaCampaignTypeRows([]);
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

  renderGfaCampaignTypeRows(campaignTypeResult.success ? campaignTypeResult.rows : []);

  await loadBreakdownData();
}

/* ---------------------------------------------------------
   6-2z. 이베이/11번가(EBAY/ELEVENST) 성과 대시보드
   ---------------------------------------------------------
   GFA와 비슷하지만 훨씬 단순한 구조 - KPI + 광고 유형별 성과(고정 3행) +
   캠페인별 성과, 이렇게 두 표만 보여준다(상품/모델 분석 없음). SA/GFA 전용
   DOM(#view-overview 안의 여러 섹션)은 전혀 건드리지 않고, 별도 뷰(#view-channel-overview)를 쓴다.
--------------------------------------------------------- */
async function renderChannelOverview() {
  const channel = state.currentChannel;
  const token = ++state.overviewRenderToken;

  channelOverviewTitle.textContent = `${CHANNEL_LABELS[channel]} 성과 대시보드`;
  periodLabel.textContent = formatPeriodRange(state.analysisPeriod);

  const { from, to } = state.analysisPeriod;
  const { from: compareFrom, to: compareTo } = state.comparisonPeriod;

  const [currentResult, comparisonResult, adTypeResult] = await Promise.all([
    fetchChannelPerformance(channel, "campaign", { dateFrom: from, dateTo: to }),
    fetchChannelPerformance(channel, "campaign", { dateFrom: compareFrom, dateTo: compareTo }),
    fetchChannelPerformance(channel, "ad_type", { dateFrom: from, dateTo: to })
  ]);

  if (token !== state.overviewRenderToken) return;

  if (!currentResult.success) {
    channelOverviewEmptyNotice.hidden = false;
    channelOverviewEmptyNotice.textContent = currentResult.message;
    renderKpiCards(withDerivedMetrics({ impressions: 0, clicks: 0, cost: 0, conversions: 0, revenue: 0 }), null, channelKpiGrid);
    renderChannelAdTypeRows(channel, []);
    channelCampaignTableBody.innerHTML = `<tr><td colspan="9" class="grouped-empty">${escapeHtml(currentResult.message)}</td></tr>`;
    return;
  }

  const currentTotals = sumRawTotals(currentResult.rows);
  const comparisonTotals = comparisonResult.success ? sumRawTotals(comparisonResult.rows) : null;
  const hasData = currentResult.rows.length > 0;

  channelOverviewEmptyNotice.hidden = hasData;
  if (!hasData) {
    channelOverviewEmptyNotice.textContent =
      `표시할 데이터가 없습니다. "데이터 업로드" 메뉴에서 ${CHANNEL_LABELS[channel]} CSV를 먼저 업로드해주세요.`;
  }

  renderKpiCards(
    withDerivedMetrics(currentTotals),
    comparisonTotals ? withDerivedMetrics(comparisonTotals) : null,
    channelKpiGrid
  );

  renderChannelAdTypeRows(channel, adTypeResult.success ? adTypeResult.rows : []);

  channelCampaignTableBody.innerHTML = currentResult.rows.length
    ? currentResult.rows
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
        .join("")
    : `<tr><td colspan="9" class="grouped-empty">표시할 데이터가 없습니다.</td></tr>`;
}

// CHANNEL_AD_TYPES에 정의된 순서 그대로 3행 고정 - 데이터가 없는 유형도 0으로 표시한다.
function renderChannelAdTypeRows(channel, rows) {
  const byName = new Map(rows.map((r) => [r.name, r]));
  const order = CHANNEL_AD_TYPES[channel] || [];
  const zero = { cost: 0, revenue: 0, roas: 0, clicks: 0, ctr: 0, conversions: 0, cvr: 0, cpa: 0 };

  channelAdTypeTableBody.innerHTML = order
    .map((type) => {
      const data = byName.get(type) || zero;
      return `
        <tr>
          <td>${escapeHtml(type)}</td>
          <td>${formatWon(data.cost)}</td>
          <td>${formatWon(data.revenue)}</td>
          <td>${data.roas}%</td>
          <td>${formatNumber(data.clicks)}</td>
          <td>${data.ctr.toFixed(2)}%</td>
          <td>${formatNumber(data.conversions)}</td>
          <td>${data.cvr.toFixed(2)}%</td>
          <td>${formatWon(data.cpa)}</td>
        </tr>
      `;
    })
    .join("");
}

/* ---------------------------------------------------------
   6-2a. GFA 캠페인 유형별 성과 (웹사이트 전환 / 인지도 및 트래픽 / 쇼핑 프로모션 / 카탈로그 판매 / 동영상 조회)
   ---------------------------------------------------------
   캠페인 Raw 업로드 시 "캠페인 목적" 컬럼에서 뽑아 저장해둔 campaign_type 기준으로,
   고정된 유형 5개는 항상 순서대로 보여주고 그 외 값(또는 비어있는 값)은 "기타"로 묶는다.
--------------------------------------------------------- */
function renderGfaCampaignTypeRows(rows) {
  const byName = new Map(rows.map((r) => [r.name, r]));

  const etcAcc = { impressions: 0, clicks: 0, cost: 0, conversions: 0, revenue: 0 };
  rows.forEach((r) => {
    if (!GFA_CAMPAIGN_TYPE_ORDER.includes(r.name)) {
      etcAcc.impressions += r.impressions;
      etcAcc.clicks += r.clicks;
      etcAcc.cost += r.cost;
      etcAcc.conversions += r.conversions;
      etcAcc.revenue += r.revenue;
    }
  });
  const hasEtc = etcAcc.impressions > 0 || etcAcc.clicks > 0 || etcAcc.cost > 0 || etcAcc.conversions > 0 || etcAcc.revenue > 0;

  const zero = withDerivedMetrics({ impressions: 0, clicks: 0, cost: 0, conversions: 0, revenue: 0 });
  const displayRows = GFA_CAMPAIGN_TYPE_ORDER.map((type) => ({ label: type, data: byName.get(type) || zero }));
  if (hasEtc) {
    displayRows.push({ label: "기타", data: withDerivedMetrics(etcAcc) });
  }

  gfaCampaignTypeTableBody.innerHTML = displayRows
    .map(
      ({ label, data }) => `
    <tr>
      <td>${escapeHtml(label)}</td>
      <td>${formatWon(data.cost)}</td>
      <td>${formatWon(data.revenue)}</td>
      <td>${data.roas}%</td>
      <td>${formatNumber(data.clicks)}</td>
      <td>${data.ctr.toFixed(2)}%</td>
      <td>${formatNumber(data.conversions)}</td>
      <td>${data.cvr.toFixed(2)}%</td>
      <td>${formatWon(data.cpa)}</td>
    </tr>
  `
    )
    .join("");
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
  } else if (state.breakdownRawType === "adgroup" && state.saMode === "manual") {
    loadSaAdgroupBreakdownData();
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

  const result = await fetchSaPerformanceAny("campaign", {
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

// 그룹별(광고그룹) 성과 - 수기 업로드 광고주(쉬어)는 SA 그룹 Raw(sa_adgroup_raw)에서
// 가져온다. API 모드(홈앤힐)는 아직 그룹 단위 자동 동기화가 없어 안내 문구만 보여준다.
async function loadSaAdgroupBreakdownData() {
  const token = ++state.overviewRenderToken;
  breakdownTableBody.innerHTML = '<tr><td colspan="9" class="grouped-empty">불러오는 중...</td></tr>';

  const result = await fetchGfaPerformance("sa_adgroup", {
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
  if (result.rows.length === 0) {
    breakdownTableBody.innerHTML =
      '<tr><td colspan="9" class="grouped-empty">표시할 데이터가 없습니다. "SA 데이터 업로드" 메뉴에서 SA 그룹 Raw를 먼저 올려주세요.</td></tr>';
    updateSortIndicators();
    return;
  }
  renderBreakdownRows();
}

// 광고그룹별 단위는 API 모드(홈앤힐)에는 아직 없어 안내 문구만 보여준다.
function renderSaBreakdownPlaceholder() {
  state.breakdownRows = [];
  breakdownTableBody.innerHTML =
    '<tr><td colspan="9" class="grouped-empty">광고그룹별 데이터는 다음 업데이트에서 제공될 예정입니다.</td></tr>';
  updateSortIndicators();
}

/* ---------------------------------------------------------
   6-1c. 파워링크 / 쇼핑검색 / 브랜드검색 - 키워드별 성과 (SA 전용, 실데이터)
   ---------------------------------------------------------
   sa-sync처럼 매일 미리 저장해두는 게 아니라, 이 페이지를 열 때마다 그 기간을
   네이버 API에서 바로 조회한다 - 캠페인/그룹/키워드를 훑어야 해서 시간이 좀 걸릴 수 있다.
   전환수/전환매출액은 키워드 단위로는 아직 검증되지 않아 노출수/클릭수/비용/CTR/CPC만 보여준다.
--------------------------------------------------------- */
async function renderKeywordView(item) {
  keywordViewTitle.textContent = `${item.label} 키워드별 성과`;
  keywordViewSubtitle.textContent = `${item.label} 키워드별 성과 상세`;
  keywordViewNotice.hidden = true;
  keywordSearchInput.value = "";
  keywordTableBody.innerHTML = '<tr><td colspan="8" class="grouped-empty">불러오는 중... (키워드 수에 따라 시간이 걸릴 수 있습니다)</td></tr>';

  brandSearchContractCard.hidden = item.naverCampaignType !== "BRAND_SEARCH";
  if (!brandSearchContractCard.hidden) {
    loadBrandSearchContracts();
  }

  const token = ++state.overviewRenderToken;
  const result = await fetchSaKeywordPerformanceAny(item.naverCampaignType, {
    dateFrom: state.analysisPeriod.from,
    dateTo: state.analysisPeriod.to
  });

  if (token !== state.overviewRenderToken) return;

  if (!result.success) {
    state.keywordViewRows = [];
    keywordViewNotice.hidden = false;
    keywordViewNotice.textContent = result.message;
    keywordTableBody.innerHTML = `<tr><td colspan="8" class="grouped-empty">${escapeHtml(result.message)}</td></tr>`;
    return;
  }

  state.keywordViewRows = result.rows;
  if (result.rows.length === 0) {
    keywordViewNotice.hidden = false;
    keywordViewNotice.textContent = "이 기간에 실적이 있는 키워드가 없습니다.";
  }
  renderKeywordTable();
}

function renderKeywordTable() {
  const q = keywordSearchInput.value.trim().toLowerCase();
  const filtered = q
    ? state.keywordViewRows.filter((r) => r.keyword.toLowerCase().includes(q))
    : state.keywordViewRows;

  if (filtered.length === 0) {
    keywordTableBody.innerHTML = `<tr><td colspan="8" class="grouped-empty">${
      state.keywordViewRows.length === 0 ? "데이터가 없습니다." : "검색 결과가 없습니다."
    }</td></tr>`;
    return;
  }

  keywordTableBody.innerHTML = filtered
    .map(
      (r) => `
        <tr>
          <td>${escapeHtml(r.keyword)}</td>
          <td>${escapeHtml(r.campaign)}</td>
          <td>${escapeHtml(r.ad_group)}</td>
          <td>${formatNumber(r.impressions)}</td>
          <td>${formatNumber(r.clicks)}</td>
          <td>${r.ctr.toFixed(2)}%</td>
          <td>${formatWon(r.cost)}</td>
          <td>${formatWon(r.cpc)}</td>
        </tr>
      `
    )
    .join("");
}

keywordSearchInput.addEventListener("input", renderKeywordTable);

/* ---------------------------------------------------------
   6-1c. 브랜드검색 계약비용 (네이버 API로 못 가져와서 직접 입력/저장)
--------------------------------------------------------- */
async function loadBrandSearchContracts() {
  brandSearchContractTableBody.innerHTML = '<tr><td colspan="3" class="grouped-empty">불러오는 중...</td></tr>';
  const result = await fetchBrandSearchContracts();
  if (!result.success) {
    brandSearchContractTableBody.innerHTML = `<tr><td colspan="3" class="grouped-empty">${escapeHtml(result.message)}</td></tr>`;
    return;
  }
  state.brandSearchContractRows = result.rows;
  renderBrandSearchContractTable();
}

function renderBrandSearchContractTable() {
  const rows = state.brandSearchContractRows;
  if (rows.length === 0) {
    brandSearchContractTableBody.innerHTML = '<tr><td colspan="3" class="grouped-empty">등록된 계약이 없습니다.</td></tr>';
    return;
  }

  const total = rows.reduce((sum, r) => sum + Number(r.contract_cost), 0);

  brandSearchContractTableBody.innerHTML =
    rows
      .map(
        (r) => `
        <tr>
          <td>${r.date_from} ~ ${r.date_to}</td>
          <td>${formatWon(r.contract_cost)}</td>
          <td><button type="button" class="contract-delete-btn" data-id="${r.id}">삭제</button></td>
        </tr>
      `
      )
      .join("") +
    `<tr><td><b>합계</b></td><td><b>${formatWon(total)}</b></td><td></td></tr>`;
}

brandSearchContractForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  const dateFrom = brandSearchContractFrom.value;
  const dateTo = brandSearchContractTo.value;
  const cost = Number(brandSearchContractCost.value);

  brandSearchContractStatus.hidden = true;
  const submitBtn = brandSearchContractForm.querySelector("button[type=submit]");
  submitBtn.disabled = true;
  const originalLabel = submitBtn.textContent;
  submitBtn.textContent = "저장 중...";

  try {
    if (!dateFrom || !dateTo || dateFrom > dateTo) {
      throw new Error("계약기간을 올바르게 입력해주세요.");
    }
    if (!Number.isFinite(cost) || cost < 0) {
      throw new Error("계약금액을 올바르게 입력해주세요.");
    }

    const result = await saveBrandSearchContract(dateFrom, dateTo, cost);
    if (!result.success) {
      throw new Error(result.message);
    }

    showUploadStatus(brandSearchContractStatus, "계약비용이 저장되었습니다.", "success");
    brandSearchContractForm.reset();
    await loadBrandSearchContracts();
  } catch (err) {
    showUploadStatus(brandSearchContractStatus, err.message || "저장 중 오류가 발생했습니다.", "error");
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = originalLabel;
  }
});

brandSearchContractTableBody.addEventListener("click", async (e) => {
  const btn = e.target.closest(".contract-delete-btn");
  if (!btn) return;

  btn.disabled = true;
  const result = await deleteBrandSearchContract(Number(btn.dataset.id));
  if (!result.success) {
    btn.disabled = false;
    showUploadStatus(brandSearchContractStatus, result.message || "삭제 중 오류가 발생했습니다.", "error");
    return;
  }
  await loadBrandSearchContracts();
});

/* ---------------------------------------------------------
   6-1d. SA 구매완료수 보정값 (네이버 API 전환수가 화면 값과 달라서 직접 입력)
--------------------------------------------------------- */
async function loadConversionOverrides() {
  conversionOverrideTableBody.innerHTML = '<tr><td colspan="4" class="grouped-empty">불러오는 중...</td></tr>';
  const result = await fetchConversionOverrides();
  if (!result.success) {
    conversionOverrideTableBody.innerHTML = `<tr><td colspan="4" class="grouped-empty">${escapeHtml(result.message)}</td></tr>`;
    return;
  }
  state.conversionOverrideRows = result.rows;
  renderConversionOverrideTable();
}

const CONVERSION_OVERRIDE_TYPE_LABEL = {
  WEB_SITE: "파워링크",
  SHOPPING: "쇼핑검색",
  BRAND_SEARCH: "브랜드검색"
};

function renderConversionOverrideTable() {
  const rows = state.conversionOverrideRows;
  if (rows.length === 0) {
    conversionOverrideTableBody.innerHTML = '<tr><td colspan="4" class="grouped-empty">입력된 보정값이 없습니다.</td></tr>';
    return;
  }

  conversionOverrideTableBody.innerHTML = rows
    .map(
      (r) => `
        <tr>
          <td>${r.date}</td>
          <td>${CONVERSION_OVERRIDE_TYPE_LABEL[r.campaign_type] || r.campaign_type}</td>
          <td>${formatNumber(r.conversions)}건</td>
          <td><button type="button" class="contract-delete-btn" data-id="${r.id}">삭제</button></td>
        </tr>
      `
    )
    .join("");
}

conversionOverrideForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  const date = conversionOverrideDate.value;
  const campaignType = conversionOverrideType.value;
  const conversions = Number(conversionOverrideValue.value);

  conversionOverrideStatus.hidden = true;
  const submitBtn = conversionOverrideForm.querySelector("button[type=submit]");
  submitBtn.disabled = true;
  const originalLabel = submitBtn.textContent;
  submitBtn.textContent = "저장 중...";

  const result = await saveConversionOverride(date, campaignType, conversions);

  submitBtn.disabled = false;
  submitBtn.textContent = originalLabel;

  if (!result.success) {
    showUploadStatus(conversionOverrideStatus, result.message || "저장 중 오류가 발생했습니다.", "error");
    return;
  }

  showUploadStatus(conversionOverrideStatus, "저장 완료", "success");
  conversionOverrideForm.reset();
  await loadConversionOverrides();
  if (state.currentView === "overview") refreshCurrentPeriodView();
});

conversionOverrideUploadForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  const file = conversionOverrideFileInput.files[0];
  if (!file) return;

  conversionOverrideUploadStatus.hidden = true;
  const submitBtn = conversionOverrideUploadForm.querySelector("button[type=submit]");
  submitBtn.disabled = true;
  const originalLabel = submitBtn.textContent;
  submitBtn.textContent = "업로드 중...";

  try {
    const text = await readUploadFileAsCsvText(file);
    let rows = parseSaRawCsv(text, ["campaign_type", "conversions"], []);
    rows = normalizeSaCampaignTypeRows(rows);
    // parseSaRawCsv는 모든 raw_type에 date_to를 채워주는데(캠페인/키워드 raw와
    // 공용 로직), 보정값에는 필요 없는 필드라 그냥 date/campaign_type/conversions만 쓴다.
    rows = rows.map((r) => ({ date: r.date, campaign_type: r.campaign_type, conversions: r.conversions }));

    if (rows.length === 0) {
      throw new Error("업로드할 데이터가 없습니다.");
    }

    const result = await bulkSaveConversionOverrides(rows);
    if (!result.success) {
      throw new Error(result.message);
    }

    showUploadStatus(conversionOverrideUploadStatus, `업로드 완료: ${result.inserted}건 저장`, "success");
    conversionOverrideUploadForm.reset();
    await loadConversionOverrides();
    if (state.currentView === "overview") refreshCurrentPeriodView();
  } catch (err) {
    showUploadStatus(conversionOverrideUploadStatus, err.message || "업로드 중 오류가 발생했습니다.", "error");
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = originalLabel;
  }
});

conversionOverrideTableBody.addEventListener("click", async (e) => {
  const btn = e.target.closest(".contract-delete-btn");
  if (!btn) return;

  btn.disabled = true;
  const result = await deleteConversionOverride(Number(btn.dataset.id));
  if (!result.success) {
    btn.disabled = false;
    showUploadStatus(conversionOverrideStatus, result.message || "삭제 중 오류가 발생했습니다.", "error");
    return;
  }
  await loadConversionOverrides();
  if (state.currentView === "overview") refreshCurrentPeriodView();
});

/* ---------------------------------------------------------
   6-2. 상품별(모델별) 성과 뷰 - 도넛/막대+선 차트 + 모델 카드 + 상세 모달
   ---------------------------------------------------------
   SA는 쇼핑검색 상품(소재) 실데이터(sa_product_daily, 업로드한 매핑 기준),
   GFA는 gfa_adv_raw(ADVoost) 실데이터를 쓴다.
--------------------------------------------------------- */
async function renderModelView() {
  modelViewTitle.textContent = `${CHANNEL_LABELS[state.currentChannel]} 상품별(모델별) 성과`;
  // 상품 매핑(소재ID<->상품명) 업로드는 API 모드(sa-sync가 sa_product_mapping과 조인)와
  // 수기 업로드 모드(sa-manual-product-performance가 sa_product_raw와 조인) 둘 다 필요하다 -
  // 어느 쪽이든 네이버가 상품별 데이터를 소재ID로만 주기 때문.
  productMappingUploadCard.hidden = state.currentChannel !== "SA";
  productModelMappingUploadCard.hidden = state.currentChannel !== "SA" || state.saMode === "manual";
  if (state.currentChannel === "GFA") {
    await renderGfaModelView();
  } else {
    await renderSaModelView();
  }
}

async function renderSaModelView() {
  modelListCard.hidden = false;
  modelViewNotice.hidden = true;

  const token = ++state.overviewRenderToken;
  const result = await fetchSaProductPerformanceAny({
    dateFrom: state.analysisPeriod.from,
    dateTo: state.analysisPeriod.to
  });

  if (token !== state.overviewRenderToken) return;

  if (!result.success) {
    modelViewNotice.hidden = false;
    modelViewNotice.textContent = result.message;
    destroyChart("modelDonut");
    destroyChart("modelCvrRoas");
    modelSearchInput.value = "";
    renderModelCardGrid([], { showBadge: false, onClick: openModelDetailModal });
    return;
  }

  if (result.rows.length === 0) {
    modelViewNotice.hidden = false;
    modelViewNotice.textContent =
      state.saMode === "manual"
        ? '표시할 상품별 데이터가 없습니다. "SA 데이터 업로드" 메뉴에서 SA 상품 Raw를 먼저 올려주세요.'
        : "표시할 상품별 데이터가 없습니다. 위에서 상품 매핑 파일을 먼저 업로드해주세요 (업로드 후 다음 자동 동기화부터 반영됩니다 - 쇼핑검색 캠페인만 상품 단위 매칭이 가능합니다).";
  }

  const models = result.rows.map((r) => ({ model: r.name, category: null, ...r }));
  const top5 = [...models].sort((a, b) => b.revenue - a.revenue).slice(0, 5);

  renderModelDonutChart(top5);
  renderModelCvrRoasChart(top5);
  modelSearchInput.value = "";
  renderModelCardGrid(models, { showBadge: false, onClick: openModelDetailModal });
}

// ADVoost 쇼핑은 검색어(키워드) 단위 데이터가 원래 없어서, 카드 목록/클릭 상세 없이
// 모델 매출 비중 + 주요 5개 상품 CVR&ROAS 차트 2개만 보여준다.
// GFA의 ADV Raw는 SA와 달리 상품코드가 없이 상품명 텍스트만 있다. 그런데 그 상품명
// 끝에 "...에센셜 베이지(RM70F90R2GD)"처럼 모델코드가 괄호로 붙어있는 경우가 있어서,
// 있으면 그 코드만 뽑아 깔끔하게 표시하고 없으면 원래 상품명을 그대로 쓴다.
function extractModelCodeFromProductName(name) {
  const match = String(name ?? "").match(/\(([A-Z0-9+]{4,50})\)\s*$/);
  return match ? match[1] : null;
}

async function renderGfaModelView() {
  modelListCard.hidden = true;
  modelViewNotice.hidden = true;

  const token = ++state.overviewRenderToken;
  const result = await fetchGfaPerformance("adv", {
    dateFrom: state.analysisPeriod.from,
    dateTo: state.analysisPeriod.to
  });

  if (token !== state.overviewRenderToken) return;

  if (!result.success) {
    modelViewNotice.hidden = false;
    modelViewNotice.textContent = result.message;
    destroyChart("modelDonut");
    destroyChart("modelCvrRoas");
    return;
  }

  if (result.rows.length === 0) {
    modelViewNotice.hidden = false;
    modelViewNotice.textContent =
      '표시할 데이터가 없습니다. "데이터 업로드" 메뉴에서 ADV Raw를 먼저 업로드해주세요.';
  }

  result.rows = result.rows.map((r) => ({ ...r, name: extractModelCodeFromProductName(r.name) || r.name }));
  const models = result.rows.map((r) => ({ model: r.name, category: null, ...r }));
  const top5 = [...models].sort((a, b) => b.revenue - a.revenue).slice(0, 5);

  renderModelDonutChart(top5);
  renderModelCvrRoasChart(top5);
}

function renderModelDonutChart(top5) {
  destroyChart("modelDonut");
  const colors = ["#2563eb", "#38bdf8", "#22c55e", "#f59e0b", "#a855f7"];
  const total = top5.reduce((sum, m) => sum + m.revenue, 0);
  const percentOf = (revenue) => (total > 0 ? ((revenue / total) * 100).toFixed(1) : "0.0");

  state.charts.modelDonut = new Chart(document.getElementById("modelRevenueDonutChart"), {
    type: "doughnut",
    data: {
      labels: top5.map((m) => `${m.model} (${percentOf(m.revenue)}%)`),
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

// models: {model, category, impressions, clicks, cost, conversions, revenue, ctr, cvr, roas, cpa}[]
// opts: { showBadge: 카테고리 뱃지 표시 여부, onClick: 카드 클릭 시 호출할 함수(model) }
function renderModelCardGrid(models, opts) {
  state.modelViewRows = models;
  state.modelViewOpts = opts;

  const q = modelSearchInput.value.trim().toLowerCase();
  const filtered = q
    ? models.filter((m) => m.model.toLowerCase().includes(q) || (m.category || "").toLowerCase().includes(q))
    : models;

  if (models.length === 0) {
    modelCardGrid.innerHTML = "";
    return;
  }

  if (filtered.length === 0) {
    modelCardGrid.innerHTML = '<p class="grouped-empty">검색 결과가 없습니다.</p>';
    return;
  }

  modelCardGrid.innerHTML = filtered
    .map((m, i) => {
      const badgeHtml = opts.showBadge
        ? `<span class="model-badge ${MODEL_BADGE_COLORS[m.category] || "badge-blue"}">${escapeHtml(m.category)}</span>`
        : "";
      return `
        <div class="model-card" data-idx="${i}">
          <div class="model-card-top">
            <span class="model-card-name">${escapeHtml(m.model)}</span>
            ${badgeHtml}
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

  modelCardGrid.querySelectorAll(".model-card").forEach((card) => {
    card.addEventListener("click", () => opts.onClick(filtered[Number(card.dataset.idx)]));
  });
}

modelSearchInput.addEventListener("input", () => {
  renderModelCardGrid(state.modelViewRows, state.modelViewOpts);
});

// period: 이 상세를 어느 기간 기준으로 보여줄지 (기본은 분석기간). "주요 상품 분석"의
// "비교 기간" 카드를 클릭했을 때는 비교기간을 넘겨줘서 라벨이 실제 기간과 맞게 한다.
function openModelDetailModal(model, period) {
  const d = withDerivedMetrics(model);

  if (model.category) {
    const badgeClass = MODEL_BADGE_COLORS[model.category] || "badge-blue";
    modelDetailBadge.className = `model-badge ${badgeClass}`;
    modelDetailBadge.textContent = model.category;
    modelDetailBadge.hidden = false;
  } else {
    modelDetailBadge.hidden = true;
  }

  modelDetailTitle.textContent = model.model;
  modelDetailPeriodLabel.textContent = formatPeriodRange(period || state.analysisPeriod);

  modelDetailImpressions.textContent = formatNumber(d.impressions);
  modelDetailClicks.textContent = formatNumber(d.clicks);
  modelDetailCpc.textContent = formatWon(d.cpc);
  modelDetailCtr.textContent = formatPercent(d.ctr);
  modelDetailCvr.textContent = formatPercent(d.cvr);

  modelDetailCost.textContent = formatWon(d.cost);
  modelDetailConversions.textContent = `${formatNumber(d.conversions)}건`;
  modelDetailRevenue.textContent = formatWon(d.revenue);
  modelDetailRoas.textContent = formatPercent(d.roas);

  if (model.keywords) {
    modelDetailKeywordBody.innerHTML = model.keywords
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
  } else {
    modelDetailKeywordBody.innerHTML =
      '<tr><td colspan="6" class="grouped-empty">키워드 단위 데이터는 제공되지 않습니다.</td></tr>';
  }

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
    if (item.requiresSaManual && state.saMode !== "manual") return;
    if (item.requiresSaApi && state.saMode !== "api") return;

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

  // 지금 채널의 사이드바에 없는 메뉴면(예: SA에서 GFA 전용 메뉴) 그 채널의 첫 메뉴로 되돌린다.
  // (SA/GFA는 둘 다 MENU_ITEMS[0]="overview"에 포함돼있어 항상 그걸로 되돌아갔지만,
  // EBAY/ELEVENST는 "overview"에 없으므로 그 채널이 실제로 가진 첫 메뉴를 찾아야 한다.)
  if (!item || !item.channels.includes(state.currentChannel)) {
    item = MENU_ITEMS.find((m) => m.channels.includes(state.currentChannel)) || MENU_ITEMS[0];
    state.currentView = item.id;
  }

  document
    .querySelectorAll(".sidebar-menu-item")
    .forEach((btn) => btn.classList.toggle("active", btn.dataset.viewId === item.id));

  viewOverview.hidden = true;
  viewTrend.hidden = true;
  viewModel.hidden = true;
  viewKeyword.hidden = true;
  viewGrouped.hidden = true;
  viewUpload.hidden = true;
  viewSaUpload.hidden = true;
  viewSaConversionUpload.hidden = true;
  viewChannelOverview.hidden = true;
  viewChannelUpload.hidden = true;
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
  } else if (item.id === "sa-upload") {
    viewSaUpload.hidden = false;
  } else if (item.id === "sa-conversion-upload") {
    viewSaConversionUpload.hidden = false;
    loadConversionOverrides();
  } else if (item.id === "channel-overview") {
    viewChannelOverview.hidden = false;
    renderChannelOverview();
  } else if (item.id === "channel-upload") {
    viewChannelUpload.hidden = false;
    applyChannelUploadCardVisibility();
  } else if (item.id === "product") {
    viewModel.hidden = false;
    renderModelView();
  } else if (item.naverCampaignType) {
    viewKeyword.hidden = false;
    renderKeywordView(item);
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
  adv: ["date", "product", "impressions", "clicks", "cost", "conversions", "revenue"],
  creative: ["date", "creative", "impressions", "clicks", "cost", "conversions", "revenue"]
};

// requiredColumns와 달리, CSV에 없어도 업로드 자체는 막지 않는 추가 컬럼
// (campaign_type은 캠페인 Raw에만 있고, 예전에 만든 템플릿이나 구버전 파일에는 없을 수 있다).
const GFA_OPTIONAL_COLUMNS = {
  campaign: ["campaign_type"]
};

// SA API 연동이 없는 광고주(예: 쉬어)용 수기 업로드 - 네이버가 실제로 주는 리포트는
// GFA와 완전히 다른 형식(첫 줄에 "쉬어 캠페인 raw(2026.07.01.~2026.08.23.)"처럼 기간이
// 있고, 그 다음 줄이 진짜 헤더, 행마다 날짜가 없다)이라 parseSaRawCsv로 따로 파싱한다.
// campaign은 검색어(키워드) 리포트에는 아예 없는 경우가 많아 sa_keyword에서는 선택 컬럼이다.
const SA_RAW_TYPE_COLUMNS = {
  sa_campaign: ["campaign_type", "campaign", "impressions", "clicks", "cost", "conversions", "revenue"],
  sa_keyword: ["campaign_type", "keyword", "impressions", "clicks", "cost", "conversions", "revenue"],
  // 상품 Raw는 네이버가 상품명이 아니라 소재ID로 주기 때문에, 소재ID를 필수로 받고
  // 상품명은 "상품 매핑 파일 업로드"(sa_product_mapping)로 별도 매칭한다.
  sa_product: ["naver_ad_id", "impressions", "clicks", "cost", "conversions", "revenue"],
  // 그룹 Raw는 캠페인/캠페인유형 컬럼 없이 광고그룹명만 오고, 구간 합계가 아니라
  // "일별" 컬럼으로 행마다 날짜가 따로 있다 (parseSaRawCsv가 자동으로 감지해서 처리).
  sa_adgroup: ["ad_group", "impressions", "clicks", "cost", "conversions", "revenue"]
};
const SA_OPTIONAL_COLUMNS = {
  sa_keyword: ["campaign", "ad_group"],
  sa_product: ["product"],
  sa_adgroup: ["campaign_type", "campaign"]
};

// 내부 필드명 -> 실제 CSV에 올 수 있는 헤더 이름 후보 (전부 소문자/trim 비교)
const GFA_HEADER_ALIASES = {
  date: ["date", "기간", "날짜", "일자", "일별"],
  campaign: ["campaign", "캠페인 이름", "캠페인명", "캠페인"],
  campaign_type: ["campaign_type", "캠페인 목적", "캠페인 유형", "캠페인유형"],
  ad_group: ["ad_group", "광고 그룹 이름", "광고그룹 이름", "광고그룹명", "광고그룹"],
  product: ["product", "상품명", "상품 이름"],
  creative: ["creative", "소재 이름", "소재명", "소재"],
  keyword: ["keyword", "키워드", "키워드명", "검색어"],
  naver_ad_id: ["naver_ad_id", "소재 id", "소재id"],
  impressions: ["impressions", "노출수"],
  clicks: ["clicks", "클릭수"],
  cost: ["cost", "총비용", "비용"],
  // 전환/매출은 종류가 여러 개(총 전환수, 회원가입 수 등) 나오는데
  // "구매완료" 기준만 쓴다. 네이버 SA 리포트는 "구매완료 전환수" / "구매완료 전환매출액(원)"으로 나온다.
  conversions: ["conversions", "구매완료 수", "구매완료수", "구매완료 전환수"],
  revenue: ["revenue", "구매완료 전환매출액", "구매완료 매출액", "구매완료전환매출액", "구매완료 전환매출액(원)"]
};

const GFA_RAW_TYPE_TEMPLATE_CSV = {
  campaign:
    "date,campaign,campaign_type,impressions,clicks,cost,conversions,revenue\n" +
    "2026-08-01,여름신상프로모션,웹사이트 전환,15200,320,540000,18,3200000\n",
  adgroup:
    "date,campaign,ad_group,impressions,clicks,cost,conversions,revenue\n" +
    "2026-08-01,여름신상프로모션,배너그룹A,15200,320,540000,18,3200000\n",
  adv:
    "date,product,impressions,clicks,cost,conversions,revenue\n" +
    "2026-08-01,ADVoost,15200,320,540000,18,3200000\n",
  creative:
    "date,creative,impressions,clicks,cost,conversions,revenue\n" +
    "2026-08-01,여름신상_소재A,15200,320,540000,18,3200000\n"
};

// SA 수기 업로드 템플릿 - 네이버 실제 리포트와 똑같이 첫 줄에 기간, 둘째 줄에 헤더.
const SA_RAW_TYPE_TEMPLATE_CSV = {
  sa_campaign:
    '"쉬어 캠페인 raw(2026.07.01.~2026.08.23.)"\n' +
    "캠페인유형,캠페인,노출수,클릭수,총비용,구매완료 전환수,구매완료 전환매출액(원)\n" +
    "쇼핑검색,여름신상프로모션,15200,320,540000,18,3200000\n",
  sa_keyword:
    '"쉬어 키워드 raw(2026.07.01.~2026.08.23.)"\n' +
    "캠페인유형,검색어,노출수,클릭수,총비용,구매완료 전환수,구매완료 전환매출액(원)\n" +
    "쇼핑검색,아기침대,5200,120,140000,3,320000\n",
  sa_product:
    '"쉬어 상품 raw(2026.07.01.~2026.08.23.)"\n' +
    "소재ID,노출수,클릭수,총비용,구매완료 전환수,구매완료 전환매출액(원)\n" +
    "nad-a001-01-000000001234567,15200,320,540000,18,3200000\n",
  // 그룹 Raw는 구간 합계가 아니라 "일별" 컬럼으로 행마다 날짜가 있다.
  sa_adgroup:
    '"쉬어 그룹 raw(2026.08.01.~2026.08.27.)"\n' +
    "일별,광고그룹,노출수,클릭수,총비용,구매완료 전환수,구매완료 전환매출액(원)\n" +
    "2026.08.01.,침대_키즈_로코_PC_검색,45,2,1192,0,0\n"
};

// SA 수기 업로드(sa_campaign/sa_keyword)의 campaign_type 값을 내부 코드로 정규화한다.
// 한글 라벨과 영문 코드를 둘 다 받아들인다.
const SA_CAMPAIGN_TYPE_ALIASES = {
  "파워링크": "WEB_SITE",
  "웹사이트": "WEB_SITE",
  "WEB_SITE": "WEB_SITE",
  "쇼핑검색": "SHOPPING",
  "SHOPPING": "SHOPPING",
  "브랜드검색": "BRAND_SEARCH",
  "브랜드검색/신제품검색": "BRAND_SEARCH",
  "BRAND_SEARCH": "BRAND_SEARCH"
};

function normalizeSaCampaignTypeRows(rows) {
  return rows.map((row, i) => {
    const trimmed = String(row.campaign_type ?? "").trim();
    const code = SA_CAMPAIGN_TYPE_ALIASES[trimmed] || SA_CAMPAIGN_TYPE_ALIASES[trimmed.toUpperCase()];
    if (!code) {
      throw new Error(
        `${i + 1}번째 행: 캠페인 유형("${row.campaign_type}")을 알아볼 수 없습니다. 파워링크/쇼핑검색/브랜드검색 중 하나로 입력해주세요.`
      );
    }
    return { ...row, campaign_type: code };
  });
}

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

function parseGfaCsv(text, requiredColumns, optionalColumns = []) {
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

  // optionalColumns는 없어도 업로드를 막지 않는다 - 있으면 같이 담고, 없으면 그냥 건너뛴다.
  optionalColumns.forEach((field) => {
    const idx = findColumnIndex(header, GFA_HEADER_ALIASES[field] || [field]);
    if (idx !== -1) columnIndex[field] = idx;
  });

  const allFields = [...requiredColumns, ...optionalColumns];

  return lines.slice(1).map((line) => {
    const cells = splitCsvLine(line);
    const row = {};

    allFields.forEach((field) => {
      if (!(field in columnIndex)) return; // optional인데 이 CSV엔 없는 컬럼

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

// 네이버 SA 실제 리포트 형식: 첫 줄에 "쉬어 캠페인 raw(2026.07.01.~2026.08.23.)"처럼
// 제목+기간이 있고, 그 다음 몇 줄 안에 진짜 헤더가 나온다. 리포트 종류에 따라 두 가지
// 형태가 섞여 있다:
//   1) 구간 합계형 (캠페인/키워드/상품 raw) - 행마다 날짜가 없다. 첫 줄의 기간 전체를
//      합친 데이터라, 그 기간을 모든 행의 date(시작일)/date_to(종료일)로 채운다.
//   2) 일별형 (그룹 raw) - "일별" 컬럼으로 행마다 날짜가 따로 있다. 이땐 그 날짜를
//      그대로 date/date_to로 쓴다 (첫 줄의 기간은 참고용일 뿐, 무시한다).
// 헤더에 날짜 컬럼(GFA_HEADER_ALIASES.date)이 있는지로 두 형태를 자동 판별한다.
const SA_TITLE_DATE_RANGE_RE = /(\d{4})\s*\.\s*(\d{1,2})\s*\.\s*(\d{1,2})\s*\.?\s*~\s*(\d{4})\s*\.\s*(\d{1,2})\s*\.\s*(\d{1,2})\s*\.?/;

function parseSaRawCsv(text, requiredColumns, optionalColumns = []) {
  const lines = text.split(/\r\n|\n|\r/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) {
    throw new Error("업로드할 데이터가 없습니다.");
  }

  const titleMatch = lines[0].match(SA_TITLE_DATE_RANGE_RE);
  let titleDateFrom = null;
  let titleDateTo = null;
  if (titleMatch) {
    const [, y1, m1, d1, y2, m2, d2] = titleMatch;
    titleDateFrom = `${y1}-${m1.padStart(2, "0")}-${d1.padStart(2, "0")}`;
    titleDateTo = `${y2}-${m2.padStart(2, "0")}-${d2.padStart(2, "0")}`;
    if (titleDateFrom > titleDateTo) {
      throw new Error("첫 줄의 기간이 올바르지 않습니다 (시작일이 종료일보다 늦습니다).");
    }
  }

  // 헤더 행 찾기: 제목 다음 몇 줄 안에서 "노출수"/"클릭수"에 해당하는 셀이 있는 첫 줄.
  let headerIdx = -1;
  const searchLimit = Math.min(lines.length, 6);
  for (let i = 1; i < searchLimit; i++) {
    const cells = splitCsvLine(lines[i]).map((c) => c.trim().toLowerCase());
    const hasImpressions = GFA_HEADER_ALIASES.impressions.some((a) => cells.includes(a));
    const hasClicks = GFA_HEADER_ALIASES.clicks.some((a) => cells.includes(a));
    // 구매완료수 보정값 리포트처럼 노출수/클릭수 없이 전환수만 있는 파일도 있다.
    const hasConversions = GFA_HEADER_ALIASES.conversions.some((a) => cells.includes(a));
    if (hasImpressions || hasClicks || hasConversions) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx === -1) {
    throw new Error('헤더 행을 찾지 못했습니다 ("노출수"/"클릭수" 컬럼이 있는 줄이 있어야 합니다).');
  }

  const header = splitCsvLine(lines[headerIdx]).map((h) => h.trim().toLowerCase());

  const dateColIdx = findColumnIndex(header, GFA_HEADER_ALIASES.date);
  if (dateColIdx === -1 && !titleMatch) {
    throw new Error(
      '첫 줄에서 기간(예: "2026.07.01.~2026.08.23.")을 찾지 못했고, "일별"처럼 행마다 날짜가 있는 컬럼도 없습니다. 네이버에서 다운로드한 파일을 수정 없이 그대로 올려주세요.'
    );
  }

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

  // optionalColumns는 없어도 업로드를 막지 않는다.
  optionalColumns.forEach((field) => {
    const idx = findColumnIndex(header, GFA_HEADER_ALIASES[field] || [field]);
    if (idx !== -1) columnIndex[field] = idx;
  });

  const allFields = [...requiredColumns, ...optionalColumns];

  return lines.slice(headerIdx + 1).map((line, i) => {
    const cells = splitCsvLine(line);

    let rowDate;
    let rowDateTo;
    if (dateColIdx !== -1) {
      rowDate = normalizeGfaDate((cells[dateColIdx] ?? "").trim());
      if (!/^\d{4}-\d{2}-\d{2}$/.test(rowDate)) {
        throw new Error(`${i + 1}번째 행: 날짜 형식을 알아볼 수 없습니다 ("${cells[dateColIdx]}").`);
      }
      rowDateTo = rowDate;
    } else {
      rowDate = titleDateFrom;
      rowDateTo = titleDateTo;
    }

    const row = { date: rowDate, date_to: rowDateTo };

    allFields.forEach((field) => {
      if (!(field in columnIndex)) return; // optional인데 이 파일엔 없는 컬럼

      const cellValue = (cells[columnIndex[field]] ?? "").trim();
      if (GFA_NUMERIC_FIELDS.includes(field)) {
        row[field] = toGfaNumber(cellValue);
      } else {
        row[field] = cellValue;
      }
    });

    return row;
  });
}

// .xlsx/.xls는 SheetJS(XLSX)로 첫 시트를 CSV 텍스트로 바꿔서, 기존 CSV 파서를 그대로
// 재사용한다 (엑셀에서 "다른 이름으로 저장 > CSV" 할 때 생기는 인코딩/구분자 문제를 피한다).
async function readUploadFileAsCsvText(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: "array" });
    const firstSheetName = workbook.SheetNames[0];
    if (!firstSheetName) {
      throw new Error("엑셀 파일에 시트가 없습니다.");
    }
    return XLSX.utils.sheet_to_csv(workbook.Sheets[firstSheetName]);
  }
  return file.text();
}

// 캠페인 / 그룹 / ADV / SA 수기 업로드 폼에 공통 로직을 붙인다.
document.querySelectorAll("#view-upload .upload-form, #view-sa-upload .upload-form").forEach((form) => {
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
      const text = await readUploadFileAsCsvText(file);
      const isSaRawType = rawType.startsWith("sa_");
      let rows = isSaRawType
        ? parseSaRawCsv(text, SA_RAW_TYPE_COLUMNS[rawType], SA_OPTIONAL_COLUMNS[rawType] || [])
        : parseGfaCsv(text, GFA_RAW_TYPE_COLUMNS[rawType], GFA_OPTIONAL_COLUMNS[rawType] || []);
      if (rawType === "sa_campaign" || rawType === "sa_keyword") {
        rows = normalizeSaCampaignTypeRows(rows);
      }

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

/* ---------------------------------------------------------
   7-4. 파일 업로드 카드에 드래그 앤 드롭 지원
   ---------------------------------------------------------
   file input이 있는 업로드 폼(GFA/SA raw 업로드, 상품 매핑, 상품코드-모델명 매핑)
   전부에 공통으로 붙인다. 카드 위로 파일을 끌어다 놓으면 그 input에 파일을
   채워넣고 change 이벤트를 그대로 발생시켜서, 클릭으로 선택했을 때와 동일하게
   동작하게 한다 (업로드 버튼은 여전히 눌러야 한다 - 실수로 잘못 끌어다 놓고
   바로 올라가버리는 걸 방지).
--------------------------------------------------------- */
document.querySelectorAll(".upload-form").forEach((form) => {
  const fileInput = form.querySelector('input[type="file"]');
  if (!fileInput) return;

  const dropZone = form.closest(".upload-card") || form.closest(".model-list-card") || form;

  ["dragenter", "dragover"].forEach((evt) => {
    dropZone.addEventListener(evt, (e) => {
      if (!e.dataTransfer?.types?.includes("Files")) return;
      e.preventDefault();
      e.stopPropagation();
      dropZone.classList.add("drop-active");
    });
  });

  ["dragleave", "drop"].forEach((evt) => {
    dropZone.addEventListener(evt, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropZone.classList.remove("drop-active");
    });
  });

  dropZone.addEventListener("drop", (e) => {
    const droppedFiles = e.dataTransfer?.files;
    if (!droppedFiles || droppedFiles.length === 0) return;

    const dt = new DataTransfer();
    dt.items.add(droppedFiles[0]);
    fileInput.files = dt.files;
    fileInput.dispatchEvent(new Event("change", { bubbles: true }));
  });
});

// CSV 템플릿 다운로드 링크 (정적 파일 없이 브라우저에서 즉석으로 생성)
document.querySelectorAll("#view-upload .upload-template-link, #view-sa-upload .upload-template-link").forEach((link) => {
  const template = GFA_RAW_TYPE_TEMPLATE_CSV[link.dataset.template] || SA_RAW_TYPE_TEMPLATE_CSV[link.dataset.template];
  if (template) {
    link.href = "data:text/csv;charset=utf-8," + encodeURIComponent(template);
  }
});

/* ---------------------------------------------------------
   7-2z. 이베이/11번가(EBAY/ELEVENST) 데이터 업로드
   ---------------------------------------------------------
   외부 플랫폼마다 리포트 형식이 제각각이라 GFA/SA처럼 원본 CSV를 그대로
   파싱하지 않고, 우리가 정한 단순한 7컬럼 템플릿(날짜/캠페인/노출수/클릭수/
   광고비/전환수/전환매출)만 받는다. 한글/영문 헤더 둘 다 허용한다.
--------------------------------------------------------- */
const CHANNEL_UPLOAD_TEMPLATE_CSV =
  "date,campaign,impressions,clicks,cost,conversions,revenue\n" +
  "2026-08-01,여름신상프로모션,15200,320,540000,18,3200000\n";

const CHANNEL_UPLOAD_FIELD_ALIASES = {
  date: ["date", "날짜"],
  campaign: ["campaign", "캠페인", "캠페인명"],
  impressions: ["impressions", "노출수"],
  clicks: ["clicks", "클릭수"],
  cost: ["cost", "광고비", "총비용", "비용"],
  conversions: ["conversions", "전환수", "구매완료수", "구매완료 수"],
  revenue: ["revenue", "전환매출", "전환매출액", "매출"]
};

function parseChannelUploadCsv(text) {
  const lines = text.split(/\r\n|\n|\r/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) {
    throw new Error("업로드할 데이터가 없습니다.");
  }

  const header = splitCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  const columnIndex = {};
  for (const field of Object.keys(CHANNEL_UPLOAD_FIELD_ALIASES)) {
    const idx = findColumnIndex(header, CHANNEL_UPLOAD_FIELD_ALIASES[field]);
    if (idx !== -1) columnIndex[field] = idx;
  }

  if (columnIndex.date === undefined || columnIndex.campaign === undefined) {
    throw new Error('CSV에서 "날짜"/"캠페인" 컬럼을 찾지 못했습니다. 템플릿을 다운로드해서 형식을 맞춰주세요.');
  }

  return lines
    .slice(1)
    .map((line) => {
      const cells = splitCsvLine(line);
      const row = {
        date: normalizeGfaDate((cells[columnIndex.date] ?? "").trim()),
        campaign: (cells[columnIndex.campaign] ?? "").trim()
      };
      ["impressions", "clicks", "cost", "conversions", "revenue"].forEach((field) => {
        row[field] = columnIndex[field] !== undefined ? toGfaNumber(cells[columnIndex[field]]) : 0;
      });
      return row;
    })
    .filter((row) => row.date && row.campaign);
}

// 지금 채널(EBAY/ELEVENST)에 해당하는 업로드 카드만 보여준다 - 나머지 채널의
// 광고 유형 카드는 DOM에 있지만 숨긴다.
function applyChannelUploadCardVisibility() {
  channelUploadTitle.textContent = `${CHANNEL_LABELS[state.currentChannel]} 데이터 업로드`;
  document.querySelectorAll(".channel-upload-card").forEach((card) => {
    card.hidden = card.dataset.channel !== state.currentChannel;
  });
}

document.querySelectorAll(".channel-upload-form").forEach((form) => {
  const channel = form.dataset.channel;
  const adType = form.dataset.adType;
  const fileInput = form.querySelector(".upload-file-input");
  const statusEl = form.closest(".channel-upload-card").querySelector(".upload-status");
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
      const text = await readUploadFileAsCsvText(file);
      const rows = parseChannelUploadCsv(text);

      if (rows.length === 0) {
        throw new Error("업로드할 데이터가 없습니다.");
      }
      if (rows.length > GFA_MAX_UPLOAD_ROWS) {
        throw new Error(`한 번에 최대 ${GFA_MAX_UPLOAD_ROWS}행까지 업로드할 수 있습니다.`);
      }

      const result = await uploadChannelData(channel, adType, rows);
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

document.querySelectorAll("#view-channel-upload .upload-template-link").forEach((link) => {
  link.href = "data:text/csv;charset=utf-8," + encodeURIComponent(CHANNEL_UPLOAD_TEMPLATE_CSV);
});

/* ---------------------------------------------------------
   7-3. SA 상품 매핑(소재ID <-> 상품명) 업로드
   ---------------------------------------------------------
   네이버 검색광고 관리시스템의 "광고 다운로드" CSV를 그대로 업로드한다. 맨 위에
   안내 문구가 한 줄 더 있을 수 있어서, "CUST_ID"로 시작하는 실제 헤더 행을 찾아서 쓴다.
--------------------------------------------------------- */
function parseSaProductMappingCsv(text) {
  const lines = text.split(/\r\n|\n|\r/).filter((line) => line.trim().length > 0);
  const headerIdx = lines.findIndex((line) => splitCsvLine(line)[0]?.trim() === "CUST_ID");
  if (headerIdx === -1) {
    throw new Error('CUST_ID 헤더를 찾을 수 없습니다. 네이버 "광고 다운로드" CSV 형식이 맞는지 확인해주세요.');
  }

  const header = splitCsvLine(lines[headerIdx]).map((h) => h.trim());
  const col = (name) => header.indexOf(name);

  const idxAdId = col("소재 ID");
  const idxProductName = col("기본상품명");
  const idxCategory = col("카테고리");
  const idxShopProductId = col("쇼핑몰 상품ID");
  const idxCampaign = col("캠페인 이름");
  const idxAdGroup = col("광고그룹 이름");

  if (idxAdId === -1 || idxProductName === -1) {
    throw new Error('CSV에서 "소재 ID" 또는 "기본상품명" 컬럼을 찾지 못했습니다.');
  }

  const seen = new Map();
  for (const line of lines.slice(headerIdx + 1)) {
    const cells = splitCsvLine(line);
    const adId = (cells[idxAdId] ?? "").trim();
    const productName = (cells[idxProductName] ?? "").trim();
    if (!adId || !productName || productName === "#N/A") continue;

    seen.set(adId, {
      naver_ad_id: adId,
      product_name: productName,
      category: idxCategory !== -1 ? (cells[idxCategory] ?? "").trim() : "",
      shop_product_id: idxShopProductId !== -1 ? (cells[idxShopProductId] ?? "").trim() : "",
      campaign: idxCampaign !== -1 ? (cells[idxCampaign] ?? "").trim() : "",
      ad_group: idxAdGroup !== -1 ? (cells[idxAdGroup] ?? "").trim() : ""
    });
  }

  return [...seen.values()];
}

/* ---------------------------------------------------------
   7-3b. SA 상품코드 <-> 모델명 매핑 업로드
   ---------------------------------------------------------
   "상품코드,모델명" 2컬럼짜리 CSV/엑셀을 그대로 업로드한다. 맨 위에 안내
   문구가 한 줄 더 있을 수 있어서, "상품코드"/"모델명" 헤더가 있는 실제
   헤더 행을 찾아서 쓴다 (영문 헤더 product_code/model_name도 허용).
--------------------------------------------------------- */
function parseSaProductModelMappingCsv(text) {
  const lines = text.split(/\r\n|\n|\r/).filter((line) => line.trim().length > 0);

  const headerIdx = lines.findIndex((line) => {
    const cells = splitCsvLine(line).map((c) => c.trim().toLowerCase());
    return (
      (cells.includes("상품코드") || cells.includes("product_code")) &&
      (cells.includes("모델명") || cells.includes("model_name"))
    );
  });
  if (headerIdx === -1) {
    throw new Error('"상품코드"/"모델명" 헤더를 찾을 수 없습니다. 파일 형식을 확인해주세요.');
  }

  const header = splitCsvLine(lines[headerIdx]).map((h) => h.trim().toLowerCase());
  const idxCode = header.indexOf("상품코드") !== -1 ? header.indexOf("상품코드") : header.indexOf("product_code");
  const idxModel = header.indexOf("모델명") !== -1 ? header.indexOf("모델명") : header.indexOf("model_name");

  const seen = new Map();
  for (const line of lines.slice(headerIdx + 1)) {
    const cells = splitCsvLine(line);
    const productCode = (cells[idxCode] ?? "").trim();
    const modelName = (cells[idxModel] ?? "").trim();
    if (!productCode || !modelName) continue;

    seen.set(productCode, { product_code: productCode, model_name: modelName });
  }

  return [...seen.values()];
}

productModelMappingUploadForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  const file = productModelMappingFileInput.files[0];
  if (!file) return;

  productModelMappingUploadStatus.hidden = true;
  const submitBtn = productModelMappingUploadForm.querySelector("button[type=submit]");
  submitBtn.disabled = true;
  const originalLabel = submitBtn.textContent;
  submitBtn.textContent = "업로드 중...";

  try {
    const text = await readUploadFileAsCsvText(file);
    const rows = parseSaProductModelMappingCsv(text);

    if (rows.length === 0) {
      throw new Error("업로드할 데이터가 없습니다.");
    }

    const result = await uploadSaProductModelMapping(rows);
    if (!result.success) {
      throw new Error(result.message);
    }

    showUploadStatus(productModelMappingUploadStatus, `업로드 완료: 상품코드 ${result.inserted}개 매핑 저장`, "success");
    productModelMappingUploadForm.reset();
  } catch (err) {
    showUploadStatus(productModelMappingUploadStatus, err.message || "업로드 중 오류가 발생했습니다.", "error");
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = originalLabel;
  }
});

productMappingUploadForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  const file = productMappingFileInput.files[0];
  if (!file) return;

  productMappingUploadStatus.hidden = true;
  const submitBtn = productMappingUploadForm.querySelector("button[type=submit]");
  submitBtn.disabled = true;
  const originalLabel = submitBtn.textContent;
  submitBtn.textContent = "업로드 중...";

  try {
    const text = await readUploadFileAsCsvText(file);
    const rows = parseSaProductMappingCsv(text);

    if (rows.length === 0) {
      throw new Error("업로드할 데이터가 없습니다.");
    }

    const result = await uploadSaProductMapping(rows);
    if (!result.success) {
      throw new Error(result.message);
    }

    showUploadStatus(productMappingUploadStatus, `업로드 완료: 상품 ${result.inserted}개 매핑 저장`, "success");
    productMappingUploadForm.reset();
  } catch (err) {
    showUploadStatus(productMappingUploadStatus, err.message || "업로드 중 오류가 발생했습니다.", "error");
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = originalLabel;
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

function renderKpiCards(current, comparison, targetGrid = kpiGrid) {
  targetGrid.innerHTML = "";
  KPI_DEFS.forEach((def) => {
    const card = document.createElement("div");
    card.className = "kpi-card";
    card.innerHTML = `
      <span class="kpi-label">${def.label}</span>
      <span class="kpi-value">${def.format(current[def.key])}</span>
      ${comparison ? buildDeltaHtml(current[def.key], comparison[def.key]) : ""}
    `;
    targetGrid.appendChild(card);
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
