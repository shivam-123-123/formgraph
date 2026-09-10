import neo4j, { Driver } from "neo4j-driver";

const g = globalThis as unknown as { _neo?: Driver };

export const driver: Driver =
  g._neo ??
  neo4j.driver(
    process.env.NEO4J_URI!,
    neo4j.auth.basic(process.env.NEO4J_USER!, process.env.NEO4J_PASSWORD!)
  );
if (process.env.NODE_ENV !== "production") g._neo = driver;

/** Run Cypher and hand back plain objects. Always parameterize. */
export async function cypher<T = Record<string, unknown>>(
  query: string,
  params: Record<string, unknown> = {}
): Promise<T[]> {
  const session = driver.session();
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
  ];
  for (const s of stmts) await cypher(s);
}