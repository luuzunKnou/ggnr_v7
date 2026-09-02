"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/app/shadcnComponents/ui/dialog";
import { AddressSearchPanel } from "../addressSearch/AddressSearchPanel";
import type { VWorldAddressItem } from "../addressSearch/vworldAddressSearch";
import { vworldItemToParcelItem } from "./layerRowParcelUtils";
import type { LayerRowParcelItem } from "./types";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vworldApiKey: string;
  onAdd: (item: LayerRowParcelItem) => void | boolean | Promise<void | boolean>;
  /** 모달 제목 (기본: 필지 추가) */
  title?: string;
};

export function LayerParcelAddModal({
  open,
  onOpenChange,
  vworldApiKey,
  onAdd,
  title = "필지 추가",
}: Props) {
  const handleSelect = async (item: VWorldAddressItem) => {
    const parcel = vworldItemToParcelItem(item);
    if (!parcel) return;
    const ok = await Promise.resolve(onAdd(parcel));
    if (ok === false) return;
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 overflow-hidden rounded-[10px] border-border/80 p-0 sm:max-w-[420px]">
        <DialogHeader className="border-b border-border bg-gradient-to-b from-muted/30 to-background px-4 py-3">
          <DialogTitle className="text-sm font-semibold text-foreground">{title}</DialogTitle>
        </DialogHeader>
        <div className="px-4 py-3">
          <AddressSearchPanel vworldApiKey={vworldApiKey} onSelect={handleSelect} />
          <p className="mt-2 text-[10px] text-muted-foreground">검색 결과를 선택하면 목록에 추가되고 모달이 닫힙니다.</p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
