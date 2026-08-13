# ADS PERFORMANCE DASHBOARD (1단계: 기본 구조)

광고 대행사가 여러 광고주의 광고 성과를 보여주는 멀티 광고주 대시보드입니다.
현재 단계는 **정적 프론트엔드(Mock 데이터) 버전**이며, Supabase 연동 및 네이버 광고 API
연동은 다음 단계에서 진행합니다.

## 기술 구성

| 영역 | 기술 |
|---|---|
| 프론트엔드 | HTML / CSS / JavaScript (Vanilla) |
| 배포 | GitHub Pages |
| 차트 | Chart.js (CDN) |
| 백엔드/DB/인증 (예정) | Supabase |
| 광고 데이터 연동 (예정) | 네이버 광고 API |

## 파일 구조

```
index.html   # 로그인 화면 + 대시보드 화면 마크업
style.css    # 전체 스타일 (BI 대시보드 톤: 네이비 사이드바 + 블루 포인트)
app.js       # Mock 인증, Mock 데이터, 렌더링 로직
README.md    # 프로젝트 설명
```

빌드 과정이 없는 순수 정적 사이트이므로, GitHub Pages에 파일을 그대로 올리면 바로 동작합니다.

## 로컬에서 실행하기

별도 서버 없이 `index.html`을 브라우저로 열어도 되고, 로컬 서버를 띄워도 됩니다.

```bash
npx serve .
```

## 로그인 (Mock 인증)

현재 비밀번호 검증은 **개발 테스트용 Mock 로직**입니다 (`app.js`의 `mockAuthenticate` 함수).

- 비밀번호 `123` 입력 → 대시보드 진입
- 그 외 값 입력 → "비밀번호가 올바르지 않습니다." 표시

> ⚠️ 실 운영 배포 전, `mockAuthenticate()`를 Supabase Edge Function 기반 인증 호출로
> 교체해야 합니다. 프론트엔드 코드에 실제 비밀번호나 시크릿을 하드코딩하지 않습니다.

## 데이터 구조 (Mock)

`app.js`의 `ADVERTISERS` 배열에 광고주별 정보와 KPI를 객체 형태로 관리합니다.
추후 이 배열을 Supabase 테이블 조회 결과로 그대로 대체할 수 있도록 설계했습니다.

```js
{
  id: "adv-001",
  name: "코스모뷰티",
  period: "2026.07.01 ~ 2026.07.31",
  kpi: { cost, revenue, roas, clicks, ctr, conversions, cvr, cpa }
}
```

상단 바의 "광고주명" 드롭다운에서 광고주를 전환하면 KPI 카드와 차트가 해당 광고주의
Mock 데이터로 다시 렌더링됩니다. 이는 향후 여러 광고주가 동일한 대시보드 UI를
공유하는 구조를 염두에 두고 설계한 부분입니다.

## 화면 구성

### 로그인 화면
- 로고 영역, "ADS PERFORMANCE DASHBOARD" 타이틀, 서브 문구
- 비밀번호 입력창, "대시보드 접속" 버튼

### 대시보드 화면
- 좌측 사이드바: 성과 대시보드 / 그래프 추이 / 상품별 데이터 / 일별 데이터 /
  월별 데이터 / 카테고리별 데이터 / 캠페인별 성과 / 광고그룹별 성과 / 소재별 성과
  - "성과 대시보드"만 1단계에서 실제 구현되어 있으며, 나머지 메뉴는 클릭 시
    "준비 중" 안내가 표시됩니다 (다음 단계에서 Supabase 연동과 함께 구현 예정).
- 상단 바: 광고주명(드롭다운), 분석 기간, 로그아웃 버튼
- KPI 카드: 광고비 / 광고매출 / ROAS / 클릭수 / CTR / 전환수 / CVR / CPA
- 차트: 일별 광고비 추이, 일별 광고매출 추이, ROAS 추이 (Chart.js)

## 다음 단계 (예정)

1. Supabase 프로젝트 연결 (Auth, DB 테이블 설계)
2. `mockAuthenticate()` → Supabase Edge Function 인증으로 교체
3. `ADVERTISERS` Mock 배열 → Supabase 쿼리 결과로 교체
4. 네이버 광고 API 연동 → 실 데이터 수집/동기화
5. 사이드바의 나머지 메뉴(그래프 추이, 상품별 데이터 등) 실제 구현
