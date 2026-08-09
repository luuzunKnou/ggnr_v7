/** 스키마 dry-run 미리보기 (모달·API 공용) */
export type SchemaSyncSqlCategory = 'create' | 'drop' | 'delete' | 'alter';

export type SchemaSyncPreviewItem = {
  category: SchemaSyncSqlCategory;
  sql: string;
  summary: string;
};

export type SchemaSyncPreviewResult = {
  ok: boolean;
  error?: string;
  counts: {
    create: number;
    drop: number;
    delete: number;
    alter: number;
  };
  items: SchemaSyncPreviewItem[];
  warnings: string[];
  hasDataLoss: boolean;
};
