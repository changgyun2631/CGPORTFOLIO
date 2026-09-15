# 인계서 — CGPORTFOLIO

작성 2026-09-15 · 인계 시점 커밋 `a607595`

이 문서는 **지금까지 무엇을 만들었고, 무엇이 검증됐고, 무엇이 아직 검증되지 않았는지**를
있는 그대로 적는다. 다음 담당자는 이 문서의 "검증되지 않은 것" 절을 가장 먼저 읽을 것.

---

## 1. 한눈에

| 항목 | 값 |
|---|---|
| 프로젝트 | CGPORTFOLIO — 개인 포트폴리오 대시보드 |
| 작업 폴더 | `C:\Users\ACC-002\Desktop\cgportfolio` |
| 저장소 | https://github.com/changgyun2631/CGPORTFOLIO (Public, `main`) |
| 스택 | Next.js 16 (App Router, Turbopack) · React 19 · TypeScript · Tailwind v4 |
| 런타임 의존성 | `next`, `react`, `react-dom`, `server-only` — **이게 전부다** |
| 규모 | 소스 38개 파일 5,215줄 |
| 배포 | **없음.** 로컬에서만 돌려봤다 |

커밋 3개가 전부다.

```
a607595  Keep personal financial data out of the repository
772586c  Rename project to CGPORTFOLIO
849e00b  Add personal portfolio dashboard
```

---

## 2. 이 프로젝트가 뭔지

qld.kr(기승전QLD)과 같은 종류의 개인 자산 대시보드를 사용자 소유로 새로 만든 것이다.
화면 구성과 기능 범위를 참고했고, **코드·CSS·이미지·글은 전혀 가져오지 않았다.**
원본은 Laravel + Blade 서버렌더라 애초에 소스가 공개돼 있지도 않다. 저장소 전체에
그 사이트에 대한 참조가 한 건도 없다(`git grep` 으로 확인).

### 스택을 Next.js로 고른 이유

사용자가 처음엔 원본과 같은 Laravel을 택했다가 되돌렸다. PC에 PHP·Composer가 없고,
PHP 호스팅에 월 5천~8천원이 드는 반면 Next.js는 Vercel 무료로 가능하다는 점 때문이다.
**이 논의는 이미 끝났다. 다시 꺼내지 말 것.**

---

## 3. 아키텍처 — 3가지 원칙

### 원칙 1. 모든 숫자는 거래원장에서 파생된다

보유수량·평균단가·실현손익·예수금을 **어디에도 저장하지 않는다.** `transactions.json`과
`cashflows.json`만이 원본이고 나머지는 매번 계산한다. 거래 한 건을 고치면 화면 전체가
일관되게 따라 움직인다.

**절대 하지 말 것**: "성능을 위해" 계산 결과를 파일에 캐시하는 것. 원장과 어긋나는
순간 어느 쪽이 맞는지 알 수 없게 된다.

### 원칙 2. 시세는 cron이 적재하고, 화면은 저장된 값만 읽는다

```
[cron] → /api/cron/refresh → 시세 공급자 → data/quotes.json
                                               ↓
                           페이지 요청 → 저장된 값만 읽어 서버 렌더
```

페이지를 열 때 외부 API를 부르지 않는다. 방문 수가 늘어도 API 호출 수는 안 늘어서
무료 플랜 한도 안에서 돌아간다. 스냅샷이 한 점씩 쌓이므로 추이 차트와 MDD가 공짜로 나온다.

**절대 하지 말 것**: 페이지나 컴포넌트에서 직접 시세 API를 호출하는 것. 같은 실수로
기존 `web-stock` 프로젝트가 Twelve Data 하루 한도(800회)를 넘겼던 전례가 있다.

### 원칙 3. 시세 공급자는 교체 가능하다

`lib/providers/types.ts`의 `QuoteProvider` 인터페이스만 맞추면 어떤 공급자든 꽂힌다.
공급자를 추가·교체할 때 건드리는 파일은 `lib/providers/index.ts` 하나뿐이다.

---

## 4. 파일 지도

### 계산 (`lib/domain/`) — 이 프로젝트의 핵심

