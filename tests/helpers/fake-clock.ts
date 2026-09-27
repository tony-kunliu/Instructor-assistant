// A controllable system clock for deterministic millisecond-boundary
// regression tests (see tests/integration-history-edit-propagation.test.ts,
// "direct edit after propagation" — tony-kunliu/actgds.com Issue #3).
// Production code (lib/repo.ts) computes its own "now" via plain
// `new Date().toISOString()`, with no injectable clock parameter — adding
// one would be a bigger signature change than this bug fix calls for. This
// helper instead swaps the global `Date` constructor for the duration of a
// test, so `new Date()` (no args) returns a value this helper controls,
// while `new Date(<arg>)` and every other `Date` behavior stay real. This
// makes "two events land in the same millisecond" and "advance the clock by
// exactly 1ms" reproducible without depending on real wall-clock timing.
export class FakeClock {
  private readonly RealDate = globalThis.Date;
  private ms: number;
  private installed = false;

  constructor(startIso: string) {
    this.ms = new this.RealDate(startIso).getTime();
  }

  set(iso: string): void {
    this.ms = new this.RealDate(iso).getTime();
  }

  advanceMs(deltaMs: number): void {
    this.ms += deltaMs;
  }

  nowIso(): string {
    return new this.RealDate(this.ms).toISOString();
  }

  install(): void {
    if (this.installed) return;
    const RealDate = this.RealDate;
    const clock = this;
    class MockDate extends RealDate {
      constructor(...args: unknown[]) {
        if (args.length === 0) {
          super(clock.ms);
        } else {
          // @ts-expect-error — forwarding an arbitrary Date constructor arg tuple
          super(...args);
        }
      }
      static now(): number {
        return clock.ms;
      }
    }
    globalThis.Date = MockDate as unknown as DateConstructor;
    this.installed = true;
  }

  restore(): void {
    if (!this.installed) return;
    globalThis.Date = this.RealDate;
    this.installed = false;
  }
}
