import { pgTable, text, integer, serial, timestamp, vector } from "drizzle-orm/pg-core";

// Mirrors db/init.sql. init.sql is the source of truth for DDL (it runs on
// first container boot); this file exists to give queries types.
export const submissions = pgTable("submissions", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  submitter: text("submitter").notNull(),
  vendor: text("vendor").notNull(),
  department: text("department").notNull(),
  notes: text("notes"),
  filename: text("filename"),
  documentId: text("document_id"),
  status: text("status").notNull().default("pending"),
  chunkCount: integer("chunk_count").notNull().default(0),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const chunks = pgTable("chunks", {
  id: serial("id").primaryKey(),
  documentId: text("document_id").notNull(),
  submissionId: text("submission_id").notNull(),
  chunkIndex: integer("chunk_index").notNull(),
  chunkText: text("chunk_text").notNull(),
  embedding: vector("embedding", { dimensions: 768 }),
});
