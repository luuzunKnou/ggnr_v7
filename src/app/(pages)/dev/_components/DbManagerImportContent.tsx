'use client';

import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/app/shadcnComponents/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/app/shadcnComponents/ui/card';
import { Input } from '@/app/shadcnComponents/ui/input';
import { call } from '@/lib/api';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/app/shadcnComponents/ui/dialog';

type DbConnection = {
  host: string;
  port: string;
  database: string;
  username: string;
  password: string;
};

type SchemaTable = { schema: string; table: string };

type SrcEndpoint = DbConnection & {
  selectedSchemas: string[]; // 체크박스 다중선택
  selectedTables: SchemaTable[]; // 체크박스 다중선택
};

type DestEndpoint = DbConnection & {
  /** 데이터 적재할 스키마 (비어 있으면 SRC와 동일 스키마명 사용) */
  selectedSchema: string;
};

type DestCheckResult = {
  checkedAt: string;
  requestedSchemasCount: number;
  requestedTablesCount: number;
  existingSchemasCount: number;
  existingTablesCount: number;
  missingSchemas: string[];
  missingTables: SchemaTable[];
};

function Field({
  id,
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
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

function SrcEndpointCard({
  title,
  description,
  endpoint,
  onChange,
  onConnect,
  onDisconnect,
  isConnecting,
  isConnected,
  connectError,
  schemas,
  tablesBySchema,
  isLoadingTables,
}: {
  title: string;
  description: string;
  endpoint: SrcEndpoint;
  onChange: (next: SrcEndpoint) => void;
  onConnect: () => Promise<void>;
  onDisconnect: () => void;
  isConnecting: boolean;
  isConnected: boolean;
  connectError: string | null;
  schemas: string[];
  tablesBySchema: Record<string, string[]>;
  isLoadingTables: boolean;
}) {
  const canConnect = Boolean(
    endpoint.host.trim() && endpoint.port.trim() && endpoint.database.trim() && endpoint.username.trim()
  );
  const canSelectSchema = schemas.length > 0 && !isConnecting;

  return (
    <Card className="rounded-none">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-lg">{title}</CardTitle>
            <CardDescription>{description}</CardDescription>
          </div>
          <Button
            type="button"
            size="sm"
            className="rounded-none"
            onClick={isConnected ? onDisconnect : onConnect}
            disabled={(!isConnected && !canConnect) || isConnecting}
          >
            {isConnecting ? 'Connecting...' : isConnected ? 'DisConnection' : 'Connection'}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field
            id={`${title}-host`}
            label="Host"
            value={endpoint.host}
            onChange={(host) => onChange({ ...endpoint, host })}
            placeholder="예: localhost 또는 10.0.0.10"
            disabled={isConnected}
          />
          <Field
            id={`${title}-port`}
            label="Port"
            value={endpoint.port}
            onChange={(port) => onChange({ ...endpoint, port })}
            placeholder="예: 5432"
            disabled={isConnected}
          />
          <Field
            id={`${title}-database`}
            label="Database"
            value={endpoint.database}
            onChange={(database) => {
              // database 입력 시 username/password를 같은 값으로 자동 세팅
              // (단, 사용자가 이미 별도로 입력해둔 경우는 덮어쓰지 않음)
              const next: SrcEndpoint = { ...endpoint, database };
              if (!endpoint.username || endpoint.username === endpoint.database) next.username = database;
              if (!endpoint.password || endpoint.password === endpoint.database) next.password = database;
              onChange(next);
            }}
            placeholder="예: postgres"
            disabled={isConnected}
          />
          <div className="grid grid-cols-1 gap-3">
            <Field
              id={`${title}-username`}
              label="Username"
              value={endpoint.username}
              onChange={(username) => onChange({ ...endpoint, username })}
              placeholder="예: postgres"
              disabled={isConnected}
            />
            <Field
              id={`${title}-password`}
              label="Password"
              value={endpoint.password}
              onChange={(password) => onChange({ ...endpoint, password })}
              placeholder="비밀번호"
              type="password"
              disabled={isConnected}
            />
          </div>

          {/* Schema 체크박스 다중선택 */}
          <div className="space-y-1 md:col-span-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-slate-700">Schema (다중선택)</label>
              <div className="flex items-center gap-2">
                <div className="text-xs text-slate-500">
                  {endpoint.selectedSchemas.length ? `${endpoint.selectedSchemas.length}개 선택됨` : ''}
                </div>
                {canSelectSchema && (
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      className="text-xs px-2 py-1 border border-slate-200 bg-white hover:bg-slate-50"
                      onClick={() => {
                        const allSelected =
                          schemas.length > 0 && endpoint.selectedSchemas.length === schemas.length;
                        if (allSelected) {
                          // 전체 해제
                          onChange({ ...endpoint, selectedSchemas: [], selectedTables: [] });
                          return;
                        }

                        // 전체 선택 (schema 목록 기준)
                        const nextSchemas = [...schemas].sort();
                        // schema 전체선택은 테이블 전체선택까지 자동으로 하진 않음(테이블은 별도 전체선택 제공)
                        const nextTables = endpoint.selectedTables.filter((t) => nextSchemas.includes(t.schema));
                        onChange({ ...endpoint, selectedSchemas: nextSchemas, selectedTables: nextTables });
                      }}
                      title="스키마 전체선택/해제"
                    >
                      {schemas.length > 0 && endpoint.selectedSchemas.length === schemas.length
                        ? '전체해제'
                        : '전체선택'}
                    </button>
                  </div>
                )}
              </div>
            </div>
            <div className="border border-slate-200 bg-white rounded-none p-2 max-h-[160px] overflow-auto">
              {!canSelectSchema ? (
                <div className="text-sm text-slate-500">Connection 후 목록이 표시됩니다.</div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-2">
                  {schemas.map((s) => {
                    const checked = endpoint.selectedSchemas.includes(s);
                    return (
                      <label key={s} className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            const nextSchemas = (e.target.checked
                              ? Array.from(new Set([...endpoint.selectedSchemas, s]))
                              : endpoint.selectedSchemas.filter((x) => x !== s)
                            ).sort();
                            // schema 해제 시 해당 schema의 테이블 선택도 같이 제거
                            const nextTables = e.target.checked
                              ? endpoint.selectedTables
                              : endpoint.selectedTables.filter((t) => t.schema !== s);
                            onChange({ ...endpoint, selectedSchemas: nextSchemas, selectedTables: nextTables });
                          }}
                        />
                        <span className="font-mono text-xs text-slate-700">{s}</span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Table 체크박스 다중선택 (선택된 schema들에 대해 그룹으로 표시) */}
          <div className="space-y-1 md:col-span-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-slate-700">Table (다중선택)</label>
              <div className="flex items-center gap-2">
                <div className="text-xs text-slate-500">
                  {endpoint.selectedTables.length ? `${endpoint.selectedTables.length}개 선택됨` : ''}
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    className="text-xs px-2 py-1 border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-50"
                    disabled={endpoint.selectedSchemas.length === 0 || isLoadingTables}
                    onClick={() => {
                      // 현재 로드된 테이블 기준으로 전체선택/해제 토글
                      const allLoadedKeys: Array<{ schema: string; table: string }> = [];
                      for (const schema of endpoint.selectedSchemas) {
                        const tables = tablesBySchema[schema] || [];
                        for (const table of tables) allLoadedKeys.push({ schema, table });
                      }

                      if (allLoadedKeys.length === 0) {
                        onChange({ ...endpoint, selectedTables: [] });
                        return;
                      }

                      const selectedKeySet = new Set(
                        endpoint.selectedTables.map((t) => `${t.schema}.${t.table}`)
                      );
                      const allLoadedSelected = allLoadedKeys.every((t) =>
                        selectedKeySet.has(`${t.schema}.${t.table}`)
                      );

                      if (allLoadedSelected) {
                        // 로드된 테이블 전체해제 (선택된 schema 범위 내)
                        const selectedSchemasSet = new Set(endpoint.selectedSchemas);
                        const next = endpoint.selectedTables.filter((t) => !selectedSchemasSet.has(t.schema));
                        onChange({ ...endpoint, selectedTables: next });
                        return;
                      }

                      // 로드된 테이블 전체선택 (기존 선택 + 병합)
                      const nextSet = new Map<string, { schema: string; table: string }>();
                      for (const t of endpoint.selectedTables) nextSet.set(`${t.schema}.${t.table}`, t);
                      for (const t of allLoadedKeys) nextSet.set(`${t.schema}.${t.table}`, t);
                      onChange({ ...endpoint, selectedTables: Array.from(nextSet.values()) });
                    }}
                    title="테이블 전체선택/해제 (로드된 목록 기준)"
                  >
                    전체선택
                  </button>
                  <button
                    type="button"
                    className="text-xs px-2 py-1 border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-50"
                    disabled={endpoint.selectedTables.length === 0}
                    onClick={() => onChange({ ...endpoint, selectedTables: [] })}
                    title="테이블 선택 전체 해제"
                  >
                    전체해제
                  </button>
                </div>
              </div>
            </div>
            <div className="border border-slate-200 bg-white rounded-none p-2 max-h-[260px] overflow-auto">
              {endpoint.selectedSchemas.length === 0 ? (
                <div className="text-sm text-slate-500">Schema를 먼저 선택하세요.</div>
              ) : isLoadingTables ? (
                <div className="text-sm text-slate-500">테이블 목록 불러오는 중...</div>
              ) : (
                <div className="space-y-3">
                  {endpoint.selectedSchemas.map((schema) => {
                    const tables = tablesBySchema[schema] || [];
                    return (
                      <div key={schema} className="space-y-2">
                        <div className="flex items-center justify-between">
                          <div className="text-xs font-semibold text-slate-600">
                            <span className="font-mono">{schema}</span>
                          </div>
                          {tables.length > 0 && (
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                className="text-[11px] px-2 py-1 border border-slate-200 bg-white hover:bg-slate-50"
                                onClick={() => {
                                  // 해당 schema 테이블 전체선택/해제 토글
                                  const schemaKeys = tables.map((table) => ({ schema, table }));
                                  const selectedKeySet = new Set(
                                    endpoint.selectedTables.map((t) => `${t.schema}.${t.table}`)
                                  );
                                  const allSelected = schemaKeys.every((t) =>
                                    selectedKeySet.has(`${t.schema}.${t.table}`)
                                  );

                                  if (allSelected) {
                                    const next = endpoint.selectedTables.filter((t) => t.schema !== schema);
                                    onChange({ ...endpoint, selectedTables: next });
                                    return;
                                  }

                                  const nextSet = new Map<string, { schema: string; table: string }>();
                                  for (const t of endpoint.selectedTables) nextSet.set(`${t.schema}.${t.table}`, t);
                                  for (const t of schemaKeys) nextSet.set(`${t.schema}.${t.table}`, t);
                                  onChange({ ...endpoint, selectedTables: Array.from(nextSet.values()) });
                                }}
                              >
                                {(() => {
                                  const selectedKeySet = new Set(
                                    endpoint.selectedTables.map((t) => `${t.schema}.${t.table}`)
                                  );
                                  const allSelected = tables.every((table) => selectedKeySet.has(`${schema}.${table}`));
                                  return allSelected ? '해제' : '전체선택';
                                })()}
                              </button>
                            </div>
                          )}
                        </div>
                        {tables.length === 0 ? (
                          <div className="text-sm text-slate-400">테이블 없음</div>
                        ) : (
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-2">
                            {tables.map((table) => {
                              const checked = endpoint.selectedTables.some(
                                (t) => t.schema === schema && t.table === table
                              );
                              return (
                                <label key={`${schema}.${table}`} className="flex items-center gap-2 text-sm">
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={(e) => {
                                      const key = { schema, table };
                                      const next = e.target.checked
                                        ? [...endpoint.selectedTables, key]
                                        : endpoint.selectedTables.filter(
                                            (t) => !(t.schema === schema && t.table === table)
                                          );
                                      onChange({ ...endpoint, selectedTables: next });
                                    }}
                                  />
                                  <span className="font-mono text-xs text-slate-700">{table}</span>
                                </label>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>

        {connectError && (
          <div className="mt-3 text-sm text-red-600 border border-red-200 bg-red-50 px-3 py-2 rounded-none">
            {connectError}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function DestEndpointCard({
  title,
  description,
  endpoint,
  onChange,
  onTestConnection,
  onDisconnect,
  isConnecting,
  isConnected,
  connectError,
  schemas,
  srcSelectedTables,
  onCheckExists,
  isChecking,
  checkResult,
  canProceed,
  importing,
  onOpenImportDialog,
}: {
  title: string;
  description: string;
  endpoint: DestEndpoint;
  onChange: (next: DestEndpoint) => void;
  onTestConnection: () => Promise<void>;
  onDisconnect: () => void;
  isConnecting: boolean;
  isConnected: boolean;
  connectError: string | null;
  /** DEST DB 스키마 목록 (연결 후 조회) */
  schemas: string[];
  srcSelectedTables: SchemaTable[];
  onCheckExists: () => Promise<void>;
  isChecking: boolean;
  checkResult: DestCheckResult | null;
  canProceed?: boolean;
  importing?: boolean;
  onOpenImportDialog?: () => void;
}) {
  const canConnect = Boolean(
    endpoint.host.trim() && endpoint.port.trim() && endpoint.database.trim() && endpoint.username.trim()
  );
  const canCheck = isConnected && srcSelectedTables.length > 0 && !isChecking;

  const ok =
    checkResult !== null &&
    checkResult.missingSchemas.length === 0 &&
    checkResult.missingTables.length === 0;

  const selectedUniqueTables = useMemo(() => {
    const m = new Map<string, SchemaTable>();
    for (const t of srcSelectedTables) {
      const key = `${t.schema}.${t.table}`;
      if (!m.has(key)) m.set(key, t);
    }
    return Array.from(m.values()).sort((a, b) => {
      if (a.schema === b.schema) return a.table.localeCompare(b.table);
      return a.schema.localeCompare(b.schema);
    });
  }, [srcSelectedTables]);

  const missingSchemaSet = useMemo(
    () => new Set(checkResult?.missingSchemas ?? []),
    [checkResult]
  );
  const missingTableKeySet = useMemo(
    () => new Set((checkResult?.missingTables ?? []).map((t) => `${t.schema}.${t.table}`)),
    [checkResult]
  );

  const statusSummary = useMemo(() => {
    let exists = 0;
    let missing = 0;
    let unchecked = 0;

    for (const t of selectedUniqueTables) {
      if (!checkResult) {
        unchecked += 1;
        continue;
      }

      const key = `${t.schema}.${t.table}`;
      const isMissing = missingSchemaSet.has(t.schema) || missingTableKeySet.has(key);
      if (isMissing) missing += 1;
      else exists += 1;
    }

    return { total: selectedUniqueTables.length, exists, missing, unchecked };
  }, [selectedUniqueTables, checkResult, missingSchemaSet, missingTableKeySet]);

  return (
    <Card className="rounded-none">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-lg">{title}</CardTitle>
            <CardDescription>{description}</CardDescription>
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              className="rounded-none"
              onClick={isConnected ? onDisconnect : onTestConnection}
              disabled={(!isConnected && !canConnect) || isConnecting}
            >
              {isConnecting ? 'Connecting...' : isConnected ? 'DisConnection' : 'Connection'}
            </Button>
            <Button
              type="button"
              size="sm"
              className="rounded-none"
              onClick={onCheckExists}
              disabled={!canCheck}
              title={srcSelectedTables.length === 0 ? 'SRC에서 테이블을 먼저 선택하세요.' : 'SRC 항목 존재 여부 확인'}
            >
              {isChecking ? 'Checking...' : '테이블 목록조회'}
            </Button>
            {onOpenImportDialog != null && (
              <Button
                type="button"
                size="sm"
                className="rounded-none"
                disabled={!canProceed || importing}
                onClick={onOpenImportDialog}
              >
                {importing ? '가져오는 중...' : '데이터 가져오기'}
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field
            id={`${title}-host`}
            label="Host"
            value={endpoint.host}
            onChange={(host) => onChange({ ...endpoint, host })}
            placeholder="예: localhost 또는 10.0.0.10"
            disabled={isConnected}
          />
          <Field
            id={`${title}-port`}
            label="Port"
            value={endpoint.port}
            onChange={(port) => onChange({ ...endpoint, port })}
            placeholder="예: 5432"
            disabled={isConnected}
          />
          <Field
            id={`${title}-database`}
            label="Database"
            value={endpoint.database}
            onChange={(database) => {
              // database 입력 시 username/password를 같은 값으로 자동 세팅
              const next: DestEndpoint = { ...endpoint, database };
              if (!endpoint.username || endpoint.username === endpoint.database) next.username = database;
              if (!endpoint.password || endpoint.password === endpoint.database) next.password = database;
              onChange(next);
            }}
            placeholder="예: postgres"
            disabled={isConnected}
          />
          <div className="grid grid-cols-1 gap-3">
            <Field
              id={`${title}-username`}
              label="Username"
              value={endpoint.username}
              onChange={(username) => onChange({ ...endpoint, username })}
              placeholder="예: postgres"
              disabled={isConnected}
            />
            <Field
              id={`${title}-password`}
              label="Password"
              value={endpoint.password}
              onChange={(password) => onChange({ ...endpoint, password })}
              placeholder="비밀번호"
              type="password"
              disabled={isConnected}
            />
          </div>

          {/* DEST 스키마 선택 (연결 후 표시, 비어 있으면 SRC와 동일 스키마명 사용) */}
          {isConnected && schemas.length > 0 && (
            <div className="space-y-1 md:col-span-2">
              <label htmlFor={`${title}-schema`} className="text-sm font-medium text-slate-700">
                적재 스키마 (선택)
              </label>
              <select
                id={`${title}-schema`}
                value={endpoint.selectedSchema}
                onChange={(e) => onChange({ ...endpoint, selectedSchema: e.target.value })}
                className="w-full rounded-none border border-slate-200 bg-white px-3 py-2 text-sm"
              >
                <option value="">SRC와 동일 스키마 사용</option>
                {schemas.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              <p className="text-xs text-slate-500">
                선택 시 모든 테이블을 해당 스키마에 적재합니다. 비우면 SRC의 스키마명을 그대로 사용합니다.
              </p>
            </div>
          )}
        </div>

        <div className="text-sm text-slate-600">
          SRC에서 선택한 테이블 수: <b>{srcSelectedTables.length}</b>
        </div>

        {connectError && (
          <div className="text-sm text-red-600 border border-red-200 bg-red-50 px-3 py-2 rounded-none">
            {connectError}
          </div>
        )}

        {/* SRC 선택 테이블 기준 상태 목록 (존재/없음/미검사) */}
        <div className="border border-slate-200 bg-white rounded-none p-3 space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium">선택 테이블 상태</div>
            <div className="text-xs text-slate-500">
              총 {statusSummary.total} · 존재 {statusSummary.exists} · 없음 {statusSummary.missing}
              {statusSummary.unchecked ? ` · 미검사 ${statusSummary.unchecked}` : ''}
            </div>
          </div>

          {selectedUniqueTables.length === 0 ? (
            <div className="text-sm text-slate-500">SRC에서 테이블을 먼저 선택하세요.</div>
          ) : (
            <div className="max-h-[240px] overflow-auto border border-slate-100">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 p-2">
                {selectedUniqueTables.map((t) => {
                  const key = `${t.schema}.${t.table}`;
                  const isChecked = Boolean(checkResult);
                  const isMissing = isChecked && (missingSchemaSet.has(t.schema) || missingTableKeySet.has(key));
                  const statusLabel = !isChecked
                    ? '미검사'
                    : isMissing
                    ? missingSchemaSet.has(t.schema)
                      ? '스키마 없음'
                      : '테이블 없음'
                    : '존재';

                  const statusClass = !isChecked
                    ? 'bg-slate-50 border-slate-200 text-slate-600'
                    : isMissing
                    ? 'bg-red-50 border-red-200 text-red-700'
                    : 'bg-green-50 border-green-200 text-green-700';

                  return (
                    <div
                      key={key}
                      className="flex items-center justify-between gap-2 border border-slate-100 px-2 py-1"
                    >
                      <div className="font-mono text-xs text-slate-700 truncate" title={key}>
                        {key}
                      </div>
                      <span className={`shrink-0 text-[11px] px-2 py-0.5 border ${statusClass}`}>
                        {statusLabel}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {checkResult && (
          <div className="border border-slate-200 bg-white rounded-none p-3 space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium">
                검사 결과: {ok ? <span className="text-green-700">OK</span> : <span className="text-red-700">누락</span>}
              </div>
              <div className="text-xs text-slate-500">{new Date(checkResult.checkedAt).toLocaleString()}</div>
            </div>
            <div className="text-sm text-slate-700">
              스키마: {checkResult.existingSchemasCount}/{checkResult.requestedSchemasCount} 존재, 테이블:{' '}
              {checkResult.existingTablesCount}/{checkResult.requestedTablesCount} 존재
            </div>

            {checkResult.missingSchemas.length > 0 && (
              <div className="space-y-1">
                <div className="text-sm font-medium text-red-700">누락 스키마</div>
                <div className="flex flex-wrap gap-2">
                  {checkResult.missingSchemas.map((s) => (
                    <span key={s} className="font-mono text-xs px-2 py-1 bg-red-50 border border-red-200">
                      {s}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {checkResult.missingTables.length > 0 && (
              <div className="space-y-1">
                <div className="text-sm font-medium text-red-700">누락 테이블</div>
                <div className="max-h-[180px] overflow-auto border border-slate-100">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2 p-2">
                    {checkResult.missingTables.map((t) => (
                      <div key={`${t.schema}.${t.table}`} className="font-mono text-xs text-slate-700">
                        {t.schema}.{t.table}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function DbManagerImportContent({ onBack }: { onBack?: () => void }) {
  const [src, setSrc] = useState<SrcEndpoint>({
    host: '',
    port: '5432',
    database: '',
    username: '',
    password: '',
    selectedSchemas: [],
    selectedTables: [],
  });
  const [dest, setDest] = useState<DestEndpoint>({
    host: '',
    port: '5432',
    database: '',
    username: '',
    password: '',
    selectedSchema: '',
  });

  // SRC state
  const [srcSchemas, setSrcSchemas] = useState<string[]>([]);
  const [srcTablesBySchema, setSrcTablesBySchema] = useState<Record<string, string[]>>({});
  const [srcConnecting, setSrcConnecting] = useState(false);
  const [srcTablesLoading, setSrcTablesLoading] = useState(false);
  const [srcError, setSrcError] = useState<string | null>(null);
  const [srcConnected, setSrcConnected] = useState(false);

  // DESC state
  const [destSchemas, setDestSchemas] = useState<string[]>([]);
  const [destConnecting, setDestConnecting] = useState(false);
  const [destError, setDestError] = useState<string | null>(null);
  const [destChecking, setDestChecking] = useState(false);
  const [destCheckResult, setDestCheckResult] = useState<DestCheckResult | null>(null);
  const [destConnected, setDestConnected] = useState(false);

  // Import 실행 UI 상태
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<any | null>(null);

  const canProceed = useMemo(() => {
    // 진행 조건:
    // - SRC/DESC가 연결되어 있고
    // - SRC에서 가져올 테이블이 선택되어 있으면 OK
    return srcConnected && destConnected && src.selectedTables.length > 0;
  }, [srcConnected, destConnected, src.selectedTables.length]);

  // 프로젝트 설정(환경 변수)에서 기본 DB 연결 정보 로드 → SRC/DEST 폼에 자동 채움
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await call('', 'POST', {
          service: 'dbManagerService',
          action: 'getDefaultDbConfig',
          params: {},
        });
        if (cancelled || !response?.success || !response?.data) return;
        const d = response.data;
        const base = {
          host: d.host ?? '',
          port: d.port ?? '5432',
          database: d.database ?? '',
          username: d.username ?? '',
          password: d.password ?? '',
        };
        setSrc((prev) => ({ ...prev, ...base, selectedSchemas: prev.selectedSchemas, selectedTables: prev.selectedTables }));
        setDest((prev) => ({ ...prev, ...base, selectedSchema: prev.selectedSchema ?? '' }));
      } catch {
        // 무시
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const startImport = async (mode: 'create_and_import' | 'import_existing_only') => {
    setImportError(null);
    setImportResult(null);
    setImporting(true);
    try {
      const response = await call('', 'POST', {
        service: 'dbManagerService',
        action: 'importData',
        params: {
          mode,
          items: src.selectedTables,
          src: {
            host: src.host,
            port: src.port,
            database: src.database,
            username: src.username,
            password: src.password || undefined,
          },
          dest: {
            host: dest.host,
            port: dest.port,
            database: dest.database,
            username: dest.username,
            password: dest.password || undefined,
          },
          destSchema: dest.selectedSchema?.trim() || undefined,
        },
      });

      if (!response?.success) throw new Error(response?.error || 'Import failed');
      setImportResult(response.data);
      setImportDialogOpen(false);
    } catch (e: any) {
      setImportError(e?.error || e?.message || 'Import failed');
    } finally {
      setImporting(false);
    }
  };

  // SRC: Connection → schema 목록 조회
  const connectSrc = async () => {
    setSrcError(null);
    setSrcConnecting(true);
    setSrcTablesBySchema({});
    setSrcConnected(false);

    try {
      const response = await call('', 'POST', {
        service: 'dbManagerService',
        action: 'getSchemas',
        params: {
          host: src.host,
          port: src.port,
          database: src.database,
          username: src.username,
          password: src.password || undefined,
        },
      });

      if (!response?.success) throw new Error(response?.error || 'Connection failed');

      const schemas: string[] = response.data?.schemas || [];
      setSrcSchemas(schemas);
      setSrc((prev) => ({ ...prev, selectedSchemas: [], selectedTables: [] }));
      setSrcConnected(true);
    } catch (e: any) {
      setSrcSchemas([]);
      setSrc((prev) => ({ ...prev, selectedSchemas: [], selectedTables: [] }));
      setSrcError(e?.message || 'Connection failed');
      setSrcConnected(false);
    } finally {
      setSrcConnecting(false);
    }
  };

  const disconnectSrc = () => {
    setSrcConnected(false);
    setSrcError(null);
    setSrcSchemas([]);
    setSrcTablesBySchema({});
    setSrc((prev) => ({ ...prev, selectedSchemas: [], selectedTables: [] }));
    // SRC 선택이 사라지므로 DEST 검증 결과도 무효화
    setDestCheckResult(null);
  };

  // SRC: 선택된 schema들에 대한 테이블 목록 조회
  const loadTablesForSchemas = async (schemas: string[]) => {
    const schemaList = (schemas || []).filter(Boolean);
    if (schemaList.length === 0) {
      setSrcTablesBySchema({});
      return;
    }

    setSrcError(null);
    setSrcTablesLoading(true);
    try {
      const response = await call('', 'POST', {
        service: 'dbManagerService',
        action: 'getTablesBySchemas',
        params: {
          host: src.host,
          port: src.port,
          database: src.database,
          username: src.username,
          password: src.password || undefined,
          schemas: schemaList,
        },
      });

      if (!response?.success) {
        throw new Error(response?.error || 'Failed to load tables');
      }

      const tablesBySchema: Record<string, string[]> = response.data?.tablesBySchema || {};
      setSrcTablesBySchema(tablesBySchema);
    } catch (e: any) {
      setSrcTablesBySchema({});
      setSrcError(e?.message || 'Failed to load tables');
    } finally {
      setSrcTablesLoading(false);
    }
  };

  // DEST: 연결 테스트 후 스키마 목록 조회
  const connectDest = async () => {
    setDestError(null);
    setDestCheckResult(null);
    setDestSchemas([]);
    setDestConnecting(true);
    setDestConnected(false);
    try {
      const response = await call('', 'POST', {
        service: 'dbManagerService',
        action: 'testConnection',
        params: {
          host: dest.host,
          port: dest.port,
          database: dest.database,
          username: dest.username,
          password: dest.password || undefined,
        },
      });

      if (!response?.success) throw new Error(response?.error || 'Connection failed');
      setDestConnected(true);

      const schemaRes = await call('', 'POST', {
        service: 'dbManagerService',
        action: 'getSchemas',
        params: {
          host: dest.host,
          port: dest.port,
          database: dest.database,
          username: dest.username,
          password: dest.password || undefined,
        },
      });
      if (schemaRes?.success && Array.isArray(schemaRes.data?.schemas)) {
        setDestSchemas(schemaRes.data.schemas);
      }
    } catch (e: any) {
      setDestError(e?.message || 'Connection failed');
      setDestConnected(false);
    } finally {
      setDestConnecting(false);
    }
  };

  const disconnectDest = () => {
    setDestConnected(false);
    setDestError(null);
    setDestCheckResult(null);
    setDestSchemas([]);
    setDest((prev) => ({ ...prev, selectedSchema: '' }));
  };

  // DEST: SRC 선택 항목 존재 여부 확인
  const checkDestHasSrc = async () => {
    setDestError(null);
    setDestChecking(true);
    setDestCheckResult(null);
    try {
      const response = await call('', 'POST', {
        service: 'dbManagerService',
        action: 'checkSchemaTablesExist',
        params: {
          host: dest.host,
          port: dest.port,
          database: dest.database,
          username: dest.username,
          password: dest.password || undefined,
          items: src.selectedTables,
          targetSchema: dest.selectedSchema?.trim() || undefined,
        },
      });

      if (!response?.success) throw new Error(response?.error || 'Check failed');
      setDestCheckResult(response.data as DestCheckResult);
    } catch (e: any) {
      // call()은 서버에서 내려준 json을 그대로 reject할 수 있어서 (message 대신 error에 있을 수 있음)
      setDestError(e?.error || e?.message || 'Check failed');
    } finally {
      setDestChecking(false);
    }
  };

  return (
    <div className="space-y-2">
      <Card className="gap-1 rounded-none border-none shadow-none">
        <CardHeader className="pb-1 pt-0">
          <CardTitle className="text-xl">데이터 가져오기</CardTitle>
          <CardDescription className="mt-0.5 text-xs">
            SRC(원본) → DESC(대상)으로 데이터를 가져오기 위한 접속정보, 스키마, 테이블명을 입력하세요.
          </CardDescription>
        </CardHeader>
      </Card>

      <div className="space-y-2">
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-2">
          <SrcEndpointCard
            title="SRC"
            description="가져올 데이터가 있는 DB"
            endpoint={src}
            onChange={(next) => {
              const schemasChanged =
                next.selectedSchemas.join('|') !== src.selectedSchemas.join('|');

              // SRC 선택이 바뀌면 DEST 검증 결과는 무효화(재검증 필요)
              setDestCheckResult(null);
              setSrc(next);
              if (schemasChanged) {
                // 선택된 schema 목록 기준으로 테이블 목록 재조회
                loadTablesForSchemas(next.selectedSchemas);
              }
            }}
            onConnect={connectSrc}
            onDisconnect={disconnectSrc}
            isConnecting={srcConnecting}
            isConnected={srcConnected}
            connectError={srcError}
            schemas={srcSchemas}
            tablesBySchema={srcTablesBySchema}
            isLoadingTables={srcTablesLoading}
          />
          <DestEndpointCard
            title="DESC"
            description="데이터를 적재할 DB (SRC 선택 항목 존재 여부 확인)"
            endpoint={dest}
            onChange={(next) => {
              const connectionChanged =
                next.host !== dest.host ||
                next.port !== dest.port ||
                next.database !== dest.database ||
                next.username !== dest.username ||
                next.password !== dest.password;
              if (connectionChanged) {
                setDestCheckResult(null);
                setDestConnected(false);
              } else {
                setDestCheckResult(null);
              }
              setDest(next);
            }}
            onTestConnection={connectDest}
            onDisconnect={disconnectDest}
            isConnecting={destConnecting}
            isConnected={destConnected}
            connectError={destError}
            schemas={destSchemas}
            srcSelectedTables={src.selectedTables}
            onCheckExists={checkDestHasSrc}
            isChecking={destChecking}
            checkResult={destCheckResult}
            canProceed={canProceed}
            importing={importing}
            onOpenImportDialog={() => {
              setImportError(null);
              setImportResult(null);
              setImportDialogOpen(true);
            }}
          />
        </div>

        {importError && (
          <div className="text-sm text-red-600 border border-red-200 bg-red-50 px-3 py-2 rounded-none">
            {importError}
          </div>
        )}

        {importResult && (
          <div className="text-sm text-slate-700 border border-slate-200 bg-white px-3 py-2 rounded-none">
            <div className="font-medium">가져오기 요청 완료</div>
            <div className="text-xs text-slate-500 mt-1">
              mode: {importResult.mode} / requested: {importResult.requestedCount} / willImport: {importResult.willImportCount} / importedTables:{' '}
              {importResult.importedTablesCount} / importedRows: {importResult.importedRowsCount} / skipped: {importResult.skippedCount}
            </div>
            {Array.isArray(importResult.results) && (
              <div className="mt-2 max-h-[220px] overflow-auto border border-slate-100">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 p-2">
                  {importResult.results.map((r: any) => (
                    <div key={`${r.schema}.${r.table}`} className="flex items-center justify-between gap-2 border border-slate-100 px-2 py-1">
                      <div className="font-mono text-xs text-slate-700 truncate" title={`${r.schema}.${r.table}`}>
                        {r.schema}.{r.table}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] text-slate-600">{r.rowsCopied ?? 0} rows</span>
                        <span
                          className={
                            r.status === 'imported'
                              ? 'text-[11px] px-2 py-0.5 border bg-green-50 border-green-200 text-green-700'
                              : r.status === 'skipped'
                              ? 'text-[11px] px-2 py-0.5 border bg-slate-50 border-slate-200 text-slate-700'
                              : 'text-[11px] px-2 py-0.5 border bg-red-50 border-red-200 text-red-700'
                          }
                          title={r.reason || ''}
                        >
                          {r.status}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>데이터 가져오기</DialogTitle>
            <DialogDescription>
              아래 두 가지 중 하나를 선택하세요.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <button
              type="button"
              className="w-full text-left border border-slate-200 hover:bg-slate-50 p-3 rounded-none"
              onClick={() => startImport('create_and_import')}
              disabled={importing}
            >
              <div className="font-medium">1. 테이블을 생성후 데이터 가져오기</div>
              <div className="text-sm text-slate-600 mt-1">
                DEST에 스키마/테이블이 없으면 생성한 뒤 데이터를 적재합니다.
              </div>
            </button>

            <button
              type="button"
              className="w-full text-left border border-slate-200 hover:bg-slate-50 p-3 rounded-none"
              onClick={() => startImport('import_existing_only')}
              disabled={importing}
            >
              <div className="font-medium">2. 존재하는 테이블만 데이터 가져오기</div>
              <div className="text-sm text-slate-600 mt-1">
                DEST에 이미 존재하는 테이블만 대상으로 데이터를 적재합니다.
              </div>
            </button>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              className="rounded-none"
              onClick={() => setImportDialogOpen(false)}
              disabled={importing}
            >
              취소
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

