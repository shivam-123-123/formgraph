/**
 * Fixed-width sliding window with overlap. The overlap means a sentence
 * straddling a boundary still appears intact in one of the two chunks.
 * A paragraph-aware splitter is better; this is enough to prove the pipeline.
 */
export function chunkText(text: string, size = 800, overlap = 100): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= size) return clean ? [clean] : [];

  const out: string[] = [];
  const step = size - overlap;
  for (let i = 0; i < clean.length; i += step) {
    const piece = clean.slice(i, i + size).trim();
    if (piece.length > 40) out.push(piece); // drop trailing scraps
  }
  return out;
}
