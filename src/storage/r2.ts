import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "node:crypto";
import path from "node:path";

const accountId = process.env.R2_ACCOUNT_ID;
const accessKeyId = process.env.R2_ACCESS_KEY_ID;
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
const bucket = process.env.R2_BUCKET;

if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
  throw new Error("R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, and R2_BUCKET must be set.");
}

const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId,
    secretAccessKey,
  },
});

export async function uploadReceiptObject(file: Express.Multer.File) {
  const extension = path.extname(file.originalname);
  const base = path.basename(file.originalname, extension) || "receipt";
  const safeBase = base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "receipt";
  const objectKey = `receipts/${Date.now()}-${randomUUID()}-${safeBase}${extension.toLowerCase()}`;

  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: objectKey,
      Body: file.buffer,
      ContentType: file.mimetype || "application/octet-stream",
    })
  );

  return {
    objectKey,
    fileName: file.originalname,
    mimeType: file.mimetype || "application/octet-stream",
  };
}

export async function deleteReceiptObject(objectKey: string | null | undefined) {
  if (!objectKey) {
    return;
  }

  await s3.send(
    new DeleteObjectCommand({
      Bucket: bucket,
      Key: objectKey,
    })
  );
}

export async function getReceiptDownloadUrl(objectKey: string, fileName?: string) {
  return getSignedUrl(
    s3,
    new GetObjectCommand({
      Bucket: bucket,
      Key: objectKey,
      ResponseContentDisposition: fileName ? `inline; filename="${fileName.replace(/"/g, "")}"` : "inline",
    }),
    { expiresIn: 300 }
  );
}
