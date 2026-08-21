"use client"

import { call } from "@/lib/api"

type DefineLayerTablesBody = {
  success: boolean
  data?: Record<string, unknown>[]
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
  tablesInflight = fetch("/api/config/defineLayer")
    .then((r) => r.json() as Promise<DefineLayerTablesBody>)
    .then((body) => {
      if (body?.success && Array.isArray(body.data)) {
        tablesCached = body
        tablesAt = Date.now()
      }
      return body
    })
    .finally(() => {
      tablesInflight = null
    })
  return tablesInflight
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
