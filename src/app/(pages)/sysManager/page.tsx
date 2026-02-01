import Link from "next/link"
import { Button } from "@/app/shadcnComponents/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/app/shadcnComponents/ui/card"

export default function SysManagerPage() {
  return (
    <div className="space-y-4">
      <Card className="gap-2 rounded-none border-none shadow-none">
        <CardHeader className="pb-1">
          <CardTitle className="text-2xl">시스템 관리</CardTitle>
          <CardDescription className="mt-1">
            시스템 목록 및 설정을 관리하는 메뉴입니다.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          <Button asChild size="sm" variant="outline" className="rounded-none">
            <Link href="/">목록으로</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
