/**
 * 증권사 CSV 파싱 공용 헬퍼. 세 가져오기 스크립트(`import-position-basis-csv.mjs`,
 * `import-account-history-csv.mjs`, `normalize-ledger.mjs`가 읽는 원장)와
 * 웹 가져오기 화면(`lib/import/*.ts`)이 같이 쓴다 — 순수 문자열 변환이라
 * 파일 IO나 Node 전용 API에 기대지 않는다(브라우저에서 업로드된 바이트를
 * 서버 액션이 그대로 넘겨도 동작해야 하므로).
 */

/** EUC-KR로 인코딩된 바이트를 문자열로 디코딩한다. 증권사 CSV는 보통 이 인코딩이다. */
export function decodeEucKr(bytes) {
  return new TextDecoder("euc-kr").decode(bytes);
}

export function parseCsvLine(line) {
  const fields = [];
  let value = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (quoted && char === '"' && line[i + 1] === '"') {
      value += '"';
      i += 1;
    } else if (char === '"') quoted = !quoted;
    else if (char === "," && !quoted) {
      fields.push(value);
      value = "";
    } else value += char;
  }
  fields.push(value);
  return fields;
}

/** 디코딩된 CSV 전체 텍스트를 줄 단위 필드 배열로 쪼갠다. */
export function parseCsvRows(decodedText) {
  return decodedText.split(/\r?\n/).filter(Boolean).map(parseCsvLine);
}

/** "1,234", "12%", " 500 " 같은 표기를 숫자로 만든다. 빈 값은 0. */
export function parseNumber(value) {
  return Number(String(value ?? "0").replaceAll(",", "").replace("%", "").trim() || 0);
}
