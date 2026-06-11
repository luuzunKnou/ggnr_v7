1. 공간누리 v7 기술스택
  Client : Cecium 3D, React 19, OpenLayers
  BackEnd :  Next.js, Geoserver
  Database : PostGis
  Sub Module : Drizzle ORM, Phyton, GDAL, QCAD, blender
  IDE : Cursor IDE

2. 디자인 및 UI/UX 개선 : Standard 중심의 기능구현에서 기능별 Custom 중심의 기능구현으로 구현방식 전환
  * Standard 중심의 기능구현 : 투입인력대비 개발속도가 빠르고 세팅만으로 기능구현이 가능하지만 정해진 UI에 데이터를 표현하므로 사용성이 떨어짐
  * Custom 중심의 기능구현 : 매번 새로운 UI를 개발해야 하므로 개발기간 증가. 사용자 및 업무에 최적화된 UI 개발 가능

3. AI 도입을 통한 개발기간 단축 : Cursor 도입을 통해 Custom 중심의 기능구현의 개발기간 리스크 해소
  * Next.js + React 개발환경 도입으로 소스코드 단일화 : AI Agent의 직관적 코드분석 및 코드작성 가능
  * Database Schema 적용 : Databse Table을 schema로 정의하고, DBMS와 연동하여 AI Agent가 DDL 작성 및 자동반영 가능
  * Geoserver 소스코드 포함 : Geoserver를 소스코드에 포함하여 배포가 용의하고 data_dir을 AI Agent가 직접 수정 가능
  * System List, Service List, DefineField 등 기타 설정파일들을 소스코드에 포함하여 배포가 용의하고 데이터 정의를 AI Agent가 직접 수정 가능

4. 업데이트 편의성 개선
  * Data Upload 편의성 개선
      SHP, Excel, 정사영상 등 파일을 특정 폴더에 업로드 한 뒤 버튼 클릭으로 데이터 업로드
      중복데이터 업데이트 제외, 변경데이터 Comflict처리 및 반영할 데이터 선택 등 기능으로 데이터 업로드 자동화
  * Config 파일 분리 : 각 사업별, 운영환경별(개발, 운영, 시연) Config 파일 분리로 설장파일을 사업별 최초 1회만 작성
  * Source Code Update 편의성 개선 : GNMS(GonganNuri Master Sever)에서 통합소스코드 관리 및 자동배포 지원
  * 기능목록 및 권한관리 방식 변경 : White List방식에서 Black List방식으로 변경하여 설정대장 기능 및 권한 최소화

5. 시스템 관리 편의기능 제공
  * GDAL 기반 정사영상 자동변환 기능 추가 : 개발자 모드 > 데이터 관리 > 정사영상관리
  * SHP, Excel, 첨부파일, 정사영상 Data 업로드 기능 제공 : 개발자 모드 > 데이터 관리 (추후 File Manager로 통합 예정)
  * Schema 파일 기반 Database 동기화 기능 제공 : 개발자 모드 > Tools > DB Manager
  * Geoserver Layer 및 Style 자동생성 기능 제공 : 개발자 모드 > Tools > Geoserver Manager
