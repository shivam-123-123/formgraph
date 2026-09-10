import { complete } from "./llm";

export type ExtractedNode = {
  /** Label chosen by the LLM at runtime. Nothing is predefined. */
  type: string;
  /** Display name, as it appeared in the document. */
  name: string;
  /** Whatever else the LLM found worth recording. Flat only -- Neo4j can't nest. */
  props?: Record<string, string | number | boolean>;
};

export type ExtractedRel = {
  from: string; // node name
  to: string; // node name
  type: string; // relationship type, also chosen at runtime
};

export type Extraction = {
  nodes: ExtractedNode[];
  relationships: ExtractedRel[];
};

/**
 * Entity resolution, cheapest tier: normalize the string used as the merge key
 * while keeping the original for display.
 *
 * Catches: "Python" / "python" / " Python ".
 * Misses:  "Python 3", "Py", "SCCRTC" vs "Santa Cruz RTC".
 */
export function entityKey(type: string, name: string): string {
  const t = type.trim().toLowerCase();
  const n = name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[.,;:'"()]/g, "");
  return `${t}::${n}`;
}

/** Neo4j labels must be alphanumeric + underscore. Whatever the LLM picks. */
function safeLabel(raw: string): string {
  const cleaned = raw
    .trim()
    .replace(/[^A-Za-z0-9_]/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!cleaned) return "Entity";
  return /^[0-9]/.test(cleaned) ? `E_${cleaned}` : cleaned;
}

const SYSTEM = `You extract a knowledge graph from a document.

Return ONLY a JSON object. No prose, no markdown fences.

{
  "nodes": [
    {"type": "<node label you choose>", "name": "<canonical name>",
     "props": {"<key>": "<flat string/number/bool>"}}
  ],
  "relationships": [
    {"from": "<node name>", "to": "<node name>", "type": "<UPPER_SNAKE_CASE>"}
  ]
}

You decide the node labels and the relationship types. Nothing is predefined.
Read the document and choose whatever schema fits it. A resume might call for
Person, Skill, Employer, Degree. A contract might call for Party, Obligation,
Payment Term, Deadline. Pick what the document actually contains.

Rules:
- Node labels: PascalCase, singular, letters and digits only.
- Relationship types: UPPER_SNAKE_CASE verbs reading source to target.
- Every name in "relationships" MUST match a "name" in "nodes" exactly.
- Use ONE form of each name. If the document says both "Santa Cruz County
  Regional Transportation Commission" and "SCCRTC", emit one node with the
  fuller name.
- props must be flat. No nested objects, no arrays. Keep values under 10 words.
- Extract what the document states. Do not infer or embellish.
- Aim for 10-30 nodes. Skip incidental mentions.`;

/**
 * Sends a slice of the document, not the whole thing -- extraction cost scales
 * with input. A production version extracts per-chunk and merges, which
 * multiplies token spend by the chunk count.
 */
const MAX_CHARS = 14000;

export async function extractGraph(
  text: string,
  docType: string
): Promise<Extraction> {
  const slice = text.replace(/\s+/g, " ").slice(0, MAX_CHARS);
  let raw = "";

  try {
    raw = await complete(SYSTEM, [
      { role: "user", content: `Document type: ${docType}\n\n---\n${slice}\n---` },
    ]);
  } catch (e) {
    console.error("[extract] LLM call failed:", e);
    return { nodes: [], relationships: [] };
  }

  let parsed: Extraction;
  try {
    const json = raw.replace(/```json|```/g, "").trim();
    parsed = JSON.parse(json) as Extraction;
  } catch (e) {
    // Loud on purpose. A silent empty result is indistinguishable from a
    // document with nothing in it, which makes this impossible to debug.
    console.error("[extract] JSON parse failed:", e);
    console.error("[extract] raw response was:", raw.slice(0, 800));
    return { nodes: [], relationships: [] };
  }

  const nodes = (parsed.nodes ?? [])
    .filter((n) => n?.name?.trim() && n?.type?.trim())
    .map((n) => ({ ...n, type: safeLabel(n.type) }));

  const names = new Set(nodes.map((n) => n.name));
  const relationships = (parsed.relationships ?? []).filter(
    (r) => r?.from && r?.to && r?.type && names.has(r.from) && names.has(r.to)
  );

  console.log(
    `[extract] ${nodes.length} nodes, ${relationships.length} rels, labels:`,
    [...new Set(nodes.map((n) => n.type))].join(", ")
  );

  return { nodes, relationships };
}