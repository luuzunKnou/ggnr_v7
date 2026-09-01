'use client';

import React, { useState, useEffect } from 'react';
import type { CompUI } from './types';
import {
  Calendar,
  MapPin,
  Phone,
  User,
  Users,
  Building2,
  FileText,
  Check,
  X,
  Crosshair,
} from 'lucide-react';
import { Input } from '@/app/shadcnComponents/ui/input';
import { Button } from '@/app/shadcnComponents/ui/button';
import { useMapContext } from '../MapContext';
import { AddressSearchPanel } from '../addressSearch/AddressSearchPanel';
import { useMapPointPick } from '../addressSearch/useMapPointPick';
import { cn } from '@/lib/utils';

export type ComplaintFormValues = {
  compName: string;
  compTel: string;
  compDate: string;
  compCg: string;
  compCt: string;
  compCu: string;
  compAdr: string;
  compContent: string;
  /** 주소검색 선택 시 EPSG:4326 — 저장 시 geom 반영 */
  lon?: number | null;
  lat?: number | null;
};

interface ComplaintInfoProps {
  complaint: CompUI;
  onSave?: (values: ComplaintFormValues) => void | Promise<void>;
  onDelete?: () => void | Promise<void>;
  onClose?: () => void;
  saving?: boolean;
  deleting?: boolean;
}

function todayStr() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function toFormValues(c: CompUI): ComplaintFormValues {
  return {
    compName: c.compName ?? '',
    compTel: c.compTel ?? '',
    compDate: c.compDate ? c.compDate.slice(0, 10) : (c.compKey === 0 ? todayStr() : ''),
    compCg: c.compCg ?? '',
    compCt: c.compCt ?? '',
    compCu: c.compCu ?? '',
    compAdr: c.compAdr ?? '',
    compContent: c.compContent ?? '',
    lon: null,
    lat: null,
  };
}

function InfoItemWithInput({
  icon,
  label,
  value,
  onChange,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  onChange?: (value: string) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="flex h-8 shrink-0 items-center text-muted-foreground/80">{icon}</span>
      <span className="w-14 shrink-0 text-[12px] text-muted-foreground/90">{label}</span>
      <Input
        value={value}
        onChange={onChange ? (e) => onChange(e.target.value) : undefined}
        readOnly={!onChange}
        placeholder="-"
        style={{ fontSize: '12px' }}
        className="h-8 flex-1 min-w-0 border-border/80 bg-muted/30 placeholder:text-[12px]"
      />
    </div>
  );
}

