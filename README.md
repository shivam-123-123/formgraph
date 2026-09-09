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
