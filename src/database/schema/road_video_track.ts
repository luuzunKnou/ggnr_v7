/**
 * road_video_track / road_video_anchor — 도로영상 위치 맞춤 (PostGIS, layer 스키마)
 * 영상 1건(첨부 레이어·노선 키·파일명)당 track 1행, 시각별 노선 위치는 anchor 에 track_id 로 조인.
 * DDL: src/service/roadVideoTrackService.ts (분석 서비스 첫 실행 시 확보)
 */

export const roadVideoTrackTableComment = '도로영상 위치맞춤 영상정보';

export const roadVideoTrackColumnComments: Record<string, string> = {
  id: '고유키',
  layer_id: '첨부 레이어(도로대장 요약)',
  road_key: '노선 키(rdid, 없으면 ogc_fid)',
  file_name: '영상 파일명',
  file_size: '분석 당시 파일 크기(byte)',
  file_mtime: '분석 당시 파일 수정시각',
  status: '분석 결과(done·failed, 요청만 있고 분석 전이면 queued)',
  message: '실패 사유',
  direction: '진행 방향(forward=노선 시작→끝, reverse=끝→시작)',
  duration_sec: '영상 길이(초)',
  route_length_m: '노선 길이(m)',
  fit_cost: '맞춤 비용(표본당, 낮을수록 잘 맞음)',
  loops: '교차로 회전 구간 [[시작초, 끝초], ...]',
  elapsed_sec: '분석 소요(초)',
  analyzed_at: '분석 일시',
  analyzer_ver: '분석 방식 버전(낮으면 슈퍼 계정이 열 때 다시 분석 요청)',
  requested_at: '분석 요청 일시(슈퍼 계정이 영상을 열 때). 값이 있으면 스케줄러가 분석',
  requested_by: '분석 요청 계정',
  geom: '분석에 쓴 노선 선형(이어 붙인 한 줄)',
};

export const roadVideoAnchorTableComment = '도로영상 위치맞춤 시각별 노선위치';

export const roadVideoAnchorColumnComments: Record<string, string> = {
  id: '고유키',
  track_id: 'road_video_track id',
  time_sec: '영상 시각(초)',
  route_m: '노선 시작 기준 거리(m, track.geom 기준)',
  front_deg: '영상 속 차 정면 방향(도, 영상 가운데 0·오른쪽 +)',
  kind: '구분(auto=자동, manual=수동 보정)',
};
