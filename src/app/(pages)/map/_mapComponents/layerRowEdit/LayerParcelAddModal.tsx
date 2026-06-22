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
  onAdd: (item: LayerRowParcelItem) => void;
};

export function LayerParcelAddModal({ open, onOpenChange, vworldApiKey, onAdd }: Props) {
  const handleSelect = (item: VWorldAddressItem) => {
    const parcel = vworldItemToParcelItem(item);
    if (!parcel) return;
    onAdd(parcel);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 overflow-hidden rounded-[10px] border-slate-200/80 p-0 sm:max-w-[420px]">
        <DialogHeader className="border-b border-slate-100 bg-gradient-to-b from-slate-50/80 to-white px-4 py-3">
          <DialogTitle className="text-sm font-semibold text-slate-800">필지 추가</DialogTitle>
        </DialogHeader>
        <div className="px-4 py-3">
          <AddressSearchPanel vworldApiKey={vworldApiKey} onSelect={handleSelect} />
          <p className="mt-2 text-[10px] text-slate-400">검색 결과를 선택하면 목록에 추가되고 모달이 닫힙니다.</p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
