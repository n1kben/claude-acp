/**
 * `delivery` on ACP v2 `session/prompt`, per the steer and queue RFD
 * (agentclientprotocol/agent-client-protocol#1261, revision of 2026-10-24,
 * `docs/rfds/v2/prompt-delivery.mdx` at ee193af). The agent serves `steer`
 * only; a client that wants a queue holds its prompts until `idle`.
 *
 * `@agentclientprotocol/sdk` 2.4.0 does not have the field yet: its
 * `session/prompt` params parser drops unknown keys, and an app cannot replace
 * the parser of a built-in method. {@link withPromptDeliveries} therefore reads
 * `delivery` off the incoming JSON-RPC messages, before the SDK parses them,
 * and the `session/prompt` handler takes it by request id. Once the SDK parses
 * `delivery`, the handler reads it from its params and this reader goes.
 */
import type * as v2 from "@agentclientprotocol/sdk/experimental/v2/unstable";
import { RequestError } from "@agentclientprotocol/sdk/unstable";

/** What a `session/prompt` asks to happen to its message while the agent works. */
export type PromptDelivery = "steer";

/**
 * `session.prompt.delivery` of the agent's capabilities: `steer` alone. The
 * SDK's `PromptCapabilities` type does not have the field yet.
 */
export const PROMPT_DELIVERY_CAPABILITY = { steer: {} } as const;

/** The `delivery` values of `session/prompt` requests, by request id. */
export class PromptDeliveries {
  private readonly byRequestId = new Map<string | number, unknown>();

  /** Records the `delivery` of `message` if it is a `session/prompt` request that has one. */
  record(message: unknown): void {
    if (!isRecord(message) || message.method !== "session/prompt") return;
    const id = message.id;
    if (typeof id !== "string" && typeof id !== "number") return;
    if (!isRecord(message.params) || !("delivery" in message.params)) return;
    this.byRequestId.set(id, message.params.delivery);
  }

  /**
   * The `delivery` of the `session/prompt` request `requestId`, once: the
   * entry is removed. `undefined` when the request had none.
   */
  take(requestId: string | number | null): unknown {
    if (requestId === null) return undefined;
    const delivery = this.byRequestId.get(requestId);
    this.byRequestId.delete(requestId);
    return delivery;
  }
}

/**
 * Validates a `delivery` value. Omitted and `null` mean no delivery mode. Any
 * other value than `steer`, `queue` included, fails with invalid params
 * (-32602) before the message is inserted, as the RFD requires for a value
 * the agent did not advertise.
 */
export function parsePromptDelivery(delivery: unknown): PromptDelivery | undefined {
  if (delivery === undefined || delivery === null) return undefined;
  if (delivery === "steer") return delivery;
  throw RequestError.invalidParams(
    { delivery },
    `Unsupported prompt delivery ${JSON.stringify(delivery)}: this agent supports "steer" only. Queue the prompt on the client until the session is idle instead.`,
  );
}

/**
 * `app` with `deliveries` recording the `delivery` of every incoming
 * `session/prompt` before the SDK parses it. Messages pass through unchanged.
 */
export function withPromptDeliveries(
  app: v2.AgentConnector,
  deliveries: PromptDeliveries,
): v2.AgentConnector {
  return {
    connect(stream, options) {
      const readable = stream.readable.pipeThrough(
        new TransformStream({
          transform(message, controller) {
            deliveries.record(message);
            controller.enqueue(message);
          },
        }),
      );
      return app.connect({ ...stream, readable }, options);
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