| 파일 | 줄 | 역할 |
|---|---|---|
| `portfolio.ts` | 371 | 이동평균법 포지션, 실현손익, 예수금, 원화환산, 비중, 계좌 집계 |
| `backtest.ts` | 303 | 일별 시뮬레이션. 적립·인출·리밸런싱·수수료·차익과세 |
| `metrics.ts` | 164 | 기간 필터, 최고/최저, MDD, 구간 수익률, 다운샘플링 |
| `dividends.ts` | 147 | 월별·연도별·종목별 집계, 연간 예상 |
| `types.ts` | 125 | 도메인 타입 정의 |
| `lookthrough.ts` | 103 | ETF를 구성종목으로 펼쳐 합산 |
| `treemap.ts` | 78 | squarified 타일 배치 |

### 데이터 (`lib/data/`)

- `store.ts` — 읽기 전용 저장소. **DB로 옮길 때 고칠 곳이 여기다.** 함수 본문만 쿼리로 바꾸면 된다
- `views.ts` — 페이지용 뷰모델 조립. `react cache`로 요청당 1회만 계산

### 시세 (`lib/providers/`)

- `types.ts` — `QuoteProvider` / `FxProvider` 인터페이스, `ProviderShapeError`
- `twelve-data.ts` — 미국 종목 + USD/KRW
- `naver-kr.ts` — 국내 ETF (비공식 경로)
- `index.ts` — 시장별 공급자 라우팅

### 화면 (`app/`)

`/` 대시보드 · `/asset-map` · `/accounts` · `/symbols` · `/symbols/[id]` · `/dividends`
· `/backtests` · `/backtests/[id]` · `/calendar` · `/philosophy` · `/reports` · `/reports/[slug]`
· `/api/cron/refresh`

### 컴포넌트 (`components/`)

차트는 **전부 SVG 직접 구현**이다. 차트 라이브러리를 쓰지 않는다.
상호작용이 필요한 `value-chart.tsx`만 클라이언트 컴포넌트고 나머지는 서버 렌더.

---

## 5. 검증된 것 / 검증되지 않은 것

**이 절이 이 문서에서 제일 중요하다.**

### 검증됨

| 항목 | 방법 |
|---|---|
| 타입체크 | `npx tsc --noEmit` 통과 |
| 린트 | `npx eslint .` 통과 (경고 0) |
| 프로덕션 빌드 | 20개 라우트 전부 생성 |
| 화면 렌더링 | 브라우저에서 전 페이지 육안 확인 |
| 모바일 반응형 | 375px에서 가로 오버플로 0 (DOM 측정) |
| 라이트/다크 테마 | 전환 동작 확인 |
| 새 클론 실행 | 실제로 clone → npm install → seed → build 완주 |
| 계산 정확성 | 비중 합계 100%, 예수금 양수, 백테스트 결과 상호 정합성 **육안 검토 수준** |

### 검증되지 않음 — 반드시 확인할 것

| 항목 | 상태 |
|---|---|
| **Twelve Data 실호출** | 코드를 **한 번도 실행한 적 없다.** API 응답 형태를 추정해 작성했다 |
| **네이버 국내 시세 크롤링** | 마찬가지로 **한 번도 실행한 적 없다.** 응답 구조는 가정이다 |
| **`/api/cron/refresh` 실행** | 한 번도 호출한 적 없다. `recomputeTotal()` 부분이 특히 미검증 |
| **자동화 테스트** | **존재하지 않는다.** 테스트 프레임워크조차 설치 안 됨 |
| **배포** | 한 번도 안 해봤다 |
| **실제 데이터** | 전부 `seed.mjs`가 만든 가상 값. 실거래 입력 안 됨 |

시세 공급자 코드는 응답 구조가 다르면 `ProviderShapeError`로 **즉시 터지게** 만들어
뒀다. 조용히 틀린 값을 쓰는 것보다 낫기 때문이다. 처음 실행하면 터질 가능성을 염두에 둘 것.

---

## 6. 알려진 제약

1. **서버리스 배포 불가 (현재 형태로는)** — `/api/cron/refresh`가 `data/*.json`에 파일을
   쓴다. Vercel 같은 읽기전용 파일시스템에서는 동작하지 않는다. 해결하려면 저장 대상을
   DB로 바꿔야 하고, 고칠 곳은 `lib/data/store.ts`(읽기)와 그 라우트(쓰기) 둘뿐이다.
   VPS나 로컬 상시 구동이면 지금 그대로 된다.
2. **국내 시세는 비공식 경로** — 상대 사이트 구조가 바뀌면 깨진다. 상용으로 쓰려면
   증권사 Open API로 갈아타야 한다. 그때 `naver-kr.ts`만 새로 쓰면 된다.
