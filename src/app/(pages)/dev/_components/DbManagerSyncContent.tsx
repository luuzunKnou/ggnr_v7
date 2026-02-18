"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/app/shadcnComponents/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/app/shadcnComponents/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/app/shadcnComponents/ui/dialog";
import { Input } from "@/app/shadcnComponents/ui/input";
import { call } from "@/lib/api";

type DbConnection = {
  host: string;
  port: string;
  database: string;
  username: string;
  password: string;
};

type SchemaTable = { schema: string; table: string };

type TableComparison = {
  definedTables: SchemaTable[];
  actualTables: SchemaTable[];
  onlyInSchema: SchemaTable[];
  onlyInDb: SchemaTable[];
  inBoth: SchemaTable[];
};

type SchemaSyncTableRow = {
  schema: string;
  table: string;
  status: "only_in_schema" | "in_both";
  definedColumnCount: number;
  actualColumnCount: number | null;
  columnsMatch: boolean | null;
  columnsMatchReason: string | null;
  tableComment: string | null;
  tableType?: string;
};

type ColumnComparison = {
  schema: string;
  table: string;
  definedColumns: { name: string; type: string; notNull: boolean; comment?: string }[];
  actualColumns: { name: string; type: string; notNull: boolean }[];
  toAdd: { name: string; type: string; notNull: boolean; comment?: string }[];
  toRemove: { name: string; type: string; notNull: boolean }[];
  toModify: Array<{ name: string; defined: { name: string; type: string; notNull: boolean; comment?: string }; actual: { name: string; type: string; notNull: boolean } }>;
  same: { name: string; type: string; notNull: boolean; comment?: string }[];
  primaryKeyColumns?: string[];
  /** DB에 실제 설정된 PK 컬럼 (없으면 []) */
  actualPrimaryKeyColumns?: string[];
};

type SyncReportItem = {
  schema: string;
  table: string;
  action: string;
  detail?: string;
  columnsAdded?: string[];
  columnsDropped?: string[];
  error?: string;
};

/** 4단계 레포트: 2·3단계에서 실행한 동기화 결과 한 건 */
type SyncReportLogEntry = {
  id: string;
  step: 2 | 3;
  title: string;
  description: string;
  executedSql: string[];
  results: SyncReportItem[];
  timestamp: string;
};

const STEPS = [
  "DB 연결",
  "테이블 목록 비교 및 생성할 테이블 선택",
  "필드 비교 및 업데이트할 필드 선택",
  "실행 결과 레포트",
] as const;

function Field({
  id,
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  disabled,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: React.HTMLInputTypeAttribute;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="text-sm font-medium text-slate-700">
        {label}
      </label>
      <Input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        type={type}
        className="rounded-none"
        disabled={disabled}
      />
    </div>
  );
}

