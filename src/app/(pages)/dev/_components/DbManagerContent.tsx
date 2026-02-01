"use client"

import { useState } from "react"
import { Button } from "@/app/shadcnComponents/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/app/shadcnComponents/ui/card"
import { Dialog, DialogContent, DialogTitle } from "@/app/shadcnComponents/ui/dialog"
import { DbManagerImportContent } from "./DbManagerImportContent"
import { DbManagerBackupContent } from "./DbManagerBackupContent"
import { DbManagerUpdateContent } from "./DbManagerUpdateContent"
import { DbManagerSyncContent } from "./DbManagerSyncContent"
import { DbManagerErDiagramContent } from "./DbManagerErDiagramContent"
import { DbManagerTableDefContent } from "./DbManagerTableDefContent"

type DbManagerModalType = "import" | "backup" | "update" | "sync" | "erDiagram" | "tableDef" | null

export function DbManagerContent() {
  const [modalType, setModalType] = useState<DbManagerModalType>(null)
  const open = modalType !== null

  const closeModal = () => setModalType(null)

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
        <Card className="rounded-none">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">테이블 구조 동기화</CardTitle>
            <CardDescription>업데이트된 테이블 및 필드 확인/동기화</CardDescription>
          </CardHeader>
          <CardContent>
            <Button size="sm" className="rounded-none" onClick={() => setModalType("sync")}>
              열기
            </Button>
          </CardContent>
        </Card>

        <Card className="rounded-none">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">데이터 가져오기</CardTitle>
            <CardDescription>외부/내부 소스에서 데이터 적재</CardDescription>
          </CardHeader>
          <CardContent>
            <Button size="sm" className="rounded-none" onClick={() => setModalType("import")}>
              열기
            </Button>
          </CardContent>
        </Card>

        <Card className="rounded-none">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">데이터 백업하기</CardTitle>
            <CardDescription>현재 DB 상태 백업 생성</CardDescription>
          </CardHeader>
          <CardContent>
            <Button size="sm" className="rounded-none" onClick={() => setModalType("backup")}>
              열기
            </Button>
          </CardContent>
        </Card>

        <Card className="rounded-none">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">데이터 업데이트</CardTitle>
            <CardDescription>기존 데이터 변경/동기화</CardDescription>
          </CardHeader>
          <CardContent>
            <Button size="sm" className="rounded-none" onClick={() => setModalType("update")}>
              열기
            </Button>
          </CardContent>
        </Card>

        <Card className="rounded-none">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">ER-Diagram</CardTitle>
            <CardDescription>논리/물리 ER 다이어그램 보기</CardDescription>
          </CardHeader>
          <CardContent>
            <Button size="sm" className="rounded-none" onClick={() => setModalType("erDiagram")}>
              열기
            </Button>
          </CardContent>
        </Card>

        <Card className="rounded-none">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">테이블 정의서 보기</CardTitle>
            <CardDescription>테이블·컬럼 정의 목록 보기</CardDescription>
          </CardHeader>
          <CardContent>
            <Button size="sm" className="rounded-none" onClick={() => setModalType("tableDef")}>
              열기
            </Button>
          </CardContent>
        </Card>
      </div>

      <Dialog open={open} onOpenChange={(o) => !o && closeModal()}>
        <DialogContent className="w-full min-w-[1800px] h-[94vh] max-h-[94vh] rounded-none p-3 flex flex-col gap-0 overflow-hidden [&>button]:shrink-0">
          <DialogTitle className="sr-only">
            {modalType === "import" && "데이터 가져오기"}
            {modalType === "backup" && "데이터 백업하기"}
            {modalType === "update" && "데이터 업데이트"}
            {modalType === "sync" && "테이블 구조 동기화"}
            {modalType === "erDiagram" && "ER-Diagram"}
            {modalType === "tableDef" && "테이블 정의서 보기"}
          </DialogTitle>
          <div className="flex-1 min-h-0 overflow-y-auto pr-1">
            {modalType === "import" && <DbManagerImportContent onBack={closeModal} />}
            {modalType === "backup" && <DbManagerBackupContent onBack={closeModal} />}
            {modalType === "update" && <DbManagerUpdateContent onBack={closeModal} />}
            {modalType === "sync" && <DbManagerSyncContent onBack={closeModal} />}
            {modalType === "erDiagram" && <DbManagerErDiagramContent onBack={closeModal} />}
            {modalType === "tableDef" && <DbManagerTableDefContent onBack={closeModal} />}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
