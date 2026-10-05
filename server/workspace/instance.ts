// Purpose: Own on-demand directory/file access, scoped observations and serialized mutations.
import { createHash, randomUUID } from "node:crypto";
import { lstat } from "node:fs/promises";
import path from "node:path";
import {
  Deferred,
  Effect,
  FileSystem,
  Schema,
  Semaphore,
  Stream,
  RcMap,
  type Scope,
} from "effect";
import { Events } from "@openchart/server/events";
import { builtinIndicatorPaths } from "@openchart/server/indicators/catalog";
import type { WorkspaceId } from "@openchart/server/resources/workspace/entity";
import {
  EntryMissing,
  EntryStale,
  WorkspaceClosed,
  WorkspaceFileProtected,
  WorkspaceMissing,
  WorkspaceMediaTooLarge,
  WorkspacePathInvalid,
  WorkspaceReadFailed,
  WorkspaceWriteFailed,
} from "./errors";
import { WorkspaceChanged } from "./events";
import {
  RelativePath,
  RelPath,
  assetMediaType,
  WORKSPACE_MEDIA_MAX_BYTES,
  type DirectoryPath,
  type Entry,
  type WatchTarget,
  type Snapshot,
} from "./contract";
import { prepareDefaultDirectory } from "@openchart/server/resources/workspace/transitions/ensure-default";

import { makeDirectoryObservations } from "./directory-observation";

const hash = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

/**
 * One acquired directory; the registry Scope owns its watcher and lifetime.
 * Paths must already be decoded as {@link RelativePath} or {@link RelPath}. Operations fail with
 * {@link WorkspaceClosed} after retirement; closing never deletes user files.
 * Mutations serialize within this backend, but external editors share no lock.
 */
export interface Workspace {
  readonly id: WorkspaceId;
  readonly root: string;

  /**
   * Recursively lists flat file and directory paths. Never reads content or
   * installs recursive watchers. Missing or unreadable directories are represented
   * by the snapshot status.
   * @example yield* workspace.listTree;
   */
  readonly listTree: Effect.Effect<
    Snapshot,
    WorkspaceClosed | WorkspaceReadFailed
  >;

  /**
   * Lists one directory; child contents stay unloaded. Missing or unreadable
   * directories are represented by the snapshot status.
   * @example yield* workspace.listDirectory("");
   */
  readonly listDirectory: (
    directory: DirectoryPath,
  ) => Effect.Effect<Snapshot, WorkspaceClosed | WorkspaceReadFailed>;

  /**
   * Watches data interests until their consumer or workspace closes.
   * Emits the initial directory revision and subsequent invalidations; file
   * interests share their parent directory's notifications.
   * @example workspace.watch({ kind: "file", path });
   */
  readonly watch: (
    target: WatchTarget,
  ) => Stream.Stream<number, WorkspaceClosed | WorkspaceReadFailed>;

  /**
   * Creates a directory and missing parents; existing directories succeed
   * without changes. Files and symlinks are rejected.
   * @example yield* workspace.mkdir(relative);
   */
  readonly mkdir: (
    relative: RelativePath,
  ) => Effect.Effect<
    void,
    | WorkspaceClosed
    | WorkspaceReadFailed
    | WorkspacePathInvalid
    | WorkspaceMissing
    | WorkspaceWriteFailed
  >;

  /**
   * Reads fresh Base64 bytes, MIME and hash with the readOnly mutation policy.
   * Consumers decode text; absent files fail with EntryMissing and media above
   * 32 MiB fails with WorkspaceMediaTooLarge.
   * @example yield* workspace.read(relative);
   */
  readonly read: (relative: RelPath) => Effect.Effect<
    {
      entry: Entry;
      mediaType: string;
      readOnly: boolean;
      base64: string;
    },
    | WorkspaceClosed
    | WorkspaceReadFailed
    | WorkspacePathInvalid
    | WorkspaceMissing
    | EntryMissing
    | WorkspaceMediaTooLarge
  >;

