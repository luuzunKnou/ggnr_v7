'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { copyTextToClipboard } from '@/lib/utils';
import { InlineCode } from '../install-manual/InlineCode';

const SECTIONS = [
  { id: 'contour', label: '고도(등고선)' },
  { id: 'kais', label: '건설•도로' },
] as const;

const STEP_LIST = 'list-decimal space-y-3 pl-5';

function CodeBlock({ children }: { children: string }) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const handleCopy = useCallback(async () => {
    const ok = await copyTextToClipboard(children);
    if (!ok) return;
    setCopied(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setCopied(false), 1500);
  }, [children]);

  return (
    <button
      type="button"
      onClick={() => void handleCopy()}
      title={copied ? '복사됨' : '클릭하여 복사'}
      className="flex w-full cursor-pointer items-start gap-2 rounded border border-border bg-muted/40 px-3 py-2 text-left text-[11px] leading-relaxed text-foreground transition-colors hover:border-primary/40 hover:bg-muted/60"
    >
      <pre className="m-0 min-w-0 flex-1 overflow-x-auto whitespace-pre-wrap break-all font-mono">
        <code>{children}</code>
      </pre>
      <span
        className="mt-0.5 inline-flex shrink-0 items-center justify-center rounded p-0.5 text-muted-foreground"
        aria-hidden
      >
        {copied ? (
          <Check className="h-3.5 w-3.5 text-primary" />
        ) : (
          <Copy className="h-3.5 w-3.5" />
        )}
      </span>
    </button>
  );
}

export function BaseDataManualClient() {
  const scrollToSection = (id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="flex h-screen min-h-0 bg-background text-foreground border">
      <aside className="flex w-64 shrink-0 flex-col border-r bg-muted/80">
        <nav
          className="min-h-0 flex-1 overflow-y-auto px-2 py-2"
          aria-label="목차"
          style={{ display: 'flex', flexDirection: 'column', gap: 20 }}
        >
          {SECTIONS.map((sec) => (
            <button
              key={sec.id}
              type="button"
              title={sec.label}
              onClick={() => scrollToSection(sec.id)}
              className="block w-full cursor-pointer rounded-sm py-1 pl-2.5 pr-1 text-left text-xs font-medium leading-snug text-foreground hover:bg-primary/5 hover:text-primary"
            >
              {sec.label}
            </button>
          ))}
        </nav>
      </aside>

      <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          <article className="mx-auto max-w-3xl space-y-10 text-sm leading-relaxed">
            <section id="contour" className="scroll-mt-4 space-y-3">
              <h1 className="text-xl font-semibold">고도(등고선)</h1>
              <ul className={STEP_LIST}>
                <li>브이월드 &gt; 공간정보 다운로드 &gt; 등고선(지도-고도) 다운로드</li>
                <li>필요 지역 대해 다운로드</li>
                <li>
                  Qgis 열어서{' '}
                  <strong>레이어를 합치기(용량 문제로 브이월드가 레이어를 쪼개서 제공함)</strong>
                  <ul className="mt-1 list-[lower-alpha] pl-5">
                    <li>벡터 &gt; 데이터 관리 도구 &gt;벡터 레이어 병합</li>
                    <li>공간처리&gt; 툴박스 &gt; 중복 도형 삭제</li>
                  </ul>
                </li>
                <li>
                  Qgis에 현재 프로젝트 행정경계 레이어 추가
                  <ul className="mt-1 list-[lower-alpha] space-y-2 pl-5">
                    <li>
                      행정경계 없으면 아래에서 찾아서 레이어 추가
                      <div className="mt-1">
                        <CodeBlock>{`\\\\192.168.120.15\\ftp_농관원\\2026년 수급자료\\01 행정경계\\20260424 행정경계 통합 12차 (GTMM50, ~20260325까지 보완)`}</CodeBlock>
                      </div>
                    </li>
                    <li>전국 단위라서 필터(BJCD 입력해서 레이어 필터링)</li>
                  </ul>
                </li>
                <li>
                  Qgis &gt; 벡터 &gt; 지리정보처리도구 &gt; 잘라내기
                  <ul className="mt-1 list-[lower-alpha] pl-5">
                    <li>잘라내기 안하고 도 단위로 자르면 용량 문제로 내보내기가 안됨</li>
                  </ul>
                </li>
                <li>
                  layer, path 필드 삭제: 레이어 우클릭 &gt; 속성 테이블 &gt; 상단 연필(편집 모드) &gt;
                  필드 속성 삭제 &gt; 저장
                </li>
              </ul>
            </section>

            <section id="kais" className="scroll-mt-4 space-y-3">
              <h1 className="text-xl font-semibold">건설•도로</h1>
              <ul className={STEP_LIST}>
                <li>
                  폴더 위치
                  <div className="mt-1">
                    <CodeBlock>{`\\\\192.168.127.11\\사업수행_개발\\133 공간누리 세팅 자료\\11 KAIS 지자체별 데이터`}</CodeBlock>
                  </div>
                </li>
                <li>
                  해당 위치에서 <InlineCode>sig_cd</InlineCode>를 기준으로 필터링해서 레이어 추출
                </li>
                <li>
                  <p>이후 스케줄러 필터링 기준은 아래 우선순위에 따라 적용됩니다.</p>
                  <p>- runtime.env에 SGG_CODE 넣기</p>
                  <p>
                    - public_layer.sgg의 <InlineCode>adm_sect_cd</InlineCode> 참고
                  </p>
                </li>
              </ul>
            </section>
          </article>
        </div>
      </main>
    </div>
  );
}
