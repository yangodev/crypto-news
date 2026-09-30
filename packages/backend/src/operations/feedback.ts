// Feedback: content, optional email, page URL, one optional screenshot. The screenshot
// is normalized, bounded and expires independently of optional Feishu forwarding.
// Abuse controls use an HMAC of client IP, never a client-controlled User-Agent.
import { createHmac } from "node:crypto";
import sharp from "sharp";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile, readdir, stat, statfs, unlink } from "node:fs/promises";
import path from "node:path";
import { config, credential } from "../config.ts";
import { sql } from "../db.ts";

import { feishuInternalEnabled, forwardFeedbackToFeishu } from "../notify/feishu.ts";

export class FeedbackRejected extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryAfter?: number;
  constructor(status: number, code: string, message: string, retryAfter?: number) {
    super(message);
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

export function feedbackSourceHash(ip: string, userAgent: string): string {
  const secret = credential("auth", "SESSION_SECRET") ?? "dev-feedback-secret";
  return createHmac("sha256", secret).update(ip).digest("base64url").slice(0, 24);
}

const recent = new Map<string, number[]>();
function rateLimit(source: string, perMinute = 5): void {
  const now = Date.now();
  const list = (recent.get(source) ?? []).filter((t) => now - t < 60_000);
  if (list.length >= perMinute) throw new FeedbackRejected(429, "rate_limited", "提交太频繁，请稍后再试。", 60);
  if (!recent.has(source) && recent.size >= 5000) recent.delete(recent.keys().next().value!);
  list.push(now);
  recent.set(source, list);
  if (recent.size > 5000) for (const [k, v] of recent) if (v.every((t) => now - t > 60_000)) recent.delete(k);
}

export interface FeedbackInput {
  content: string;
  email?: string | null;
  pageUrl?: string | null;
  screenshot?: { mime: string; data: Buffer } | null;
  ip: string;
  userAgent: string;
}

export async function submitFeedback(input: FeedbackInput): Promise<{ id: number }> {
  const content = input.content.trim();
  if (content.length < 2) throw new FeedbackRejected(400, "invalid_request", "请写下反馈内容。");
  if (content.length > 5000) throw new FeedbackRejected(400, "invalid_request", "反馈内容最多 5000 字。");
  const email = input.email?.trim() || null;
  if (email && (email.length > 200 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) throw new FeedbackRejected(400, "invalid_request", "邮箱格式不正确。");
  const pageUrl = input.pageUrl?.trim().slice(0, 500) || null;
  const source = feedbackSourceHash(input.ip, input.userAgent);
  const [banned] = await sql`SELECT 1 FROM feedback_bans WHERE source_hash = ${source}`;
  if (banned) throw new FeedbackRejected(403, "forbidden", "暂时无法提交反馈。");
  rateLimit(source);

  let createdFile: string | null = null;
  let id: number;
  try {
    id = await sql.begin(async (tx) => {
      // One shared storage budget across API processes; refuse work rather than queue image decoders.
      const [lock] = await tx`SELECT pg_try_advisory_xact_lock(72819451) AS held`;
      if (!lock!.held) throw new FeedbackRejected(429, "rate_limited", "反馈提交繁忙，请稍后再试。", 5);
      const [usage] = await tx`SELECT count(*) FILTER (WHERE created_at > now()-interval '1 minute') AS total,
        count(*) FILTER (WHERE source_hash=${source} AND created_at > now()-interval '1 minute') AS requests,
        count(*) AS daily, coalesce(sum(screenshot_bytes) FILTER (WHERE source_hash=${source} AND created_at > now()-interval '1 hour'),0) AS bytes
        FROM feedback WHERE created_at > now()-interval '1 day'`;
      if (Number(usage!.total) >= 120 || Number(usage!.daily) >= 1000 || Number(usage!.requests) >= 5)
        throw new FeedbackRejected(429, "rate_limited", "提交太频繁，请稍后再试。", 60);
      let screenshotKey: string | null = null;
      let inputBytes = 0;
      if (input.screenshot) {
        inputBytes = input.screenshot.data.length;
        if (!/^image\/(png|jpeg|webp|gif)$/.test(input.screenshot.mime) || inputBytes > 8 * 1024 * 1024)
          throw new FeedbackRejected(400, "invalid_request", "截图需要是 8MB 以内的 PNG、JPG、WebP 或 GIF。");
        if (Number(usage!.bytes) + inputBytes > 16 * 1024 * 1024)
          throw new FeedbackRejected(429, "rate_limited", "截图提交过多，请稍后再试或仅提交文字。", 3600);
        let image: Buffer;
        try {
          const decoder = sharp(input.screenshot.data, { limitInputPixels: 16_000_000, failOn: "warning" });
          const meta = await decoder.metadata();
          if (!["png", "jpeg", "webp", "gif"].includes(meta.format ?? "") || (meta.pages ?? 1) > 1) throw Error("Unsupported image");
          image = await decoder.rotate().resize({ width: 2048, height: 2048, fit: "inside", withoutEnlargement: true }).webp({ quality: 80 }).timeout({ seconds: 5 }).toBuffer();
        } catch { throw new FeedbackRejected(400, "invalid_request", "截图无法读取，请使用有效的单帧图片（最多 1600 万像素）。"); }
        const dir = path.join(config.dataDir, "feedback-screenshots");
        await mkdir(dir, { recursive: true, mode: 0o700 });
        let used = 0;
        const entries = await readdir(dir);
        if (entries.length >= 2000) throw new FeedbackRejected(503, "storage_full", "截图存储暂时不可用，请仅提交文字反馈。");
        for (const entry of entries) used += (await stat(path.join(dir, entry)).catch(() => null))?.size ?? 0;
        const disk = await statfs(dir);
        assertFeedbackCapacity(used, disk.bavail * disk.bsize, image.length);
        const name = `${randomUUID()}.webp`;
        createdFile = path.join(dir, name);
        await writeFile(createdFile, image, { flag: "wx", mode: 0o600 });
        screenshotKey = `local:${name}`;
      }
      const [row] = await tx`INSERT INTO feedback (content,email,page_url,screenshot_key,source_hash,forward_error,screenshot_bytes)
        VALUES (${content},${email},${pageUrl},${screenshotKey},${source},'pending',${inputBytes}) RETURNING id`;
      return Number(row!.id);
    });
  } catch (error) {
    if (createdFile) await unlink(createdFile).catch(() => {});
    if (["ENOSPC", "EDQUOT"].includes((error as NodeJS.ErrnoException).code ?? ""))
      throw new FeedbackRejected(503, "storage_full", "截图暂时无法保存，请仅提交文字反馈。");
    throw error;
  }
  void forwardFeedbackToFeishu(id).catch(() => {});
  return { id };
}

/**
 * Every few minutes: feedback that did not reach the internal chat (Feishu down, a screenshot upload
 * failing) is tried again for a week. Newer than a few minutes is still being sent by its submission.
 */
export async function forwardPendingFeedback(): Promise<{ sent: number; failed: number }> {
  if (!feishuInternalEnabled()) return { sent: 0, failed: 0 };
  const rows = await sql<{ id: number }[]>`
    SELECT id FROM feedback WHERE forwarded_at IS NULL AND forward_error IS NOT NULL
      AND created_at < now() - interval '5 minutes' AND created_at > now() - interval '7 days'
    ORDER BY id LIMIT 20`;
  let sent = 0;
  let failed = 0;
  for (const r of rows) {
    try {
      if ((await forwardFeedbackToFeishu(r.id)) === "sent") sent += 1;
    } catch {
      failed += 1;
    }
  }
  return { sent, failed };
}

export function assertFeedbackCapacity(used: number, free: number, incoming: number): void {
  if (used + incoming > 256 * 1024 * 1024 || free - incoming < 1024 * 1024 * 1024)
    throw new FeedbackRejected(503, "storage_full", "截图存储暂时不可用，请仅提交文字反馈。");
}