  /**
   * Atomically replaces one file after its content comparison; null requires
   * an absent target. Built-in originals reject writes. Mismatches fail with
   * EntryStale; returns committed metadata.
   * @example yield* workspace.write(relative, 'close', null);
   */
  readonly write: (
    relative: RelPath,
    text: string,
    expected: string | null,
  ) => Effect.Effect<
    Entry,
    | WorkspaceClosed
    | WorkspaceReadFailed
    | WorkspacePathInvalid
    | WorkspaceMissing
    | WorkspaceWriteFailed
    | WorkspaceMediaTooLarge
    | WorkspaceFileProtected
    | EntryStale
  >;

  /**
   * Internal installation for canonical built-ins: writes `text` unless the
   * original already holds exactly it, so originals follow the bundled text.
   * Never exposed over RPC.
   * @example yield* workspace.installBuiltin(relative, source);
   */
  readonly installBuiltin: (
    relative: RelPath,
    text: string,
  ) => Effect.Effect<
    Entry,
    | WorkspaceClosed
    | WorkspaceReadFailed
    | WorkspacePathInvalid
    | WorkspaceMissing
    | WorkspaceWriteFailed
    | WorkspaceMediaTooLarge
    | EntryStale
  >;

  /**
   * Built-in originals reject removal. Other missing files are already removed;
   * existing content requires its hash or fails with EntryStale.
   * @example yield* workspace.remove(relative, hash);
   */
  readonly remove: (
    relative: RelPath,
    expected: string,
  ) => Effect.Effect<
    void,
    | WorkspaceClosed
    | WorkspaceReadFailed
    | WorkspacePathInvalid
    | WorkspaceMissing
    | WorkspaceWriteFailed
    | WorkspaceMediaTooLarge
    | WorkspaceFileProtected
    | EntryStale
  >;

  /**
   * Renames one artifact without overwriting an observed target. Changed source
   * content or an existing target fails with EntryStale; returns the new metadata.
   * Built-in original paths reject rename in either direction.
   * @example yield* workspace.rename(from, to, hash);
   */
  readonly rename: (
    from: RelPath,
    to: RelPath,
    expected: string,
  ) => Effect.Effect<
    Entry,
    | WorkspaceClosed
    | WorkspaceReadFailed
    | WorkspacePathInvalid
    | WorkspaceMissing
    | WorkspaceWriteFailed
    | EntryMissing
    | WorkspaceMediaTooLarge
    | WorkspaceFileProtected
    | EntryStale
  >;
}

/**
 * Acquire a directory until its Scope closes. Closing stops admission, drains
 * admitted mutations and ends subscriptions; it never removes user files.
 * Registration checks run at admission so delayed invalidations cannot reopen a forgotten root.
 * @example const workspace = yield* makeWorkspace(id, root, false, assertRegistered);
 */
