import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const vacancies = sqliteTable("vacancies", {
  id: text("id").primaryKey(),
  normalizedTitle: text("normalized_title").notNull(),
  recordJson: text("record_json").notNull(),
}, (table) => [uniqueIndex("vacancies_normalized_title_unique").on(table.normalizedTitle)]);

export const vacancyOperations = sqliteTable("vacancy_operations", {
  operationId: text("operation_id").primaryKey(),
  vacancyId: text("vacancy_id").notNull(),
  normalizedTitle: text("normalized_title").notNull(),
  inputJson: text("input_json").notNull(),
  state: text("state", { enum: ["provisioning", "committed"] }).notNull(),
  folderId: text("folder_id"),
}, (table) => [uniqueIndex("vacancy_operations_normalized_title_unique").on(table.normalizedTitle)]);

export const candidates = sqliteTable("candidates", {
  id: integer("id").primaryKey(),
  revision: integer("revision").notNull(),
  recordJson: text("record_json").notNull(),
});

export const resultDocuments = sqliteTable("result_documents", {
  candidateId: integer("candidate_id").notNull(),
  type: text("type", { enum: ["candidate-results", "abc-test"] }).notNull(),
  version: integer("version").notNull(),
  descriptorJson: text("descriptor_json").notNull(),
}, (table) => [uniqueIndex("result_documents_identity_unique").on(table.candidateId, table.type, table.version)]);

export const auditEvents = sqliteTable("audit_events", {
  id: text("id").primaryKey(),
  candidateId: integer("candidate_id").notNull(),
  action: text("action").notNull(),
  actor: text("actor").notNull(),
  timestamp: text("timestamp").notNull(),
  outcome: text("outcome").notNull(),
  details: text("details"),
});

export const candidateTombstones = sqliteTable("candidate_tombstones", {
  candidateId: integer("candidate_id").primaryKey(),
  deletedAt: text("deleted_at").notNull(),
});
