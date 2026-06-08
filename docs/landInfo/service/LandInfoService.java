package component.landInfo.service;

import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;

import component.admin.layerPerm.service.LayerVO;
import component.contextListener.saeolSOAP.service.SaeolLandInfoVO;
import component.contextListener.saeolSOAP.service.SaeolLoanInfoVO;
import component.contextListener.saeolSOAP.service.SaeolOccuInfoVO;
import component.contextListener.saeolSOAP.service.SaeolRealityInfoVO;
import component.contextListener.saeolSOAP.service.SaeolVarianceInfoVO;

public interface LandInfoService {

	List<LandInfoVO> getLandInfoList(String pnu);

	List<LandOwnInfoVO> getLandOwnInfoList(String pnu);
	
	//2024.02.22 김재운 코드 불러오기
	public List<LandInfoCodeVO> landInfoCodeChange(LandInfoCodeVO codeVO);
	
	//landInfo테이블 입력
	public void landInfoInsert(List<LandInfoVO> allLandInfo);
	
	//landInfo테이블 입력
	public void landOwnInsert(List<LandOwnInfoVO> allOwnInfo);
	
	//2024.07.04 - 울진 공유재산 새올연계 데이터 불러오기
	public SaeolLandInfoVO saeolLandInfoData(String means_no);
	public SaeolRealityInfoVO saeolRealityInfoData(String means_no);
	public List<SaeolVarianceInfoVO> saeolVarianceInfoList(String means_no);
	public List<SaeolLoanInfoVO> saeolLoanInfoList(String means_no);
	public List<SaeolOccuInfoVO> saeolOccuInfoList(String means_no);
	
	//2025.03.28 김재운 - 주제도 리스트 가져오기
	public List<LayerVO> tgLayerManager();
	
	public List<LinkedHashMap<String, Object>> usePlanList(HashMap<String, String> uesPlanMap);
}