export const makeWorkspace = Effect.fn("Workspace.acquire")(function* (
  id: WorkspaceId,
  root: string,
  isDefault: boolean,
  assertRegistered: Effect.Effect<void, WorkspaceClosed | WorkspaceReadFailed>,
): Effect.fn.Return<
  Workspace,
  never,
  FileSystem.FileSystem | Events.Service | Scope.Scope
> {
  const fs = yield* FileSystem.FileSystem;
  const events = yield* Events.Service;
  const mutex = yield* Semaphore.make(1);
  const stopped = yield* Deferred.make<void>();
  let closed = false;

  const notify = Effect.asVoid(events.publish(WorkspaceChanged, {}));
  const info = (filename: string) =>
    Effect.tryPromise({
      try: () =>
        lstat(filename).catch((cause: NodeJS.ErrnoException) => {
          if (cause.code === "ENOENT") return undefined;
          throw cause;
        }),
      catch: (cause) =>
        new WorkspaceReadFailed({ workspaceId: id, path: filename, cause }),
    });
  const checkRoot = Effect.gen(function* () {
    const value = yield* info(root);
    if (!value) return yield* new WorkspaceMissing({ workspaceId: id });
    if (value.isSymbolicLink() || !value.isDirectory())
      return yield* new WorkspacePathInvalid({ workspaceId: id, path: "" });
    const canonical = yield* fs
      .realPath(root)
      .pipe(
        Effect.mapError(
          (cause) =>
            new WorkspaceReadFailed({ workspaceId: id, path: "", cause }),
        ),
      );
    if (canonical !== root)
      return yield* new WorkspacePathInvalid({ workspaceId: id, path: "" });
    return value;
  });
  const checkedPath = Effect.fn("Workspace.path")(function* (
    relative: RelativePath,
    kind: "file" | "directory" = "file",
  ) {
    const destination = path.resolve(root, relative);
    const contained = path.relative(root, destination);
    if (
      !contained ||
      contained === ".." ||
      contained.startsWith(`..${path.sep}`) ||
      path.isAbsolute(contained)
    )
      return yield* new WorkspacePathInvalid({
        workspaceId: id,
        path: relative,
      });
    yield* checkRoot;
    let filename = root;
    const parts = relative.split("/");
    // Filesystem state is untrusted even after the wire path has been parsed.
    for (const [index, part] of parts.entries()) {
      filename = path.join(filename, part);
      const value = yield* info(filename);
      if (!value) break;
      if (
        value.isSymbolicLink() ||
        (index < parts.length - 1 || kind === "directory"
          ? !value.isDirectory()
          : !value.isFile())
      )
        return yield* new WorkspacePathInvalid({
          workspaceId: id,
          path: relative,
        });
    }
    return path.join(root, ...parts);
  });
  const readCurrent = Effect.fn("Workspace.readCurrent")(function* (
    relative: RelPath,
  ) {
    const filename = yield* checkedPath(relative);
    const read = Effect.gen(function* () {
      if (assetMediaType(relative) === undefined)
        return yield* fs.readFile(filename);
      const tooLarge = () =>
        new WorkspaceMediaTooLarge({
          workspaceId: id,
          path: relative,
          maxBytes: WORKSPACE_MEDIA_MAX_BYTES,
        });
      const stat = yield* fs.stat(filename);
      if (stat.size > WORKSPACE_MEDIA_MAX_BYTES) return yield* tooLarge();
      // A writer can grow the file after stat; cap the actual read as well.
      const chunks = yield* Stream.runCollect(
        fs.stream(filename, {
          bytesToRead: WORKSPACE_MEDIA_MAX_BYTES + 1,
        }),
      );
      const size = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
      if (size > WORKSPACE_MEDIA_MAX_BYTES) return yield* tooLarge();
      return Buffer.concat(chunks, size);
    });
    const bytes = yield* read.pipe(
      Effect.catchTag("PlatformError", (cause) =>
        cause.reason._tag === "NotFound"
          ? Effect.succeed(undefined)
          : Effect.fail(
              new WorkspaceReadFailed({
                workspaceId: id,
                path: relative,
                cause,
              }),
            ),
      ),
    );
    if (!bytes) return undefined;
    return { entry: { path: relative, hash: hash(bytes) }, bytes };
  });
  const directoryPath = Effect.fn("Workspace.directoryPath")(function* (
    relative: DirectoryPath,
  ) {
    if (relative === "") {
      yield* checkRoot;
      return root;
    }
    return yield* checkedPath(relative, "directory");
  });
  const observations = yield* makeDirectoryObservations(id, root, (relative) =>
    Effect.gen(function* () {
      if (isDefault)
        yield* prepareDefaultDirectory(root).pipe(
          Effect.provideService(FileSystem.FileSystem, fs),
        );
      const filename = yield* directoryPath(relative);
      const value = yield* info(filename);
      if (!value) return yield* new WorkspaceMissing({ workspaceId: id });
      return value;
    }),
  );
  const listing = Effect.fn("Workspace.listing")(function* (
    directory: DirectoryPath,
    recursive: boolean,
  ) {
    const entries: Array<{ path: RelPath }> = [];
    const directories: RelativePath[] = [];
    const pending: DirectoryPath[] = [directory];
    for (let index = 0; index < pending.length; index++) {
      const parent = pending[index]!;
      const filename = yield* directoryPath(parent);
      const names = yield* fs.readDirectory(filename);
      for (const name of names.sort()) {
        const relative = parent === "" ? name : `${parent}/${name}`;
        if (!Schema.is(RelativePath)(relative)) continue;
        const stat = yield* info(path.join(root, relative));
        if (!stat || stat.isSymbolicLink()) continue;
        if (stat.isDirectory()) {
          directories.push(relative);
          if (recursive) pending.push(relative);
        } else if (
          stat.isFile() &&
          Schema.is(RelPath)(relative) &&
          (assetMediaType(relative) === undefined ||
            stat.size <= WORKSPACE_MEDIA_MAX_BYTES)
        ) {
          entries.push({ path: relative });
        }
      }
    }
    entries.sort((a, b) => a.path.localeCompare(b.path));
    directories.sort();
    return { status: "ready" as const, entries, directories };
  });
  const snapshot = (directory: DirectoryPath, recursive: boolean) =>
    listing(directory, recursive).pipe(
      Effect.catch((error) =>
        Effect.succeed<Snapshot>(
          error instanceof WorkspaceMissing ||
            (error._tag === "PlatformError" && error.reason._tag === "NotFound")
            ? { status: "missing" }
            : {
                status: "unavailable",
                reason: "Unable to read this workspace directory.",
              },
        ),
      ),
    );
  yield* Effect.addFinalizer(() =>
    Effect.gen(function* () {
      closed = true;
      yield* mutex.withPermits(1)(Effect.void);
      yield* Deferred.succeed(stopped, undefined);
    }),
  );

  const requireOpen = Effect.suspend(() =>
    closed
      ? Effect.fail(new WorkspaceClosed({ workspaceId: id }))
      : assertRegistered,
  );
  const admit = <A, E>(operation: Effect.Effect<A, E>, mutation = false) =>
    mutex.withPermits(1)(
      Effect.suspend(() => {
        if (closed)
          return Effect.fail(new WorkspaceClosed({ workspaceId: id }));
        const admitted = Effect.andThen(assertRegistered, operation);
        return mutation ? Effect.uninterruptible(admitted) : admitted;
      }),
    );
  const compare = Effect.fn("Workspace.compare")(function* (
    relative: RelPath,
    expected: string | null,
  ) {
    const item = yield* readCurrent(relative);
    if ((item?.entry.hash ?? null) !== expected)
      return yield* new EntryStale({
        workspaceId: id,
        path: relative,
        current: item?.entry ?? null,
      });
    return item;
  });
  const committed = notify;
  const isReadOnly = (relative: RelPath) =>
    isDefault && builtinIndicatorPaths.has(relative.toLowerCase());
  const writeText = Effect.fn("Workspace.writeText")(function* (
    relative: RelPath,
    text: string,
    expected: string | null,
  ) {
    if (assetMediaType(relative))
      return yield* new WorkspacePathInvalid({
        workspaceId: id,
        path: relative,
      });
    yield* compare(relative, expected);
    const filename = yield* checkedPath(relative);
    const temporary = path.join(
      path.dirname(filename),
      `.${path.basename(filename)}.${randomUUID()}.tmp`,
    );
    yield* Effect.gen(function* () {
      yield* fs.makeDirectory(path.dirname(filename), {
        recursive: true,
      });
      yield* fs.writeFileString(temporary, text, {
        flag: "wx",
        mode: 0o600,
      });
      yield* fs.rename(temporary, filename);
    }).pipe(
      Effect.mapError(
        (cause) =>
          new WorkspaceWriteFailed({
            workspaceId: id,
            path: relative,
            cause,
          }),
      ),
      Effect.ensuring(Effect.ignore(fs.remove(temporary, { force: true }))),
    );
    yield* committed;
    return { path: relative, hash: hash(new TextEncoder().encode(text)) };
  });
  return {
    id,
    root,
    listTree: Effect.andThen(requireOpen, snapshot("", true)),
    listDirectory: (directory: DirectoryPath) =>
      Effect.andThen(requireOpen, snapshot(directory, false)),
    watch: (target: WatchTarget) =>
      Stream.unwrap(
        Effect.gen(function* () {
          if (closed) return yield* new WorkspaceClosed({ workspaceId: id });
          yield* assertRegistered;
          const directory =
            target.kind === "directory"
              ? target.path
              : (target.path
                  .split("/")
                  .slice(0, -1)
                  .join("/") as DirectoryPath);
          return yield* RcMap.get(observations, directory);
        }),
      ).pipe(Stream.interruptWhen(Deferred.await(stopped))),
    mkdir: (relative: RelativePath) =>
      admit(
        Effect.gen(function* () {
          const directory = yield* checkedPath(relative, "directory");
          yield* fs.makeDirectory(directory, { recursive: true }).pipe(
            Effect.mapError(
              (cause) =>
                new WorkspaceWriteFailed({
                  workspaceId: id,
                  path: relative,
                  cause,
                }),
            ),
          );
          yield* committed;
        }),
        true,
      ),
    read: (relative: RelPath) =>
      admit(
        Effect.gen(function* () {
          const item = yield* readCurrent(relative);
          if (!item)
            return yield* new EntryMissing({ workspaceId: id, path: relative });
          return {
            entry: item.entry,
            mediaType: assetMediaType(relative) ?? "text/plain",
            readOnly: isReadOnly(relative),
            base64: Buffer.from(item.bytes).toString("base64"),
          };
        }),
      ),
    write: (relative: RelPath, text: string, expected: string | null) =>
      admit(
        Effect.gen(function* () {
          if (isReadOnly(relative))
            return yield* new WorkspaceFileProtected({
              workspaceId: id,
              path: relative,
            });
          return yield* writeText(relative, text, expected);
        }),
        true,
      ),
    installBuiltin: (relative: RelPath, text: string) =>
      admit(
        Effect.gen(function* () {
          if (!isDefault || !builtinIndicatorPaths.has(relative))
            return yield* new WorkspacePathInvalid({
              workspaceId: id,
              path: relative,
            });
          const existing = yield* readCurrent(relative);
          return existing?.entry.hash === hash(new TextEncoder().encode(text))
            ? existing.entry
            : yield* writeText(relative, text, existing?.entry.hash ?? null);
        }),
        true,
      ),
    remove: (relative: RelPath, expected: string) =>
      admit(
        Effect.gen(function* () {
          if (isReadOnly(relative))
            return yield* new WorkspaceFileProtected({
              workspaceId: id,
              path: relative,
            });
          const item = yield* readCurrent(relative);
          if (!item) return;
          if (item.entry.hash !== expected)
            return yield* new EntryStale({
              workspaceId: id,
              path: relative,
              current: item.entry,
            });
          yield* fs.remove(yield* checkedPath(relative), { force: true }).pipe(
            Effect.mapError(
              (cause) =>
                new WorkspaceWriteFailed({
                  workspaceId: id,
                  path: relative,
                  cause,
                }),
            ),
          );
          yield* committed;
        }),
        true,
      ).pipe(Effect.asVoid),
    rename: (from: RelPath, to: RelPath, expected: string) =>
      admit(
        Effect.gen(function* () {
          if (isReadOnly(from) || isReadOnly(to))
            return yield* new WorkspaceFileProtected({
              workspaceId: id,
              path: isReadOnly(from) ? from : to,
            });
          const item = yield* compare(from, expected);
          if (!item)
            return yield* new EntryMissing({ workspaceId: id, path: from });
          yield* compare(to, null);
          const source = yield* checkedPath(from);
          const target = yield* checkedPath(to);
          yield* fs
            .makeDirectory(path.dirname(target), { recursive: true })
            .pipe(
              Effect.andThen(fs.rename(source, target)),
              Effect.mapError(
                (cause) =>
                  new WorkspaceWriteFailed({
                    workspaceId: id,
                    path: from,
                    cause,
                  }),
              ),
            );
          yield* committed;
          return { path: to, hash: item.entry.hash };
        }),
        true,
      ),
  };
});
