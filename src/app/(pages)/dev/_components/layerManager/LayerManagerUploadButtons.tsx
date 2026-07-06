"use client"

import { Button } from "@/app/shadcnComponents/ui/button"
import { Upload, FileSpreadsheet } from "lucide-react"
import { requestLayerManagerUpload } from "./layerManagerUploadBridge"

const uploadBtnClass =
  "rounded-none gap-1.5 text-xs bg-background hover:bg-muted/50 text-foreground shadow-none h-8"

export function LayerManagerUploadButtons() {
  return (
    <div className="flex items-center gap-1.5 flex-wrap justify-end">
      <Button
        type="button"
        variant="outline"
        size="sm"
        className={uploadBtnClass}
        onClick={() => requestLayerManagerUpload("shp")}
      >
        <Upload className="w-3.5 h-3.5 opacity-70" />
        SHP 업로드
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className={uploadBtnClass}
        onClick={() => requestLayerManagerUpload("exl")}
      >
        <FileSpreadsheet className="w-3.5 h-3.5 opacity-70" />
        Excel 업로드
      </Button>
    </div>
  )
}
