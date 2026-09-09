import { NextResponse } from "next/server";
import { sql } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const rows = await sql`
    SELECT id, title, submitter, vendor, department, filename,
           status, chunk_count, error, created_at
    FROM submissions
    ORDER BY created_at DESC
    LIMIT 50
  `;
  return NextResponse.json(rows);
}
