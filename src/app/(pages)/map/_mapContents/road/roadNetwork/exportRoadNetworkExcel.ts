import * as XLSX from "xlsx";
import { type RoadNetworkRow } from "./roadNetworkMock";

/** 현재 목록(필터·검색 반영)을 엑셀 파일로 내려받기 */
export function exportRoadNetworkExcel(rows: RoadNetworkRow[], fileName?: string) {
  const data = rows.map((r) => ({
    도로명: r.roadName,
    도로종류: r.roadType,
    개설여부: r.openStatus ?? "",
    도로번호: r.roadNo,
    관리기관: r.dept,
    담당자: r.manager,
    유지보수건수: r.maintenance.length,
    민원건수: r.complaints.length,
  }));

  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "도로망도");
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  XLSX.writeFile(wb, fileName ?? `도로망도_${stamp}.xlsx`);
}
