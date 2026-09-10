import { NextResponse } from "next/server";
import { routeQuestion } from "@/lib/router";
import {
  searchChunks,
  searchChunksInDocs,
  vendorNeighbourhood,
  entityNeighbourhood,
} from "@/lib/retrieve";
import { complete } from "@/lib/llm";

export const runtime = "nodejs";

const ANSWER_SYSTEM = `You answer questions about a submissions database using only
the context provided. If the context doesn't contain the answer, say so plainly.
Be brief. Don't mention "context" or "chunks" — just answer.

When the context lists graph relationships, name the specific people, skills or
organisations involved rather than describing the structure abstractly.`;

export async function POST(req: Request) {
  try {
    const { question } = (await req.json()) as { question: string };
    if (!question?.trim()) {
      return NextResponse.json({ error: "Ask something first." }, { status: 400 });
    }

    const decision = await routeQuestion(question);
    let graphRows: Record<string, unknown>[] = [];
    let chunks: { chunk_text: string; submission_id: string; distance: number }[] = [];

    if (decision.route === "GRAPH" || decision.route === "BOTH") {
      graphRows = await vendorNeighbourhood(decision.vendor ?? "");
    }

    if (decision.route === "ENTITY") {
      // Extracted entities live under dynamic labels, so this walks outward
      // from whatever the LLM named rather than a fixed relationship path.
      graphRows = await entityNeighbourhood(decision.entity ?? decision.vendor ?? "");
    }

    if (decision.route === "DOCUMENT") {
      chunks = await searchChunks(question);
    } else if (decision.route === "BOTH") {
      // The graph narrows the search space before the vector search runs.
      const docIds = graphRows
        .map((r) => r.documentId as string | null)
        .filter((d): d is string => Boolean(d));
      chunks = docIds.length
        ? await searchChunksInDocs(question, docIds)
        : await searchChunks(question);
    }

    // An ENTITY question that matched nothing in the graph is usually a
    // fragmentation miss ("Python 3" stored, "Python" asked). Fall back to
    // vector search so the user still gets an answer.
    if (decision.route === "ENTITY" && graphRows.length === 0) {
      chunks = await searchChunks(question);
    }

    const parts: string[] = [];
    if (graphRows.length) {
      parts.push(`Related records from the graph:\n${JSON.stringify(graphRows, null, 2)}`);
    }
    if (chunks.length) {
      parts.push(
        `Excerpts from attachments:\n${chunks
          .map((c, i) => `[${i + 1}] ${c.chunk_text}`)
          .join("\n\n")}`
      );
    }
    if (!parts.length) parts.push("No matching records or documents were found.");

    const answer = await complete(ANSWER_SYSTEM, [
      { role: "user", content: `${parts.join("\n\n")}\n\nQuestion: ${question}` },
    ]);

    return NextResponse.json({
      answer,
      route: decision.route,
      vendor: decision.vendor,
      entity: decision.entity,
      graphRows,
      chunks: chunks.map((c) => ({
        text: c.chunk_text.slice(0, 220),
        submissionId: c.submission_id,
        distance: Number(c.distance.toFixed(4)),
      })),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Chat failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
