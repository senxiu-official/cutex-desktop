const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
export const graphemes = (text: string): string[] => Array.from(segmenter.segment(text), ({ segment }) => segment);
export const graphemeCount = (text: string): number => graphemes(text).length;
