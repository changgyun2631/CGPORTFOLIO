/**
 * 세 가져오기 화면(`components/import/*-import.tsx`)이 공유하는 "적용 결과 →
 * 화면 상태" 전이 규칙. React 컴포넌트 밖으로 뽑아서 DOM 없이 순수 함수로
 * 테스트할 수 있게 했다(이 저장소에 React Testing Library 같은 UI 테스트
 * 기반이 없어서, WORK_ORDER B-0A-5가 권한 대로 로직을 순수 함수로 분리하는
 * 쪽을 택했다).
 *
 * 이전에는 성공 분기에서 `error`를 지우지 않아서, "실패(retryToken) → 재시도
 * 성공" 순서를 밟으면 이전 빨간 오류 문구와 새 초록 성공 문구가 동시에 보이는
 * 문제가 있었다.
 */

export type ApplyOutcome = { ok: true; message: string } | { ok: false; errors: string[]; retryToken?: string };

export type ApplyUiState<TPreview extends { token: string }> = {
  preview: TPreview | null;
  error: string | null;
  result: string | null;
};

/**
 * 적용 버튼을 누른 직후(요청을 보내기 전) 상태 — 이전 시도의 성공/실패 문구를
 * 지운다. 결과가 오기 전까지 미리보기 자체는 그대로 보여준다.
 */
export function applyStarted<TPreview extends { token: string }>(preview: TPreview): ApplyUiState<TPreview> {
  return { preview, error: null, result: null };
}

/** 서버 액션이 돌려준 결과를 화면 상태로 바꾼다. */
export function applyFinished<TPreview extends { token: string }>(
  preview: TPreview,
  outcome: ApplyOutcome,
): ApplyUiState<TPreview> {
  if (outcome.ok) {
    return { preview: null, error: null, result: outcome.message };
  }
  if (outcome.retryToken) {
    // 백업/쓰기 자체가 실패했을 뿐 데이터는 안 바뀌었다 — 재업로드 없이 같은
    // 내용으로 다시 시도할 수 있게 토큰만 새 것으로 바꿔 미리보기를 유지한다.
    return { preview: { ...preview, token: outcome.retryToken }, error: outcome.errors.join(" / "), result: null };
  }
  // 검증 실패·동시성 충돌 등 다시 시도해도 똑같이 실패할 문제 — 이미 소모된
  // 토큰을 붙들고 있지 않게 미리보기를 지워 다시 업로드하도록 안내한다.
  return { preview: null, error: outcome.errors.join(" / "), result: null };
}

/** 예기치 못한 예외(네트워크 등)로 서버 액션 자체가 끝까지 못 간 경우. */
export function applyThrew<TPreview extends { token: string }>(error: unknown): ApplyUiState<TPreview> {
  return { preview: null, error: (error as Error).message, result: null };
}
