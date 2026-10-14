export type AssessmentTextBlock =
  | { kind: "paragraph"; text: string; label?: string }
  | { kind: "list"; ordered: boolean; items: string[] };

const SECTION_LABELS = "Подтверждено цифрами|Подтверждено|Сильные стороны|Риски и пробелы|Существенные пробелы|Оговорки|Ограничения|Риски|Риск|Допуск к КЕ|На встрече обязательно проверить|На встрече проверить|Вопросы для проверки|Что проверить|Рекомендация|Обоснование|Вывод";
const TRANSITIONS = "При этом|Однако|Дополнительно|Поэтому|При успешной проверке";

// Boundaries inside quotes/brackets belong to the original statement, not UI sections.
function outsidePositions(text: string) {
  const result = new Set<number>();
  let quote = "";
  let brackets = 0;
  for (let index = 0; index <= text.length; index += 1) {
    if (!quote && brackets === 0) result.add(index);
    const character = text[index];
    if (quote) {
      if (character === quote && text[index - 1] !== "\\") quote = "";
    } else if (character === "«") quote = "»";
    else if (character === "“") quote = "”";
    else if (character === '"') quote = '"';
    else if (character === "(" || character === "[") brackets += 1;
    else if ((character === ")" || character === "]") && brackets > 0) brackets -= 1;
  }
  return result;
}

function sections(text: string) {
  const outside = outsidePositions(text);
  const boundary = new RegExp(`([.!?]\\s+)((?:${SECTION_LABELS}):)`, "gu");
  // Cyrillic has no JavaScript \b word boundary: require whitespace after a connective.
  const connective = new RegExp(`([.!?]\\s+)((?:${TRANSITIONS})(?=\\s))`, "gu");
  const starts = new Set<number>([0]);
  for (const pattern of [boundary, connective]) {
    for (const match of text.matchAll(pattern)) {
      const position = match.index! + match[1].length;
      if (outside.has(position)) starts.add(position);
    }
  }
  const indexes = [...starts].sort((left, right) => left - right);
  return indexes.map((start, index) => text.slice(start, indexes[index + 1]).trim()).filter(Boolean);
}

function paragraph(text: string): AssessmentTextBlock {
  const label = text.match(new RegExp(`^(?:${SECTION_LABELS}):`, "u"))?.[0];
  return { kind: "paragraph", text, ...(label ? { label } : {}) };
}

function inlineList(text: string): AssessmentTextBlock[] | undefined {
  const matches = [...text.matchAll(/(?:^|\s)([1-9]\d{0,2})[.)]\s+/gu)];
  if (matches.length < 2 || matches[0][1] !== "1") return undefined;
  const outside = outsidePositions(text);
  const positions = matches.map((match) => match.index! + match[0].search(/\d/u));
  if (!matches.every((match, index) => Number(match[1]) === index + 1 && outside.has(positions[index]))) return undefined;
  const prefix = text.slice(0, positions[0]).trim();
  if (prefix && !prefix.endsWith(":")) return undefined;
  return [
    ...(prefix ? [paragraph(prefix)] : []),
    { kind: "list", ordered: true, items: positions.map((start, index) => text.slice(start, positions[index + 1]).trim()) },
  ];
}

function lineBlocks(text: string): AssessmentTextBlock[] {
  const inline = inlineList(text.trim());
  if (inline) return inline;
  const lines = text.split("\n");
  const blocks: AssessmentTextBlock[] = [];
  const outside = outsidePositions(text);
  let offset = 0;
  let prose: string[] = [];
  let list: { kind: "list"; ordered: boolean; items: string[]; next?: number } | undefined;
  const flushProse = () => {
    if (prose.length) {
      const value = prose.join("\n").trim();
      blocks.push(...(inlineList(value) ?? [paragraph(value)]));
      prose = [];
    }
  };
  const flushList = () => {
    if (list) {
      blocks.push({ kind: "list", ordered: list.ordered, items: list.items });
      list = undefined;
    }
  };
  for (const line of lines) {
    const value = line.trim();
    const marker = value.match(/^(?:([1-9]\d{0,2})[.)]|([-*•]))\s+/u);
    const markerPosition = offset + line.search(/\S/u);
    if (marker && outside.has(markerPosition)) {
      flushProse();
      const ordered = Boolean(marker[1]);
      const number = ordered ? Number(marker[1]) : undefined;
      if (list && (list.ordered !== ordered || (ordered && number !== list.next))) flushList();
      list ??= { kind: "list", ordered, items: [] };
      list.items.push(value); // Keep the literal source marker, including punctuation.
      list.next = number === undefined ? undefined : number + 1;
    } else {
      flushList();
      if (value) prose.push(line);
    }
    offset += line.length + 1;
  }
  flushProse();
  flushList();
  return blocks;
}

export function assessmentTextBlocks(value: string): AssessmentTextBlock[] {
  const normalized = value.replace(/\r\n?/gu, "\n").trim();
  if (!normalized) return [];
  const blocks = normalized.split(/\n[\t ]*\n+/u).flatMap((part) => sections(part).flatMap(lineBlocks));
  const source = normalized.replace(/\s/gu, "");
  const rendered = blocks.map((block) => block.kind === "list" ? block.items.join("") : block.text).join("").replace(/\s/gu, "");
  // This is presentation only: any unexpected segmentation falls back to the intact text.
  return source === rendered ? blocks : [{ kind: "paragraph", text: normalized }];
}

export function AssessmentText({ text, className = "" }: { text?: string; className?: string }) {
  if (!text?.trim()) return null;
  return <div className={`assessment-prose ${className}`.trim()}>
    {assessmentTextBlocks(text).map((block, index) => {
      if (block.kind === "list") {
        const items = block.items.map((item, itemIndex) => <li key={itemIndex}>{item}</li>);
        return block.ordered
          ? <ol className="assessment-text-list literal-markers" key={index}>{items}</ol>
          : <ul className="assessment-text-list literal-markers" key={index}>{items}</ul>;
      }
      return <p key={index}>{block.label ? <><strong>{block.label}</strong>{block.text.slice(block.label.length)}</> : block.text}</p>;
    })}
  </div>;
}
