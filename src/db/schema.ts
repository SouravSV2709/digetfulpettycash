import { sql } from "drizzle-orm";
import * as t from "drizzle-orm/pg-core";

const timestamps = {
  createdAt: t.timestamp("created_at", { withTimezone: false }).defaultNow().notNull(),
  updatedAt: t
    .timestamp("updated_at", { withTimezone: false })
    .defaultNow()
    .$onUpdate(() => sql`NOW()`)
    .notNull(),
};

export const transactions = t.pgTable("transactions", {
  id: t.serial("id").primaryKey(),
  transactionCode: t.varchar("transaction_code", { length: 20 }).unique(),
  transactionDate: t.date("transaction_date"),
  type: t.varchar("type", { length: 10 }).notNull(),
  description: t.varchar("description", { length: 255 }).notNull(),
  amount: t.numeric("amount", { precision: 12, scale: 2 }).notNull(),
  notes: t.text("notes"),
  updatedBy: t.varchar("updated_by", { length: 120 }).notNull(),
  receiptFileName: t.varchar("receipt_file_name", { length: 255 }),
  receiptStoredName: t.varchar("receipt_stored_name", { length: 255 }),
  receiptMimeType: t.varchar("receipt_mime_type", { length: 120 }),
  ...timestamps,
});
