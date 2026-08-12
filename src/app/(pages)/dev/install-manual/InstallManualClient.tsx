'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

const SECTIONS = [
  { id: 'nodejs', label: 'Node.js 및 npm 설치' },
  { id: 'package', label: '프로젝트 파일 설치/실행 및 서비스 등록' },
  { id: 'run', label: '구동' },
  { id: 'remove', label: 'Window 서비스 등록 삭제' },
  { id: 'contour', label: '고도(등고선)' },
  { id: 'python-env', label: '레이어 업로드 실패(python/env) 문제' },
] as const;

const TOC_ACTIVE =
  'rounded-r-sm bg-primary/[0.11] pl-2.5 font-medium text-foreground';
const TOC_IDLE =
  'rounded-sm pl-2.5 text-muted-foreground font-medium hover:bg-primary/5 hover:text-foreground';

function ExtLink({ href, children }: { href: string; children: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="cursor-pointer break-all text-primary underline"
      title={children}
    >
      {children}
    </a>
  );
}

function CodeBlock({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded border bg-muted/40 px-3 py-2 text-[11px] leading-relaxed text-foreground">
      <code>{children}</code>
    </pre>
  );
}

export function InstallManualClient() {
  const contentRef = useRef<HTMLElement>(null);
  const [activeId, setActiveId] = useState<string>(SECTIONS[0].id);

  const updateActive = useCallback(() => {
    const root = contentRef.current;
    if (!root) return;
    const top = root.scrollTop + 24;
    let current: string = SECTIONS[0].id;
    for (const sec of SECTIONS) {
      const el = document.getElementById(sec.id);
      if (!el) continue;
      if (el.offsetTop <= top) current = sec.id;
    }
    setActiveId(current);
  }, []);

  useEffect(() => {
    const root = contentRef.current;
    if (!root) return;
    updateActive();
    root.addEventListener('scroll', updateActive, { passive: true });
    return () => root.removeEventListener('scroll', updateActive);
  }, [updateActive]);

  const scrollToSection = (id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="flex h-screen min-h-0 bg-background text-foreground">
      <aside className="flex w-64 shrink-0 flex-col border-r bg-muted/20">
        <div className="border-b px-3 py-2 text-sm font-semibold">설치 매뉴얼</div>
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
              className={cn(
                'block w-full cursor-pointer py-1 pr-1 text-left text-xs leading-snug',
                activeId === sec.id ? TOC_ACTIVE : TOC_IDLE
              )}
            >
              {sec.label}
            </button>
          ))}
        </nav>
      </aside>

      <main ref={contentRef} className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        <article
          className="mx-auto max-w-3xl text-xs leading-relaxed"
          style={{ display: 'flex', flexDirection: 'column', gap: 64 }}
        >
          <section id="nodejs" className="scroll-mt-4 space-y-3">
            <h1 className="text-base font-semibold">Node.js 및 npm 설치</h1>
            <ol className="list-decimal space-y-3 pl-5">
              <li>
                해당 페이지 &gt; 다운로드 &gt; github 다운로드
                <div className="mt-1">
                  <ExtLink href="https://www.nvmnode.com/ko/guide/installation.html">
                    https://www.nvmnode.com/ko/guide/installation.html
                  </ExtLink>
                </div>
              </li>
              <li>
                cmd에서 아래 순서대로 진행
                <ol className="mt-2 list-[lower-alpha] space-y-3 pl-5">
                  <li>
                    nvm 버전 확인(nvm은 설치경로상관없음)
                    <div className="mt-1">
                      <CodeBlock>nvm -v</CodeBlock>
                    </div>
                  </li>
                  <li>
                    최신버전 Node.js 및 npm 설치
                    <div className="mt-1 space-y-1">
                      <CodeBlock>{`nvm install lts

-- 여기서 node랑 npm 최신버전 설치`}</CodeBlock>
                    </div>
                  </li>
                  <li>
                    설치된 node 사용
                    <div className="mt-1">
                      <CodeBlock>{`--버전 확인--
nvm ls
-- 해당 버전 사용--
nvm use (사용할 버전)`}</CodeBlock>
                    </div>
                  </li>
                  <li>
                    설치 확인
                    <div className="mt-1">
                      <CodeBlock>{`node -v
npm -v`}</CodeBlock>
                    </div>
                  </li>
                </ol>
              </li>
            </ol>
          </section>

          <section id="package" className="scroll-mt-4 space-y-3">
            <h1 className="text-base font-semibold">프로젝트 파일 설치/실행 및 서비스 등록</h1>
            <p>
              아래 실행하기 전 먼저 코드에서 TypeScript 타입 검사{' '}
              <code className="rounded bg-muted px-1 py-0.5">npx tsc --noEmit</code> 를 실행하여
              타입에러가 없는지 검사후 (커서에서 타입에러만 수정하도록 요청 -원본 작업자에게 이를 알리고
              진행)
            </p>
            <p>에러가 없을 경우 다음으로 진행</p>
            <p>
              <ExtLink href="http://localhost:3001/dev">http://localhost:3001/dev</ExtLink>{' '}
              (개발자 모드)
            </p>
            <ol className="list-decimal space-y-2 pl-5">
              <li>
                버전관리 &gt; 소스코드 관리 &gt; 설치파일 다운로드
                <ol className="mt-1 list-[lower-alpha] pl-5">
                  <li>
                    <code className="rounded bg-muted px-1 py-0.5">.env</code>에 해당 DB 정보 확인하기
                  </li>
                </ol>
              </li>
              <li>
                GNMS / 현재 서버 선택
                <ol className="mt-1 list-[lower-alpha] space-y-1 pl-5">
                  <li>
                    폐쇄망에 설치할 목적일 경우
                    <ol className="mt-1 list-[lower-roman] pl-5">
                      <li>개발 브라우저에서 현재 서버 &gt; 폐쇄망 선택 후 다운로드</li>
                    </ol>
                  </li>
                </ol>
              </li>
              <li>다운로드 클릭</li>
            </ol>
            <div className="border-t pt-3">
              <ExtLink href="https://nssm.cc/download">https://nssm.cc/download</ExtLink>
              <ol className="mt-2 list-decimal space-y-1 pl-5">
                <li>
                  서비스 등록을 위해 <code className="rounded bg-muted px-1 py-0.5">NSSM</code> 다운로드
                </li>
                <li>
                  사이트 이동 &gt; <strong>Latest release</strong> &gt; ZIP 파일 압축 풀기
                </li>
                <li>
                  C 드라이브에 복사 붙여넣기 후 폴더 이름을{' '}
                  <code className="rounded bg-muted px-1 py-0.5">nssm</code>으로 수정
                </li>
              </ol>
            </div>
          </section>

          <section id="run" className="scroll-mt-4 space-y-3">
            <h1 className="text-base font-semibold">구동</h1>
            <ol className="list-decimal space-y-3 pl-5">
              <li>
                VM C 드라이브 내 <code className="rounded bg-muted px-1 py-0.5">htdocs</code> 폴더
                만들고 설치파일 ZIP 풀기(htdocs는 v6 규칙 따라 만듦)
              </li>
              <li>
                <code className="rounded bg-muted px-1 py-0.5">00_make_ggnr_starter.bat</code> 관리자로
                실행 (소스테스트와 지오서버구동 그리고 실행파일이 만들어짐)
                <ul className="mt-2 list-disc space-y-2 pl-5">
                  <li>
                    node_modules 폴더 여부 확인 후 npm install 진행 질문: y/n 입력 (폐쇄망일 경우
                    node_modules 포함된 설치파일로 가져와야함)
                  </li>
                  <li>
                    프로젝트 및 타입 입력
                    <div className="mt-1">
                      <CodeBlock>{`프로젝트명: build_yy
타입: demo`}</CodeBlock>
                    </div>
                  </li>
                  <li>
                    nssm 등록 관련 y/n 입력
                    <ul className="mt-1 list-disc pl-5">
                      <li>처음 등록할 경우 Y</li>
                    </ul>
                  </li>
                  <li>
                    이후 자동 진행되는 내용
                    <ul className="mt-1 list-disc pl-5">
                      <li>npm run start 되는지 확인</li>
                      <li>Window 서비스 등록</li>
                      <li>window 서비스 로그 확인용 cmd 열기</li>
                    </ul>
                  </li>
                </ul>
              </li>
              <li>
                <code className="rounded bg-muted px-1 py-0.5">00_make_ggnr_starter.bat</code> 구동중
                취소할 경우 npm run start가 제대로 구동되는지 체크되고 있어 cmd 종료시 실행중인 프로세스
                종료가 필요함.
                <ol className="mt-2 list-[lower-alpha] space-y-1 pl-5">
                  <li>Ctrl+C로 종료(자동 청소): 자동 실행중 생성된 파일 제거</li>
                  <li>
                    cmd 자체 종료(수동 청소):{' '}
                    <code className="rounded bg-muted px-1 py-0.5">smoke_ggnr_cleanup.ps1</code> 실행
                  </li>
                </ol>
              </li>
            </ol>
          </section>

          <section id="remove" className="scroll-mt-4 space-y-3">
            <h1 className="text-base font-semibold">Window 서비스 등록 삭제</h1>
            <h2 className="text-sm font-semibold">bat 실행</h2>
            <ol className="list-decimal space-y-1 pl-5">
              <li>
                <code className="rounded bg-muted px-1 py-0.5">Win+R</code>:{' '}
                <code className="rounded bg-muted px-1 py-0.5">services.msc</code> 실행후 GGNR_V7 중지
              </li>
              <li>
                <code className="rounded bg-muted px-1 py-0.5">00_remove_ggnr.bat</code> 실행
              </li>
            </ol>
            <h2 className="text-sm font-semibold">수동 제거</h2>
            <ol className="list-decimal space-y-2 pl-5">
              <li>
                <code className="rounded bg-muted px-1 py-0.5">Win+R</code>:{' '}
                <code className="rounded bg-muted px-1 py-0.5">services.msc</code> 실행후 GGNR_V7 중지
              </li>
              <li>
                cmd 열고 아래 입력
                <div className="mt-1 space-y-2">
                  <CodeBlock>nssm remove GGNR_V7</CodeBlock>
                  <CodeBlock>{`-- 80포트 사용중인 프로세스 검색 및 종료
netstat -ano | findstr :80
taskkill /f /pid [작업 중지 번호]`}</CodeBlock>
                </div>
              </li>
              <li>
                C 드라이브에 <code className="rounded bg-muted px-1 py-0.5">nssm</code> &gt;{' '}
                <code className="rounded bg-muted px-1 py-0.5">win64</code> &gt;{' '}
                <code className="rounded bg-muted px-1 py-0.5">nssm.exe</code>까지 이동
              </li>
            </ol>
          </section>

          <section id="contour" className="scroll-mt-4 space-y-3">
            <h1 className="text-base font-semibold">고도(등고선)</h1>
            <ol className="list-decimal space-y-2 pl-5">
              <li>브이월드 &gt; 공간정보 다운로드 &gt; 등고선(지도-고도) 다운로드</li>
              <li>필요 지역 대해 다운로드</li>
              <li>
                Qgis 열어서 <strong>레이어를 합치기(용량 문제로 브이월드가 레이어를 쪼개서 제공함)</strong>
                <ol className="mt-1 list-[lower-alpha] pl-5">
                  <li>벡터 &gt; 데이터 관리 도구 &gt;벡터 레이어 병합</li>
                  <li>공간처리&gt; 툴박스 &gt; 중복 도형 삭제</li>
                </ol>
              </li>
              <li>
                Qgis에 현재 프로젝트 행정경계 레이어 추가
                <ol className="mt-1 list-[lower-alpha] space-y-2 pl-5">
                  <li>
                    행정경계 없으면 아래에서 찾아서 레이어 추가
                    <div className="mt-1">
                      <CodeBlock>{`\\\\192.168.120.15\\ftp_농관원\\2026년 수급자료\\01 행정경계\\20260424 행정경계 통합 12차 (GTMM50, ~20260325까지 보완)`}</CodeBlock>
                    </div>
                  </li>
                  <li>전국 단위라서 필터(BJCD 입력해서 레이어 필터링)</li>
                </ol>
              </li>
              <li>
                Qgis &gt; 벡터 &gt; 지리정보처리도구 &gt; 잘라내기
                <ol className="mt-1 list-[lower-alpha] pl-5">
                  <li>잘라내기 안하고 도 단위로 자르면 용량 문제로 내보내기가 안됨</li>
                </ol>
              </li>
              <li>
                layer, path 필드 삭제: 레이어 우클릭 &gt; 속성 테이블 &gt; 상단 연필(편집 모드) &gt; 필드
                속성 삭제 &gt; 저장
              </li>
            </ol>
          </section>

          <section id="python-env" className="scroll-mt-4 space-y-3 pb-8">
            <h1 className="text-base font-semibold">레이어 업로드 실패(python/env) 문제</h1>
            <ol className="list-decimal space-y-2 pl-5">
              <li>
                ‘설치파일 다운로드’에서는{' '}
                <code className="rounded bg-muted px-1 py-0.5">python/env</code> 폴더 제외되고 있음.
              </li>
              <li>
                <code className="rounded bg-muted px-1 py-0.5">LAS File Uploader</code> 내 파이프라인
                환경(python/env) 통해 설치 가능
              </li>
            </ol>
          </section>
        </article>
      </main>
    </div>
  );
}
