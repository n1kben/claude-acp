/**
 * Steers that report when Claude Code takes them in, as a prompt does.
 *
 * ACP v2 `session/prompt` with `delivery: "steer"` (RFD
 * agentclientprotocol/agent-client-protocol#1261) answers once the steered
 * message is inserted, with its `messageId`, like any v2 prompt. The agent
 * pushes such a steer into the running turn (`ClaudeAcpAgent.steerTurn`) and
 * tracks it here until one of these shows Claude Code took it in:
 *
 * - its echo (`--replay-user-messages`),
 * - its `command_lifecycle` "started" frame (msg_lifecycle_v1 CLIs), or
 * - a result that names it in `user_message_uuids`.
 *
 * Whichever comes first reports {@link TurnEvents.inserted}; the others find
 * nothing to report. A steer the turn ended without taking in is handed back
 * by {@link SteerInsertions.takeForTurn}, so the agent can start it as the
 * next turn. A steer the client withdrew is removed with
 * {@link SteerInsertions.take}.
 *
 * `_session/steering` (ACP v1) steers are not tracked: that request answers as
 * soon as the message is pushed.
 */
import type { PromptRequest } from "@agentclientprotocol/sdk/unstable";
import type { TurnEvents } from "./turn-events.js";

/** A steer that Claude Code has not taken in yet. */
export type PendingSteer = {
  /** The prompt request the steer was sent as, to start it as a turn. */
  request: PromptRequest;
  /** Where the steer reports how its prompt is answered. */
  events: TurnEvents;
  /** The turn the steer was pushed into. Opaque here: only compared. */
  turn: object;
};

export class SteerInsertions {
  /** By the uuid of the steer's user message, in the order steers were sent. */
  private readonly pending = new Map<string, PendingSteer>();

  /** Tracks a steer whose user message is pushed with `uuid`. */
  track(uuid: string, steer: PendingSteer): void {
    this.pending.set(uuid, steer);
  }

  /**
   * Reports the steer with `uuid` inserted, once. A uuid that names no pending
   * steer (a prompt, a v1 steer, or a steer already reported) is ignored.
   */
  inserted(uuid: string): void {
    const steer = this.pending.get(uuid);
    if (!steer) return;
    this.pending.delete(uuid);
    steer.events.inserted(uuid);
  }

  /** The pending steer `uuid`, or `undefined` once it was reported or taken. */
  get(uuid: string): PendingSteer | undefined {
    return this.pending.get(uuid);
  }

  /** Removes and returns the pending steer `uuid`, without reporting it. */
  take(uuid: string): PendingSteer | undefined {
    const steer = this.pending.get(uuid);
    this.pending.delete(uuid);
    return steer;
  }

  /**
   * Removes and returns the steers pushed into `turn` that Claude Code has not
   * taken in, in the order they were sent.
   */
  takeForTurn(turn: object): Array<[uuid: string, steer: PendingSteer]> {
    const taken: Array<[string, PendingSteer]> = [];
    for (const [uuid, steer] of this.pending) {
      if (steer.turn !== turn) continue;
      this.pending.delete(uuid);
      taken.push([uuid, steer]);
    }
    return taken;
  }
}
