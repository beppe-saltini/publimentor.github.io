/**
 * Newline-delimited JSON streaming for the reviewer discovery search: the server
 * emits a snapshot after each stage, so the editor sees candidates while e-mail,
 * integrity, deceased and conflict checks are still running, and can cancel.
 */

export interface DiscoveryProgressEvent<R = unknown, S = unknown> {
  event: "progress";
  stage: string;
  label: string;
  reviewers: R[];
  summary: S;
}

export interface DiscoveryDoneEvent<R = unknown, S = unknown> {
  event: "done";
  reviewers: R[];
  summary: S;
  disclaimer: string;
  selectionCriteria: Record<string, string | boolean>;
}

export interface DiscoveryErrorEvent {
  event: "error";
  message: string;
}

export type DiscoveryEvent<R = unknown, S = unknown> =
  | DiscoveryProgressEvent<R, S>
  | DiscoveryDoneEvent<R, S>
  | DiscoveryErrorEvent;

export const NDJSON_CONTENT_TYPE = "application/x-ndjson; charset=utf-8";

export type Emit = (event: Record<string, unknown>) => void;

/**
 * Runs `work` while streaming the events it emits as NDJSON. `signal` aborts when
 * the client disconnects or cancels; `work` is expected to check it between stages.
 */
export function ndjsonResponse(
  work: (emit: Emit, signal: AbortSignal) => Promise<void>,
  signal: AbortSignal
): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const emit: Emit = (event) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
        } catch {
          closed = true;
        }
      };
      work(emit, signal)
        .catch((err) => {
          console.error("[Discover] Stream failed:", err);
          emit({ event: "error", message: "Failed to discover reviewers" });
        })
        .finally(() => {
          if (!closed) {
            closed = true;
            try {
              controller.close();
            } catch {
              /* already closed by the client */
            }
          }
        });
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": NDJSON_CONTENT_TYPE,
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}

/** Splits buffered text into complete lines and the unfinished remainder. */
export function splitNdjson(buffer: string): { lines: string[]; rest: string } {
  const parts = buffer.split("\n");
  const rest = parts.pop() ?? "";
  return { lines: parts.map((l) => l.trim()).filter(Boolean), rest };
}

/** Yields each JSON object from an NDJSON response body as it arrives. */
export async function* readNdjson<T = unknown>(body: ReadableStream<Uint8Array>): AsyncGenerator<T> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const { lines, rest } = splitNdjson(buffer);
      buffer = rest;
      for (const line of lines) yield JSON.parse(line) as T;
    }
    buffer += decoder.decode();
    const { lines } = splitNdjson(buffer + "\n");
    for (const line of lines) yield JSON.parse(line) as T;
  } finally {
    reader.releaseLock();
  }
}
