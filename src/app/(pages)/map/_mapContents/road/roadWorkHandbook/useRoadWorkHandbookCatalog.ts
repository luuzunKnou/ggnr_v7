"use client"

import { useEffect, useState } from "react"
import { call } from "@/lib/api"
import type { HandbookMaterial, HandbookProcedure } from "./roadWorkHandbookData"

type CatalogState = {
  reviews: HandbookProcedure[]
  materials: HandbookMaterial[]
  loading: boolean
  error: string | null
}

function asProcedure(raw: Record<string, unknown>): HandbookProcedure {
  const formula =
    raw.formula != null && typeof raw.formula === "object" && !Array.isArray(raw.formula)
      ? (raw.formula as HandbookProcedure["formula"])
      : null
  const exampleKind = String(raw.exampleKind ?? "").trim() || undefined
  return {
    no: Number(raw.no ?? 0),
    name: String(raw.name ?? ""),
    law: String(raw.law ?? ""),
    criteria: String(raw.criteria ?? ""),
    criteriaItems: Array.isArray(raw.criteriaItems)
      ? raw.criteriaItems.map((s) => String(s)).filter(Boolean)
      : [],
    when: String(raw.when ?? "—") || "—",
    org: (raw.org === "대가없음" || raw.org === "과업포함" ? raw.org : "별도") as HandbookProcedure["org"],
    note: String(raw.note ?? "").trim() || undefined,
    exampleKind: exampleKind as HandbookProcedure["exampleKind"],
    formula,
  }
}

function asMaterial(raw: Record<string, unknown>): HandbookMaterial {
  const files = Array.isArray(raw.files)
    ? raw.files
        .map((f) => {
          if (f == null || typeof f !== "object") return null
          const rec = f as Record<string, unknown>
          const url = String(rec.url ?? "").trim()
          return {
            name: String(rec.name ?? "").trim() || "자료",
            src: String(rec.src ?? "").trim() || "자료",
            ...(url ? { url } : {}),
          }
        })
        .filter((x): x is NonNullable<typeof x> => x != null)
    : []
  const xmlUrl = String(raw.xmlUrl ?? "").trim()
  const lawViewUrl = String(raw.lawViewUrl ?? "").trim()
  return {
    id: String(raw.id ?? ""),
    chapter: String(raw.chapter ?? ""),
    name: String(raw.name ?? ""),
    source: String(raw.source ?? ""),
    files,
    ...(xmlUrl ? { xmlUrl } : {}),
    ...(lawViewUrl ? { lawViewUrl } : {}),
    ...(raw.notesOnly === true ? { notesOnly: true } : {}),
  }
}

let catalogCache: { reviews: HandbookProcedure[]; materials: HandbookMaterial[] } | null = null
let catalogInflight: Promise<{ reviews: HandbookProcedure[]; materials: HandbookMaterial[] }> | null = null

async function loadCatalog(): Promise<{ reviews: HandbookProcedure[]; materials: HandbookMaterial[] }> {
  if (catalogCache) return catalogCache
  if (catalogInflight) return catalogInflight
  catalogInflight = (async () => {
    const res = await call("", "POST", {
      service: "roadWorkHandbookService",
      action: "listCatalog",
    })
    if (res?.success === false) {
      throw new Error(String(res?.error ?? "업무편람 자료를 불러오지 못했습니다."))
    }
    const data = (res?.data ?? res) as {
      reviews?: unknown
      materials?: unknown
      error?: string
    }
    if (data?.error) throw new Error(String(data.error))
    const reviewsRaw = Array.isArray(data?.reviews) ? data.reviews : []
    const materialsRaw = Array.isArray(data?.materials) ? data.materials : []
    const next = {
      reviews: reviewsRaw.map((r) => asProcedure(r as Record<string, unknown>)),
      materials: materialsRaw.map((m) => asMaterial(m as Record<string, unknown>)),
    }
    catalogCache = next
    return next
  })().finally(() => {
    catalogInflight = null
  })
  return catalogInflight
}

export function useRoadWorkHandbookCatalog(): CatalogState {
  const [reviews, setReviews] = useState<HandbookProcedure[]>(catalogCache?.reviews ?? [])
  const [materials, setMaterials] = useState<HandbookMaterial[]>(catalogCache?.materials ?? [])
  const [loading, setLoading] = useState(!catalogCache)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const next = await loadCatalog()
        if (cancelled) return
        setReviews(next.reviews)
        setMaterials(next.materials)
        setError(null)
      } catch {
        if (!cancelled) {
          setError("업무편람 자료를 불러오지 못했습니다.")
          setReviews([])
          setMaterials([])
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  return { reviews, materials, loading, error }
}
