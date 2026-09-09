import { complete } from "./llm";

export type Route = {
  route: "DOCUMENT" | "GRAPH" | "BOTH";
  vendor: string | null;
};

const SYSTEM = `You classify questions about a submissions database.

Return ONLY a JSON object, no prose, no markdown fences:
{"route": "DOCUMENT" | "GRAPH" | "BOTH", "vendor": string | null}

DOCUMENT — answerable by reading the text inside uploaded attachments
           (terms, clauses, figures, what a document says)
GRAPH    — answerable from relationships between submissions, people,
           vendors and departments (who else, what else, connections, counts)
BOTH     — needs the graph to find which records matter, then their text

vendor: the company name mentioned in the question, or null if none.`;

/**
 * One cheap call with a three-token output space, so it's reliable.
 * Falls back to a document search if parsing fails — never blocks the answer.
 */
export async function routeQuestion(question: string): Promise<Route> {
  try {
    const raw = await complete(SYSTEM, [{ role: "user", content: question }]);
    const json = raw.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(json) as Route;
    if (!["DOCUMENT", "GRAPH", "BOTH"].includes(parsed.route)) throw new Error("bad route");
    return { route: parsed.route, vendor: parsed.vendor ?? null };
  } catch {
    return { route: "DOCUMENT", vendor: null };
  }
}
