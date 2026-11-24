/**
 * Object storage for evidence and generated PDFs, via Vercel Blob when
 * BLOB_READ_WRITE_TOKEN is set, otherwise the local filesystem (dev/tests).
 *
 * Content is addressed by SHA-256 — the key is always a hex digest, never a
 * user-supplied filename, so it is path-traversal safe by construction.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export function sha256Bytes(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

function localDir(): string {
  return process.env.FEASIBILITY3D_BLOB_DIR ?? join(process.cwd(), "data", "blobs");
}

/** Store bytes under its SHA-256 and return the storage location. */
export async function putBlob(
  sha256: string,
  data: Buffer,
  contentType: string,
): Promise<string> {
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const { put } = await import("@vercel/blob");
    const { url } = await put(sha256, data, {
      access: "public",
      contentType,
      addRandomSuffix: false,
    });
    return url;
  }
  const path = join(/* turbopackIgnore: true */ localDir(), sha256.slice(0, 2), sha256);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, data);
  return path;
}

/** Read bytes back from a storage location (URL or local path). */
export async function getBlob(location: string): Promise<Buffer | null> {
  if (location.startsWith("http")) {
    const res = await fetch(location);
    return res.ok ? Buffer.from(await res.arrayBuffer()) : null;
  }
  try {
    return readFileSync(/* turbopackIgnore: true */ location);
  } catch {
    return null;
  }
}