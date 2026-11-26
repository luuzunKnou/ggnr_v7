/**
 * road_video_landmark — 도로영상 수동 기준점 (PostGIS, layer 스키마)
 * 재분석해도 유지. DDL: src/lib/roadVideoTrack.ts ensure SQL
 */

export const roadVideoLandmarkTableComment = '도로영상 수동 기준점(재분석에도 유지)';

export const roadVideoLandmarkColumnComments: Record<string, string> = {
  id: '고유키',
  layer_id: '첨부 레이어(도로대장 요약)',
  road_key: '노선 키(rdid, 없으면 ogc_fid)',
  file_name: '영상 파일명',
  time_sec: '해당 파일 영상 시각(초)',
  route_m: '노선 시작 기준 거리(m)',
  created_by: '저장 계정',
  created_at: '저장 일시',
};
