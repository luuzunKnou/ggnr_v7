declare module 'archiver' {
  import type { Readable } from 'node:stream';

  interface EntryData {
    name?: string;
    date?: Date | string;
    mode?: number;
    prefix?: string;
    stats?: unknown;
  }

  type AppendSource = Buffer | Readable | string;

  interface Archiver {
    pipe<T extends NodeJS.WritableStream>(destination: T): T;
    directory(path: string, destPath?: string | false, data?: EntryData): this;
    file(path: string, data?: EntryData): this;
    append(source: AppendSource, data?: EntryData): this;
    glob(pattern: string, options?: Record<string, unknown>, data?: EntryData): this;
    symlink(filepath: string, target: string, mode?: number): this;
    finalize(): Promise<void>;
    abort(): this;
    pointer(): number;
    on(event: string, listener: (...args: unknown[]) => void): this;
  }
  function archiver(format: string, options?: Record<string, unknown>): Archiver;
  export = archiver;
}
