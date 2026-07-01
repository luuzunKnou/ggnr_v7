'use client';

import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/app/shadcnComponents/ui/dialog';
import { Button } from '@/app/shadcnComponents/ui/button';
import { X } from 'lucide-react';
import { ACCESS_MODAL_OUTLINE_BTN_CLASS } from '@/lib/accessModalStyles';
import type { ConsoleAreaId } from '@/lib/consoleMenuAccess/types';
import { getConsoleMenuLabel } from '@/lib/consoleMenuAccess/registry';

type ConsoleMenuAccessDeniedDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  area: ConsoleAreaId;
  menuId: string;
};

export function ConsoleMenuAccessDeniedDialog({
  open,
  onOpenChange,
  area,
  menuId,
}: ConsoleMenuAccessDeniedDialogProps) {
  const label = getConsoleMenuLabel(area, menuId);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-md sm:max-w-md" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle className="text-base font-semibold">접근 권한 없음</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground leading-relaxed py-1">
          «{label}» 메뉴에 접근할 수 있는 권한이 없습니다. 관리자에게 권한 부여를 요청해 주세요.
        </p>
        <DialogFooter className="sm:justify-end">
          <Button
            type="button"
            variant="outline"
            className={ACCESS_MODAL_OUTLINE_BTN_CLASS}
            onClick={() => onOpenChange(false)}
          >
            <X className="h-4 w-4 shrink-0" aria-hidden />
            닫기
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
