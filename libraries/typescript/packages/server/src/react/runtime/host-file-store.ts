import { EmptyResultSchema, ResultSchema } from "@modelcontextprotocol/core";
import type { App } from "@modelcontextprotocol/ext-apps";
import type {
  HostFileContent,
  HostFileData,
  HostFileHandle,
  HostFileOptions,
  ResourceWriteResult,
} from "../types/host-file.js";
import type { HostSnapshot } from "./view-runtime.js";

const RESOURCE_EXTENSION = "openai/resource";
// Keep host extension fields (and dual content keys) for boundary validation.
// EmptyResultSchema is strict, and standard resource unions strip extra fields.
const hostResultSchema = ResultSchema.passthrough();

type Opening = Readonly<
  | { status: "pending" | "unsupported" }
  | { status: "error"; error: Error }
  | { status: "file"; file: Readonly<NonNullable<HostFileHandle["file"]>> }
>;
interface SaveFence {
  revision: number;
  readSequence: number;
}
type Snapshot = Omit<HostFileHandle, "refresh" | "write">;
type SnapshotPatch = { [K in keyof Snapshot]?: Snapshot[K] | undefined };
interface Host {
  app: App;
  connect(): Promise<App>;
  getHostSnapshot(): HostSnapshot;
}

function failure(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}
function content(value: unknown): HostFileContent {
  const item = record(value);
  if (item && typeof item.text === "string" && !("blob" in item))
    return { text: item.text };
  if (item && typeof item.blob === "string" && !("text" in item))
    return { blob: item.blob };
  throw new Error(
    "Host file contents must contain exactly one of text or blob"
  );
}
function writeResult(value: unknown): ResourceWriteResult {
  const result = record(value);
  if (
    result &&
    (result.outcome === "saved" || result.outcome === "conflict") &&
    nonEmpty(result.etag)
  )
    return result as ResourceWriteResult;
  if (
    result?.outcome === "too-large" &&
    typeof result.maxBytes === "number" &&
    Number.isFinite(result.maxBytes) &&
    result.maxBytes >= 0
  )
    return result as ResourceWriteResult;
  throw new Error("Malformed host resource write result");
}

/** Runtime-owned opening identity, write queue and shared subscription. @internal */
export class HostFileStore {
  #opening: Opening = Object.freeze({ status: "pending" });
  disposed = false;
  saveRevision = 0;
  writable = false;
  readonly sessions = new Set<HostFileSession>();
  readonly #host: Host;
  readonly #subscribers = new Set<HostFileSession>();
  #subscribed = false;
  #subscriptionError: Error | undefined;
  #subscriptionQueue = Promise.resolve();
  #writeQueue = Promise.resolve();
  #readSequence = 0;
  #permissionSequence = 0;

  /** Use the runtime-owned App and its cached connection. */
  constructor(host: Host) {
    this.#host = host;
  }

  /** Capture only the first complete rendering input. */
  receiveInput(input: Record<string, unknown>): void {
    if (this.disposed || this.#opening.status !== "pending") return;
    if (!("file" in input))
      this.#opening = Object.freeze({ status: "unsupported" });
    else {
      const file = record(input.file);
      const opening: Opening =
        file &&
        typeof file.name === "string" &&
        typeof file.resourceUri === "string" &&
        file.resourceUri.trim()
          ? {
              status: "file",
              file: Object.freeze({
                name: file.name,
                resourceUri: file.resourceUri,
              }),
            }
          : {
              status: "error",
              error: new Error(
                "Malformed complete host file input: expected name and non-blank resourceUri"
              ),
            };
      this.#opening = Object.freeze(opening);
    }
    this.sync();
  }

  /** Publish negotiation or opening-input changes to active consumers. */
  sync(): void {
    for (const session of this.sessions) session.sync();
  }

  /** Resolve the opening identity only after the dedicated capability handshake. */
  state(): Opening {
    const host = this.#host.getHostSnapshot();
    if (this.disposed)
      return {
        status: "error",
        error: new Error("View runtime has been disposed"),
      };
    if (host.connectionError)
      return { status: "error", error: host.connectionError };
    if (!host.isConnected) return { status: "pending" };
    if (
      this.#host.app.getHostCapabilities()?.experimental?.[
        RESOURCE_EXTENSION
      ] === undefined
    )
      return { status: "unsupported" };
    return this.#opening;
  }

