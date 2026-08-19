import type { ProtectedTracePersistence } from "./protected-store.ts";
import type { ProtectedLlmTrace } from "./tracing.ts";

const PREFIX = "protected-llm-traces/";

export class R2ProtectedTracePersistence implements ProtectedTracePersistence {
  private readonly bucket: R2Bucket;

  constructor(bucket: R2Bucket) {
    this.bucket = bucket;
  }

  async put(trace: Readonly<ProtectedLlmTrace>) {
    await this.bucket.put(this.key(trace.correlation.traceId), JSON.stringify(trace), {
      httpMetadata: { contentType: "application/json" },
      customMetadata: { expiresAt: trace.expiresAt, schemaVersion: String(trace.schemaVersion) },
    });
  }

  async findById(traceId: string) {
    const object = await this.bucket.get(this.key(traceId));
    if (!object) return null;
    return await object.json<ProtectedLlmTrace>();
  }

  async deleteExpired(expiryInclusive: string) {
    let cursor: string | undefined;
    let deleted = 0;
    do {
      const page = await this.bucket.list({ prefix: PREFIX, cursor });
      const expired = page.objects.filter((object) => object.customMetadata?.expiresAt && object.customMetadata.expiresAt <= expiryInclusive);
      if (expired.length) {
        await this.bucket.delete(expired.map((object) => object.key));
        deleted += expired.length;
      }
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
    return deleted;
  }

  private key(traceId: string) {
    return `${PREFIX}${encodeURIComponent(traceId)}.json`;
  }
}
