export type GcpPoint = {
  id: string
  gcpnum: string
  x: number
  y: number
  z: number
  geom5181: [number, number]
  placeNote: string
  txt1?: string
  txt2?: string
}

export function placeNoteFromTxt(txt1: string, txt2: string): string {
  const a = String(txt1 ?? '').trim()
  const b = String(txt2 ?? '').trim()
  if (a && b) return `${a} / ${b}`
  return a || b || ''
}
