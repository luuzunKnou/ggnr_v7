/** webkitRelativePath 와 동일하게 업로드 경로를 맞추기 위한 확장 File */
export type FolderPickFile = File & { webkitRelativePath?: string };