3. **ETF 구성종목은 수동 갱신** — `data/lookthrough.json`. 자동 수집 소스를 안 붙였다.
4. **인증 없음** — 누구나 열면 보인다. 외부 공개 전에 반드시 붙일 것.
5. **백테스트 구간이 2.7년** — `prices.json`에 2024-01-02 이후만 있다. 더 긴 백테스트를
   하려면 과거 종가를 더 넣어야 한다.
6. **개인 데이터는 git이 지켜주지 않는다** — `.gitignore`로 뺐으므로 **별도 백업 필수.**

---

## 7. 데이터 정책 — 지켜야 할 선

저장소는 **Public**이다. 개인 금융 데이터는 `.gitignore`로 빼 두었다.

| 저장소에 있음 | 저장소에 없음 (로컬 전용) |
|---|---|
| `lookthrough.json` (공개 ETF 구성) | `accounts.json`, `symbols.json` |
| `backtests.json` (시나리오 정의) | `transactions.json`, `cashflows.json`, `dividends.json` |
| `philosophy.md`, `reports/` (직접 쓴 글) | `snapshots.json`, `quotes.json`, `prices.json`, `fx*.json` |
| `sample/` (실행용 가상 데이터) | `calendar.json` |

**절대 하지 말 것**: 위 오른쪽 파일들을 `git add` 하는 것. 한 번 커밋하면 이력에 영구히
남아 지워도 이력·포크·캐시에 남는다. `.gitignore`의 해당 블록을 지우거나 `-f`로 강제
추가하지 말 것.

지금까지 커밋된 데이터는 전부 가상 값이라 실제 금액이 이력에 남은 적은 없다.

---

## 8. 이미 잡은 버그 — 다시 만들지 말 것

작업 중 실제로 발생해서 고친 것들이다. 같은 실수를 반복하기 쉬운 지점이라 남긴다.

| 버그 | 원인 | 교훈 |
|---|---|---|
| cron이 파일을 갱신해도 화면이 낡은 값 표시 | `store.ts`가 모듈 수준 `Map`에 캐시 | 요청 경계에서 비워지는 `react cache`를 쓸 것. 모듈 캐시는 프로세스가 사는 동안 영원히 남는다 |
| 예수금 -1.2억, 비중 합계 170% | 시드가 초기 매수에 대응하는 입금을 안 만듦 | 매수 전에 입금이 있어야 한다 |
| 모바일 가로 스크롤 | `grid`에 기본 컬럼 미지정 → 암시적 컬럼이 `max-content` | 반응형 그리드엔 항상 `grid-cols-1`을 기본으로 둘 것 |
| 모바일 가로 스크롤 (2차) | `opacity-0` 라벨이 레이아웃 폭을 차지 | 숨길 땐 `absolute`로 흐름에서 빼거나 `hidden` |
| 백테스트가 첫 달부터 "자금 소진" | 수수료 때문에 실수령이 목표보다 몇백 원 모자란 것을 소진으로 오판 | "못 만든 것"과 "조금 모자란 것"을 구분할 것 |
| 인출 시나리오 결과가 과도하게 나쁨 | 매도대금 **전체**에 과세 | 원금 회수분은 비과세. 차익에만 매길 것 |
| 리밸런싱 후 세금 과소 계산 | 전량매도·재매수로 매입원가가 현재가로 리셋 | 리밸런싱은 원가를 이어받아야 한다 |
| 적립식에서 "연평균 0.00%" | 초기 일시금 0이면 CAGR 자체가 성립 안 함 | `cagrApplicable`로 판별해 순증률로 대체 |

---

## 9. 검증 명령

```bash
npx tsc --noEmit
```

```bash
npx eslint .
```

```bash
npm run build
```

```bash
node scripts/seed.mjs
```

개발 서버는 `npm run dev`. 데이터가 없으면 화면이 오류를 내는데, 그때는
`node scripts/seed.mjs`를 먼저 돌리라는 안내가 나온다.

---

## 10. 작업 환경 메모

- Windows 11, PowerShell / Git Bash 병행
- GitHub CLI(`gh`) 2.100.0 **설치돼 있으나 로그인 안 됨.** `gh auth login` 필요
- git 신원은 저장소 단위 설정 (`changgyun2631`). 전역 설정은 비어 있음
- 기존 관련 프로젝트: `C:\Users\ACC-002\Desktop\web-stock` (별개 프로젝트, 건드리지 말 것.
  단 `.claude/launch.json`에 이 프로젝트 프리뷰 구성 한 줄이 추가돼 있음)

---

다음에 할 일은 `WORK_ORDER.md` 참고.