export function DbManagerSyncContent({ onBack }: { onBack?: () => void }) {
  const [step, setStep] = useState(1);

  const [conn, setConn] = useState<DbConnection>({
    host: "",
    port: "5432",
    database: "",
    username: "",
    password: "",
  });
  const [isConnecting, setIsConnecting] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);

  const [comparison, setComparison] = useState<TableComparison | null>(null);
  const [tableList, setTableList] = useState<SchemaSyncTableRow[] | null>(null);
  const [isComparing, setIsComparing] = useState(false);
  const [compareError, setCompareError] = useState<string | null>(null);

  const [tablesToCreate, setTablesToCreate] = useState<SchemaTable[]>([]);
  const [tablesToSync, setTablesToSync] = useState<SchemaTable[]>([]);

  const [columnDiffs, setColumnDiffs] = useState<Record<string, ColumnComparison | null>>({});
  const [loadingColumn, setLoadingColumn] = useState<string | null>(null);
  const [columnsToAdd, setColumnsToAdd] = useState<Record<string, string[]>>({});

  const [isApplying, setIsApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);

  /** 4단계: 2·3단계에서 실행한 동기화 결과 로그 (설명 + 쿼리) */
  const [syncReportLog, setSyncReportLog] = useState<SyncReportLogEntry[]>([]);

  const [isCreatingAll, setIsCreatingAll] = useState(false);
  const [creatingTableKey, setCreatingTableKey] = useState<string | null>(null);
  const [syncingTableKey, setSyncingTableKey] = useState<string | null>(null);
  /** 3단계: 행 단위 "_all" | `${tableKey}-${fieldName}` */
  const [step3Syncing, setStep3Syncing] = useState<string | null>(null);
  /** 3단계: PK 동기화 중인 테이블 (schema.table) */
  const [step3PkSyncing, setStep3PkSyncing] = useState<string | null>(null);

  /** 불일치 항목만 표시 (2·3단계 테이블) — 기본값: 체크 */
  const [showOnlyMismatch, setShowOnlyMismatch] = useState(true);

  /** 3단계 검사 시 필드 비교 재로드 트리거 */
  const [step3RefreshCounter, setStep3RefreshCounter] = useState(0);

  /** 2·3단계 동기화 시 실행된 SQL 리포트 (다이얼로그 표시용) */
  const [syncReportSql, setSyncReportSql] = useState<string[] | null>(null);

  const canConnect = Boolean(
    conn.host.trim() && conn.port.trim() && conn.database.trim() && conn.username.trim()
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await call("", "POST", {
          service: "dbManagerService",
          action: "getDefaultDbConfig",
          params: {},
        });
        if (cancelled || !response?.success || !response?.data) return;
        const d = response.data;
        setConn((prev) => ({
          ...prev,
          host: d.host ?? prev.host,
          port: d.port ?? prev.port,
          database: d.database ?? prev.database,
          username: d.username ?? prev.username,
          password: d.password ?? prev.password,
        }));
      } catch {
        // 무시
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const params = useMemo(
    () => ({
      host: conn.host.trim(),
      port: conn.port.trim(),
      database: conn.database.trim(),
      username: conn.username.trim(),
      password: conn.password || undefined,
    }),
    [conn]
  );

  const connect = async () => {
    setConnectError(null);
    setIsConnecting(true);
    setIsConnected(false);
    setComparison(null);
    try {
      const response = await call("", "POST", {
        service: "dbManagerService",
        action: "testConnection",
        params,
      });
      if (!response?.success) throw new Error(response?.error || "Connection failed");
      setIsConnected(true);
      setStep(2);
    } catch (e: any) {
      setConnectError(e?.error || e?.message || "Connection failed");
      setIsConnected(false);
    } finally {
      setIsConnecting(false);
    }
  };

  const disconnect = () => {
    setIsConnected(false);
    setConnectError(null);
    setComparison(null);
    setStep(1);
  };

  const runCompare = async () => {
    setCompareError(null);
    setIsComparing(true);
    setComparison(null);
    setTableList(null);
    try {
      const response = await call("", "POST", {
        service: "dbManagerService",
        action: "getSchemaSyncTableList",
        params,
      });
      if (!response?.success) throw new Error(response?.error || "Compare failed");
      const rows: SchemaSyncTableRow[] = response.data?.tables ?? [];
      setTableList(rows);
      const onlyInSchema = rows.filter((r) => r.status === "only_in_schema").map((r) => ({ schema: r.schema, table: r.table }));
      const inBoth = rows.filter((r) => r.status === "in_both").map((r) => ({ schema: r.schema, table: r.table }));
      setComparison({
        definedTables: rows.map((r) => ({ schema: r.schema, table: r.table })),
        actualTables: [],
        onlyInSchema,
        onlyInDb: [],
        inBoth,
      });
      setTablesToCreate([]);
      setTablesToSync(inBoth);
    } catch (e: any) {
      setCompareError(e?.error || e?.message || "Compare failed");
    } finally {
      setIsComparing(false);
    }
  };

  const goToStep2 = () => {
    setCompareError(null);
    setStep(2);
  };

  useEffect(() => {
    if (step === 2 && isConnected && !comparison && !isComparing) runCompare();
  }, [step, isConnected]);

  /** 3단계 진입 시 동기화할 테이블들의 필드 비교 자동 로드 */
  useEffect(() => {
    if (step !== 3 || tablesToSync.length === 0) return;
    let cancelled = false;
    const toLoad = tablesToSync.filter((t) => columnDiffs[`${t.schema}.${t.table}`] === undefined);
    if (toLoad.length === 0) return;
    setLoadingColumn(toLoad.length === 1 ? `${toLoad[0].schema}.${toLoad[0].table}` : "_all");
    (async () => {
      const results = await Promise.all(
        toLoad.map(async (t) => {
          const key = `${t.schema}.${t.table}`;
          try {
            const response = await call("", "POST", {
              service: "dbManagerService",
              action: "getTableColumnComparison",
              params: { ...params, schema: t.schema, table: t.table },
            });
            if (cancelled) return { key, diff: null as ColumnComparison | null };
            if (response?.success && response?.data) return { key, diff: response.data as ColumnComparison };
            return { key, diff: null };
          } catch {
            return { key, diff: null };
          }
        })
      );
      if (cancelled) return;
      setColumnDiffs((prev) => {
        const next = { ...prev };
        for (const { key, diff } of results) {
          next[key] = diff;
        }
        return next;
      });
      setColumnsToAdd((prev) => {
        let next = { ...prev };
        for (const { key, diff } of results) {
          if (diff?.toAdd?.length) {
            next[key] = (diff.toAdd as { name: string }[]).map((c) => c.name);
          }
        }
        return next;
      });
      setLoadingColumn(null);
    })();
    return () => {
      cancelled = true;
    };
  }, [step, tablesToSync.length, step3RefreshCounter]);

  const loadColumnDiff = async (schema: string, table: string) => {
    const key = `${schema}.${table}`;
    setLoadingColumn(key);
    try {
      const response = await call("", "POST", {
        service: "dbManagerService",
        action: "getTableColumnComparison",
        params: { ...params, schema, table },
      });
      if (!response?.success) throw new Error(response?.error || "Column compare failed");
      const diff = response.data;
      setColumnDiffs((prev) => ({ ...prev, [key]: diff }));
      if (diff?.toAdd?.length) {
        setColumnsToAdd((prev) => ({
          ...prev,
          [key]: (diff.toAdd as { name: string }[]).map((c) => c.name),
        }));
      }
    } catch {
      setColumnDiffs((prev) => ({ ...prev, [key]: null }));
    } finally {
      setLoadingColumn(null);
    }
  };

  const toggleTableToCreate = (t: SchemaTable) => {
    const key = `${t.schema}.${t.table}`;
    setTablesToCreate((prev) =>
      prev.some((x) => `${x.schema}.${x.table}` === key)
        ? prev.filter((x) => `${x.schema}.${x.table}` !== key)
        : [...prev, t]
    );
  };

  const onlyInSchemaTables = useMemo(
    () => tableList?.filter((r) => r.status === "only_in_schema").map((r) => ({ schema: r.schema, table: r.table })) ?? [],
    [tableList]
  );

  /** 코멘트·필드 모두 일치하는 테이블이 없고, 생성할 테이블도 없으면 전체 동기화 비활성화 */
  const hasAnySyncWork = useMemo(
    () => tableList?.some((r) => r.status === "only_in_schema" || r.columnsMatch !== true) ?? false,
    [tableList]
  );

  /** 2·3단계 동기화 후 4단계 레포트 로그에 추가 */
  const pushSyncReportLog = (
    stepLog: 2 | 3,
    title: string,
    description: string,
    data: { executedSql?: string[]; results?: SyncReportItem[] }
  ) => {
    const executedSql = data.executedSql ?? [];
    const results = data.results ?? [];
    if (executedSql.length === 0 && results.length === 0) return;
    setSyncReportLog((prev) => [
      ...prev,
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        step: stepLog,
        title,
        description,
        executedSql,
        results,
        timestamp: new Date().toLocaleString("ko-KR"),
      },
    ]);
  };

  const createTables = async (tables: SchemaTable[]) => {
    if (tables.length === 0) return;
    try {
      const response = await call("", "POST", {
        service: "dbManagerService",
        action: "applySchemaSync",
        params: {
          ...params,
          tablesToCreate: tables,
          tables: [],
          addColumnsOnly: true,
        },
      });
      if (!response?.success) throw new Error(response?.error || "Create failed");
      if (response?.data?.executedSql?.length) setSyncReportSql(response.data.executedSql);
      pushSyncReportLog(
        2,
        "테이블 생성",
        `스키마에만 있던 테이블 생성: ${tables.map((t) => `${t.schema}.${t.table}`).join(", ")}`,
        { executedSql: response.data?.executedSql, results: response.data?.results }
      );
      await runCompare();
    } catch (e: any) {
      setCompareError(e?.error || e?.message || "Create failed");
    }
  };

  /** 2단계 전체 동기화: 스키마에만 있는 테이블 생성 + 양쪽 모두 테이블 코멘트/컬럼 동기화 */
  const handleCreateAll = async () => {
    const hasCreate = onlyInSchemaTables.length > 0;
    const hasSync = tablesToSync.length > 0;
    if (!hasCreate && !hasSync) return;
    setIsCreatingAll(true);
    setCompareError(null);
    try {
      const response = await call("", "POST", {
        service: "dbManagerService",
        action: "applySchemaSync",
        params: {
          ...params,
          tablesToCreate: onlyInSchemaTables,
          tables: tablesToSync,
          addColumnsOnly: true,
          tableCommentOnly: true,
        },
      });
      if (!response?.success) throw new Error(response?.error || "동기화 실패");
      if (response?.data?.executedSql?.length) setSyncReportSql(response.data.executedSql);
      pushSyncReportLog(2, "2단계 전체 동기화", "스키마에만 있는 테이블 생성 + 양쪽 모두 테이블 코멘트·컬럼 동기화", {
        executedSql: response.data?.executedSql,
        results: response.data?.results,
      });
      await runCompare();
    } catch (e: any) {
      setCompareError(e?.error || e?.message || "동기화 실패");
    } finally {
      setIsCreatingAll(false);
    }
  };

  const handleCreateOne = async (schema: string, table: string) => {
    const key = `${schema}.${table}`;
    setCreatingTableKey(key);
    setCompareError(null);
    try {
      await createTables([{ schema, table }]);
    } finally {
      setCreatingTableKey(null);
    }
  };

  /** 양쪽 모두 테이블 1개 동기화 (코멘트 + 컬럼) */
  const handleSyncOne = async (schema: string, table: string) => {
    const key = `${schema}.${table}`;
    setSyncingTableKey(key);
    setCompareError(null);
    try {
      const response = await call("", "POST", {
        service: "dbManagerService",
        action: "applySchemaSync",
        params: {
          ...params,
          tablesToCreate: [],
          tables: [{ schema, table }],
          addColumnsOnly: true,
          tableCommentOnly: true,
        },
      });
      if (!response?.success) throw new Error(response?.error || "동기화 실패");
      if (response?.data?.executedSql?.length) setSyncReportSql(response.data.executedSql);
      pushSyncReportLog(2, "테이블 동기화", `${schema}.${table} 테이블 코멘트·컬럼 동기화`, {
        executedSql: response.data?.executedSql,
        results: response.data?.results,
      });
      await runCompare();
    } catch (e: any) {
      setCompareError(e?.error || e?.message || "동기화 실패");
    } finally {
      setSyncingTableKey(null);
    }
  };

  const toggleColumnToAdd = (tableKey: string, colName: string) => {
    setColumnsToAdd((prev) => {
      const list = prev[tableKey] ?? [];
      const next = list.includes(colName) ? list.filter((c) => c !== colName) : [...list, colName];
      return { ...prev, [tableKey]: next };
    });
  };

  /** 3단계: DB에만 있는 필드 하나 삭제 (동기화 = 스키마에 맞추기) */
  const handleDropOneField = async (tableKey: string, fieldName: string) => {
    const [schema, table] = tableKey.split(".");
    if (!schema || !table) return;
    const rowId = `${tableKey}-${fieldName}`;
    setStep3Syncing(rowId);
    setCompareError(null);
    try {
      const response = await call("", "POST", {
        service: "dbManagerService",
        action: "applySchemaSync",
        params: {
          ...params,
          tablesToCreate: [],
          tables: [{ schema, table }],
          columnsToAddByTable: {},
          columnsToRemoveByTable: { [tableKey]: [fieldName] },
          addColumnsOnly: true,
        },
      });
      if (!response?.success) throw new Error(response?.error || "동기화 실패");
      if (response?.data?.executedSql?.length) setSyncReportSql(response.data.executedSql);
      pushSyncReportLog(3, "컬럼 삭제", `${tableKey}.${fieldName} DB에만 있는 컬럼 삭제`, {
        executedSql: response.data?.executedSql,
        results: response.data?.results,
      });
      const diffRes = await call("", "POST", {
        service: "dbManagerService",
        action: "getTableColumnComparison",
        params: { ...params, schema, table },
      });
      if (diffRes?.success && diffRes?.data) {
        setColumnDiffs((prev) => ({ ...prev, [tableKey]: diffRes.data }));
        const nextToAdd = (diffRes.data.toAdd as { name: string }[]).map((c) => c.name);
        setColumnsToAdd((prev) => ({ ...prev, [tableKey]: nextToAdd }));
      }
    } catch (e: any) {
      setCompareError(e?.error || e?.message || "동기화 실패");
    } finally {
      setStep3Syncing(null);
    }
  };

  /** 3단계: 필드 하나 동기화 (해당 테이블에 해당 컬럼만 추가) */
  const handleSyncOneField = async (tableKey: string, fieldName: string) => {
    const [schema, table] = tableKey.split(".");
    if (!schema || !table) return;
    const rowId = `${tableKey}-${fieldName}`;
    setStep3Syncing(rowId);
    setCompareError(null);
    try {
      const response = await call("", "POST", {
        service: "dbManagerService",
        action: "applySchemaSync",
        params: {
          ...params,
          tablesToCreate: [],
          tables: [{ schema, table }],
          columnsToAddByTable: { [tableKey]: [fieldName] },
          addColumnsOnly: true,
        },
      });
      if (!response?.success) throw new Error(response?.error || "동기화 실패");
      if (response?.data?.executedSql?.length) setSyncReportSql(response.data.executedSql);
      pushSyncReportLog(3, "컬럼 추가", `${tableKey}.${fieldName} 컬럼 추가`, {
        executedSql: response.data?.executedSql,
        results: response.data?.results,
      });
      const diffRes = await call("", "POST", {
        service: "dbManagerService",
        action: "getTableColumnComparison",
        params: { ...params, schema, table },
      });
      if (diffRes?.success && diffRes?.data) {
        setColumnDiffs((prev) => ({ ...prev, [tableKey]: diffRes.data }));
        const nextToAdd = (diffRes.data.toAdd as { name: string }[]).map((c) => c.name);
        setColumnsToAdd((prev) => ({ ...prev, [tableKey]: nextToAdd }));
      }
    } catch (e: any) {
      setCompareError(e?.error || e?.message || "동기화 실패");
    } finally {
      setStep3Syncing(null);
    }
  };

  /** 3단계: 전체 동기화 (선택된 컬럼 추가 + DB에만 있는 컬럼 삭제) */
  const handleSyncAllStep3 = async () => {
    const columnsToRemoveByTable: Record<string, string[]> = {};
    for (const t of tablesToSync) {
      const key = `${t.schema}.${t.table}`;
      const diff = columnDiffs[key];
      const toRemove = (diff?.toRemove ?? []) as { name: string }[];
      if (toRemove.length > 0) columnsToRemoveByTable[key] = toRemove.map((c) => c.name);
    }
    const hasAdd = Object.keys(columnsToAdd).some((k) => (columnsToAdd[k]?.length ?? 0) > 0);
    const hasRemove = Object.keys(columnsToRemoveByTable).some((k) => (columnsToRemoveByTable[k]?.length ?? 0) > 0);
    if (!hasAdd && !hasRemove) return;
    setStep3Syncing("_all");
    setCompareError(null);
    try {
      const response = await call("", "POST", {
        service: "dbManagerService",
        action: "applySchemaSync",
        params: {
          ...params,
          tablesToCreate: [],
          tables: tablesToSync,
          columnsToAddByTable: Object.keys(columnsToAdd).length > 0 ? columnsToAdd : undefined,
          columnsToRemoveByTable: Object.keys(columnsToRemoveByTable).length > 0 ? columnsToRemoveByTable : undefined,
          addColumnsOnly: true,
        },
      });
      if (!response?.success) throw new Error(response?.error || "동기화 실패");
      if (response?.data?.executedSql?.length) setSyncReportSql(response.data.executedSql);
      pushSyncReportLog(3, "3단계 전체 동기화", "선택된 테이블들 컬럼 동기화", {
        executedSql: response.data?.executedSql,
        results: response.data?.results,
      });
      for (const t of tablesToSync) {
        const key = `${t.schema}.${t.table}`;
        const diffRes = await call("", "POST", {
          service: "dbManagerService",
          action: "getTableColumnComparison",
          params: { ...params, schema: t.schema, table: t.table },
        });
        if (diffRes?.success && diffRes?.data) {
          setColumnDiffs((prev) => ({ ...prev, [key]: diffRes.data }));
          const nextToAdd = (diffRes.data.toAdd as { name: string }[]).map((c) => c.name);
          setColumnsToAdd((prev) => ({ ...prev, [key]: nextToAdd }));
        }
      }
    } catch (e: any) {
      setCompareError(e?.error || e?.message || "동기화 실패");
    } finally {
      setStep3Syncing(null);
    }
  };

  const handlePkSync = async (tableKey: string) => {
    const [schema, table] = tableKey.split(".");
    if (!schema || !table) return;
    setStep3PkSyncing(tableKey);
    setCompareError(null);
    try {
      const response = await call("", "POST", {
        service: "dbManagerService",
        action: "applyPrimaryKeySync",
        params: { ...params, schema, table },
      });
      if (!response?.success) throw new Error(response?.error || "PK 동기화 실패");
      if (response?.data?.executedSql?.length) setSyncReportSql(response.data.executedSql);
      pushSyncReportLog(3, "PK 동기화", `${tableKey} Primary Key 추가`, {
        executedSql: response.data?.executedSql,
        results: response.data?.results,
      });
      const diffRes = await call("", "POST", {
        service: "dbManagerService",
        action: "getTableColumnComparison",
        params: { ...params, schema, table },
      });
      if (diffRes?.success && diffRes?.data) {
        setColumnDiffs((prev) => ({ ...prev, [tableKey]: diffRes.data }));
      }
    } catch (e: any) {
      setCompareError(e?.error || e?.message || "PK 동기화 실패");
    } finally {
      setStep3PkSyncing(null);
    }
  };

  const hasAnyColumnsToAdd = useMemo(
    () => Object.keys(columnsToAdd).some((k) => (columnsToAdd[k]?.length ?? 0) > 0),
    [columnsToAdd]
  );

  const hasAnyColumnsToRemove = useMemo(() => {
    return tablesToSync.some((t) => {
      const key = `${t.schema}.${t.table}`;
      const diff = columnDiffs[key];
      const toRemove = diff?.toRemove ?? [];
      return toRemove.length > 0;
    });
  }, [tablesToSync, columnDiffs]);

  const resetWizard = () => {
    setStep(1);
    setComparison(null);
    setTableList(null);
    setColumnDiffs({});
    setColumnsToAdd({});
    setSyncReportLog([]);
    setApplyError(null);
    setConnectError(null);
    setCompareError(null);
  };

  return (
    <>
    <Card className="gap-2 rounded-none border-none shadow-none">
      <CardHeader className="pb-1">
        <CardTitle className="text-xl">테이블 구조 동기화</CardTitle>
        <CardDescription className="mt-0.5 text-xs">
          {step}. {STEPS[step - 1]}
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-0 min-h-[320px] flex flex-col">
        {/* Step 1: DB 연결 */}
        {step === 1 && (
          <div className="space-y-4 flex-1 max-w-md">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field
                id="sync-host"
                label="Host"
                value={conn.host}
                onChange={(v) => setConn((c) => ({ ...c, host: v }))}
                placeholder="localhost"
                disabled={isConnected}
              />
              <Field
                id="sync-port"
                label="Port"
                value={conn.port}
                onChange={(v) => setConn((c) => ({ ...c, port: v }))}
                placeholder="5432"
                disabled={isConnected}
              />
              <Field
                id="sync-database"
                label="Database"
                value={conn.database}
                onChange={(v) => setConn((c) => ({ ...c, database: v }))}
                disabled={isConnected}
              />
              <Field
                id="sync-username"
                label="Username"
                value={conn.username}
                onChange={(v) => setConn((c) => ({ ...c, username: v }))}
                disabled={isConnected}
              />
              <Field
                id="sync-password"
                label="Password"
                value={conn.password}
                onChange={(v) => setConn((c) => ({ ...c, password: v }))}
                type="password"
                disabled={isConnected}
              />
            </div>
            <div className="flex gap-2 items-center">
              <Button
                size="sm"
                className="rounded-none"
                onClick={isConnected ? disconnect : connect}
                disabled={!canConnect || isConnecting}
              >
                {isConnecting ? "연결 중..." : isConnected ? "연결 해제" : "연결"}
              </Button>
              {connectError && <span className="text-sm text-red-600">{connectError}</span>}
            </div>
          </div>
        )}

        {/* Step 2: 테이블 목록 비교 및 생성할 테이블 선택 (스키마 파일 기준 표) */}
        {step === 2 && (
          <div className="space-y-3 flex-1 overflow-auto">
            {isComparing && (
              <div className="text-sm text-slate-600">테이블 목록 비교 중...</div>
            )}
            {compareError && (
              <div className="text-sm text-red-600">{compareError}</div>
            )}
            {tableList && tableList.length > 0 && !isComparing && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={showOnlyMismatch}
                      onChange={(e) => setShowOnlyMismatch(e.target.checked)}
                    />
                    불일치 항목만
                  </label>
                  <div className="flex gap-4 text-[11px] text-slate-600">
                  <span className="flex items-center gap-1">
                    <span className="w-3 h-3 rounded-sm bg-amber-50 border border-amber-200" />
                    스키마에만
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-3 h-3 rounded-sm bg-green-50 border border-green-200" />
                    양쪽 모두
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-3 h-3 rounded-sm bg-green-100 border border-green-300" />
                    일치
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-3 h-3 rounded-sm bg-amber-100 border border-amber-300" />
                    불일치
                  </span>
                  </div>
                </div>
                <div className="border border-slate-200 rounded-none overflow-hidden">
                <table className="w-full text-xs table-fixed leading-tight">
                  <thead>
                    <tr className="bg-slate-100 border-b border-slate-200">
                      <th className="text-left py-1 px-2 w-[120px] font-medium">동기화</th>
                      <th className="text-left py-1 px-2 w-[200px] font-medium">테이블</th>
                      <th className="text-left py-1 px-2 w-[200px]">코멘트</th>
                      <th className="text-left py-1 px-2 w-24">상태</th>
                      <th className="text-left py-1 px-2 min-w-0">일치 여부</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(showOnlyMismatch ? tableList.filter((r) => r.status === "only_in_schema" || r.columnsMatch !== true) : tableList).map((r) => {
                      const key = `${r.schema}.${r.table}`;
                      const isOnlyInSchema = r.status === "only_in_schema";
                      // 행 배경: 스키마에만 = 연한 노랑, 양쪽 모두 = 연한 초록 (중간 톤)
                      const rowBg = isOnlyInSchema ? "bg-amber-50" : "bg-green-50";
                      const statusLabel = isOnlyInSchema ? "스키마에만" : "양쪽 모두";
                      const statusBadge = isOnlyInSchema
                        ? "px-1.5 py-0.5 rounded text-[11px] font-medium bg-amber-200 text-amber-800"
                        : "px-1.5 py-0.5 rounded text-[11px] font-medium bg-green-200 text-green-800";
                      const matchLabel =
                        r.columnsMatch === true ? "일치" : r.columnsMatch === false ? "불일치" : "—";
                      const matchBadge =
                        r.columnsMatch === true
                          ? "px-1.5 py-0.5 rounded text-[11px] font-medium bg-green-100 text-green-800"
                          : r.columnsMatch === false
                            ? "px-1.5 py-0.5 rounded text-[11px] font-medium bg-amber-100 text-amber-800"
                            : "";
                      const creating = creatingTableKey === key || isCreatingAll;
                      const syncing = syncingTableKey === key || isCreatingAll;
                      return (
                        <tr key={key} className={`border-b border-slate-100 ${rowBg}`}>
                          <td className="py-1 px-2 w-[120px] align-middle">
                            {isOnlyInSchema ? (
                              <Button
                                size="sm"
                                variant="outline"
                                className="rounded-none text-xs h-6 px-1.5"
                                onClick={() => handleCreateOne(r.schema, r.table)}
                                disabled={creating}
                              >
                                {creating ? "동기화 중..." : "동기화"}
                              </Button>
                            ) : (
                              <Button
                                size="sm"
                                variant="outline"
                                className="rounded-none text-xs h-6 px-1.5"
                                onClick={() => handleSyncOne(r.schema, r.table)}
                                disabled={syncing || r.columnsMatch === true}
                              >
                                {syncing ? "동기화 중..." : "동기화"}
                              </Button>
                            )}
                          </td>
                          <td className="py-1 px-2 w-[200px] font-mono truncate align-middle" title={key}>{key}</td>
                          <td className="py-1 px-2 w-[200px] text-slate-600 truncate align-middle" title={r.tableComment ?? undefined}>
                            {r.tableComment ?? "—"}
                          </td>
                          <td className="py-1 px-2 align-middle">
                            <span className={statusBadge}>{statusLabel}</span>
                          </td>
                          <td className="py-1 px-2 min-w-0 align-middle">
                            {matchBadge ? (
                              <span
                                className={`inline-block truncate max-w-full ${matchBadge}`}
                                title={r.columnsMatch === false && r.columnsMatchReason ? `불일치: ${r.columnsMatchReason}` : undefined}
                              >
                                {r.columnsMatch === false && r.columnsMatchReason
                                  ? `불일치: ${r.columnsMatchReason}`
                                  : matchLabel}
                              </span>
                            ) : (
                              <span className="text-slate-500">{matchLabel}</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                </div>
              </div>
            )}
            {tableList && tableList.length === 0 && !isComparing && (
              <div className="text-sm text-slate-500">스키마에 정의된 테이블이 없습니다.</div>
            )}
          </div>
        )}

        {/* Step 3: 필드 비교 및 업데이트할 필드 선택 (2단계와 동일한 테이블 구조) */}
        {step === 3 && (
          <div className="space-y-3 flex-1 overflow-y-auto">
            {comparison && tablesToSync.length > 0 ? (
              (() => {
                type FieldRow = {
                  tableKey: string;
                  fieldName: string;
                  comment: string | null;
                  type: string;
                  nullable: "Y" | "N";
                  isPk: boolean;
                  status: "추가" | "DB에만" | "수정" | "일치";
                  isToAdd: boolean;
                };
                const fieldRows: FieldRow[] = [];
                for (const t of tablesToSync) {
                  const key = `${t.schema}.${t.table}`;
                  const diff = columnDiffs[key];
                  if (!diff) continue;
                  const pkSet = new Set((diff.primaryKeyColumns ?? []) as string[]);
                  const toAddByName = new Map(diff.toAdd.map((c) => [c.name, c]));
                  const toModifyByName = new Map(diff.toModify.map((m) => [m.name, m]));
                  const sameByName = new Map(diff.same.map((c) => [c.name, c]));
                  // 스키마 정의 순서대로 모든 필드 출력
                  const definedCols = diff.definedColumns ?? [];
                  for (const col of definedCols) {
                    const toAddCol = toAddByName.get(col.name);
                    const modifyEntry = toModifyByName.get(col.name);
                    const sameCol = sameByName.get(col.name);
                    if (toAddCol) {
                      fieldRows.push({
                        tableKey: key,
                        fieldName: toAddCol.name,
                        comment: toAddCol.comment ?? null,
                        type: toAddCol.type,
                        nullable: toAddCol.notNull ? "N" : "Y",
                        isPk: pkSet.has(toAddCol.name),
                        status: "추가",
                        isToAdd: true,
                      });
                    } else if (modifyEntry) {
                      const def = modifyEntry.defined;
                      fieldRows.push({
                        tableKey: key,
                        fieldName: modifyEntry.name,
                        comment: def.comment ?? null,
                        type: def.type,
                        nullable: def.notNull ? "N" : "Y",
                        isPk: pkSet.has(modifyEntry.name),
                        status: "수정",
                        isToAdd: false,
                      });
                    } else if (sameCol) {
                      fieldRows.push({
                        tableKey: key,
                        fieldName: sameCol.name,
                        comment: sameCol.comment ?? null,
                        type: sameCol.type,
                        nullable: sameCol.notNull ? "N" : "Y",
                        isPk: pkSet.has(sameCol.name),
                        status: "일치",
                        isToAdd: false,
                      });
                    }
                  }
                  // DB에만 있는 컬럼 (스키마에 없음)
                  for (const c of diff.toRemove) {
                    fieldRows.push({
                      tableKey: key,
                      fieldName: c.name,
                      comment: null,
                      type: c.type,
                      nullable: c.notNull ? "N" : "Y",
                      isPk: false,
                      status: "DB에만",
                      isToAdd: false,
                    });
                  }
                }
                const displayRows = showOnlyMismatch ? fieldRows.filter((r) => r.status !== "일치") : fieldRows;
                const isLoading = loadingColumn !== null;
                const tablesWithMissingPk = tablesToSync.filter((t) => {
                  const key = `${t.schema}.${t.table}`;
                  const d = columnDiffs[key];
                  return (d?.primaryKeyColumns?.length ?? 0) > 0 && (d?.actualPrimaryKeyColumns?.length ?? 0) === 0;
                });
                return (
                  <div className="space-y-1.5">
                    {isLoading && (
                      <div className="text-sm text-slate-600">필드 비교 조회 중...</div>
                    )}
                    {tablesWithMissingPk.length > 0 && (
                      <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                        <p className="font-medium mb-1.5">다음 테이블에 PK가 DB에 설정되지 않았습니다. (데이터 수정 불가)</p>
                        <div className="flex flex-wrap gap-2">
                          {tablesWithMissingPk.map((t) => {
                            const key = `${t.schema}.${t.table}`;
                            const syncing = step3PkSyncing === key;
                            return (
                              <span key={key} className="flex items-center gap-2">
                                <span className="font-mono text-slate-700">{key}</span>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="rounded-none h-6 px-2 text-xs border-amber-300 text-amber-800 hover:bg-amber-100"
                                  onClick={() => handlePkSync(key)}
                                  disabled={syncing || step3PkSyncing !== null}
                                >
                                  {syncing ? "동기화 중..." : "PK 동기화"}
                                </Button>
                              </span>
                            );
                          })}
                        </div>
                      </div>
                    )}
                    <div className="flex items-center justify-between gap-2">
                      <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={showOnlyMismatch}
                          onChange={(e) => setShowOnlyMismatch(e.target.checked)}
                        />
                        불일치 항목만
                      </label>
                      <div className="flex gap-4 text-[11px] text-slate-600">
                      <span className="flex items-center gap-1">
                        <span className="w-3 h-3 rounded-sm bg-red-50 border border-red-200" />
                        스키마에만
                      </span>
                      <span className="flex items-center gap-1">
                        <span className="w-3 h-3 rounded-sm bg-amber-50 border border-amber-200" />
                        DB에만
                      </span>
                      <span className="flex items-center gap-1">
                        <span className="w-3 h-3 rounded-sm bg-slate-100 border border-slate-200" />
                        수정
                      </span>
                      <span className="flex items-center gap-1">
                        <span className="w-3 h-3 rounded-sm bg-green-100 border border-green-300" />
                        일치
                      </span>
                      </div>
                    </div>
                    <div className="border border-slate-200 rounded-none overflow-hidden">
                      <table className="w-full text-xs table-fixed leading-tight">
                        <thead>
                          <tr className="bg-slate-100 border-b border-slate-200">
                            <th className="text-left py-1 px-2 w-[120px] font-medium">동기화</th>
                            <th className="text-left py-1 px-2 w-[200px] font-medium">테이블</th>
                            <th className="text-left py-1 px-2 w-[200px]">필드명</th>
                            <th className="text-left py-1 px-2 w-[200px]">코멘트</th>
                            <th className="text-left py-1 px-2 w-20">컬럼타입</th>
                            <th className="text-left py-1 px-2 w-20">N/N</th>
                            <th className="text-left py-1 px-2 w-24">키여부</th>
                            <th className="text-left py-1 px-2 min-w-0">상태</th>
                          </tr>
                        </thead>
                        <tbody>
                          {displayRows.length === 0 && !isLoading ? (
                            <tr>
                              <td colSpan={8} className="py-4 text-center text-slate-500">
                                {showOnlyMismatch ? "불일치 항목이 없습니다." : "모든 필드가 일치합니다."}
                              </td>
                            </tr>
                          ) : (
                            displayRows.map((row, idx) => {
                              const rowId = `${row.tableKey}-${row.fieldName}-${idx}`;
                              const statusBg =
                                row.status === "추가"
                                  ? "bg-red-50"
                                  : row.status === "DB에만"
                                    ? "bg-amber-50"
                                    : row.status === "수정"
                                      ? "bg-slate-50"
                                      : "bg-green-50";
                              const statusBadge =
                                row.status === "추가"
                                  ? "px-1.5 py-0.5 rounded text-[11px] font-medium bg-red-200 text-red-800"
                                  : row.status === "DB에만"
                                    ? "px-1.5 py-0.5 rounded text-[11px] font-medium bg-amber-200 text-amber-800"
                                    : row.status === "수정"
                                      ? "px-1.5 py-0.5 rounded text-[11px] font-medium bg-slate-200 text-slate-800"
                                      : "px-1.5 py-0.5 rounded text-[11px] font-medium bg-green-100 text-green-800";
                              const rowSyncId = `${row.tableKey}-${row.fieldName}`;
                              const syncingThis = step3Syncing === "_all" || step3Syncing === rowSyncId;
                              const canSyncAdd = row.status === "추가";
                              const canSyncDrop = row.status === "DB에만";
                              const canSync = canSyncAdd || canSyncDrop;
                              const onSyncClick = () => {
                                if (canSyncAdd) handleSyncOneField(row.tableKey, row.fieldName);
                                else if (canSyncDrop) handleDropOneField(row.tableKey, row.fieldName);
                              };
                              return (
                                <tr key={rowId} className={`border-b border-slate-100 ${statusBg}`}>
                                  <td className="py-1 px-2 w-[120px] align-middle">
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="rounded-none text-xs h-6 px-1.5"
                                      onClick={onSyncClick}
                                      disabled={!canSync || step3Syncing !== null}
                                    >
                                      {syncingThis ? "동기화 중..." : "동기화"}
                                    </Button>
                                  </td>
                                  <td className="py-1 px-2 w-[200px] font-mono truncate align-middle" title={row.tableKey}>
                                    {row.tableKey}
                                  </td>
                                  <td className="py-1 px-2 w-[200px] font-mono truncate align-middle">{row.fieldName}</td>
                                  <td className="py-1 px-2 w-[200px] text-slate-600 truncate align-middle" title={row.comment ?? undefined}>
                                    {row.comment ?? "—"}
                                  </td>
                                  <td className="py-1 px-2 w-20 font-mono truncate align-middle">{row.type}</td>
                                  <td className="py-1 px-2 w-20 align-middle">{row.nullable}</td>
                                  <td className="py-1 px-2 w-24 align-middle">
                                    {row.isPk ? (
                                      (() => {
                                        const diff = columnDiffs[row.tableKey];
                                        const pkMissing = (diff?.primaryKeyColumns?.length ?? 0) > 0 && (diff?.actualPrimaryKeyColumns?.length ?? 0) === 0;
                                        return pkMissing ? (
                                          <span className="text-red-600 font-medium" title="DB에 PK가 설정되지 않음. 위 PK 동기화 버튼으로 추가하세요.">
                                            PK (미설정)
                                          </span>
                                        ) : (
                                          "PK"
                                        );
                                      })()
                                    ) : (
                                      "—"
                                    )}
                                  </td>
                                  <td className="py-1 px-2 min-w-0 align-middle">
                                    <span className={`inline-block truncate max-w-full ${statusBadge}`}>{row.status === "추가" ? "스키마에만" : row.status}</span>
                                  </td>
                                </tr>
                              );
                            })
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })()
            ) : (
              <div className="text-sm text-slate-500">동기화할 테이블이 없습니다. 이전 단계에서 선택하세요.</div>
            )}
          </div>
        )}

        {/* Step 4: 실행 결과 레포트 */}
        {step === 4 && (
          <div className="space-y-4 flex-1 overflow-y-auto">
            {syncReportLog.length === 0 ? (
              <div className="text-sm text-slate-500 py-6">
                아직 실행한 동기화가 없습니다. 2단계·3단계에서 동기화를 실행하면 여기에 결과가 쌓입니다.
              </div>
            ) : (
              <div className="space-y-6">
                {syncReportLog.map((entry) => (
                  <div key={entry.id} className="border border-slate-200 rounded-none overflow-hidden bg-white">
                    <div className="bg-slate-50 border-b border-slate-200 px-3 py-2 flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <span className="text-xs font-medium text-slate-500 mr-2">
                          {entry.step === 2 ? "2단계" : "3단계"}
                        </span>
                        <span className="text-sm font-medium text-slate-800">{entry.title}</span>
                      </div>
                      <span className="text-xs text-slate-500">{entry.timestamp}</span>
                    </div>
                    <div className="p-3 space-y-3">
                      <p className="text-sm text-slate-600">{entry.description}</p>
                      {entry.results.length > 0 && (
                        <div>
                          <p className="text-xs font-medium text-slate-500 mb-1">실행 결과 요약</p>
                          <table className="w-full text-xs border border-slate-200">
                            <thead>
                              <tr className="bg-slate-100 border-b border-slate-200">
                                <th className="text-left p-2">schema.table</th>
                                <th className="text-left p-2">action</th>
                                <th className="text-left p-2">detail</th>
                              </tr>
                            </thead>
                            <tbody>
                              {entry.results.map((r, i) => (
                                <tr key={i} className="border-b border-slate-100">
                                  <td className="p-2 font-mono">{r.schema}.{r.table}</td>
                                  <td className="p-2">
                                    {r.action === "columns_dropped" ? "컬럼 삭제" : r.action === "columns_added" ? "컬럼 추가" : r.action}
                                  </td>
                                  <td className="p-2">
                                    {r.detail}
                                    {r.columnsAdded?.length ? ` 추가: ${r.columnsAdded.join(", ")}` : ""}
                                    {r.columnsDropped?.length ? ` 삭제: ${r.columnsDropped.join(", ")}` : ""}
                                    {r.error && <span className="text-red-600"> {r.error}</span>}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                      {entry.executedSql.length > 0 && (
                        <div>
                          <p className="text-xs font-medium text-slate-500 mb-1">실행된 SQL</p>
                          <ol className="list-decimal list-inside space-y-1.5 p-2 bg-slate-50 border border-slate-200 text-xs font-mono text-slate-800 overflow-x-auto">
                            {entry.executedSql.map((sql, i) => (
                              <li key={i} className="break-all whitespace-pre-wrap">{sql}</li>
                            ))}
                          </ol>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* 하단: 이전 / 다음 */}
        <div className="flex justify-between gap-2 mt-4 pt-3 border-t border-slate-200 shrink-0">
          <div>
            {step > 1 && step < 4 && (
              <Button size="sm" className="rounded-none" onClick={() => setStep(step - 1)}>
                이전
              </Button>
            )}
            {step === 4 && (
              <>
                <Button size="sm" className="rounded-none" onClick={() => setStep(3)}>
                  이전
                </Button>
                <Button size="sm" className="rounded-none ml-2" onClick={resetWizard}>
                  처음으로
                </Button>
              </>
            )}
          </div>
          <div className="flex gap-2">
            {step === 4 && (
              <Button
                size="sm"
                className="rounded-none"
                onClick={() => (onBack ? onBack() : resetWizard())}
              >
                완료
              </Button>
            )}
            {step === 1 && isConnected && (
              <Button size="sm" className="rounded-none" onClick={goToStep2}>
                다음
              </Button>
            )}
            {step === 2 && comparison && !isComparing && (
              <>
                <Button
                  size="sm"
                  className="rounded-none"
                  onClick={runCompare}
                  disabled={isComparing}
                >
                  검사
                </Button>
                <Button
                  size="sm"
                  className="rounded-none"
                  onClick={handleCreateAll}
                  disabled={!hasAnySyncWork || isCreatingAll}
                >
                  {isCreatingAll ? "동기화 중..." : "전체 동기화"}
                </Button>
                <Button size="sm" className="rounded-none" onClick={() => setStep(3)}>
                  다음
                </Button>
              </>
            )}
            {step === 3 && comparison && tablesToSync.length > 0 && (
              <>
                <Button
                  size="sm"
                  className="rounded-none"
                  onClick={async () => {
                    await runCompare();
                    setColumnDiffs({});
                    setStep3RefreshCounter((c) => c + 1);
                  }}
                  disabled={isComparing}
                >
                  {isComparing ? "검사 중..." : "검사"}
                </Button>
                <Button
                  size="sm"
                  className="rounded-none"
                  onClick={handleSyncAllStep3}
                  disabled={!(hasAnyColumnsToAdd || hasAnyColumnsToRemove) || step3Syncing !== null}
                >
                  {step3Syncing === "_all" ? "동기화 중..." : "전체 동기화"}
                </Button>
                <Button size="sm" className="rounded-none" onClick={() => setStep(4)}>
                  다음
                </Button>
              </>
            )}
            {step === 3 && (!comparison || tablesToSync.length === 0) && (
              <>
                <Button
                  size="sm"
                  className="rounded-none"
                  onClick={async () => {
                    await runCompare();
                    setColumnDiffs({});
                    setStep3RefreshCounter((c) => c + 1);
                  }}
                  disabled={isComparing}
                >
                  {isComparing ? "검사 중..." : "검사"}
                </Button>
                <Button size="sm" className="rounded-none" onClick={() => setStep(4)}>
                  다음
                </Button>
              </>
            )}
          </div>
        </div>
      </CardContent>
    </Card>

    <Dialog open={syncReportSql !== null} onOpenChange={(open) => !open && setSyncReportSql(null)}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>실행된 SQL</DialogTitle>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto border rounded p-3 bg-slate-50 text-xs font-mono">
          {syncReportSql?.length ? (
            <ol className="list-decimal list-inside space-y-2">
              {syncReportSql.map((sql, i) => (
                <li key={i} className="break-all">
                  <pre className="inline whitespace-pre-wrap text-slate-800">{sql}</pre>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-slate-500">실행된 SQL이 없습니다.</p>
          )}
        </div>
        <div className="flex justify-end pt-2">
          <Button size="sm" className="rounded-none" onClick={() => setSyncReportSql(null)}>
            닫기
          </Button>
        </div>
      </DialogContent>
    </Dialog>
    </>
  );
}
