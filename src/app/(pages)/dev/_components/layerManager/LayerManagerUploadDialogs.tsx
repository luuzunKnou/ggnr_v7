"use client"

import { useState, useEffect } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/app/shadcnComponents/ui/dialog"
import { ShpWizardModal } from "../shp/ShpWizardModal"
import { ExlWizardModal } from "../exl/ExlWizardModal"
import { ExcelToDbWizardModal } from "../exl/ExcelToDbWizardModal"
import { ServerDataBrowser } from "./ServerDataBrowser"

export type LayerUploadDialogKind = "shp" | "exl" | null

type LayerManagerUploadDialogsProps = {
  kind: LayerUploadDialogKind
  onClose: () => void
  onSuccess?: (kind: Exclude<LayerUploadDialogKind, null>) => void
}

const SHP_ROOT = "shp_data"
const EXL_ROOT = "excel_data"

export function LayerManagerUploadDialogs({ kind, onClose, onSuccess }: LayerManagerUploadDialogsProps) {
  const [shpServerPickerOpen, setShpServerPickerOpen] = useState(false)
  const [shpServerFolder, setShpServerFolder] = useState<{
    relativePath: string
    folderName: string
  } | null>(null)
  const [exlServerPickerOpen, setExlServerPickerOpen] = useState(false)
  const [exlServerTarget, setExlServerTarget] = useState<{
    fileRelPath: string
    fileName: string
    folderName: string
  } | null>(null)

  useEffect(() => {
    if (kind === "shp") {
      setShpServerPickerOpen(false)
      setShpServerFolder(null)
    }
    if (kind !== "exl") {
      setExlServerPickerOpen(false)
      setExlServerTarget(null)
    }
  }, [kind])

  const handleSuccess = (completed: Exclude<LayerUploadDialogKind, null>) => {
    onSuccess?.(completed)
    onClose()
  }

  return (
    <>
      <ShpWizardModal
        open={kind === "shp"}
        onOpenChange={(o) => {
          if (!o) onClose()
        }}
        relativePath={SHP_ROOT}
        showServerPickButton
        onPickFromServer={() => setShpServerPickerOpen(true)}
        serverFolderSelection={shpServerFolder}
        onClearServerFolderSelection={() => setShpServerFolder(null)}
        configureVisible={!shpServerPickerOpen}
        onSuccess={() => handleSuccess("shp")}
      />

      <Dialog open={shpServerPickerOpen} onOpenChange={setShpServerPickerOpen}>
        <DialogContent className="max-w-3xl w-[95vw] h-[80vh] flex flex-col gap-3 overflow-hidden">
          <DialogHeader className="shrink-0">
            <DialogTitle>SHP — 서버에서 선택</DialogTitle>
          </DialogHeader>
          <div className="flex-1 min-h-0">
            <ServerDataBrowser
              rootPath={SHP_ROOT}
              pickMode="folder"
              onPickFolder={(relativePath) => {
                const folderName = relativePath.split("/").filter(Boolean).pop() ?? ""
                setShpServerFolder({ relativePath, folderName })
                setShpServerPickerOpen(false)
              }}
            />
          </div>
        </DialogContent>
      </Dialog>

      <ExlWizardModal
        open={kind === "exl" && !exlServerPickerOpen && !exlServerTarget}
        onOpenChange={(o) => {
          if (!o) onClose()
        }}
        relativePath={EXL_ROOT}
        showServerPickButton
        onPickFromServer={() => setExlServerPickerOpen(true)}
        onSuccess={() => handleSuccess("exl")}
      />

      <Dialog open={exlServerPickerOpen} onOpenChange={setExlServerPickerOpen}>
        <DialogContent className="max-w-3xl w-[95vw] h-[80vh] flex flex-col gap-3 overflow-hidden">
          <DialogHeader className="shrink-0">
            <DialogTitle>Excel — 서버에서 선택</DialogTitle>
          </DialogHeader>
          <div className="flex-1 min-h-0">
            <ServerDataBrowser
              rootPath={EXL_ROOT}
              pickMode="file"
              fileFilter={(name) => /\.(xlsx|xls)$/i.test(name)}
              onPickFile={(fileRelPath, fileName) => {
                const parts = fileRelPath.replace(/\\/g, "/").split("/").filter(Boolean)
                const folderName = parts.length >= 2 ? parts[parts.length - 2] : parts[0] ?? ""
                setExlServerTarget({ fileRelPath, fileName, folderName })
                setExlServerPickerOpen(false)
              }}
            />
          </div>
        </DialogContent>
      </Dialog>

      <ExcelToDbWizardModal
        open={!!exlServerTarget}
        onOpenChange={(o) => {
          if (!o) setExlServerTarget(null)
        }}
        folderName={exlServerTarget?.folderName ?? ""}
        fileName={exlServerTarget?.fileName ?? ""}
        fileRelPath={exlServerTarget?.fileRelPath ?? ""}
        onSuccess={() => {
          setExlServerTarget(null)
          handleSuccess("exl")
        }}
      />
    </>
  )
}