export function ComplaintInfo({ complaint, onSave, onDelete, onClose, saving = false, deleting = false }: ComplaintInfoProps) {
  const mapContext = useMapContext();
  const vworldApiKey = mapContext?.vworldApiKey ?? '';
  const [form, setForm] = useState<ComplaintFormValues>(() => toFormValues(complaint));

  const { pickMode, startPick, stopPick, clearDraftPoint } = useMapPointPick({
    vworldApiKey,
    onPicked: ({ lon, lat, address }) => {
      setForm((prev) => ({
        ...prev,
        compAdr: address || prev.compAdr,
        lon,
        lat,
      }));
    },
  });

  useEffect(() => {
    setForm(toFormValues(complaint));
  }, [complaint.compKey, complaint.compName, complaint.compTel, complaint.compDate, complaint.compCg, complaint.compCt, complaint.compCu, complaint.compAdr, complaint.compContent]);

  const update = (field: keyof ComplaintFormValues, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  return (
    <div className="rounded-xl border border-border bg-card px-3 pt-3 pb-[15px]">
      <div className="flex flex-col gap-3.5">
        <div className="grid grid-cols-1 gap-y-3.5 sm:grid-cols-2 sm:gap-x-4">
          <InfoItemWithInput
            icon={<Building2 className="h-3.5 w-3.5" />}
            label="담당부서"
            value={form.compCg}
            onChange={(v) => update('compCg', v)}
          />
          <InfoItemWithInput
            icon={<Users className="h-3.5 w-3.5" />}
            label="담당팀"
            value={form.compCt}
            onChange={(v) => update('compCt', v)}
          />
          <InfoItemWithInput
            icon={<User className="h-3.5 w-3.5" />}
            label="담당자"
            value={form.compCu}
            onChange={(v) => update('compCu', v)}
          />
          <div className="flex items-center gap-2">
            <span className="flex h-8 shrink-0 items-center text-muted-foreground/80">
              <Calendar className="h-3.5 w-3.5" />
            </span>
            <span className="w-14 shrink-0 text-[12px] text-muted-foreground/90">접수일자</span>
            <Input
              type="date"
              value={form.compDate}
              onChange={(e) => update('compDate', e.target.value)}
              style={{ fontSize: '12px' }}
              className="h-8 flex-1 min-w-0 border-border/80 bg-muted/30 accent-primary input-date-primary"
            />
          </div>
        </div>
        <div className="grid grid-cols-1 gap-y-3.5 sm:grid-cols-2 sm:gap-x-4">
          <InfoItemWithInput
            icon={<User className="h-3.5 w-3.5" />}
            label="민원인"
            value={form.compName}
            onChange={(v) => update('compName', v)}
          />
          <InfoItemWithInput
            icon={<Phone className="h-3.5 w-3.5" />}
            label="연락처"
            value={form.compTel}
            onChange={(v) => update('compTel', v)}
          />
        </div>
        <div className="flex items-start gap-2">
          <span className="flex h-8 shrink-0 items-center text-muted-foreground/80">
            <MapPin className="h-3.5 w-3.5" />
          </span>
          <span className="flex h-8 shrink-0 items-center w-14 text-[12px] text-muted-foreground/90">
            주소
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <AddressSearchPanel
                  layout="field"
                  includePlace
                  vworldApiKey={vworldApiKey}
                  initialQuery={form.compAdr}
                  placeholder="주소/지번/장소 검색"
                  onSelect={(item) => {
                    const adr =
                      (item.roadAddress ?? '').trim() ||
                      (item.jibunAddress ?? '').trim() ||
                      (item.title ?? '').trim() ||
                      (item.address ?? '').trim();
                    const lon = Number(item.point?.x);
                    const lat = Number(item.point?.y);
                    setForm((prev) => ({
                      ...prev,
                      compAdr: adr || prev.compAdr,
                      lon: Number.isFinite(lon) ? lon : null,
                      lat: Number.isFinite(lat) ? lat : null,
                    }));
                  }}
                  onClear={() =>
                    setForm((prev) => ({ ...prev, compAdr: '', lon: null, lat: null }))
                  }
                />
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                title={pickMode ? '위치 지정 취소' : '지도에서 위치 찍기'}
                aria-label={pickMode ? '위치 지정 취소' : '지도에서 위치 찍기'}
                onClick={pickMode ? stopPick : startPick}
                className={cn(
                  'h-8 w-8 shrink-0 p-0',
                  pickMode
                    ? 'border-orange-300 bg-orange-50 text-orange-700 hover:bg-orange-50'
                    : 'border-border bg-background text-muted-foreground hover:border-primary hover:bg-primary/15 hover:text-primary'
                )}
              >
                {pickMode ? <X className="h-3.5 w-3.5" /> : <Crosshair className="h-3.5 w-3.5" />}
              </Button>
            </div>
            {pickMode && (
              <p className="mt-1 text-[11px] text-muted-foreground">지도를 클릭해 민원 위치를 지정하세요.</p>
            )}
          </div>
        </div>
        <div className="flex items-start gap-2">
          <span className="flex h-5 shrink-0 items-center text-muted-foreground/80">
            <FileText className="h-3.5 w-3.5" />
          </span>
          <span className="flex h-5 shrink-0 items-center w-14 text-[12px] text-muted-foreground/90">내용</span>
          <textarea
            value={form.compContent}
            onChange={(e) => update('compContent', e.target.value)}
            placeholder="-"
            rows={6}
            style={{ fontSize: '12px' }}
            className="min-h-[5.5rem] flex-1 min-w-0 resize-none rounded-md border border-border/80 bg-muted/30 px-3 py-2 text-foreground/90 placeholder:text-muted-foreground focus:outline-none focus:ring-0 focus:border-primary"
          />
        </div>
      </div>

      <div className="mt-3 flex items-center justify-end gap-2">
        {onDelete && (
          <Button
            size="sm"
            variant="outline"
            title={deleting ? '삭제 중…' : '삭제'}
            onClick={onDelete}
            disabled={deleting}
            className="h-[26px] min-h-[26px] cursor-pointer gap-1 px-2.5 text-[12px] font-light border border-border bg-muted/50 text-muted-foreground hover:border-destructive hover:bg-destructive/15 hover:text-destructive disabled:cursor-not-allowed"
          >
            <X className="h-3 w-3" />
            {deleting ? '삭제 중…' : '삭제'}
          </Button>
        )}
        {onSave && (
          <Button
            size="sm"
            title={saving ? '저장 중…' : '저장'}
            onClick={async () => {
              await onSave(form);
              clearDraftPoint();
            }}
            disabled={saving}
            className="h-[26px] min-h-[26px] cursor-pointer gap-1 px-2.5 text-[12px] font-light border border-border bg-muted/50 text-muted-foreground hover:border-primary hover:bg-primary/15 hover:text-primary disabled:cursor-not-allowed"
          >
            <Check className="h-3 w-3" />
            {saving ? '저장 중…' : '저장'}
          </Button>
        )}
        {onClose && (
          <Button
            size="sm"
            variant="outline"
            title="닫기"
            onClick={onClose}
            className="h-[26px] min-h-[26px] cursor-pointer gap-1 px-2.5 text-[12px] font-light border border-border bg-muted/50 text-muted-foreground hover:border-border hover:bg-muted/50 hover:text-foreground"
          >
            <X className="h-3 w-3" />
            닫기
          </Button>
        )}
      </div>
    </div>
  );
}
