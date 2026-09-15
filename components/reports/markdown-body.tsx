import { Fragment } from "react";

import { parseInline, parseMarkdown } from "@/lib/markdown";

/** 리포트 본문 렌더러. 파서가 만든 조각을 React 노드로만 바꾼다. */
export function MarkdownBody({ source }: { source: string }) {
  const blocks = parseMarkdown(source);

  return (
    <div className="space-y-4">
      {blocks.map((block, index) => {
        switch (block.type) {
          case "heading": {
            if (block.level === 1) {
              // 제목은 페이지 상단에서 이미 보여주므로 본문에서는 건너뛴다.
              return null;
            }
            const className =
              block.level === 2
                ? "mt-8 border-t border-line pt-6 text-[17px] font-bold tracking-tight first:mt-0 first:border-0 first:pt-0"
                : "mt-5 text-[14px] font-semibold text-muted";
            return (
              <h2 key={index} className={className}>
                <Inlines text={block.text} />
              </h2>
            );
          }
          case "paragraph":
            return (
              <p key={index} className="text-[14px] leading-7 text-muted">
                <Inlines text={block.text} />
              </p>
            );
          case "list": {
            const ListTag = block.ordered ? "ol" : "ul";
            return (
              <ListTag
                key={index}
                className={`space-y-1.5 pl-5 text-[14px] leading-7 text-muted ${block.ordered ? "list-decimal" : "list-disc"}`}
              >
                {block.items.map((item, itemIndex) => (
                  <li key={itemIndex} className="pl-1">
                    <Inlines text={item} />
                  </li>
                ))}
              </ListTag>
            );
          }
          case "code":
            return (
              <pre
                key={index}
                className="overflow-x-auto rounded-xl border border-line bg-bg-elevated px-4 py-3 text-[12.5px] leading-6 text-text"
              >
                <code>{block.text}</code>
              </pre>
            );
          case "hr":
            return <hr key={index} className="border-line" />;
        }
      })}
    </div>
  );
}

function Inlines({ text }: { text: string }) {
  return (
    <>
      {parseInline(text).map((part, index) => {
        if (part.kind === "bold")
          return (
            <strong key={index} className="font-semibold text-text">
              {part.text}
            </strong>
          );
        if (part.kind === "code")
          return (
            <code key={index} className="rounded border border-line bg-bg-elevated px-1 py-0.5 text-[12.5px] text-text">
              {part.text}
            </code>
          );
        return <Fragment key={index}>{part.text}</Fragment>;
      })}
    </>
  );
}
