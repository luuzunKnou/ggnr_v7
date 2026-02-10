# GeoServer Data Directory (Git 관리)

이 폴더는 GeoServer의 data_dir로 사용됩니다.
- workspaces, layers, styles 등 설정이 저장됩니다.
- Git으로 관리하여 모든 지자체에 동일하게 배포할 수 있습니다.

## 최초 실행 시
- 빈 폴더 상태에서 GeoServer를 실행하면 기본 구조가 자동 생성됩니다.
- 또는 기존 `geoserver/data_dir` 내용을 이 폴더로 복사한 뒤 사용할 수 있습니다.

## 배포 시
- DB 연결 정보(datastore 등)만 지자체별로 치환하면 됩니다.
