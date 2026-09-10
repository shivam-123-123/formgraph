import { complete } from "./llm";

export type Route = {
  route: "DOCUMENT" | "GRAPH" | "ENTITY" | "BOTH";
  vendor: string | null;
  entity: string | null;
};

const SYSTEM = `You classify questions about a submissions database.

Return ONLY a JSON object, no prose, no markdown fences:
{"route": "DOCUMENT" | "GRAPH" | "ENTITY" | "BOTH",
 "vendor": string | null,
 "entity": string | null}

DOCUMENT — answerable by reading the text inside uploaded attachments
           (what a clause says, a figure, a stated term)
GRAPH    — about the submission wrapper: which submissions involve a vendor,
           who submitted what, which department filed it
ENTITY   — about things found INSIDE documents and how they connect:
           who has a skill, which people worked at a company, what a
           document requires. Anything of the form "who/what has X".
BOTH     — needs the graph to find which records matter, then their text

vendor: the vendor/company named on the submission form, or null.
entity: the thing being asked about for ENTITY routes — a skill, technology,
        company, person or role, e.g. "Python", "Infosys". Null otherwise.`;

/**
 * One cheap call with a small output space, so it's reliable.
 * Falls back to a document search if parsing fails — never blocks the answer.
 *
 * Worth knowing: routing can misroute silently, and when it does, retrieval
 * fetches the wrong thing and the answer degrades with no error. The
 * alternative design is to fan out to every store on every question and let
 * the answering model sort it out — more tokens, no misroute failure mode.
 */
export async function routeQuestion(question: string): Promise<Route> {
  try {
    const raw = await complete(SYSTEM, [{ role: "user", content: question }]);
    const json = raw.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(json) as Route;
    if (!["DOCUMENT", "GRAPH", "ENTITY", "BOTH"].includes(parsed.route)) {
      throw new Error("bad route");
    }
    return {
      route: parsed.route,
      vendor: parsed.vendor ?? null,
      entity: parsed.entity ?? null,
    };
  } catch {
    return { route: "DOCUMENT", vendor: null, entity: null };
  }
}
