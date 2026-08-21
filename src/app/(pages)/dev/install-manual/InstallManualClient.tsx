'use client';

const SECTIONS = [
  { id: 'setting_file_list', label: '세팅용 파일' },
  { id: 'nodejs', label: 'Node.js 및 npm 설치' },
  { id: 'install_db', label: 'PostgreSQL 설치 및 DB 생성' },
  { id: 'package', label: '프로젝트 파일 설치/실행 및 서비스 등록' },
  { id: 'run', label: '구동' },
  { id: 'remove', label: 'Window 서비스 등록 삭제' },
  { id: 'contour', label: '기초데이터: 고도(등고선)' }
] as const;

const HEADER_BAR = 'flex h-10 shrink-0 items-center border-b';

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
  const scrollToSection = (id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="flex h-screen min-h-0 bg-background text-foreground">
      <aside className="flex w-64 shrink-0 flex-col border-r bg-muted/20">
        <div className={`${HEADER_BAR} px-3 text-base font-semibold`}>설치 매뉴얼</div>
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
        <section
          id="sub_text"
          className={`${HEADER_BAR} sticky top-0 z-10 justify-center border-[#e5e5e5] bg-background px-6 text-center text-xs leading-none dark:border-neutral-600`}
        >
          <p className="truncate">
            매뉴얼 수정시{' '}
            <code className="rounded bg-muted px-1 py-0.5">InstallManualClient.tsx</code> 파일을
            수정하세요.
          </p>
        </section>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        <article
          className="mx-auto max-w-3xl text-xs leading-relaxed"
          style={{ display: 'flex', flexDirection: 'column', gap: 64 }}
        >

          <section id="setting_file_list" className="scroll-mt-4 space-y-3">
            <h1 className="text-xl font-semibold">세팅용 파일</h1>
            <h2 className="text-base font-semibold">경로</h2>
            <div className="mt-1">
              <CodeBlock>{`\\\\192.168.127.11\\사업수행_개발\\020 공간누리 v7\\20260819_세팅용 파일`}</CodeBlock>
            </div>
          </section>

          <section id="nodejs" className="scroll-mt-4 space-y-3">
            <h1 className="text-xl font-semibold">Node.js 및 npm 설치</h1>
            <ul className="list-decimal space-y-3 pl-5">
              <li><code className="rounded bg-muted px-1 py-0.5">node-v20.14.0-x64.msi</code> 파일 실행</li>
              <li>
                설치 파일 실행 종료되면 powershell 열고 아래 명령어 입력
                <div className="mt-1">
                  <CodeBlock>{`node -v
where node
npm -v`}</CodeBlock>
                </div>
                버전 확인이 되면 정상 설치가 완료됨.
              </li>
            </ul>
          </section>

          <section id="install_db" className="scroll-mt-4 space-y-3">
            <h1 className="text-xl font-semibold">PostgreSQL 설치 및 DB 생성</h1>
            <h2 className="text-base font-semibold">1. PostgreSQL 18 버전 설치</h2>
              <ul className="list-decimal space-y-3 pl-5">
                <li>
                  Stack Builder - Spatlal Extension 설치 - PostGIS 설치
                  <img src="\image\manual_image\install_db_1.png" alt="Spatlal Extension 설치 - PostGIS 설치" />
                </li>
                <li>
                  PostGIS Bundle에서 Enable ALL GDAL Drivers 체크
                  <img src="\image\manual_image\install_db_2.png" alt="PostGIS Bundle에서 Enable ALL GDAL Drivers 체크" />
                </li>
                <li>
                  <p><code className="rounded bg-muted px-1 py-0.5">pg_hba.conf</code> 파일 수정</p>
                  <p>위치: <code className="rounded bg-muted px-1 py-0.5">postgresql/18/data/pg_hba.conf</code></p>
                  <p>최하단에 아래 내용 추가하기</p>
                  <div className="mt-1">
                      <CodeBlock>{`host    all             all             [해당 서버 IP]/32         scram-sha-256`}</CodeBlock>
                    </div>
                </li>
              </ul>
            <h2 className="text-base font-semibold">2. DB 생성(pgAdmin 실행)</h2>
              <ul className="list-decimal space-y-3 pl-5">
                <li>
                  <code className="rounded bg-muted px-1 py-0.5">V6 DB 세팅</code> 참고
                </li>
                <li>
                  Extension 활성화
                  <div className="mt-1">
                      <CodeBlock>{`CREATE EXTENSION IF NOT EXISTS plpgsql;
  CREATE EXTENSION IF NOT EXISTS postgis;
  CREATE EXTENSION IF NOT EXISTS postgis_raster;`}</CodeBlock>
                  </div>
                </li>
              </ul>
            <h2 className="text-base font-semibold">3. '프로젝트명'.env 파일 내 demo/prod를 생성한 DB 내용에 따라 수정</h2>
            <p>.env 수정하면서 GGNR_DATA_DIR도 확인후 수정</p>
          </section>

          <section id="package" className="scroll-mt-4 space-y-3">
            <h1 className="text-xl font-semibold">프로젝트 파일 설치/실행 및 서비스 등록</h1>
            <h2 className="text-base font-semibold">TypeScript 타입 검사</h2>
            <ul className="list-decimal space-y-3 pl-5">
              <li><code className="rounded bg-muted px-1 py-0.5">npx tsc --noEmit</code> 타입 검사</li>
              <li>타입에러 모달이 있을 경우, 수정후 다시 다운로드하세요.</li>
            </ul>
            <h2 className="text-base font-semibold">옵션 설명</h2>
            <h3 className="text-sm font-semibold">GNMS 최신</h3>
            <p>GNMS 서버에 업로드되어 있는 최신 버전을 다운로드합니다.</p>
            <h3 className="text-sm font-semibold">현재 서버</h3>
            <p>현재 로컬 기준으로 파일을 다운로드합니다.</p>
            <ol className="list-decimal space-y-3 pl-5">
              <li>폐쇄망: node_modules를 포함한 상태로 설치파일 ZIP을 제공합니다. (<span className="text-red-500">이후 <code className="rounded bg-muted px-1 py-0.5">00_make_ggnr_starter.bat</code>에서 npm install 질문시 'n' 입력</span>)</li>
              <li>개방망: node_modules를 미포함한 상태로 설치파일 ZIP을 제공합니다.</li>
            </ol>
          </section>

          <section id="run" className="scroll-mt-4 space-y-3">
            <h1 className="text-xl font-semibold">구동</h1>
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
                      <li>smoke: npm run start 되는지 확인</li>
                      <li>nssm: Window 서비스 등록</li>
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
            <h1 className="text-xl font-semibold">Window 서비스 등록 삭제</h1>
            <h2 className="text-base font-semibold">bat 실행</h2>
            <ol className="list-decimal space-y-1 pl-5">
              <li>
                <code className="rounded bg-muted px-1 py-0.5">Win+R</code>:{' '}
                <code className="rounded bg-muted px-1 py-0.5">services.msc</code> 실행후 GGNR_V7 중지
              </li>
              <li>
                <code className="rounded bg-muted px-1 py-0.5">00_remove_ggnr.bat</code> 실행
              </li>
            </ol>
            <h2 className="text-base font-semibold">수동 제거</h2>
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
                <code className="rounded bg-muted px-1 py-0.5">nssm</code> &gt;{' '}
                <code className="rounded bg-muted px-1 py-0.5">win64</code> &gt;{' '}
                <code className="rounded bg-muted px-1 py-0.5">nssm.exe</code>까지 이동
              </li>
            </ol>
          </section>

          <section id="contour" className="scroll-mt-4 space-y-3">
            <h1 className="text-xl font-semibold">기초데이터: 고도(등고선)</h1>
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
        </article>
        </div>
      </main>
    </div>
  );
}
