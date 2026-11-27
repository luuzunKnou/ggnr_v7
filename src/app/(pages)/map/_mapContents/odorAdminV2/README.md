# 하수악취 통합관리시스템 V2

V1(`odorAdmin`, `odorPh`, `odorDashboard` 등)과 **파일·시스템 키를 분리**한 프로토타입 레인입니다.

## 규칙

- UI·패널 수정은 `odorPhV2/`, `odor*V2/` 만 건드린다.
- V1 경로를 같이 수정하면 merge 충돌이 난다.
- 시스템 키: `odorAdminV2`
- 기본 화면: `opened=odorDashboardV2`

## 진입

`/map?system=odorAdminV2&opened=odorDashboardV2`
