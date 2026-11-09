'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { copyTextToClipboard } from '@/lib/utils';
import { InlineCode } from './InlineCode';
import { ManualImage } from './ManualImage';

const SECTIONS = [
  { id: 'setting_file_list', label: '세팅용 파일' },
  { id: 'git_setting', label: 'Git 설정' },
  { id: 'git_credential', label: '- 자격증명 등록' },
  { id: 'git_clone', label: '- 프로젝트 클론' },
  { id: 'git_ignore_file', label: '- gitignore 파일' },
  { id: 'nodejs', label: 'Node.js 및 npm 설치' },
  { id: 'install_postgresql', label: 'PostgreSQL 설치' },
  { id: 'install_db_pg18', label: '- PostgreSQL 18 버전 설치' },
  { id: 'install_db', label: 'DB 생성' },
  { id: 'install_db_run_pgadmin', label: '- pgAdmin 실행' },
  { id: 'install_db_create_user', label: '- User 생성' },
  { id: 'install_db_env', label: '- .env 파일 수정' },
  { id: 'base_path', label: 'BASE_PATH 설정' },
  { id: 'base_path_project', label: '- 프로젝트 내 BASE_PATH 설정' },
  { id: 'base_path_gate', label: '- 게이트서버 설정' },
  { id: 'geoserver_related', label: 'geoserver 관련' },
  { id: 'geoserver_port', label: '- geoserver PORT 변경' },
  { id: 'package', label: '프로젝트 파일 설치/실행 및 서비스 등록' },
  { id: 'package_tsc', label: '- TypeScript 타입 검사' },
  { id: 'package_options', label: '- 옵션 설명' },
  { id: 'package_build', label: '- 빌드 명령어' },
  { id: 'run', label: '구동' },
  { id: 'run_setup', label: '- 설치파일 풀기 및 서비스 등록' },
  { id: 'run_demo_files', label: '- 시연 첨부파일' },
  { id: 'remove', label: 'Window 서비스 등록 삭제' },
  { id: 'remove_bat', label: '- bat 실행' },
  { id: 'remove_manual', label: '- 수동 제거' },
  { id: 'contour', label: '기초데이터: 고도(등고선)' },
  { id: 'kais', label: '기초데이터: 건설•도로' },
] as const;

const SUB_LIST =
  'list-decimal space-y-6 pl-5 [&>li]:text-base [&>li]:font-semibold [&>li>*:not(h2)]:text-xs [&>li>*:not(h2)]:font-normal';
const STEP_LIST = 'list-decimal space-y-3 pl-5';
const SUB_HEADING = 'inline scroll-mt-4 text-base font-semibold';

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

