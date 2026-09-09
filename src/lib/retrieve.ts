import { sql } from "./db";
import { cypher } from "./neo4j";
import { embed, toVectorLiteral } from "./embed";

export type Chunk = { chunk_text: string; submission_id: string; distance: number };
export type GraphRow = Record<string, unknown>;

/** Nearest neighbours across all documents. `<=>` is cosine distance. */
export async function searchChunks(question: string, limit = 5): Promise<Chunk[]> {
  const v = toVectorLiteral(await embed(question));
  return sql<Chunk[]>`
    SELECT chunk_text, submission_id, embedding <=> ${v}::vector AS distance
    FROM chunks
    ORDER BY embedding <=> ${v}::vector
    LIMIT ${limit}
  `;
}

/** Same, but restricted to documents the graph already picked out. */
export async function searchChunksInDocs(
  question: string,
  documentIds: string[],
  limit = 5
): Promise<Chunk[]> {
  if (documentIds.length === 0) return [];
  const v = toVectorLiteral(await embed(question));
  return sql<Chunk[]>`
    SELECT chunk_text, submission_id, embedding <=> ${v}::vector AS distance
    FROM chunks
    WHERE document_id = ANY(${documentIds})
    ORDER BY embedding <=> ${v}::vector
    LIMIT ${limit}
  `;
}

/**
 * The query Postgres can't do as naturally: everything reachable from a vendor.
 * Two hops out, and it also hands back the document IDs so the vector search
 * can be narrowed to just those files.
 */
export async function vendorNeighbourhood(vendor: string) {
  return cypher<{
    submissionId: string;
    title: string;
    submitter: string;
    department: string;
    documentId: string | null;
  }>(
    `
    MATCH (v:Vendor)
    WHERE toLower(v.name) CONTAINS toLower($vendor)
    MATCH (v)<-[:INVOLVES]-(s:Submission)-[:SUBMITTED_BY]->(p:Person)
    OPTIONAL MATCH (s)-[:FILED_UNDER]->(dep:Department)
    OPTIONAL MATCH (s)-[:HAS_ATTACHMENT]->(d:Document)
    RETURN s.id AS submissionId, s.title AS title, p.email AS submitter,
           dep.name AS department, d.id AS documentId
    ORDER BY s.title
    `,
    { vendor }
  );
}

/** Who else has touched the same vendors as this person. Three hops. */
export async function relatedPeople(email: string) {
  return cypher(
    `
    MATCH (me:Person {email: $email})<-[:SUBMITTED_BY]-(:Submission)
          -[:INVOLVES]->(v:Vendor)<-[:INVOLVES]-(:Submission)
          -[:SUBMITTED_BY]->(other:Person)
    WHERE other <> me
    RETURN other.email AS person, collect(DISTINCT v.name) AS sharedVendors
    `,
    { email }
  );
}
