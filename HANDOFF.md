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
| **계산 엔진 단위 테스트** | Vitest 도입. `lib/domain/` 5개 파일(portfolio/backtest/metrics/dividends/lookthrough) 45개 테스트, `npm test` 전부 통과. §8의 버그 8건 중 경계 사례로 고정 가능한 것들을 테스트로 재현해 회귀를 막아 둠 |
| **Twelve Data 실호출** | 2026-09-15 `tsx`로 `lib/providers/twelve-data.ts` 실제 실행. QLD/TQQQ/SCHD 단일·복수 조회, USD/KRW 환율 전부 성공. 응답 형태가 코드 가정과 정확히 일치했다 (단일 심볼은 객체, 복수는 심볼 키 객체 — 가정대로) |
| **네이버 국내 시세 크롤링** | 2026-09-15 `lib/providers/naver-kr.ts` 실제 실행. 418660/0015B0/490590/491620 4종목 전부 성공. `closePrice`/`compareToPreviousClosePrice` 필드명 가정이 맞았고, 하락 종목(490590)에서 `compareToPreviousClosePrice`가 음수로 오는 것도 확인(부호 포함). 버그 1건 발견·수정: `marketState`를 항상 `"closed"`로 하드코딩하고 있었는데, 실제 응답의 `marketStatus` 필드(`"OPEN"`/그 외)를 반영하도록 고침 |
| **공급자 실패 처리** | 존재하지 않는 심볼을 섞어 호출 → 해당 심볼만 `ProviderShapeError`로 건너뛰고 나머지는 정상 반환되는 것을 Twelve Data·네이버 양쪽에서 확인 (`console.warn`에 원인 메시지 출력) |
| **`/api/cron/refresh` 실행** | 2026-09-15 `npm run dev` + `curl`로 실제 호출. 7종목 전부 갱신, `data/quotes.json`·`fx-quote.json`·`snapshots.json`이 실제로 갱신되고 대시보드 HTML에 새 총액이 그대로 반영되는 것까지 확인. `recomputeTotal()`이 계산한 총액이 `loadPortfolio()`(정식 계산 경로)가 페이지에 렌더한 총액과 정확히 일치함을 확인 — 두 계산 경로가 어긋나지 않는다 |
| **부분 실패 시 기존 값 유지** | Twelve Data 키를 일부러 무효화해 US 3종목만 실패시켜 봄. 실패한 종목은 `asOf`가 그대로였고(값이 안 바뀜), 성공한 KR 4종목만 갱신됨. `fx-quote.json`도 환율 조회 실패 시 안 덮어써짐. 빈 값으로 덮어쓰는 사고는 없었다 |
| **`CRON_SECRET` 인증** | 설정 후 무인증/오답 헤더는 401, 올바른 `Authorization: Bearer <secret>`만 200. 실제로 헤더를 바꿔가며 확인 |
| **실제 데이터 (부분)** | 2026-09-15 사용자의 실제 미국주식 위탁계좌 CSV(28종목)를 `scripts/import-holdings-csv.mjs`로 부트스트랩. 실제 평단가·수량이 반영된 채로 대시보드·계좌·종목·백테스트 전 페이지 200 확인, `npm test`/`tsc`/`eslint`/`build` 전부 통과. 상세는 아래 "실거래 데이터 상태" 참고 |
| **Twelve Data 대량 종목 처리** | 실제 28종목으로 cron을 돌려보다 발견: 무료 플랜은 분당 8크레딧인데 심볼 하나당 1크레딧이라, 8개 넘는 심볼을 한 URL에 묶어도 429로 전부 실패한다. `twelve-data.ts`를 8개씩 분당 한 묶음으로 보내도록 고쳐 30개 심볼 전부 성공(약 3.1분 소요)하는 것까지 실측 확인 |
| **백업 자동화** | `scripts/backup-data.mjs` 작성 후 Windows 작업 스케줄러에 "CGPORTFOLIO 데이터 백업" 이름으로 등록 완료 (매일 새벽 3시, `C:\Users\ACC-002\cgportfolio-backups\`, 최근 30개 보관). `Start-ScheduledTask`로 수동 트리거해 `LastTaskResult: 0`(성공)과 실제 백업 폴더 생성까지 확인 |
| **작업 폴더를 메인 체크아웃으로 합침** | 이 작업은 원래 `.claude/worktrees/continue-previous-work-f7f06a`라는 워크트리에서 했다. 실제 데이터가 워크트리 삭제 시 같이 사라지는 걸 막기 위해 브랜치를 `C:\Users\ACC-002\Desktop\cgportfolio`(메인 체크아웃, `main` 브랜치)에 fast-forward 병합하고, gitignore된 실제 데이터 파일 8종(`accounts.json` 등)과 `.env.local`도 그대로 옮겼다. 메인에서 `npm install` 후 `tsc`/`eslint`/`test`/`build` 전부 통과 |
| **워크트리 중첩 버그** | 위 병합 과정에서 발견: 워크트리가 저장소 안에 있다 보니 메인에서 `eslint .`/`vitest run`을 돌리면 워크트리의 `.next` 빌드 산출물·테스트 파일까지 같이 스캔돼 eslint 683개 오류, vitest 테스트 2배 중복 실행이 났다. `eslint.config.mjs`/`vitest.config.mts`에 `**/.claude/worktrees/**` 제외 규칙을 추가해 고침 |
| **시세 자동 갱신 스케줄링 (P2-1)** | `scripts/refresh-quotes.mjs` + `scripts/start-server.cmd` 작성, Windows 작업 스케줄러에 "CGPORTFOLIO 서버"(매일 새벽 4시 기동, 실패 시 3회 재시도)·"CGPORTFOLIO 시세 갱신"(6시간마다 `/api/cron/refresh` 호출) 등록. 수동 트리거로 30종목 갱신 성공(30/0/0) 2회 확인, 로그는 `~/cgportfolio-logs/refresh.log` |

### 검증되지 않음 — 반드시 확인할 것

| 항목 | 상태 |
|---|---|
| **Twelve Data/네이버 값의 육안 대조** | 코드 실행 결과는 확인했으나, 이 환경의 브라우저 도구가 `finance.naver.com` 접근을 차단해 시세 앱과의 육안 대조는 못 했다. 네이버 시세는 그 사이트가 쓰는 실시간 폴링 API를 직접 부른 값이라 원천은 같다 |
| **배포** | 한 번도 안 해봤다 |
| **서버 상시구동 안정성** | 테스트 중 "CGPORTFOLIO 서버" 작업으로 띄운 프로세스가 원인 불명으로 한 번 죽었다(`LastTaskResult: 0xC000013A`, Ctrl+C로 종료된 것과 같은 코드). Task Scheduler 이벤트 로그가 이 환경에서 비활성이라(`wevtutil` 조회 결과 없음) 원인을 못 찾았다. 재기동 후에는 5분+ 안정적이었고 갱신도 정상 성공했다. **로그온 트리거(`ONLOGON`)는 이 환경에서 `Access is denied`로 등록 자체가 안 돼서**, 대안으로 "매일 새벽 4시 기동 + 실패 시 재시도 3회"를 썼다 — PC 재부팅 시 다음 새벽 4시까지 서버가 안 뜰 수 있다. 다음 담당자는 며칠 지켜보고, 자주 죽으면 `start-server.cmd`에 무한 재시작 루프(`:loop`/`goto`)를 넣거나 다른 프로세스 매니저(pm2 등) 도입을 고려할 것 |

### 실거래 데이터 상태 (2026-09-15)

`계좌.csv`(미국주식 위탁계좌, 28종목)를 `scripts/import-holdings-csv.mjs`로 가져왔다.
이 CSV는 **현재 보유 스냅샷**(평단가·수량)일 뿐 개별 매매 날짜가 없어서, 전 종목을
"오늘 날짜에 평단가·수량 그대로 한 번에 산" 부트스트랩 거래 1건씩으로 넣었다
(`transactions.json`의 `note` 필드에 이 사실을 명시해 뒀다). 원금은 몰라서 매입금액
합계로 근사했다(`cashflows.json`의 `note` 참고). 배당 이력은 비어 있다.

**아직 안 된 것**:
- 실제 매매 날짜별 개별 거래 이력 (지금은 부트스트랩 1건뿐이라 종목 상세의 "매매 이력",
  실현손익 이력이 실제와 다르다 — 현재 보유분의 평단가·평가금액은 정확하다)
- 실제 입출금 이력 (원금이 근사치)
- 배당 실지급 이력
- 기존 시드에 있던 `418660`/`0015B0`/`490590` 등 국내 ETF는 완전히 삭제했다 (`491620`만
  `leverage-ladder`/`dca-monthly` 데모 백테스트가 참조해서 심볼 정의만 남겨둠, 보유
  거래는 없음). `TQQQ`도 같은 이유로 심볼만 남아 있다

**환경 관련 발견**: 이 작업 환경에서 Browser 도구(`preview_start`)가 띄운 `next dev`
프로세스는 외부 API(Twelve Data·네이버)로 나가는 `fetch`가 전부 `fetch failed`로
실패했다. 반면 터미널(Bash 도구)에서 직접 `npm run dev`로 띄운 프로세스는 같은
코드로 정상 호출됐다. Browser 도구가 띄우는 프로세스에 별도의 아웃바운드 네트워크
제약이 있는 것으로 보인다 — 실제 VPS나 로컬 상시구동 환경에서는 해당하지 않을
가능성이 높지만, 다음에 이 환경에서 cron을 다시 검증할 때는 dev 서버를 Browser
도구가 아니라 터미널에서 직접 띄울 것.

시세 공급자 코드는 응답 구조가 다르면 `ProviderShapeError`로 **즉시 터지게** 만들어
뒀다. 조용히 틀린 값을 쓰는 것보다 낫기 때문이다. 실제로 돌려본 결과 이 설계가
의도대로 동작함을 확인했다 (잘못된 심볼만 걸러지고 나머지는 살아남는다).

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
2026-09-15부터 `data/`에 실제 금융 정보(미국주식 위탁계좌)가 들어 있다 — 커밋·
스크린샷·로그에 노출되지 않도록 각별히 주의할 것 (`WORK_ORDER.md` P1-2 참고).

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
| 네이버 `marketState`가 항상 "closed" | 실제 응답의 `marketStatus` 필드를 안 쓰고 하드코딩 | 실거래·실호출 전에는 이런 자리도 의심할 것 |
| 실제 28종목으로 cron 돌리자 전부 429 | Twelve Data 무료 플랜은 분당 8크레딧인데 심볼 1개=1크레딧. 여러 심볼을 한 URL에 묶어도 크레딧은 심볼 수만큼 그대로 듦 | 테스트할 땐 항상 소수 종목만 썼던 게 이 버그를 가렸다. 실제 규모(보유 종목 전체)로 반드시 한 번은 돌려볼 것. 8개씩 분당 나눠 보내도록 고침 |

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
npm test
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