export function InstallManualClient() {
  const scrollToSection = (id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="flex h-screen min-h-0 bg-background text-foreground border">
      <aside className="flex w-64 shrink-0 flex-col border-r bg-muted/80">
        {/* <div className={`${HEADER_BAR} px-3 text-base font-semibold`}>설치 매뉴얼</div> */}
        <nav
          className="min-h-0 flex-1 overflow-y-auto px-2 py-2"
          aria-label="목차"
          style={{ display: 'flex', flexDirection: 'column', gap: 20 }}
        >
          {SECTIONS.map((sec) => {
            const isSub = sec.label.startsWith('- ');
            return (
              <button
                key={sec.id}
                type="button"
                title={sec.label}
                onClick={() => scrollToSection(sec.id)}
                className={`block w-full cursor-pointer rounded-sm py-1 pr-1 text-left text-xs leading-snug hover:bg-primary/5 hover:text-primary ${
                  isSub
                    ? 'pl-4 font-normal text-muted-foreground'
                    : 'pl-2.5 font-medium text-foreground'
                }`}
              >
                {sec.label}
              </button>
            );
          })}
        </nav>
      </aside>

      <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {/* <section
          id="sub_text"
          className={`${HEADER_BAR} sticky top-0 z-10 justify-center border-[#e5e5e5] bg-background px-6 text-center text-xs leading-none dark:border-neutral-600`}
        >
          <p className="truncate">
            매뉴얼 수정시{' '}
            <InlineCode>InstallManualClient.tsx</InlineCode> 파일을
            수정하세요.
          </p>
        </section> */}
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        <article
          className="px-12 w-full text-xs leading-relaxed"
          style={{ display: 'flex', flexDirection: 'column', gap: 64 }}
        >
          

          <section id="setting_file_list" className="scroll-mt-4 space-y-3">
            <h1 className="text-xl font-semibold">세팅용 파일</h1>
            <p>파일 목록은 아래와 같음</p>
            <ul className={STEP_LIST}>
              <li>FileZilla_3.67.0_win64-setup: FileZilla 설치 파일</li>
              <li>node-v20.14.0-x64.msi: node, npm 설치 파일</li>
              <li>npp.8.9.7.Installer.x64.exe: 노트패드 설치 파일</li>
              <li>postgresql-18.6-1-windows-x64.exe: postgres 설치 파일</li>
            </ul>
            <div className="mt-1">
              <CodeBlock>{`\\\\192.168.127.11\\사업수행_개발\\020 공간누리 v7\\20260819_세팅용 파일`}</CodeBlock>
            </div>
          </section>

          <section id="git_setting" className="scroll-mt-4 space-y-3">
            <h1 className="text-xl font-semibold">Git 설정</h1>
            <ul className={SUB_LIST}>
              <li className="space-y-3">
                <h2 id="git_credential" className={SUB_HEADING}>
                  자격증명 등록
                </h2>
                <ul className={STEP_LIST}>
                  <li>
                    <p>프로젝트 폴더 (빈 폴더 생성)</p>
                  </li>
                  <li>
                    <p>아래 내용 맞춰서 입력</p>
                    <CodeBlock>{`git config --global user.name "[git 사용자명]"
git config --global user.email "[git 이메일]"`}</CodeBlock>
                  </li>
                </ul>
              </li>
              <li className="space-y-3">
                <h2 id="git_clone" className={SUB_HEADING}>
                  프로젝트 클론
                </h2>
                <ul className={STEP_LIST}>
                  <li>화면 내에 'Code' 버튼 클릭</li>
                  <li>https://github.com으로 시작하는 주소 복사</li>
                  <li>
                    <p>아래 채워넣고 터미널에 입력</p>
                    <p>(온점까지 포함시킬 것. 해당 폴더에 하위 폴더로 만들기 X).</p>
                    <CodeBlock>{`git clone [복사한 주소] .`}</CodeBlock>
                  </li>
                </ul>
              </li>
              <li className="space-y-3">
                <h2 id="git_ignore_file" className={SUB_HEADING}>
                  gitignore 파일
                </h2>
                <ul className={STEP_LIST}>
                  <li>geoserver_modules 내 java, geoserver</li>
                  <li>python</li>
                </ul>
              </li>
            </ul>
          </section>

          <section id="nodejs" className="scroll-mt-4 space-y-3">
            <h1 className="text-xl font-semibold">Node.js 및 npm 설치</h1>
            <ul className={STEP_LIST}>
              <li><InlineCode>node-v20.14.0-x64.msi</InlineCode> 파일 실행</li>
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

          <section id="install_postgresql" className="scroll-mt-4 space-y-3">
            <h1 className="text-xl font-semibold">PostgreSQL 설치</h1>
            <ul className={SUB_LIST}>
              <li className="space-y-3">
                <h2 id="install_db_pg18" className={SUB_HEADING}>
                  PostgreSQL 18 버전 설치
                </h2>
                <ul className={STEP_LIST}>
                  <li>
                    Stack Builder - Spatlal Extension 설치 - PostGIS 설치
                    <ManualImage
                      src="/image/manual_image/install_db_1.png"
                      alt="Spatlal Extension 설치 - PostGIS 설치"
                    />
                  </li>
                  <li>
                    PostGIS Bundle에서 Enable ALL GDAL Drivers 체크
                    <ManualImage
                      src="/image/manual_image/install_db_2.png"
                      alt="PostGIS Bundle에서 Enable ALL GDAL Drivers 체크"
                    />
                  </li>
                  <li>
                    <p>
                      <InlineCode>pg_hba.conf</InlineCode> 파일 수정
                    </p>
                    <p>
                      위치: <InlineCode>postgresql/18/data/pg_hba.conf</InlineCode>
                    </p>
                    <p>최하단에 아래 내용 추가하기</p>
                    <div className="mt-1">
                      <CodeBlock>{`host    all             all             [해당 서버 IP]/32         scram-sha-256`}</CodeBlock>
                    </div>
                  </li>
                </ul>
              </li>
            </ul>
          </section>

          <section id="install_db" className="scroll-mt-4 space-y-3">
            <h1 className="text-xl font-semibold">DB 생성</h1>
            <ul className={SUB_LIST}>
              <li className="space-y-3">
                <h2 id="install_db_run_pgadmin" className={SUB_HEADING}>
                  pgAdmin 실행
                </h2>
              </li>
              <li className="space-y-3">
                <h2 id="install_db_create_user" className={SUB_HEADING}>
                  User 생성
                </h2>
                <ul className={STEP_LIST}>
                  <li>
                    <InlineCode>Login/Group Rolels</InlineCode> 우클릭 → Create 클릭
                  </li>
                  <li>
                    <p>General</p>
                    <p>Name: 프로젝트명으로 작성</p>
                    <ManualImage
                      src="/image/manual_image/install_db_create_user_1.png"
                      alt="General"
                    />
                  </li>
                  <li>
                    <p>Definition</p>
                    <p>Password에 '프로젝트명'으로 입력</p>
                    <ManualImage
                      src="/image/manual_image/install_db_create_user_4.png"
                      alt="Database에 '프로젝트명'으로 입력"
                    />
                  </li>
                  <li>
                    <p>Privileges</p>
                    <ManualImage
                      src="/image/manual_image/install_db_create_user_2.png"
                      alt="Privileges"
                    />
                  </li>
                  <li>
                    <p>Parameters</p>
                    <ManualImage
                      src="/image/manual_image/install_db_create_user_3.png"
                      alt="Parameters"
                    />
                  </li>
                  <li>저장</li>
                </ul>
              </li>
              <li className="space-y-3">
                <h2 id="install_db_env" className={SUB_HEADING}>
                  Databases 생성
                </h2>
                <ul className={STEP_LIST}>
                  <li>
                    PostgresSQL 18 내 <InlineCode>Databases</InlineCode> 우클릭 → Create 클릭
                  </li>
                  <li>
                    <p>General</p>
                    <p>Database에 '프로젝트명'으로 입력</p>
                    <ManualImage
                      src="/image/manual_image/install_db_create_db_1.png"
                      alt="Database에 '프로젝트명'으로 입력"
                    />
                  </li>
                  
                  <li>
                    <p>Security</p>
                    <p>사진과 같이 입력(Grantor은 현재 pgAdmin 접속 유저에 따름)</p>
                    <ManualImage
                      src="/image/manual_image/install_db_create_db_2.png"
                      alt="Security"
                    />
                  </li>
                  <li>
                    <p>Parameters</p>
                    <p>search_path 입력</p>
                    <ManualImage
                      src="/image/manual_image/install_db_create_db_3.png"
                      alt="Parameters"
                    />
                  </li>
                  <li>저장</li>
                </ul>
              </li>
              <li className="space-y-3">
                <h2 id="install_db_env" className={SUB_HEADING}>
                  <InlineCode>.env</InlineCode>, <InlineCode>.runtime.env</InlineCode> 파일 수정
                </h2>
                <ul className={STEP_LIST}>
                  <li>
                    <p><InlineCode>프로젝트명.env</InlineCode> 파일 수정/생성 후 DB 내용에 따라 수정</p>
                  </li>
                  <li>
                    <p><InlineCode>프로젝트명.runtime.env</InlineCode> 파일 수정/생성 후 DB 내용에 따라 수정</p>
                  </li>
                  <li>.env 수정하면서 GGNR_DATA_DIR도 확인후 수정</li>
                </ul>
              </li>
            </ul>
          </section>

          <section id="base_path" className="scroll-mt-4 space-y-3">
            <h1 className="text-xl font-semibold">BASE_PATH 설정</h1>
            <ul className={SUB_LIST}>
              <li className="space-y-3">
                <h2 id="base_path_project" className={SUB_HEADING}>
                  프로젝트 내 BASE_PATH 설정
                </h2>
                <p>
                  시연 게이트 서버 등록했을 때, [프로젝트명].env에 <InlineCode>BASE_PATH</InlineCode>{' '}
                  설정
                </p>
                <p ><span className="text-red-500">&apos;/프로젝트명&apos;</span>으로 넣어주세요.(예: BASE_PATH=/build_yy)</p>
              </li>
              <li className="space-y-3">
                <h2 id="base_path_gate" className={SUB_HEADING}>
                  게이트서버 설정
                </h2>
                <ul className={STEP_LIST}>
                  <li>192.168.127.111 VMware 이동(아이디/비번 관련은 노션 &apos;인프라 관리&apos; 참고)</li>
                  <li>228 선택 후 웹 콘솔 연결: 비밀번호 노션 참고</li>
                  <li>
                    http.conf 기존 내용 참고 후 등록한 뒤 gateserver@localhost:cmd에 sudo systemctl
                    restart httpd gateserver(암호 노션 참고)
                  </li>
                  <li>V6/V7 규칙이 다르니 주의. 공백 확인 후 등록할 것.</li>
                </ul>
              </li>
            </ul>
          </section>

          <section id="geoserver_related" className="scroll-mt-4 space-y-3">
            <h1 className="text-xl font-semibold">geoserver 관련</h1>
            <ul className={SUB_LIST}>
              <li className="space-y-3">
                <h2 id="geoserver_port" className={SUB_HEADING}>
                  geoserver PORT 변경
                </h2>
                <ul className={STEP_LIST}>
                  <li>geoserver-modules/geoserver/start.ini 파일 수정: <InlineCode>jetty.http.port</InlineCode> 수정</li>
                  <li>
                    구동 시 변경된 PORT 확인하기 때문에, geoserver 포트는 프로젝트 구동 전 수정이
                    필요합니다.
                  </li>
                </ul>
              </li>
            </ul>
          </section>

          <section id="package" className="scroll-mt-4 space-y-3">
            <h1 className="text-xl font-semibold">프로젝트 파일 설치/실행 및 서비스 등록</h1>
            <ul className={SUB_LIST}>
              <li className="space-y-3">
                <h2 id="package_tsc" className={SUB_HEADING}>
                  TypeScript 타입 검사
                </h2>
                <ul className={STEP_LIST}>
                  <li>
                    <InlineCode>npx tsc --noEmit</InlineCode> 타입 검사
                  </li>
                  <li>타입에러 모달이 있을 경우, 수정후 다시 다운로드하세요.</li>
                </ul>
              </li>
              <li className="space-y-3">
                <h2 id="package_options" className={SUB_HEADING}>
                  옵션 설명
                </h2>
                <h3 className="text-sm font-semibold">GNMS 최신</h3>
                <p>GNMS 서버에 업로드되어 있는 최신 버전을 다운로드합니다.</p>
                <h3 className="text-sm font-semibold">현재 서버</h3>
                <p>현재 로컬 기준으로 파일을 다운로드합니다.</p>
                <ul className={STEP_LIST}>
                  <li>
                    폐쇄망: node_modules를 포함한 상태로 설치파일 ZIP을 제공합니다. (
                    <span className="text-red-500">
                      이후 <InlineCode>00_make_ggnr_starter.bat</InlineCode>에서 npm install 질문시
                      &apos;n&apos; 입력
                    </span>
                    )
                  </li>
                  <li>개방망: node_modules를 미포함한 상태로 설치파일 ZIP을 제공합니다.</li>
                </ul>
              </li>
              <li className="space-y-3">
                <h2 id="package_build" className={SUB_HEADING}>
                  빌드 명령어
                </h2>
                <p>빌드만 필요할 경우, cmd에 아래와 같이 입력하세요</p>
                <div className="mt-1">
                  <CodeBlock>{`npx tsx scripts/build-with-project-env.ts [프로젝트명] [타입]`}</CodeBlock>
                </div>
              </li>
            </ul>
          </section>

          <section id="run" className="scroll-mt-4 space-y-3">
            <h1 className="text-xl font-semibold">구동</h1>
            <ul className={SUB_LIST}>
              <li className="space-y-3">
                <h2 id="run_setup" className={SUB_HEADING}>
                  설치파일 풀기 및 서비스 등록
                </h2>
                <ul className={STEP_LIST}>
                  <li>
                    VM C 드라이브 내 <InlineCode>htdocs</InlineCode> 폴더 만들고 설치파일 ZIP
                    풀기(htdocs는 v6 규칙 따라 만듦)
                  </li>
                  <li>
                    <InlineCode>00_make_ggnr_starter.bat</InlineCode> 관리자로 실행 (ggnr_start.bat
                    생성 및 선택 시 nssm 등록)
                    <ul className={`mt-2 ${STEP_LIST}`}>
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
                        이후 자동 진행되는 내용 (nssm 등록을 Y로 한 경우)
                        <ul className="mt-1 list-disc pl-5">
                          <li>nssm: Window 서비스 등록</li>
                          <li>window 서비스 로그 확인용 cmd 열기</li>
                        </ul>
                      </li>
                      <li>
                        설치 ZIP에 python/env 분할압축본(env_parts)이 있으면 시작 시 복원하고, 없으면
                        건너뜁니다 (없어도 정상 진행).
                      </li>
                    </ul>
                  </li>
                </ul>
              </li>
              <li className="space-y-3">
                <h2 id="run_demo_files" className={SUB_HEADING}>
                  시연 첨부파일
                </h2>
                <ul className={STEP_LIST}>
                  <li>
                    시연일 경우 nssm에 G드라이브 접근 권한에 대해 따로 설정이 필요함 (C, D는
                    상관없음)
                    <p>소스가 있는 루트 폴더에서 cmd 열고 아래 명령어 입력</p>
                    <div className="mt-1">
                      <CodeBlock>{`cd nssm\\win64
.\\nssm.exe set GGNR_V7 ObjectName ".\\[Window 계정]" "[Window 비밀번호]"`}</CodeBlock>
                    </div>
                  </li>
                  <li>
                    구동시 관련 포트 계속 대기중이라면 ( waiting until port [구동될 포트] is
                    FREE...) 해당 포트가 점용중임으로 확인 후 종료가 필요함.
                  </li>
                </ul>
              </li>
            </ul>
          </section>

          <section id="remove" className="scroll-mt-4 space-y-3">
            <h1 className="text-xl font-semibold">Window 서비스 등록 삭제</h1>
            <ul className={SUB_LIST}>
              <li className="space-y-3">
                <h2 id="remove_bat" className={SUB_HEADING}>
                  bat 실행
                </h2>
                <ul className={STEP_LIST}>
                  <li>
                    <InlineCode>Win+R</InlineCode>:{' '}
                    <InlineCode>services.msc</InlineCode> 실행후 GGNR_V7 중지
                  </li>
                  <li>
                    <InlineCode>00_remove_ggnr.bat</InlineCode> 실행
                  </li>
                </ul>
              </li>
              <li className="space-y-3">
                <h2 id="remove_manual" className={SUB_HEADING}>
                  수동 제거
                </h2>
                <ul className={STEP_LIST}>
                  <li>
                    <InlineCode>Win+R</InlineCode>:{' '}
                    <InlineCode>services.msc</InlineCode> 실행후 GGNR_V7 중지
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
                    <InlineCode>nssm</InlineCode> &gt; <InlineCode>win64</InlineCode> &gt;{' '}
                    <InlineCode>nssm.exe</InlineCode>까지 이동
                  </li>
                </ul>
              </li>
            </ul>
          </section>

          <section id="contour" className="scroll-mt-4 space-y-3">
            <h1 className="text-xl font-semibold">기초데이터: 고도(등고선)</h1>
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
            <h1 className="text-xl font-semibold">기초데이터: 건설•도로</h1>
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
