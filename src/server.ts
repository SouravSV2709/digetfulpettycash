import "dotenv/config";
import express, { type Request, type Response, type NextFunction } from "express";
import multer from "multer";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { desc, eq, sql } from "drizzle-orm";
import { db } from "./db/index.js";
import { transactions } from "./db/schema.js";
import { deleteReceiptObject, getReceiptDownloadUrl, uploadReceiptObject } from "./storage/r2.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const publicDir = path.join(rootDir, "public");
const port = Number(process.env.PORT || 3000);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024,
  },
});

const app = express();

app.use(express.json());
app.use(express.static(publicDir));

app.get("/api/bootstrap", async (_req, res, next) => {
  try {
    res.json(await getBootstrapPayload());
  } catch (error) {
    next(error);
  }
});

app.post("/api/transactions", upload.single("receipt"), async (req, res, next) => {
  try {
    const payload = readTransactionPayload(req);
    const uploadedReceipt = req.file ? await uploadReceiptObject(req.file) : null;

    const [inserted] = await db
      .insert(transactions)
      .values({
        transactionDate: payload.transactionDate,
        type: payload.type,
        description: payload.description,
        amount: payload.amount,
        notes: payload.notes,
        updatedBy: payload.updatedBy,
        receiptFileName: uploadedReceipt?.fileName || null,
        receiptStoredName: uploadedReceipt?.objectKey || null,
        receiptMimeType: uploadedReceipt?.mimeType || null,
      })
      .returning({ id: transactions.id });

    await db
      .update(transactions)
      .set({ transactionCode: formatTransactionCode(inserted.id) })
      .where(eq(transactions.id, inserted.id));

    res.status(201).json({
      transaction: await getTransactionById(inserted.id),
      summary: await getSummary(),
      nextTransactionCode: await getNextTransactionCode(),
    });
  } catch (error) {
    next(error);
  }
});

