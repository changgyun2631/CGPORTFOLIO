/** 가져오기 미리보기의 검증 결과를 보여준다. 금액은 안 들어가고 항목명·개수만 나온다. */
export function ValidationList({ errors }: { errors: string[] }) {
  if (errors.length === 0) {
    return <p className="text-xs font-medium text-up">검증 통과 — 참조 무결성·형식 이상 없음</p>;
  }
  return (
    <div className="rounded-lg border border-down/40 bg-down-soft px-3 py-2">
      <p className="text-xs font-semibold text-down">검증 실패 {errors.length}건 — 이대로는 적용할 수 없습니다</p>
      <ul className="mt-1 space-y-0.5 text-[11px] leading-4 text-down">
        {errors.map((error, index) => (
          <li key={index}>· {error}</li>
        ))}
      </ul>
    </div>
  );
}
