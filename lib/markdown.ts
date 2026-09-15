/**
 * 아주 작은 마크다운 렌더러.
 *
 * 리포트 본문은 내가 쓴 파일만 들어오므로 전체 문법을 지원할 필요가 없다.
 * 제목, 문단, 목록, 코드블록, 굵게, 인라인 코드까지만 다룬다.
 * 라이브러리를 하나 더 들이는 것보다 이 정도가 낫다.
 */

export type Block =
  | { type: "heading"; level: 1 | 2 | 3; text: string }
  | { type: "paragraph"; text: string }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "code"; text: string }
  | { type: "hr" };

export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];

  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let code: string[] | null = null;

  const flushParagraph = () => {
    if (paragraph.length > 0) {
      blocks.push({ type: "paragraph", text: paragraph.join(" ").trim() });
      paragraph = [];
    }
  };
  const flushList = () => {
    if (list && list.items.length > 0) blocks.push({ type: "list", ...list });
    list = null;
  };

  for (const raw of lines) {
    const line = raw.trimEnd();

    if (code !== null) {
      if (line.trim().startsWith("```")) {
        blocks.push({ type: "code", text: code.join("\n") });
        code = null;
      } else {
        code.push(raw);
      }
      continue;
    }

    if (line.trim().startsWith("```")) {
      flushParagraph();
      flushList();
      code = [];
      continue;
    }

    if (line.trim() === "") {
      flushParagraph();
      flushList();
      continue;
    }

    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      flushParagraph();
      flushList();
      blocks.push({ type: "heading", level: heading[1].length as 1 | 2 | 3, text: heading[2].trim() });
      continue;
    }

    if (/^(-{3,}|\*{3,})$/.test(line.trim())) {
      flushParagraph();
      flushList();
      blocks.push({ type: "hr" });
      continue;
    }

    const bullet = /^[-*]\s+(.*)$/.exec(line.trim());
    if (bullet) {
      flushParagraph();
      if (!list || list.ordered) {
        flushList();
        list = { ordered: false, items: [] };
      }
      list.items.push(bullet[1].trim());
      continue;
    }

    const numbered = /^\d+\.\s+(.*)$/.exec(line.trim());
    if (numbered) {
      flushParagraph();
      if (!list || !list.ordered) {
        flushList();
        list = { ordered: true, items: [] };
      }
      list.items.push(numbered[1].trim());
      continue;
    }

    flushList();
    paragraph.push(line.trim());
  }

  if (code !== null) blocks.push({ type: "code", text: code.join("\n") });
  flushParagraph();
  flushList();

  return blocks;
}

/** 인라인 서식을 조각으로 쪼갠다. HTML 문자열을 만들지 않으므로 주입 위험이 없다. */
export type Inline = { kind: "text" | "bold" | "code"; text: string };

export function parseInline(text: string): Inline[] {
  const parts: Inline[] = [];
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let lastIndex = 0;

  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > lastIndex) parts.push({ kind: "text", text: text.slice(lastIndex, index) });
    const token = match[0];
    if (token.startsWith("**")) parts.push({ kind: "bold", text: token.slice(2, -2) });
    else parts.push({ kind: "code", text: token.slice(1, -1) });
    lastIndex = index + token.length;
  }

  if (lastIndex < text.length) parts.push({ kind: "text", text: text.slice(lastIndex) });
  return parts;
}