app.put("/api/transactions/:id", upload.single("receipt"), async (req, res, next) => {
  try {
    const transactionId = Number(req.params.id);
    if (Number.isNaN(transactionId)) {
      res.status(400).json({ message: "Invalid transaction id." });
      return;
    }

    const existing = await getRawTransactionById(transactionId);
    if (!existing) {
      res.status(404).json({ message: "Transaction not found." });
      return;
    }

    const payload = readTransactionPayload(req);
    const uploadedReceipt = req.file ? await uploadReceiptObject(req.file) : null;

    if (uploadedReceipt?.objectKey && existing.receiptStoredName) {
      await deleteReceiptObject(existing.receiptStoredName);
    }

    await db
      .update(transactions)
      .set({
        transactionDate: payload.transactionDate,
        type: payload.type,
        description: payload.description,
        amount: payload.amount,
        notes: payload.notes,
        updatedBy: payload.updatedBy,
        receiptFileName: uploadedReceipt?.fileName || existing.receiptFileName || null,
        receiptStoredName: uploadedReceipt?.objectKey || existing.receiptStoredName || null,
        receiptMimeType: uploadedReceipt?.mimeType || existing.receiptMimeType || null,
      })
      .where(eq(transactions.id, transactionId));

    res.json({
      transaction: await getTransactionById(transactionId),
      summary: await getSummary(),
      nextTransactionCode: await getNextTransactionCode(),
    });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/transactions/:id", async (req, res, next) => {
  try {
    const transactionId = Number(req.params.id);
    if (Number.isNaN(transactionId)) {
      res.status(400).json({ message: "Invalid transaction id." });
      return;
    }

    const existing = await getRawTransactionById(transactionId);
    if (!existing) {
      res.status(404).json({ message: "Transaction not found." });
      return;
    }

    await db.delete(transactions).where(eq(transactions.id, transactionId));
    await deleteReceiptObject(existing.receiptStoredName);

    res.json({
      summary: await getSummary(),
      nextTransactionCode: await getNextTransactionCode(),
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/transactions/:id/receipt", async (req, res, next) => {
  try {
    const transactionId = Number(req.params.id);
    if (Number.isNaN(transactionId)) {
      res.status(400).json({ message: "Invalid transaction id." });
      return;
    }

    const existing = await getRawTransactionById(transactionId);
    if (!existing?.receiptStoredName) {
      res.status(404).json({ message: "Receipt not found." });
      return;
    }

    const signedUrl = await getReceiptDownloadUrl(existing.receiptStoredName, existing.receiptFileName || undefined);
    res.redirect(signedUrl);
  } catch (error) {
    next(error);
  }
});

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (error instanceof Error) {
    res.status(500).json({ message: error.message });
    return;
  }

  res.status(500).json({ message: "Unexpected server error." });
});

app.use((_req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

app.listen(port, "0.0.0.0", () => {
  console.log(`Petty cash app listening on http://localhost:${port}`);
});

async function getBootstrapPayload() {
  return {
    transactions: await listTransactions(),
    summary: await getSummary(),
    nextTransactionCode: await getNextTransactionCode(),
  };
}

async function listTransactions() {
  const rows = await db
    .select()
    .from(transactions)
    .orderBy(desc(transactions.transactionDate), desc(transactions.id));
  return rows.map(serializeTransaction);
}

async function getTransactionById(id: number) {
  const row = await getRawTransactionById(id);
  return row ? serializeTransaction(row) : null;
}

async function getRawTransactionById(id: number) {
  const [row] = await db.select().from(transactions).where(eq(transactions.id, id)).limit(1);
  return row || null;
}

async function getSummary() {
  const [summary] = await db
    .select({
      totalCashInHand: sql<string>`COALESCE(SUM(CASE WHEN ${transactions.type} = 'credit' THEN ${transactions.amount} ELSE -${transactions.amount} END), 0)`,
      amountSpent: sql<string>`COALESCE(SUM(CASE WHEN ${transactions.type} = 'debit' THEN ${transactions.amount} ELSE 0 END), 0)`,
    })
    .from(transactions);

  return {
    totalCashInHand: Number(summary?.totalCashInHand || 0),
    amountSpent: Number(summary?.amountSpent || 0),
  };
}

async function getNextTransactionCode() {
  const [lastTransaction] = await db
    .select({ id: transactions.id })
    .from(transactions)
    .orderBy(desc(transactions.id))
    .limit(1);

  return formatTransactionCode((lastTransaction?.id || 0) + 1);
}

function serializeTransaction(row: typeof transactions.$inferSelect) {
  return {
    dbId: row.id,
    id: row.transactionCode || formatTransactionCode(row.id),
    transactionDate: row.transactionDate || "",
    type: row.type,
    description: row.description,
    amount: Number(row.amount),
    updatedBy: row.updatedBy,
    notes: row.notes || "",
    receiptName: row.receiptFileName || "",
    receiptUrl: row.receiptStoredName ? `/api/transactions/${row.id}/receipt` : "",
  };
}

function readTransactionPayload(req: Request) {
  const transactionDate = String(req.body.transactionDate || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(transactionDate)) {
    throw new Error("Transaction date is required.");
  }

  const type = String(req.body.type || "").trim().toLowerCase();
  if (type !== "credit" && type !== "debit") {
    throw new Error("Transaction type must be debit or credit.");
  }

  const description = String(req.body.description || "").trim();
  if (!description) {
    throw new Error("Description is required.");
  }

  const amount = Number(req.body.amount);
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error("Amount must be a valid non-negative number.");
  }

  const updatedBy = String(req.body.updatedBy || "").trim();
  if (!updatedBy) {
    throw new Error("Updated by is required.");
  }

  return {
    transactionDate,
    type,
    description,
    amount: amount.toFixed(2),
    updatedBy,
    notes: String(req.body.notes || "").trim(),
  };
}

function formatTransactionCode(id: number) {
  return String(id).padStart(3, "0");
}
