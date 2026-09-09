import { sql } from "./db";
import { cypher, ensureConstraints } from "./neo4j";
import { chunkText } from "./chunk";
import { embedAll, toVectorLiteral } from "./embed";

export type SubmissionInput = {
  id: string;
  title: string;
  submitter: string;
  vendor: string;
  department: string;
  notes: string;
  filename: string | null;
  documentId: string | null;
  pdfBuffer: Buffer | null;
};

/**
 * Writes to all three stores. No distributed transaction exists here, so:
 * row lands first as 'pending', then vectors, then graph, then 'complete'.
 * Everything keys off the submission/document IDs, so a retry is idempotent.
 */
export async function ingest(input: SubmissionInput) {
  const { id, documentId, pdfBuffer } = input;

  // 1. Postgres: the record of truth.
  await sql`
    INSERT INTO submissions
      (id, title, submitter, vendor, department, notes, filename, document_id, status)
    VALUES
      (${id}, ${input.title}, ${input.submitter}, ${input.vendor},
       ${input.department}, ${input.notes}, ${input.filename},
       ${documentId}, 'pending')
    ON CONFLICT (id) DO NOTHING
  `;

  let chunkCount = 0;

  try {
    // 2. pgvector: the attachment's text, chunked and embedded.
    if (pdfBuffer && documentId) {
      // Required inside the function: pdf-parse touches the filesystem on import.
      const pdfParse = (await import("pdf-parse")).default;
      const { text } = await pdfParse(pdfBuffer);
      const pieces = chunkText(text);
      const vectors = await embedAll(pieces);

      await sql`DELETE FROM chunks WHERE document_id = ${documentId}`;
      for (let i = 0; i < pieces.length; i++) {
        await sql`
          INSERT INTO chunks (document_id, submission_id, chunk_index, chunk_text, embedding)
          VALUES (${documentId}, ${id}, ${i}, ${pieces[i]},
                  ${toVectorLiteral(vectors[i])}::vector)
        `;
      }
      chunkCount = pieces.length;
    }

    // 3. Neo4j: the relationships. Entities come from form fields, not the PDF —
    // clean, typed, no extraction risk. LLM extraction is the stretch goal.
    await ensureConstraints();
    await cypher(
      `
      MERGE (s:Submission {id: $id})
        SET s.title = $title, s.createdAt = datetime()
      MERGE (p:Person {email: $submitter})
      MERGE (s)-[:SUBMITTED_BY]->(p)
      MERGE (v:Vendor {name: $vendor})
      MERGE (s)-[:INVOLVES]->(v)
      MERGE (dep:Department {name: $department})
      MERGE (s)-[:FILED_UNDER]->(dep)
      WITH s
      FOREACH (_ IN CASE WHEN $documentId IS NULL THEN [] ELSE [1] END |
        MERGE (d:Document {id: $documentId})
          SET d.filename = $filename, d.chunkCount = $chunkCount
        MERGE (s)-[:HAS_ATTACHMENT]->(d)
      )
      `,
      {
        id,
        title: input.title,
        submitter: input.submitter,
        vendor: input.vendor,
        department: input.department,
        documentId,
        filename: input.filename,
        chunkCount,
      }
    );

    await sql`
      UPDATE submissions SET status = 'complete', chunk_count = ${chunkCount}, error = NULL
      WHERE id = ${id}
    `;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await sql`UPDATE submissions SET status = 'failed', error = ${msg} WHERE id = ${id}`;
    throw e;
  }

  return { chunkCount };
}
