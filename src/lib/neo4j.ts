import neo4j, { Driver } from "neo4j-driver";

const g = globalThis as unknown as { _neo?: Driver };

/**
 * Lazy on purpose. Creating the driver at module load makes `next build` fail
 * during page-data collection, because the env vars aren't set at build time.
 */
function getDriver(): Driver {
  if (!g._neo) {
    g._neo = neo4j.driver(
      process.env.NEO4J_URI!,
      neo4j.auth.basic(process.env.NEO4J_USER!, process.env.NEO4J_PASSWORD!)
    );
  }
  return g._neo;
}

/** Run Cypher and hand back plain objects. Always parameterize. */
export async function cypher<T = Record<string, unknown>>(
  query: string,
  params: Record<string, unknown> = {}
): Promise<T[]> {
  const session = getDriver().session();
  try {
    const res = await session.run(query, params);
    return res.records.map((r) => {
      const o: Record<string, unknown> = {};
      for (const key of r.keys) {
        const v = r.get(key);
        // Neo4j integers are {low, high} objects; flatten the common case.
        o[key as string] = neo4j.isInt(v) ? v.toNumber() : v;
      }
      return o as T;
    });
  } finally {
    await session.close();
  }
}

/** Idempotent. Safe to call on every boot. */
export async function ensureConstraints() {
  const stmts = [
    "CREATE CONSTRAINT sub_id IF NOT EXISTS FOR (s:Submission) REQUIRE s.id IS UNIQUE",
    "CREATE CONSTRAINT person_email IF NOT EXISTS FOR (p:Person) REQUIRE p.email IS UNIQUE",
    "CREATE CONSTRAINT vendor_name IF NOT EXISTS FOR (v:Vendor) REQUIRE v.name IS UNIQUE",
    "CREATE CONSTRAINT dept_name IF NOT EXISTS FOR (d:Department) REQUIRE d.name IS UNIQUE",
    "CREATE CONSTRAINT doc_id IF NOT EXISTS FOR (d:Document) REQUIRE d.id IS UNIQUE",
    // Extracted entities carry dynamic labels, so the merge key can't have a
    // per-label constraint. One index per label we expect to see often.
    "CREATE INDEX entity_key IF NOT EXISTS FOR (n:Person) ON (n.key)",
    "CREATE INDEX org_key IF NOT EXISTS FOR (n:Organization) ON (n.key)",
    "CREATE INDEX skill_key IF NOT EXISTS FOR (n:Skill) ON (n.key)",
    "CREATE INDEX role_key IF NOT EXISTS FOR (n:Role) ON (n.key)",
    "CREATE INDEX tech_key IF NOT EXISTS FOR (n:Technology) ON (n.key)",
  ];
  for (const s of stmts) await cypher(s);
}