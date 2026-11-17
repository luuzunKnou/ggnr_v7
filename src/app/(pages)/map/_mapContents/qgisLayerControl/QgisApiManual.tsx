'use client';

import { useState } from 'react';
import {
  ServiceFileImagePreview,
  type ServiceFilePreviewItem,
} from '@/app/(pages)/map/_mapComponents/standard/ServiceFileImagePreview';

type Shot = {
  src: string;
  alt: string;
  caption: string;
};

type Step = {
  title: string;
  body: string;
  points?: string[];
  images?: Shot[];
};

const STEPS: Step[] = [
  {
    title: '데이터소스 관리자',
    body: '',
    points: ['『레이어』 → 『데이터소스 관리자』를 클릭합니다.'],
    images: [
      {
        src: '/image/qgis-manual/1번.png',
        alt: 'QGIS 레이어 메뉴에서 데이터소스 관리자를 연 화면',
        caption: '데이터소스 관리자',
      },
    ],
  },
  {
    title: '서버 연결',
    body: '',
    points: [
      '『WFS / OGC API - 피처』를 선택합니다. 드론영상은 『WMS/WMTS』를 선택합니다.',
      '『새로 생성』을 클릭합니다. 기존 연결은 『편집』을 클릭합니다.',
    ],
    images: [
      {
        src: '/image/qgis-manual/2번.png',
        alt: '데이터소스 관리자에서 WFS를 고르고 새로 생성을 누른 화면',
        caption: '서버 연결',
      },
    ],
  },
  {
    title: '접속 주소',
    body: '',
    points: ['이름과 복사한 접속 주소를 입력합니다.', '『확인』을 클릭합니다.'],
    images: [
      {
        src: '/image/qgis-manual/3번.png',
        alt: '연결 설정 창에 이름과 주소를 넣고 확인을 누른 화면',
        caption: '접속 주소',
      },
    ],
  },
  {
    title: '레이어 추가',
    body: '',
    points: [
      '생성한 연결을 선택한 후 『연결』을 클릭합니다.',
      '표시할 레이어를 선택합니다.',
      '『추가』를 클릭하면 지도에 표시됩니다.',
    ],
    images: [
      {
        src: '/image/qgis-manual/4번.png',
        alt: '연결 후 레이어를 고르고 추가를 누른 화면',
        caption: '레이어 추가',
      },
    ],
  },
];

const MANUAL_IMAGES: ServiceFilePreviewItem[] = STEPS.flatMap((step) =>
  (step.images ?? []).map((shot) => ({
    url: shot.src,
    fileName: shot.caption,
    kind: 'image' as const,
  }))
);

export function QgisApiManual() {
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);

  return (
    <aside className="flex min-h-0 w-[26rem] shrink-0 flex-col border-l border-border bg-background">
      <div className="shrink-0 border-b border-border px-4 py-3">
        <p className="text-sm font-semibold text-foreground">사용설명</p>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-2.5">
        <ol className="flex flex-col gap-3">
          {STEPS.map((step, index) => (
            <li key={step.title} className="shrink-0">
              <p className="shrink-0 text-sm font-semibold text-foreground">
                <span className="mr-1.5 text-muted-foreground">{index + 1}.</span>
                {step.title}
              </p>
              {step.body ? (
                <p className="mt-0.5 shrink-0 text-[13px] leading-5 text-foreground/80">{step.body}</p>
              ) : null}
              {step.points ? (
                <ol className="mt-1 shrink-0 list-decimal space-y-0.5 pl-4 text-[13px] leading-5 text-foreground/80">
                  {step.points.map((point) => (
                    <li key={point}>{point}</li>
                  ))}
                </ol>
              ) : null}
              {step.images && step.images.length > 0 ? (
                <div className="mt-1.5 flex flex-col gap-2">
                  {step.images.map((shot) => (
                    <button
                      key={shot.src}
                      type="button"
                      title="크게 보기"
                      className="flex w-full flex-col overflow-hidden rounded-md border border-border bg-muted/30 text-left"
                      onClick={() => {
                        const found = MANUAL_IMAGES.findIndex((item) => item.url === shot.src);
                        setPreviewIndex(found >= 0 ? found : 0);
                      }}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element -- 매뉴얼 정적 캡처 */}
                      <img
                        src={shot.src}
                        alt={shot.alt}
                        className="h-auto w-full bg-background"
                      />
                      <span className="block shrink-0 border-t border-border px-2 py-0.5 text-xs text-foreground/70">
                        {shot.caption}
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}
            </li>
          ))}
        </ol>
        <p className="mt-2 shrink-0 border-t border-border pt-2 text-[13px] leading-5 text-foreground/80">
          사진 속 주소는 참고입니다. 이 화면 왼쪽 주소를 넣으세요. 키를 다시 발급하거나 삭제하면 예전 주소는 쓸 수 없습니다.
        </p>
      </div>
      {previewIndex != null ? (
        <ServiceFileImagePreview
          items={MANUAL_IMAGES}
          initialIndex={previewIndex}
          onClose={() => setPreviewIndex(null)}
        />
      ) : null}
    </aside>
  );
}
