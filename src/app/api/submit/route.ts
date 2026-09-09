import { NextResponse } from "next/server";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { nanoid } from "nanoid";
import { ingest } from "@/lib/ingest";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get("attachment") as File | null;

    const id = `sub_${nanoid(10)}`;
    let documentId: string | null = null;
    let filename: string | null = null;
    let buffer: Buffer | null = null;

    if (file && file.size > 0) {
      documentId = `doc_${nanoid(10)}`;
      filename = file.name;
      buffer = Buffer.from(await file.arrayBuffer());
      const dir = path.join(process.cwd(), "uploads");
      await writeFile(path.join(dir, `${documentId}.pdf`), buffer);
    }

    const { chunkCount } = await ingest({
      id,
      title: String(form.get("title") ?? "").trim(),
      submitter: String(form.get("submitter") ?? "").trim().toLowerCase(),
      vendor: String(form.get("vendor") ?? "").trim(),
      department: String(form.get("department") ?? "").trim(),
      notes: String(form.get("notes") ?? "").trim(),
      filename,
      documentId,
      pdfBuffer: buffer,
    });

    return NextResponse.json({ id, documentId, chunkCount });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Ingestion failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
