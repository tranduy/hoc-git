export interface ScrollAnchor {
  readonly key: string;
  readonly offset: number;
}

function anchoredRows(container: HTMLElement): readonly HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>("[data-scroll-key]")];
}

export function captureScrollAnchor(container: HTMLElement): ScrollAnchor | null {
  if (container.scrollTop <= 1) return null;
  const viewportTop = container.getBoundingClientRect().top;
  const row = anchoredRows(container).find((candidate) => candidate.getBoundingClientRect().bottom > viewportTop);
  const key = row?.dataset.scrollKey;
  return row === undefined || key === undefined ? null :
    { key, offset: row.getBoundingClientRect().top - viewportTop };
}

export function restoreScrollAnchor(container: HTMLElement, anchor: ScrollAnchor | null): void {
  container.scrollLeft = 0;
  if (anchor === null) return;
  const row = anchoredRows(container).find((candidate) => candidate.dataset.scrollKey === anchor.key);
  if (row === undefined) return;
  const currentOffset = row.getBoundingClientRect().top - container.getBoundingClientRect().top;
  container.scrollTop += currentOffset - anchor.offset;
}
