declare module 'archiver' {
  interface Archiver {
    pipe<T extends NodeJS.WritableStream>(destination: T): T;
    directory(path: string, destPath?: string | false): this;
    file(path: string, data?: { name?: string }): this;
    finalize(): Promise<void>;
    on(event: string, listener: (...args: unknown[]) => void): this;
  }
  function archiver(format: string, options?: Record<string, unknown>): Archiver;
  export = archiver;
}
