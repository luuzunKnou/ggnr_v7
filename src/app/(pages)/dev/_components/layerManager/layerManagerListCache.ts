"use client"

import { call } from "@/lib/api"

type DefineLayerTablesBody = {
  success: boolean
  data?: Record<string, unknown>[]
  error?: string
}

type DefineLayerTablesPayload = {
  success?: boolean
  tables?: Record<string, unknown>[]
  error?: string
}

type DbTableListPayload = {
  success?: boolean
  error?: string
  tables?: Array<{ schema: string; table: string }>
}

const TTL_MS = 20_000

let tablesInflight: Promise<DefineLayerTablesBody> | null = null
let tablesCached: DefineLayerTablesBody | null = null
let tablesAt = 0

let dbInflight: Promise<DbTableListPayload> | null = null
let dbCached: DbTableListPayload | null = null
let dbAt = 0

export function invalidateLayerManagerListCache() {
  tablesCached = null
  tablesAt = 0
  tablesInflight = null
  dbCached = null
  dbAt = 0
  dbInflight = null
}

export function fetchDefineLayerTables(force = false): Promise<DefineLayerTablesBody> {
  if (!force && tablesCached && Date.now() - tablesAt < TTL_MS) {
    return Promise.resolve(tablesCached)
  }
  if (!force && tablesInflight) return tablesInflight
  tablesInflight = call("", "POST", {
    service: "devTestService",
    action: "getDefineLayerTables",
    params: {},
  })
    .then((res) => {
      const inner = (res?.data ?? res) as DefineLayerTablesPayload
      const body: DefineLayerTablesBody = {
        success: !!inner?.success,
        data: inner?.tables,
        error: inner?.error,
      }
      if (body.success && Array.isArray(body.data)) {
        tablesCached = body
        tablesAt = Date.now()
      }
      return body
    })
    .catch((e: unknown): DefineLayerTablesBody => ({
      success: false,
      error: e instanceof Error ? e.message : "defineLayer 요청 실패",
    }))
    .finally(() => {
      tablesInflight = null
    })
  return tablesInflight
}

export async function saveDefineLayerTablesConfig(
  tables: Record<string, unknown>[]
): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await call("", "POST", {
      service: "devTestService",
      action: "saveDefineLayerTables",
      params: { tables },
    })
    const inner = (res?.data ?? res) as { success?: boolean; error?: string }
    if (inner?.success) {
      invalidateLayerManagerListCache()
    }
    return { success: !!inner?.success, error: inner?.error }
  } catch (e: unknown) {
    return {
      success: false,
      error: e instanceof Error ? e.message : "defineLayer 저장 실패",
    }
  }
}

export function fetchLayerDbTableList(force = false): Promise<DbTableListPayload> {
  if (!force && dbCached && Date.now() - dbAt < TTL_MS) {
    return Promise.resolve(dbCached)
  }
  if (!force && dbInflight) return dbInflight
  dbInflight = call("", "POST", {
    service: "devTestService",
    action: "getLayerTableList",
    params: {},
  }).then((res) => {
    const data = (res?.data ?? res) as DbTableListPayload
    if (data?.success && Array.isArray(data.tables)) {
      dbCached = data
      dbAt = Date.now()
    }
    return data
  }).finally(() => {
    dbInflight = null
  })
  return dbInflight
}
