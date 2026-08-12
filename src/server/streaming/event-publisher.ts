import type { RunEvent, RunEventType, StageName } from "@/domain/contracts/events";
import type { ArtifactName } from "../runs/run-store";
import type { RunStore } from "../runs/run-store";
import { encodeNdjsonLine } from "./ndjson";

type PublishInput = {
  type: RunEventType;
  runId: string;
  stage?: StageName | string;
  data: unknown;
};

export type DeliveryMode = "live" | "cached-replay";

/**
 * Publishes streamed run events. Every event is first appended to
 * events.ndjson, then enqueued to subscribers. sequence increments strictly
 * per publish across the whole run.
 */
export class EventPublisher {
  private sequence = 0;
  private subscribers = new Set<(event: RunEvent) => void>();

  constructor(
    private readonly store: RunStore,
    private readonly now: () => string,
    private readonly deliveryMode: DeliveryMode,
  ) {}

  onEvent(fn: (event: RunEvent) => void): void {
    this.subscribers.add(fn);
  }

  private async emit(event: RunEvent): Promise<void> {
    // appendEvent receives the already-framed line (ends with "\n") so the
    // on-disk NDJSON bytes match the HTTP stream exactly.
    await this.store.appendEvent(event.runId, encodeNdjsonLine(event));
    for (const fn of this.subscribers) {
      try {
        fn(event);
      } catch {
        // A subscriber error must never break the run stream.
      }
    }
  }

  async publish(input: PublishInput): Promise<void> {
    const event: RunEvent = {
      protocolVersion: "1",
      sequence: ++this.sequence,
      eventId: `${input.runId}-${this.sequence}`,
      runId: input.runId,
      timestamp: this.now(),
      deliveryMode: this.deliveryMode,
      type: input.type,
      stage: input.stage as StageName | undefined,
      data: input.data,
    };
    await this.emit(event);
  }

  /**
   * Writes an artifact, emits artifact.available, and returns the run-relative
   * file name. The relative name keeps the event stream portable (no local
   * absolute paths) and is what manifests index for replay.
   */
  async publishArtifact(runId: string, name: ArtifactName, attempt: number, value: unknown): Promise<string> {
    await this.store.writeArtifact(runId, name, attempt, value);
    const relativeFile = `artifacts/${name}.attempt-${String(attempt).padStart(2, "0")}.json`;
    await this.emit({
      protocolVersion: "1",
      sequence: ++this.sequence,
      eventId: `${runId}-${this.sequence}`,
      runId,
      timestamp: this.now(),
      deliveryMode: this.deliveryMode,
      type: "artifact.available",
      data: { artifact: name, attempt, file: relativeFile },
    });
    return relativeFile;
  }
}
