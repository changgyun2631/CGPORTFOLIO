# CGPORTFOLIO

보유 자산과 전일 변동을 한 화면에서 보는 개인용 포트폴리오 대시보드. 거래원장
하나에서 평가금액·수익률·비중·배당을 전부 파생시킨다.

> **이어받아 작업하는 경우** — [`HANDOFF.md`](HANDOFF.md)(현재 상태와 검증 여부)를
> 먼저 읽고 [`WORK_ORDER.md`](WORK_ORDER.md)(다음 작업과 규칙)로 넘어갈 것.
> 특히 "검증되지 않은 것" 절을 읽지 않고 손대면 곤란해진다.

## 빠르게 띄우기

```bash
npm install
```

```bash
node scripts/seed.mjs
```

```bash
npm run dev
```

`seed.mjs` 는 `data/sample` 을 바탕으로 가상 포트폴리오 한 벌을 만든다. 실제 금액이
아니라 화면이 돌아가는 것을 확인하기 위한 값이다.

## 로그인 설정

실제 데이터를 쓰거나 서버에 공개하기 전, 저장소 폴더의 터미널에서 다음 명령을 한 번
실행한다.

```powershell
npm run auth:setup
```

아이디와 8자 이상의 비밀번호를 물으며, 비밀번호 원문 대신 scrypt 해시와 무작위
세션·예약작업 비밀키를 `.env.local`에 저장한다. 로그인 쿠키는 `HttpOnly`,
`SameSite=Lax`이고 발급 시점부터 7일 뒤 만료된다. 설정을 바꾼 뒤에는 서버를 다시
빌드하고 시작해야 한다. 외부 서버에서는 반드시 HTTPS를 사용한다.

## 개인 데이터는 저장소에 없다

보유 종목·수량·평단·평가금액·계좌 잔고·입출금이 담기는 파일은 `.gitignore` 로 빼
두었다. 한 번 커밋하면 git 이력에 영구히 남아서, 나중에 지워도 이력·포크·캐시에
그대로 남기 때문이다.

| 저장소에 있음 | 저장소에 없음 (로컬 전용) |
|---|---|
| `lookthrough.json` — 공개된 ETF 구성 | `accounts.json`, `symbols.json` |
| `backtests.json` — 시나리오 정의 | `transactions.json`, `cashflows.json`, `dividends.json` |
| `philosophy.md`, `reports/` — 직접 쓴 글 | `snapshots.json`, `quotes.json`, `prices.json`, `fx*.json` |
| `sample/` — 실행해보기용 가상 데이터 | `calendar.json` |

내 데이터로 쓰려면 `data/accounts.json` 과 `data/symbols.json` 부터 고치고 거래·입출금·
배당 파일을 채운다. 이 파일들은 커밋되지 않으므로 **따로 백업해 둘 것.**

## 설계의 핵심

### 1. 숫자는 전부 거래원장에서 나온다

`data/transactions.json`(매매)과 `data/cashflows.json`(입출금)이 원본이다.
보유수량·평균단가·실현손익·예수금은 어디에도 따로 저장하지 않고 매번 계산한다.
거래 한 건을 고치면 화면 전체가 일관되게 따라 움직인다.

계산은 `lib/domain/` 에 모여 있다.

| 파일 | 역할 |
|---|---|
| `portfolio.ts` | 포지션·평균단가·실현손익·예수금·평가금액·비중 |
| `metrics.ts` | 기간 필터, 최고/최저, MDD, 구간 수익률 |
| `lookthrough.ts` | ETF를 구성종목으로 펼쳐 합산 (자산맵의 재료) |
| `dividends.ts` | 월별·연도별·종목별 배당 집계, 연간 예상 |
| `treemap.ts` | 자산맵 타일 배치 (squarified) |

### 2. 시세는 cron이 적재하고, 화면은 저장된 값만 읽는다

```
[cron] -> /api/cron/refresh -> 시세 공급자 -> data/quotes.json
                                                  |
                              페이지 요청 -> 저장된 값만 읽어 서버 렌더
```

페이지를 열 때 외부 API를 부르지 않는다. 그래서 방문 수가 늘어도 API 호출 수는
늘지 않고, 무료 플랜 한도 안에서 운영된다. 스냅샷이 한 점씩 쌓이므로 추이
차트와 MDD가 따로 작업 없이 만들어진다.

