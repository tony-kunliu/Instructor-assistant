// An isolated, in-process fake ACTGDS receiver for testing the sender end
// to end (outbox → signed webhook → receiver → delivery status) without
// ever touching a real network host, per docs/integrations/
// actgds-instructor-assistant-v1.md §17. Implements `typeof fetch` directly
// (no HTTP server, no sockets) — passed as `fetchImpl` in IntegrationHooks.

import { verifyWebhookSignature } from "../../lib/integration/hmac.ts";

export type FakeReceivedRequest = {
  url: string;
  method: string;
  headers: Record<string, string>;
  bodyText: string;
  signatureValid: boolean;
};

type QueuedResponse = { kind: "status"; status: number } | { kind: "network-error" };

export function createFakeReceiver(secret: string) {
  const received: FakeReceivedRequest[] = [];
  const queue: QueuedResponse[] = [];
  let defaultStatus = 200;

  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = init?.method ?? "GET";
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    const bodyText = typeof init?.body === "string" ? init.body : "";
    const timestamp = Number(headers["x-ia-timestamp"]);
    const signatureHeader = headers["x-ia-signature"] ?? "";
    const signatureValid = await verifyWebhookSignature(secret, timestamp, bodyText, signatureHeader);
    received.push({ url, method, headers, bodyText, signatureValid });

    const next = queue.shift();
    if (next?.kind === "network-error") throw new TypeError("simulated network failure (fake receiver)");
    const status = next?.kind === "status" ? next.status : defaultStatus;
    return new Response(JSON.stringify({ received: true }), { status, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;

  return {
    fetchImpl,
    received,
    queueResponse(status: number) {
      queue.push({ kind: "status", status });
    },
    queueNetworkError() {
      queue.push({ kind: "network-error" });
    },
    setDefaultStatus(status: number) {
      defaultStatus = status;
    },
  };
}
