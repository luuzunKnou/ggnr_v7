"use client"

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react"

export type HandbookMapDrawKind = "line" | "polygon"

export type HandbookMapPick = {
  kind: HandbookMapDrawKind
  fieldKey: string
  label: string
}

type HandbookMapContextValue = {
  sessionKey: string | null
  activePick: HandbookMapPick | null
  overlayNote: string | null
  drawnFieldKeys: string[]
  lastDrawn: HandbookMapPick | null
  clearTick: number
  pendingClearKey: string | null
  scaleVals: Record<string, string>
  setScaleField: (key: string, value: string) => void
  startPick: (pick: HandbookMapPick) => void
  cancelPick: () => void
  finishPick: (value: string, note: string) => void
  clearDrawn: (fieldKey?: string) => void
  resetScale: () => void
  redrawLast: () => void
  registerFill: (fn: ((fieldKey: string, value: string) => void) | null) => void
}

const HandbookMapContext = createContext<HandbookMapContextValue | null>(null)

export function RoadWorkHandbookMapProvider({
  children,
  sessionKey,
}: {
  children: ReactNode
  sessionKey: string | null
}) {
  const [activePick, setActivePick] = useState<HandbookMapPick | null>(null)
  const [overlayNote, setOverlayNote] = useState<string | null>(null)
  const [drawnFieldKeys, setDrawnFieldKeys] = useState<string[]>([])
  const [lastDrawn, setLastDrawn] = useState<HandbookMapPick | null>(null)
  const [clearTick, setClearTick] = useState(0)
  const [pendingClearKey, setPendingClearKey] = useState<string | null>(null)
  const [scaleVals, setScaleVals] = useState<Record<string, string>>({})
  const [seenSession, setSeenSession] = useState(sessionKey)
  const fillRef = useRef<((fieldKey: string, value: string) => void) | null>(null)
  const pickRef = useRef<HandbookMapPick | null>(null)
  const lastDrawnRef = useRef<HandbookMapPick | null>(null)
  const drawnKeysRef = useRef<string[]>([])
  pickRef.current = activePick
  lastDrawnRef.current = lastDrawn
  drawnKeysRef.current = drawnFieldKeys

  if (seenSession !== sessionKey) {
    setSeenSession(sessionKey)
    setActivePick(null)
    setOverlayNote(null)
    setDrawnFieldKeys([])
    setLastDrawn(null)
    setPendingClearKey(null)
  }

  const startPick = useCallback((next: HandbookMapPick) => {
    setOverlayNote(null)
    setActivePick(next)
  }, [])

  const cancelPick = useCallback(() => {
    setActivePick(null)
  }, [])

  const finishPick = useCallback((value: string, note: string) => {
    const current = pickRef.current
    if (current) {
      fillRef.current?.(current.fieldKey, value)
      setScaleVals((prev) => ({ ...prev, [current.fieldKey]: value }))
      setDrawnFieldKeys((prev) => (prev.includes(current.fieldKey) ? prev : [...prev, current.fieldKey]))
      setLastDrawn(current)
    }
    setOverlayNote(note)
    setActivePick(null)
  }, [])

  const setScaleField = useCallback((key: string, value: string) => {
    setScaleVals((prev) => ({ ...prev, [key]: value }))
  }, [])

  const clearDrawn = useCallback((fieldKey?: string) => {
    const prev = drawnKeysRef.current
    const keys = fieldKey ? prev.filter((k) => k === fieldKey) : prev
    keys.forEach((k) => fillRef.current?.(k, ""))
    if (fieldKey) {
      setScaleVals((prev) => ({ ...prev, [fieldKey]: "" }))
    } else {
      setScaleVals((prev) => {
        const next = { ...prev }
        keys.forEach((k) => {
          next[k] = ""
        })
        return next
      })
    }
    setDrawnFieldKeys(fieldKey ? prev.filter((k) => k !== fieldKey) : [])
    setLastDrawn((prevLast) => (!fieldKey || prevLast?.fieldKey === fieldKey ? null : prevLast))
    setOverlayNote(null)
    setActivePick(null)
    setPendingClearKey(fieldKey ?? null)
    setClearTick((t) => t + 1)
  }, [])

  const resetScale = useCallback(() => {
    drawnKeysRef.current.forEach((k) => fillRef.current?.(k, ""))
    setScaleVals({})
    setDrawnFieldKeys([])
    setLastDrawn(null)
    setOverlayNote(null)
    setActivePick(null)
    setPendingClearKey(null)
    setClearTick((t) => t + 1)
  }, [])

  const redrawLast = useCallback(() => {
    const last = lastDrawnRef.current
    if (!last) return
    setOverlayNote(null)
    setActivePick(last)
  }, [])

  const registerFill = useCallback((fn: ((fieldKey: string, value: string) => void) | null) => {
    fillRef.current = fn
  }, [])

  const value = useMemo(
    () => ({
      sessionKey,
      activePick,
      overlayNote,
      drawnFieldKeys,
      lastDrawn,
      clearTick,
      pendingClearKey,
      scaleVals,
      setScaleField,
      startPick,
      cancelPick,
      finishPick,
      clearDrawn,
      resetScale,
      redrawLast,
      registerFill,
    }),
    [
      sessionKey,
      activePick,
      overlayNote,
      drawnFieldKeys,
      lastDrawn,
      clearTick,
      pendingClearKey,
      scaleVals,
      setScaleField,
      startPick,
      cancelPick,
      finishPick,
      clearDrawn,
      resetScale,
      redrawLast,
      registerFill,
    ]
  )

  return <HandbookMapContext.Provider value={value}>{children}</HandbookMapContext.Provider>
}

export function useHandbookMapPick() {
  return useContext(HandbookMapContext)
}
