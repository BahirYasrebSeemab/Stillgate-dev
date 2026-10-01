import { EventEmitter } from "node:events";
import { reduce, remainingSec, type Effect, type LockEvent, type LockState, type Now } from "@asd/shared";
import type { Logger } from "@asd/shared/node";
import type { Clock } from "../deps";

// Owns the current lock state. Every event goes through the pure reducer from @asd/shared,
// then the resulting effects are carried out by `runEffects`.
// Events are processed strictly one at a time (a promise queue), because effects are async
// and two overlapping transitions could otherwise interleave.

export type EffectRunner = (effects: readonly Effect[], state: LockState) => Promise<void>;

type RunnerEvents = { change: [state: LockState] };

const TICK_MS = 1000;

export class StateRunner extends EventEmitter<RunnerEvents> {
  private current: LockState;
  private queue: Promise<void> = Promise.resolve();
  private ticker: NodeJS.Timeout | null = null;

  constructor(
    initial: LockState,
    private readonly clock: Clock,
    private readonly runEffects: EffectRunner,
    private readonly log: Logger,
  ) {
    super();
    this.current = initial;
  }

  get state(): LockState {
    return this.current;
  }

  now(): Now {
    return { mono: this.clock.monoMs(), wall: this.clock.wallMs() };
  }

  remainingSec(): number | null {
    return remainingSec(this.current, this.now());
  }

  // Adds the event to the queue; resolves when it (and its effects) are done
  dispatch(event: LockEvent): Promise<void> {
    const step = this.queue.then(() => this.apply(event));
    this.queue = step.catch(() => undefined); // one failure must not block later events
    return step;
  }

  // Runs effects decided outside the reducer (the boot rule) through the same queue
  runInitialEffects(effects: readonly Effect[]): Promise<void> {
    const step = this.queue.then(() => this.runEffects(effects, this.current));
    this.queue = step.catch(() => undefined);
    return step;
  }

  startTicking(): void {
    this.ticker = setInterval(() => {
      this.dispatch({ type: "TICK" }).catch((error: unknown) => this.log.error("tick_failed", { error }));
    }, TICK_MS);
  }

  stopTicking(): void {
    if (this.ticker !== null) clearInterval(this.ticker);
    this.ticker = null;
  }

  private async apply(event: LockEvent): Promise<void> {
    const before = this.current;
    const { state, effects } = reduce(before, event, this.now());
    if (state === before && effects.length === 0) return;
    this.current = state;
    if (state.kind !== before.kind) this.log.info("state_change", { from: before.kind, to: state.kind, trigger: event.type });
    this.emit("change", state);
    await this.runEffects(effects, state);
  }
}
