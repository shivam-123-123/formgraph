import { sql } from "./db";
import { cypher, ensureConstraints } from "./neo4j";
import { chunkText } from "./chunk";
import { embedAll, toVectorLiteral } from "./embed";
import { extractGraph, entityKey } from "./extract";

export type SubmissionInput = {
  id: string;
  title: string;
  submitter: string;
  vendor: string;
  department: string;
  docType: string;
  notes: string;
  filename: string | null;
  documentId: string | null;
  pdfBuffer: Buffer | null;
};

/**
 * Writes to all three stores. No distributed transaction exists here, so:
 * row lands first as 'pending', then vectors, then graph, then 'complete'.
 * Everything keys off the submission/document IDs, so a retry is idempotent.
 *
 * Two graph layers get written:
 *   1. The submission wrapper -- who submitted what, when. Fixed schema, from
 *      form fields. Reliable.
 *   2. The document's contents -- entities and relationships the LLM found by
 *      reading the text. Schema decided per document. Flexible, fallible.
 */
export async function ingest(input: SubmissionInput) {
  const { id, documentId, pdfBuffer } = input;

  // 1. Postgres: the record of truth.
  await sql`
    INSERT INTO submissions
      (id, title, submitter, vendor, department, doc_type, notes,
       filename, document_id, status)
    VALUES
      (${id}, ${input.title}, ${input.submitter}, ${input.vendor},
       ${input.department}, ${input.docType}, ${input.notes},
       ${input.filename}, ${documentId}, 'pending')
    ON CONFLICT (id) DO NOTHING
  `;

  let chunkCount = 0;
  let entityCount = 0;
  let relCount = 0;
  let docText = "";

  try {
    await ensureConstraints();

    // 2. pgvector: the attachment's text, chunked and embedded.
    if (pdfBuffer && documentId) {
      // Required inside the function: pdf-parse touches the filesystem on import.
      const pdfParse = (await import("pdf-parse")).default;
      const parsed = await pdfParse(pdfBuffer);
      docText = parsed.text ?? "";

      const pieces = chunkText(docText);
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

    // 3. Neo4j, layer one: the submission wrapper. Fixed schema, form fields.
    await cypher(
      `
      MERGE (s:Submission {id: $id})
        SET s.title = $title, s.docType = $docType, s.createdAt = datetime()
      MERGE (p:Person {email: $submitter})
      MERGE (s)-[:SUBMITTED_BY]->(p)
      MERGE (v:Vendor {name: $vendor})
      MERGE (s)-[:INVOLVES]->(v)
      MERGE (dep:Department {name: $department})
      MERGE (s)-[:FILED_UNDER]->(dep)
      WITH s
      FOREACH (_ IN CASE WHEN $documentId IS NULL THEN [] ELSE [1] END |
        MERGE (d:Document {id: $documentId})
          SET d.filename = $filename, d.chunkCount = $chunkCount,
              d.docType = $docType
        MERGE (s)-[:HAS_ATTACHMENT]->(d)
      )
      `,
      {
        id,
        title: input.title,
        submitter: input.submitter,
        vendor: input.vendor,
        department: input.department,
        docType: input.docType,
        documentId,
        filename: input.filename,
        chunkCount,
      }
    );

    // 4. Neo4j, layer two: entities extracted from the document text.
    if (docText.trim() && documentId) {
      const { nodes, relationships } = await extractGraph(docText, input.docType);

      if (nodes.length) {
        const payload = nodes.map((n) => ({
          type: n.type,
          key: entityKey(n.type, n.name),
          props: { name: n.name.trim(), ...(n.props ?? {}) },
        }));

        // apoc.merge.node lets the LABEL be a runtime value. Plain Cypher can't
        // parameterize labels, so without APOC the "don't hardcode the schema"
        // requirement isn't satisfiable at all.
        await cypher(
          `
          MATCH (d:Document {id: $documentId})
          UNWIND $nodes AS n
          CALL apoc.merge.node([n.type], {key: n.key}, n.props, n.props)
            YIELD node
          MERGE (d)-[:MENTIONS]->(node)
          `,
          { documentId, nodes: payload }
        );
        entityCount = payload.length;
      }

      if (relationships.length) {
        const keyed = relationships.map((r) => {
          const from = nodes.find((n) => n.name === r.from)!;
          const to = nodes.find((n) => n.name === r.to)!;
          return {
            fromKey: entityKey(from.type, from.name),
            toKey: entityKey(to.type, to.name),
            type: r.type.toUpperCase().replace(/[^A-Z0-9_]/g, "_"),
          };
        });

        await cypher(
          `
          UNWIND $rels AS r
          MATCH (a {key: r.fromKey})
          MATCH (b {key: r.toKey})
          CALL apoc.merge.relationship(a, r.type, {}, {}, b, {}) YIELD rel
          RETURN count(rel) AS c
          `,
          { rels: keyed }
        );
        relCount = keyed.length;
      }
    }

    await sql`
      UPDATE submissions
      SET status = 'complete', chunk_count = ${chunkCount},
          entity_count = ${entityCount}, rel_count = ${relCount}, error = NULL
      WHERE id = ${id}
    `;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await sql`UPDATE submissions SET status = 'failed', error = ${msg} WHERE id = ${id}`;
    throw e;
  }

  return { chunkCount, entityCount, relCount };
}
