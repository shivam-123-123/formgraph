const OLLAMA = process.env.OLLAMA_URL ?? "http://localhost:11434";
const MODEL = process.env.EMBED_MODEL ?? "nomic-embed-text";

/** One string -> one 768-dim vector. Ollama takes a single prompt per call. */
export async function embed(text: string): Promise<number[]> {
  const res = await fetch(`${OLLAMA}/api/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, prompt: text }),
  });
  if (!res.ok) {
    throw new Error(`Ollama embed failed (${res.status}). Is the model pulled?`);
  }
  const { embedding } = (await res.json()) as { embedding: number[] };
  return embedding;
}

/** Sequential on purpose — CPU-only box, no benefit from hammering it. */
export async function embedAll(texts: string[]): Promise<number[][]> {
  const out: number[][] = [];
  for (const t of texts) out.push(await embed(t));
  return out;
}

/** pgvector accepts the literal '[1,2,3]' form. */
export function toVectorLiteral(v: number[]): string {
  return `[${v.join(",")}]`;
}
