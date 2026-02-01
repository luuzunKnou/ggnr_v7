"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/app/shadcnComponents/ui/card"

export function DbManagerBackupContent({ onBack: _onBack }: { onBack?: () => void }) {
  return (
    <Card className="gap-2 rounded-none border-none shadow-none">
      <CardHeader className="pb-1">
        <CardTitle className="text-2xl">데이터 백업하기</CardTitle>
        <CardDescription className="mt-1">여기에 백업 생성 UI/로직을 붙이면 됩니다.</CardDescription>
      </CardHeader>
      <CardContent className="pt-0" />
    </Card>
  )
}
