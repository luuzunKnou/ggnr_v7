export type DataHistoryCardItem = {
  id: string
  author: string
  createdAt: string
  content: string
  agency: string
  /** his_extra (저수조 용량·재질 등) */
  extra: Record<string, unknown> | null
}

export type DataHistoryCardModalMode = 'add' | 'edit'
