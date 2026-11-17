import { redirect } from 'next/navigation';

/** 옛 게시판 주소 — 왼쪽 메뉴 정책지도로 보낸다 */
export default function PolicyMapPage() {
  redirect('/map?system=uav_view&opened=policyMap');
}