갱신 호출:

```bash
curl http://localhost:3000/api/cron/refresh
```

`CRON_SECRET` 을 설정했다면 `Authorization: Bearer <토큰>` 헤더를 함께 보낸다.

### 3. 시세 공급자는 갈아끼울 수 있다

`lib/providers/` 의 `QuoteProvider` 인터페이스만 맞추면 어떤 공급자든 꽂힌다.

- `twelve-data.ts` — 미국 상장 종목 + USD/KRW 환율
- `naver-kr.ts` — 국내 ETF. 공식 API가 아니라서 응답 구조가 바뀌면
  `ProviderShapeError` 로 즉시 터진다. 조용히 틀린 값을 쓰는 것보다 낫다.
  정식 경로(증권사 Open API)로 옮길 때는 이 파일만 새로 쓰면 된다.

공급자를 추가하거나 바꿀 때 건드리는 곳은 `lib/providers/index.ts` 하나다.

### 4. 차트는 라이브러리 없이 직접 그린다

전부 SVG를 직접 만든다(`components/charts/`). 번들에 차트 라이브러리가 들어가지
않고, 서버 렌더 결과가 그대로 최종 화면이 된다. 상호작용이 필요한 추이 차트만
클라이언트 컴포넌트다.

## 내 데이터로 바꾸기

`scripts/seed.mjs` 가 만든 샘플을 지우고 아래 파일을 직접 채운다.

| 파일 | 내용 |
|---|---|
| `data/accounts.json` | 계좌 목록 (위탁/연금/ISA 등) |
| `data/symbols.json` | 보유 종목 정의. `lookthroughId` 로 구성종목 표와 연결 |
| `data/transactions.json` | 매매 내역 |
| `data/cashflows.json` | 입출금 |
| `data/dividends.json` | 배당 수령 내역 (세후 실수령액) |
| `data/lookthrough.json` | ETF 구성종목. 발행사 공시로 주기적 갱신 |
| `data/calendar.json` | 일정 |
| `data/backtests.json` | 백테스트 시나리오 정의 (결과는 매번 계산) |
| `data/philosophy.md` | 투자철학 본문 |
| `data/reports.json` + `data/reports/*.md` | 리포트 |

백테스트는 시나리오만 저장하고 결과는 요청할 때마다 `data/prices.json` 의 일별 종가와
환율로 다시 돌린다. 가격 이력이 늘어나면 결과도 따라 갱신된다. 엔진은
`lib/domain/backtest.ts` 이고, 인출 시 세금은 원금 회수분이 아닌 매도 차익에만 매긴다.

투자철학 화면의 레버리지·인컴 비중 분류는 `app/philosophy/page.tsx` 상단의 종목 목록으로
정한다. 종목을 새로 담으면 그 목록에도 넣어야 계산에 잡힌다.

`quotes.json` / `fx-quote.json` / `snapshots.json` / `prices.json` 은 cron이
관리하는 파일이라 직접 손대지 않아도 된다.

## 알려진 제약

- **서버리스 배포 불가 (현재 형태로는)** — `/api/cron/refresh` 가 `data/*.json` 에
  파일을 쓴다. Vercel 같은 읽기 전용 파일시스템에서는 동작하지 않는다. 그런 곳에
  올리려면 저장 대상을 DB로 바꿔야 한다. 바꿀 곳은 `lib/data/store.ts`(읽기)와
  위 라우트(쓰기) 둘뿐이고, 나머지 코드는 그대로다. VPS나 로컬 상시 구동
  환경이라면 지금 형태로 바로 쓸 수 있다.
- **국내 시세는 비공식 경로** — 위 3번 참고.
- **ETF 구성종목은 수동 갱신** — 발행사가 공시하지만 자동 수집은 붙여두지
  않았다. `data/lookthrough.json` 을 직접 갱신한다.
- **단일 사용자 인증** — 여러 사용자·비밀번호 찾기 기능은 없다. 로그인 실패 제한은
  단일 서버 프로세스 메모리에 있으므로 여러 서버 복제본으로 확장할 때는 공유 저장소로
  옮겨야 한다.

## 검증

```bash
npx tsc --noEmit
```

```bash
npx eslint .
```

```bash
npm run build
```
