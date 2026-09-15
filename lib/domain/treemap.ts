/**
 * Squarified treemap 배치.
 *
 * 값에 비례한 면적을 주되 각 칸이 가능한 한 정사각형에 가깝게 나오도록
 * 줄 단위로 채워 나간다. 길쭉한 칸이 생기면 글자를 넣을 수 없기 때문에
 * 단순 슬라이스 방식 대신 이 방법을 쓴다.
 */

export type TreemapInput = { key: string; value: number };
export type TreemapTile = { key: string; x: number; y: number; width: number; height: number };

type Rect = { x: number; y: number; width: number; height: number };

/** 한 줄에 담긴 칸들의 가로세로비 중 가장 나쁜 값. 작을수록 정사각형에 가깝다. */
function worstRatio(row: number[], length: number, scale: number): number {
  if (row.length === 0 || length === 0) return Number.POSITIVE_INFINITY;
  const areas = row.map((v) => v * scale);
  const sum = areas.reduce((a, b) => a + b, 0);
  if (sum === 0) return Number.POSITIVE_INFINITY;
  const max = Math.max(...areas);
  const min = Math.min(...areas);
  const lengthSquared = length * length;
  const sumSquared = sum * sum;
  return Math.max((lengthSquared * max) / sumSquared, sumSquared / (lengthSquared * min));
}

export function squarify(items: TreemapInput[], width: number, height: number): TreemapTile[] {
  const positive = items.filter((item) => item.value > 0).sort((a, b) => b.value - a.value);
  if (positive.length === 0 || width <= 0 || height <= 0) return [];

  const total = positive.reduce((sum, item) => sum + item.value, 0);
  const scale = (width * height) / total;

  const tiles: TreemapTile[] = [];
  let rect: Rect = { x: 0, y: 0, width, height };
  let index = 0;

  while (index < positive.length) {
    const shortSide = Math.min(rect.width, rect.height);
    const row: TreemapInput[] = [];
    let rowValues: number[] = [];

    // 이 줄에 하나 더 넣었을 때 모양이 나빠지기 직전까지 채운다.
    while (index < positive.length) {
      const candidate = [...rowValues, positive[index].value];
      const currentWorst = worstRatio(rowValues, shortSide, scale);
      const candidateWorst = worstRatio(candidate, shortSide, scale);
      if (rowValues.length > 0 && candidateWorst > currentWorst) break;
      row.push(positive[index]);
      rowValues = candidate;
      index += 1;
    }

    const rowArea = rowValues.reduce((sum, v) => sum + v, 0) * scale;
    const thickness = shortSide > 0 ? rowArea / shortSide : 0;
    const horizontal = rect.width >= rect.height;

    let offset = 0;
    for (const item of row) {
      const area = item.value * scale;
      const extent = thickness > 0 ? area / thickness : 0;
      tiles.push(
        horizontal
          ? { key: item.key, x: rect.x, y: rect.y + offset, width: thickness, height: extent }
          : { key: item.key, x: rect.x + offset, y: rect.y, width: extent, height: thickness },
      );
      offset += extent;
    }

    rect = horizontal
      ? { x: rect.x + thickness, y: rect.y, width: Math.max(rect.width - thickness, 0), height: rect.height }
      : { x: rect.x, y: rect.y + thickness, width: rect.width, height: Math.max(rect.height - thickness, 0) };

    if (rect.width <= 0.01 || rect.height <= 0.01) break;
  }

  return tiles;
}
