"use client";
import { useState } from "react";

type Turn = {
  question: string;
  answer: string;
  route: string;
  vendor: string | null;
  entity: string | null;
  graphRows: Record<string, unknown>[];
  chunks: { text: string; submissionId: string; distance: number }[];
};

const EXAMPLES = [
  "Who knows Python?",
  "What were the payment terms in the contract?",
  "What else involves Acme?",
  "Which organisations appear across our documents?",
];

export default function ChatPage() {
  const [question, setQuestion] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function ask(q: string) {
    if (!q.trim() || busy) return;
    setBusy(true);
    setErr(null);
    setQuestion("");

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Request failed");
      setTurns((t) => [...t, { question: q, ...data }]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main>
      <header>
        <h2>Ask</h2>
        <p>
          Each question is routed to document search, the submission graph, the extracted
          entity graph, or a combination. What the answer was built from is shown
          underneath it, so you can see when routing picks badly.
        </p>
      </header>

      <div className="panel">
        {turns.length > 0 && (
          <div className="thread">
            {turns.map((t, i) => (
              <div className="turn" key={i}>
                <div className="q">{t.question}</div>
                <div className="routetag" data-r={t.route}>
                  Routed to <b>{t.route}</b>
                  {t.entity ? ` · entity: ${t.entity}` : ""}
                  {t.vendor ? ` · vendor: ${t.vendor}` : ""}
                </div>
                <div className="a">{t.answer}</div>

                {(t.graphRows.length > 0 || t.chunks.length > 0) && (
                  <div className="sources">
                    <h3>Built from</h3>
                    {t.graphRows.map((r, j) => (
                      <div className="src" data-kind="graph" key={`g${j}`}>
                        <span className="mono">neo4j</span> · {JSON.stringify(r)}
                      </div>
                    ))}
                    {t.chunks.map((c, j) => (
                      <div className="src" data-kind="vector" key={`c${j}`}>
                        <span className="mono">
                          pgvector · {c.submissionId} · d={c.distance}
                        </span>
                        <div>{c.text}…</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="ask">
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && ask(question)}
            placeholder={busy ? "Thinking…" : "Ask about a vendor or a document"}
            disabled={busy}
          />
          <button onClick={() => ask(question)} disabled={busy || !question.trim()}>
            Ask
          </button>
        </div>

        {err && <p className="note bad">{err}</p>}

        {turns.length === 0 && (
          <div className="hints">
            <div style={{ marginBottom: 8 }}>Try one of these:</div>
            {EXAMPLES.map((e) => (
              <button key={e} onClick={() => ask(e)} disabled={busy}>
                {e}
              </button>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
