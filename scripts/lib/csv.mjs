/**
 * 증권사 CSV 파싱 공용 헬퍼. 세 가져오기 스크립트(`import-position-basis-csv.mjs`,
 * `import-account-history-csv.mjs`, `normalize-ledger.mjs`가 읽는 원장)와
 * 웹 가져오기 화면(`lib/import/*.ts`)이 같이 쓴다 — 순수 문자열 변환이라
 * 파일 IO나 Node 전용 API에 기대지 않는다(브라우저에서 업로드된 바이트를
 * 서버 액션이 그대로 넘겨도 동작해야 하므로).
 */

/**
 * 증권사 CSV 바이트를 문자열로 만든다. 인코딩은 파일마다 다르다 —
 * 증권사 프로그램이 바로 내려준 파일은 EUC-KR이지만, 사용자가 엑셀에서
 * "CSV UTF-8"로 다시 저장하면 UTF-8(보통 BOM 포함)이 된다. 둘 다 받아야 한다.
 *
 * EUC-KR로 고정해 두면 UTF-8 파일이 깨진 글자로 디코딩되고, 헤더를 못 읽어
 * "판별 불가"로 조용히 밀려난다 — 사용자 입장에서는 원인을 알 수 없는 실패다.
 *
 * 판별은 UTF-8을 엄격 모드로 시도해 보는 방식이다. 한글이 든 EUC-KR 바이트열은
 * 유효한 UTF-8이 아니라서 거의 항상 예외가 난다.
 */
export function decodeBrokerCsv(bytes) {
  const view = ArrayBuffer.isView(bytes) ? bytes : new Uint8Array(bytes);
  // BOM이 있으면 UTF-8로 확정. TextDecoder가 BOM 자체는 알아서 떼어낸다.
  const hasBom = view[0] === 0xef && view[1] === 0xbb && view[2] === 0xbf;
  if (hasBom) return new TextDecoder("utf-8").decode(view);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(view);
  } catch {
    return new TextDecoder("euc-kr").decode(view);
  }
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
