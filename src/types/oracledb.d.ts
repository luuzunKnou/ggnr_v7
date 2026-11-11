declare module 'oracledb' {
  export interface Connection {
    execute(
      sql: string,
      binds?: Record<string, string | number>,
      options?: { outFormat?: number }
    ): Promise<{ rows?: Record<string, unknown>[] }>;
    close(): Promise<void>;
  }

  export interface Pool {
    getConnection(): Promise<Connection>;
    close(drainTime?: number): Promise<void>;
  }

  export interface PoolAttributes {
    user?: string;
    password?: string;
    connectString?: string;
    poolMin?: number;
    poolMax?: number;
    poolIncrement?: number;
    poolTimeout?: number;
    connectTimeout?: number;
    stmtCacheSize?: number;
  }

  export const OUT_FORMAT_OBJECT: number;
  export function createPool(poolAttrs: PoolAttributes): Promise<Pool>;

  const oracledb: {
    OUT_FORMAT_OBJECT: number;
    createPool(poolAttrs: PoolAttributes): Promise<Pool>;
  };
  export default oracledb;
}
