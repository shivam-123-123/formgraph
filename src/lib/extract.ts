import { complete } from "./llm";

export type ExtractedNode = {
  /** Dynamic label chosen by the LLM, e.g. "Skill", "Company", "Obligation". */
  type: string;
  /** Display name, as it appeared in the document. */
  name: string;
  /** Whatever else the LLM found worth recording. Flat only — Neo4j can't nest. */
  props?: Record<string, string | number | boolean>;
};

export type ExtractedRel = {
  from: string; // node name
  to: string; // node name
  type: string; // dynamic relationship type, e.g. "HAS_SKILL"
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
 *
 * That gap is the whole point. Real entity resolution needs embedding similarity
 * or an LLM adjudicating candidate pairs, and it is the expensive half of
 * building a graph you'd actually trust.
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

/**
 * Node labels are constrained; properties are not.
 *
 * Fully open labels drift — one document yields "Organization", the next
 * "Company", the next "Employer", and every query then matches a third of the
 * graph. Constraining the label list while leaving properties and relationship
 * types free is the compromise that keeps queries writable.
 */
const ALLOWED_TYPES = [
  "Person",
  "Organization",
  "Skill",
  "Role",
  "Technology",
  "Qualification",
  "Location",
  "Obligation",
  "Amount",
  "Date",
  "Project",
] as const;

const SYSTEM = `You extract a knowledge graph from a document.

Return ONLY a JSON object. No prose, no markdown fences.

{
  "nodes": [
    {"type": "<one of the allowed types>", "name": "<canonical name>",
     "props": {"<key>": "<flat string/number/bool>"}}
  ],
  "relationships": [
    {"from": "<node name>", "to": "<node name>", "type": "<UPPER_SNAKE_CASE>"}
  ]
}

Allowed node types (use ONLY these): ${ALLOWED_TYPES.join(", ")}

Relationship types are yours to choose. Use UPPER_SNAKE_CASE verbs that read
naturally from source to target: HAS_SKILL, WORKED_AT, HELD_ROLE, REQUIRES,
LOCATED_IN, REPORTS_TO, CERTIFIED_IN.

Rules:
- Every name in "relationships" MUST match a "name" in "nodes" exactly.
- Prefer the fullest form of a name over an abbreviation, and use that one form
  everywhere. If the document says both "Santa Cruz County Regional
  Transportation Commission" and "SCCRTC", emit one node with the full name.
- props must be flat. No nested objects, no arrays.
- Extract what the document states. Do not infer or embellish.
- Aim for 10-30 nodes. Skip incidental mentions.`;

/**
 * Sends a slice of the document, not the whole thing — extraction cost scales
 * with input, and the front of a resume or contract carries most of the
 * structure. A production version would extract per-chunk and merge, which
 * multiplies token spend by the chunk count.
 */
const MAX_CHARS = 14000;

export async function extractGraph(
  text: string,
  docType: string
): Promise<Extraction> {
  const slice = text.replace(/\s+/g, " ").slice(0, MAX_CHARS);

  const raw = await complete(SYSTEM, [
    {
      role: "user",
      content: `Document type: ${docType}\n\n---\n${slice}\n---`,
    },
  ]);

  let parsed: Extraction;
  try {
    const json = raw.replace(/```json|```/g, "").trim();
    parsed = JSON.parse(json) as Extraction;
  } catch {
    // Extraction failing shouldn't fail ingestion. The rest of the pipeline
    // (chunks, vectors, submission graph) is still useful without it.
    return { nodes: [], relationships: [] };
  }

  const nodes = (parsed.nodes ?? []).filter(
    (n) =>
      n?.name?.trim() &&
      n?.type &&
      (ALLOWED_TYPES as readonly string[]).includes(n.type)
  );

  const names = new Set(nodes.map((n) => n.name));
  const relationships = (parsed.relationships ?? []).filter(
    (r) => r?.from && r?.to && r?.type && names.has(r.from) && names.has(r.to)
  );

  return { nodes, relationships };
}
