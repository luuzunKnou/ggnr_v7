'use client';

import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/app/shadcnComponents/ui/dialog';
import { Button } from '@/app/shadcnComponents/ui/button';
import { ShpCrsPreviewMap } from './ShpCrsPreviewMap';

export type ShpCrsCandidate = {
  epsg: number;
  sourceCrs: string;
  intersectsEmd: boolean;
  overlapRatio: number;
};

type DisplayCard = {
  sourceCrs: string;
  epsg: number;
  overlapRatio: number;
  intersectsEmd: boolean;
};

type Props = {
  open: boolean;
  fileName?: string | null;
  candidates: ShpCrsCandidate[];
  /** EPSG:5181(최종 임포트 목표) 비교용 참고 값. 일치율 상위 후보가 1개뿐일 때 우측 비교 카드로 표시 */
  reference5181?: ShpCrsCandidate;
  /** 이 행에 이미 입력되어 있던 값(prj/폴더명 등). 후보 중에 있으면 기본 선택값으로 사용해 실수로 덮어쓰지 않게 한다 */
  currentEpsg?: number | null;
  geojson: Record<string, unknown> | null;
  onConfirm: (epsg: number) => void;
  onCancel: () => void;
};

export function ShpCrsCandidateModal({ open, fileName, candidates, reference5181, currentEpsg, geojson, onConfirm, onCancel }: Props) {
  const primary = candidates.slice(0, 2);
  const cards: DisplayCard[] = primary.map((c) => ({
    sourceCrs: c.sourceCrs,
    epsg: c.epsg,
    overlapRatio: c.overlapRatio,
    intersectsEmd: c.intersectsEmd,
  }));
  if (primary.length <= 1 && reference5181 && reference5181.epsg !== primary[0]?.epsg) {
    cards.push({
      sourceCrs: reference5181.sourceCrs,
      epsg: reference5181.epsg,
      overlapRatio: reference5181.overlapRatio,
      intersectsEmd: reference5181.intersectsEmd,
    });
  }

  const defaultSelected = () =>
    (currentEpsg != null ? cards.find((c) => c.epsg === currentEpsg)?.sourceCrs : undefined) ?? cards[0]?.sourceCrs ?? null;
  const [selected, setSelected] = useState<string | null>(defaultSelected());

  useEffect(() => {
    if (open) setSelected(defaultSelected());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, fileName]);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onCancel(); }}>
      <DialogContent className="flex max-h-[88vh] w-[1100px] max-w-[96vw] flex-col gap-0 overflow-hidden">
        <DialogHeader className="mb-[10px] shrink-0">
          <DialogTitle>좌표계 추정 결과{fileName ? ` - ${fileName}` : ''}</DialogTitle>
        </DialogHeader>
        <div className="min-h-0 overflow-y-auto pr-1 mb-3">
          {!cards.length ? (
            <p className="text-xs text-muted-foreground">대한민국 경계와 겹치는 좌표계 후보를 찾지 못했습니다.</p>
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {cards.map((c) => {
                const isSelected = selected === c.sourceCrs;
                return (
                  <div
                    key={c.sourceCrs}
                    className={`group space-y-2 rounded border p-2 cursor-pointer ${isSelected ? 'border-blue-500 bg-blue-50/40 dark:bg-blue-950/20' : 'border-border'}`}
                    onClick={() => setSelected(c.sourceCrs)}
                  >
                    <div className="flex items-center justify-between">
                      <button
                        type="button"
                        className="text-left text-sm font-medium group-hover:underline cursor-pointer"
                      >
                        {isSelected ? '●' : '○'} {c.sourceCrs}
                      </button>
                      <span className="text-[11px] text-muted-foreground">일치율 {(c.overlapRatio * 100).toFixed(1)}%</span>
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      EMD 교차: {c.intersectsEmd ? '있음' : '없음'}
                    </div>
                    <ShpCrsPreviewMap geojson={geojson} dataProjection={c.sourceCrs} />
                    <p className="text-[10px] text-muted-foreground">
                      배경: VWorld 항공영상
                      <br />
                      빨간색: 해당 좌표계로 해석한 SHP 원본 도형
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <div className="flex flex-col gap-2 border-t pt-2">
          <p className="text-[11px] text-muted-foreground">
            {currentEpsg != null ? (
              <>지도에서 빨간 도형이 실제 위치에 맞게 놓였는지 확인하고, 필요하면 다른 좌표계를 선택해주세요.</>
            ) : (
              <>
                SHP 파일의 좌표계를 자동으로 확인하지 못해 후보를 추정했습니다.
                <br />
                지도에서 빨간 도형이 실제 위치에 맞게 놓인 좌표계를 선택해주세요.
              </>
            )}
          </p>
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              선택 좌표계: <span className="font-mono text-foreground">{selected || '-'}</span>
            </p>
            <div className="flex shrink-0 items-center gap-2">
              <Button type="button" variant="outline" size="sm" onClick={onCancel}>
                직접 입력
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={!selected}
                onClick={() => {
                  const epsg = cards.find((c) => c.sourceCrs === selected)?.epsg;
                  if (epsg != null) onConfirm(epsg);
                }}
              >
                좌표계 저장
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
