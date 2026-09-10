"use client";
import { useEffect, useState } from "react";

type Row = {
  id: string;
  title: string;
  submitter: string;
  vendor: string;
  department: string;
  doc_type: string;
  status: string;
  chunk_count: number;
  entity_count: number;
  rel_count: number;
  error: string | null;
};

export default function FormPage() {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [rows, setRows] = useState<Row[]>([]);

  async function loadRows() {
    const res = await fetch("/api/submissions");
    if (res.ok) setRows(await res.json());
  }

  useEffect(() => {
    loadRows();
  }, []);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    setBusy(true);
    setNote(null);

    try {
      const res = await fetch("/api/submit", {
        method: "POST",
        body: new FormData(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Submission failed");
      setNote({
        ok: true,
        text:
          `Saved ${data.id}. ${data.chunkCount} chunks embedded, ` +
          `${data.entityCount} entities and ${data.relCount} relationships extracted.`,
      });
      form.reset();
      loadRows();
    } catch (err) {
      setNote({ ok: false, text: err instanceof Error ? err.message : "Failed" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <main>
      <header>
        <h2>New submission</h2>
        <p>
          Form fields become the submission wrapper in Neo4j. The attachment is chunked
          into pgvector, and its contents are read by an LLM which decides for itself
          what entities and relationships to create — no schema defined in advance.
        </p>
      </header>

      <form className="panel" onSubmit={onSubmit}>
        <div className="field">
          <label htmlFor="title">Title</label>
          <input id="title" name="title" required placeholder="Q3 renewal terms" />
        </div>

        <div className="row">
          <div className="field">
            <label htmlFor="submitter">Your email</label>
            <input id="submitter" name="submitter" type="email" required placeholder="you@company.com" />
          </div>
          <div className="field">
            <label htmlFor="vendor">Vendor</label>
            <input id="vendor" name="vendor" required placeholder="Acme Logistics" />
          </div>
        </div>

        <div className="field">
          <label htmlFor="department">Department</label>
          <select id="department" name="department" defaultValue="Procurement">
            <option>Procurement</option>
            <option>Legal</option>
            <option>Finance</option>
            <option>Engineering</option>
          </select>
        </div>

        <div className="field">
          <label htmlFor="docType">Document type</label>
          <select id="docType" name="docType" defaultValue="Contract">
            <option>Contract</option>
            <option>Resume</option>
            <option>Invoice</option>
            <option>Report</option>
            <option>Other</option>
          </select>
        </div>

        <div className="field">
          <label htmlFor="notes">Notes</label>
          <textarea id="notes" name="notes" placeholder="Anything worth recording" />
        </div>

        <div className="field">
          <label htmlFor="attachment">Attachment (PDF)</label>
          <input id="attachment" name="attachment" type="file" accept="application/pdf" />
        </div>

        <button type="submit" disabled={busy}>
          {busy ? "Ingesting…" : "Save submission"}
        </button>

        {note && <p className={`note ${note.ok ? "ok" : "bad"}`}>{note.text}</p>}
      </form>

      <header style={{ marginTop: 38 }}>
        <h2>Submitted</h2>
        <p>
          Submit two resumes that share a skill, then open the Neo4j Browser and run{" "}
          <code>MATCH (n) RETURN n</code>. The candidates join through one skill node that
          nothing in the code linked. Fragmented duplicates you see there are the entity
          resolution problem, not a bug.
        </p>
      </header>

      <div className="panel">
        {rows.length === 0 ? (
          <p style={{ margin: 0, color: "var(--muted)" }}>
            Nothing yet. Fill in the form above to populate all three stores.
          </p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Title</th>
                <th>Vendor</th>
                <th>Submitter</th>
                <th>Chunks</th>
                <th>Extracted</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    {r.title}
                    <div className="mono" style={{ fontSize: 11.5, color: "var(--muted)" }}>
                      {r.id}
                    </div>
                  </td>
                  <td>
                    {r.vendor}
                    <div style={{ fontSize: 11.5, color: "var(--muted)" }}>{r.doc_type}</div>
                  </td>
                  <td>{r.submitter}</td>
                  <td className="mono">{r.chunk_count}</td>
                  <td className="mono">
                    {r.entity_count}n / {r.rel_count}r
                  </td>
                  <td>
                    <span className="pill" data-s={r.status}>
                      {r.status}
                    </span>
                    {r.error && (
                      <div style={{ fontSize: 11.5, color: "var(--warn)", marginTop: 4 }}>
                        {r.error}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </main>
  );
}