  /** Connect through the runtime and reject unsupported or inactive openings. */
  async app(): Promise<App> {
    const app = await this.#host.connect();
    if (this.state().status !== "file")
      throw new Error(
        "Host file access requires a supported host and complete opening file input"
      );
    return app;
  }

  /** Activate a read consumer and start the existing connection if needed. */
  attach(session: HostFileSession): void {
    if (this.disposed) return;
    this.sessions.add(session);
    session.sync();
    void this.#host.connect().catch(() => {
      /* The runtime publishes connectionError. */
    });
  }
  /** Release a consumer and its subscription reference. */
  detach(session: HostFileSession): void {
    this.sessions.delete(session);
    this.unsubscribe(session);
  }

  /** Acquire one reference to the shared opening-resource subscription. */
  subscribe(session: HostFileSession): void {
    if (this.#subscribers.has(session)) return;
    this.#subscribers.add(session);
    session.subscription(this.#subscribed, this.#subscriptionError);
    this.#queueSubscription();
  }
  /** Release one reference, serializing cleanup after any pending subscribe. */
  unsubscribe(session: HostFileSession): void {
    if (this.#subscribers.delete(session)) this.#queueSubscription();
  }
  #publishSubscription(): void {
    for (const session of this.#subscribers)
      session.subscription(this.#subscribed, this.#subscriptionError);
  }
  #queueSubscription(): void {
    this.#subscriptionQueue = this.#subscriptionQueue.then(async () => {
      if (this.#opening.status !== "file") return;
      const uri = this.#opening.file.resourceUri;
      const wanted = !this.disposed && this.#subscribers.size > 0;
      if (wanted === this.#subscribed) return;
      try {
        const app = wanted ? await this.app() : this.#host.app;
        await app.request(
          {
            method: wanted ? "resources/subscribe" : "resources/unsubscribe",
            params: { uri },
          },
          EmptyResultSchema
        );
        this.#subscribed = wanted;
        this.#subscriptionError = undefined;
      } catch (error) {
        this.#subscriptionError = failure(error);
      }
      this.#publishSubscription();
    });
  }

  /** Filter host updates by exact opening identity and trigger subscribed reads. */
  updated(uri: string): void {
    if (
      this.disposed ||
      this.#opening.status !== "file" ||
      uri !== this.#opening.file.resourceUri
    )
      return;
    this.invalidate();
    for (const session of this.#subscribers)
      void session.refresh().catch(() => {});
  }
  /** Disable saving and discard pre-invalidation read completions. */
  invalidate(): void {
    this.writable = false;
    ++this.saveRevision;
    this.#permissionSequence = this.#readSequence;
    for (const session of this.sessions) session.disableWrite();
  }
  /** Order permission observations across concurrent representation consumers. */
  beginRead(): number {
    return ++this.#readSequence;
  }
  /** Apply the newest read permission without letting an older read restore writes. */
  permission(data: HostFileData, sequence: number): void {
    if (sequence < this.#permissionSequence) return;
    this.#permissionSequence = sequence;
    this.writable = data.writable && nonEmpty(data.etag);
    if (!this.writable)
      for (const session of this.sessions) session.disableWrite();
  }

  /** Serialize writes to the single opening resource, including failures. */
  enqueueWrite(
    operation: () => Promise<ResourceWriteResult>
  ): Promise<ResourceWriteResult> {
    const result = this.#writeQueue.then(operation);
    this.#writeQueue = result.then(
      () => {},
      () => {}
    );
    return result;
  }
  /** Capture invalidation and read ordering immediately before a save request. */
  saveFence(): SaveFence {
    return { revision: this.saveRevision, readSequence: this.#readSequence };
  }
  /** Adopt a save only if no newer read or invalidation has been observed. */
  saved(replacement: HostFileContent, etag: string, fence: SaveFence): void {
    if (
      this.saveRevision !== fence.revision ||
      this.#permissionSequence > fence.readSequence
    )
      return;
    ++this.saveRevision;
    for (const session of this.sessions) session.saved(replacement, etag);
  }
  /** Ignore late operations and release host subscriptions before App closure. */
  async dispose(): Promise<void> {
    this.disposed = true;
    for (const session of [...this.sessions]) session.stop();
    this.#subscribers.clear();
    this.#queueSubscription();
    await this.#subscriptionQueue;
  }
}

/** Per-hook read representation and lifetime, using the runtime's shared owner. @internal */
export class HostFileSession {
  readonly #store: HostFileStore;
  readonly #options: HostFileOptions;
  readonly #listeners = new Set<() => void>();
  #active = false;
  #generation = 0;
  #readId = 0;
  #started = false;
  #snapshot: Snapshot = {
    status: "pending",
    isRefreshing: false,
    isSubscribed: false,
    canWrite: false,
  };

  /** Bind this consumer to one representation and subscription preference. */
  constructor(store: HostFileStore, options: HostFileOptions) {
    this.#store = store;
    this.#options = options;
  }
  /** Stable external-store snapshot until a visible field changes. */
  getSnapshot = (): Snapshot => this.#snapshot;
  /** Start on the first React listener and clean up after the last one leaves. */
  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    if (!this.#active) {
      this.#active = true;
      ++this.#generation;
      this.#store.attach(this);
    }
    return () => {
      this.#listeners.delete(listener);
      if (!this.#listeners.size) this.stop();
    };
  };
  /** Invalidate this consumer lifetime and release its host reference. */
  stop(): void {
    this.#active = false;
    this.#listeners.clear();
    ++this.#generation;
    this.#started = false;
    this.#store.detach(this);
    this.#snapshot = {
      status: "pending",
      isRefreshing: false,
      isSubscribed: false,
      canWrite: false,
    };
  }
  #patch(patch: SnapshotPatch): void {
    if (!this.#active || this.#store.disposed) return;
    if (
      (Object.keys(patch) as (keyof Snapshot)[]).every(
        (key) => this.#snapshot[key] === patch[key]
      )
    )
      return;
    const next = { ...this.#snapshot, ...patch };
    for (const key of Object.keys(next) as (keyof Snapshot)[]) {
      if (next[key] === undefined) delete next[key];
    }
    this.#snapshot = next as Snapshot;
    for (const listener of this.#listeners) listener();
  }
  /** Publish negotiation or opening-input changes to active consumers. */
  sync(): void {
    if (!this.#active) return;
    const state = this.#store.state();
    if (state.status !== "file") {
      this.#patch({
        status: state.status,
        ...(state.status === "error" && { error: state.error }),
        canWrite: false,
      });
      return;
    }
    const published = this.#snapshot.file;
    if (
      !published ||
      published.name !== state.file.name ||
      published.resourceUri !== state.file.resourceUri
    ) {
      this.#patch({ file: { ...state.file } });
    }
    if (!this.#started) {
      this.#started = true;
      void this.refresh().catch(() => {});
      if (this.#options.subscribe !== false) this.#store.subscribe(this);
    }
  }
  /** Publish subscription status independently from read failures. */
  subscription(isSubscribed: boolean, error: Error | undefined): void {
    this.#patch({ isSubscribed, subscriptionError: error });
  }
  /** Preserve contents while revoking save eligibility. */
  disableWrite(): void {
    this.#patch({ canWrite: false });
  }
  /** Adopt saved contents/token without allowing earlier reads to overwrite them. */
  saved(replacement: HostFileContent, etag: string): void {
    const data = this.#snapshot.data;
    const opening = this.#store.state();
    if (opening.status !== "file") return;
    const uri = opening.file.resourceUri;
    const metadata = {
      uri,
      writable: data?.writable ?? this.#store.writable,
      ...(data?.mimeType !== undefined && { mimeType: data.mimeType }),
    };
    this.#patch({
      data: { ...metadata, ...replacement, etag },
      status: "ready",
      error: undefined,
      canWrite: this.#store.writable,
    });
  }
  #assertActive(generation: number): void {
    if (
      !this.#active ||
      this.#store.disposed ||
      generation !== this.#generation
    )
      throw new Error(
        "Host file operation belongs to an inactive View lifetime"
      );
  }

  /** Read the exact opening URI, ignoring stale lifetime/version completions. */
  refresh = async (): Promise<HostFileData> => {
    const generation = this.#generation;
    this.#assertActive(generation);
    const state = this.#store.state();
    if (state.status !== "file")
      throw new Error("No supported opening file is available");
    const uri = state.file.resourceUri;
    const id = ++this.#readId;
    const saveRevision = this.#store.saveRevision;
    const readSequence = this.#store.beginRead();
    this.#patch({
      isRefreshing: true,
      error: undefined,
      status: this.#snapshot.data ? this.#snapshot.status : "loading",
    });
    try {
      const app = await this.#store.app();
      this.#assertActive(generation);
      const representation = this.#options.representation;
      const result = await app.request(
        {
          method: "resources/read",
          params: {
            uri,
            ...(representation !== undefined && {
              _meta: { [RESOURCE_EXTENSION]: { representation } },
            }),
          },
        },
        hostResultSchema
      );
      this.#assertActive(generation);
      if (!Array.isArray(result.contents))
        throw new Error("Malformed host resource read result");
      const item = record(
        result.contents.find((item: unknown) => record(item)?.uri === uri)
      );
      if (!item)
        throw new Error("Host resource read did not return the opened URI");
      if (item.mimeType !== undefined && typeof item.mimeType !== "string")
        throw new Error("Malformed host resource MIME type");
      const metadata = record(record(item._meta)?.[RESOURCE_EXTENSION]);
      const data: HostFileData = {
        uri,
        ...(item.mimeType !== undefined && { mimeType: item.mimeType }),
        ...content(item),
        writable: metadata?.writable === true,
        ...(typeof metadata?.etag === "string" && { etag: metadata.etag }),
      };
      if (id === this.#readId && saveRevision === this.#store.saveRevision) {
        this.#store.permission(data, readSequence);
        this.#patch({
          data,
          status: "ready",
          error: undefined,
          isRefreshing: false,
          canWrite: this.#store.writable,
        });
      } else if (id === this.#readId) this.#patch({ isRefreshing: false });
      return data;
    } catch (error) {
      if (
        this.#active &&
        generation === this.#generation &&
        id === this.#readId &&
        saveRevision === this.#store.saveRevision
      ) {
        this.#store.invalidate();
        this.#patch({
          status: "error",
          error: failure(error),
          isRefreshing: false,
          canWrite: false,
        });
      } else if (
        this.#active &&
        generation === this.#generation &&
        id === this.#readId
      )
        this.#patch({ isRefreshing: false });
      throw error;
    }
  };

  /** Guard and queue a copied replacement/token for the current opening lifetime. */
  write = (
    input: HostFileContent,
    options: { ifMatch: string }
  ): Promise<ResourceWriteResult> => {
    // Copy the payload/token now so mutation while queued cannot change the request.
    let replacement: HostFileContent;
    try {
      replacement = content(input);
    } catch (error) {
      return Promise.reject(error);
    }
    const ifMatch = options?.ifMatch;
    if (!nonEmpty(ifMatch))
      return Promise.reject(
        new Error("Host file writes require an explicit non-empty ifMatch ETag")
      );
    const generation = this.#generation;
    return this.#store.enqueueWrite(async () => {
      this.#assertActive(generation);
      const app = await this.#store.app();
      this.#assertActive(generation);
      const state = this.#store.state();
      const data = this.#snapshot.data;
      if (
        state.status !== "file" ||
        !data ||
        data.uri !== state.file.resourceUri ||
        !this.#snapshot.canWrite ||
        !this.#store.writable ||
        !data.writable ||
        !nonEmpty(data.etag)
      )
        throw new Error("The opened host file has no valid writable snapshot");
      const fence = this.#store.saveFence();
      try {
        const result = writeResult(
          await app.request(
            {
              method: "openai/resources/write",
              params: { uri: state.file.resourceUri, ...replacement, ifMatch },
            },
            hostResultSchema
          )
        );
        this.#assertActive(generation);
        if (result.outcome === "saved")
          this.#store.saved(replacement, result.etag, fence);
        else if (result.outcome === "conflict") this.#store.invalidate();
        return result;
      } catch (error) {
        if (
          this.#active &&
          generation === this.#generation &&
          !this.#store.disposed
        ) {
          this.#store.invalidate();
          this.#patch({ error: failure(error), canWrite: false });
        }
        throw error;
      }
    });
  };
}
