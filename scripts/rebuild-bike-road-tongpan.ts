/**
 * [폐기] 도로구간을 ST_Node 로 잘라 통판 테이블을 만드는 방식은 쓰지 않음.
 * 원본 tl_sprd_manage 를 유지하고, 서버 bikeRoadNetService 가 그래프만 이음.
 *
 * 남아 있는 public_layer.tl_sprd_manage_tongpan / GeoServer 레이어는
 * 안내용으로 쓰지 않으며, 필요 시 DB·GeoServer 에서 수동 삭제.
 */

console.log(
  "[tongpan] skipped — use original tl_sprd_manage + bikeRoadNetService graph join"
);
process.exit(0);
