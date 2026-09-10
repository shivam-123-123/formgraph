# Formgraph

Form intake POC. One submission fans out into three stores:

| Store | Holds | Answers |
|---|---|---|
| Postgres | the submission row, status | "what was submitted" |
| pgvector | embedded chunks of the attachment | "what does the document say" |
| Neo4j | submissions, people, vendors, departments | "what else is connected to this" |

Everything is keyed on `submission_id` / `document_id`, which is the only bridge
between the stores.

## Run it

    cp .env.example .env      # add GROQ_API_KEY
    docker compose up -d
    docker compose exec ollama ollama pull nomic-embed-text

Then:

- app — http://localhost:3000
- Neo4j Browser — http://localhost:7474 (neo4j / neo4jpass)

The embedding model download is ~270MB and runs on CPU. First submission will be
slow while the model loads into memory; after that a chunk takes ~100ms.

## The demo

1. Submit a form naming vendor "Acme Logistics" with a PDF attached.
2. Submit a second form, different submitter, same vendor.
3. Neo4j Browser: `MATCH (n) RETURN n` — two submissions joined through one
   vendor node, which nothing in the code explicitly linked.
4. Ask page: "What else involves Acme Logistics?" — routes to the graph.
5. Ask page: a question about the PDF's contents — routes to pgvector.

## Wiring

    src/lib/chunk.ts      sliding-window splitter
    src/lib/embed.ts      Ollama → 768-dim vectors
    src/lib/ingest.ts     writes all three stores, pending → complete
    src/lib/retrieve.ts   vector search + Cypher queries
    src/lib/router.ts     classifies a question DOCUMENT / GRAPH / BOTH
    src/lib/llm.ts        Groq or Anthropic, one switch

## Known shortcuts

- No distributed transaction. Postgres row is written first as `pending`, then
  vectors, then graph, then flipped to `complete`. Retries are idempotent.
- Graph entities come from form fields, not from the PDF. LLM extraction from
  document text is the stretch goal — it's the part that eats hours.
- Graph queries are hardcoded Cypher, not generated. Text-to-Cypher is the other
  thing that eats hours.
- Vector index is commented out in `db/init.sql`; sequential scan is faster
  until you have thousands of chunks.

---

## Update: LLM-driven entity extraction

The graph now has two layers.

**Layer 1 — submission wrapper.** Fixed schema from form fields: Submission,
Person, Vendor, Department, Document. Reliable, no LLM involved.

**Layer 2 — document contents.** An LLM reads the attachment and decides what
nodes and relationships to create. Upload a resume and it produces Skill,
Company and Role nodes with `HAS_SKILL` / `WORKED_AT` edges — none of which are
defined anywhere in the code.

Dynamic labels require `apoc.merge.node`, because plain Cypher cannot
parameterize a label. APOC was already enabled in the compose file.

### Why labels are constrained but properties aren't

Fully open extraction drifts: one document yields `Organization`, the next
`Company`, the next `Employer`, and queries then match a third of the graph.
`src/lib/extract.ts` pins the label list and leaves properties and relationship
types free.

### Entity resolution — the actual hard part

Extraction is a library call. Making the result trustworthy is not.

Three resumes will produce `Python`, `python` and `Python 3` as separate Skill
nodes. Each carries a few edges. None connect. Ask "who knows Python" and you
get a third of the answer.

`entityKey()` normalizes case, whitespace and punctuation before merging. That
catches `Python` vs `python`. It does **not** catch `Python 3`, `Py`, or
`SCCRTC` vs `Santa Cruz RTC` — those need embedding similarity or an LLM
adjudicating candidate pairs.

This is worth demoing rather than hiding: run `MATCH (n:Skill) RETURN n.name`
after a few resumes and the fragmentation is visible. Published work argues that
without entity resolution, graph RAG degrades into ordinary vector search,
because unresolved entities leave the graph with no traversable edges.

### Migration

`db/init.sql` only runs on a fresh Postgres volume. With existing data:

    docker compose exec -T postgres psql -U fg -d formgraph \
      < db/migrate-001-extraction.sql

### Cost note

Extraction sends up to 14k characters per document to the LLM, on top of the
per-question calls. A production version extracts per-chunk and merges, which
multiplies spend by the chunk count. Purpose-built extraction models (e.g.
Triplex, a 3B finetune) are several times cheaper than a frontier model here.
