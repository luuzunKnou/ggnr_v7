package component.landInfo.service.impl;

import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;

import javax.annotation.Resource;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import component.admin.layerPerm.service.LayerVO;
import component.contextListener.saeolSOAP.service.SaeolLandInfoVO;
import component.contextListener.saeolSOAP.service.SaeolLoanInfoVO;
import component.contextListener.saeolSOAP.service.SaeolOccuInfoVO;
import component.contextListener.saeolSOAP.service.SaeolRealityInfoVO;
import component.contextListener.saeolSOAP.service.SaeolVarianceInfoVO;
import component.landInfo.service.LandInfoCodeVO;
import component.landInfo.service.LandInfoService;
import component.landInfo.service.LandInfoVO;
import component.landInfo.service.LandOwnInfoVO;

@Service("LandInfoService")
public class LandInfoServiceImpl implements LandInfoService{
	private static final Logger LOGGER = LoggerFactory.getLogger(LandInfoServiceImpl.class);
	
	@Resource(name = "LandInfoDAO")
	private LandInfoDAO landInfoDAO;

	@Override
	public List<LandInfoVO> getLandInfoList(String pnu) {
		// TODO Auto-generated method stub
		return landInfoDAO.getLandInfoList(pnu);
	}

	@Override
	public List<LandOwnInfoVO> getLandOwnInfoList(String pnu) {
		// TODO Auto-generated method stub
		return landInfoDAO.getLandOwnInfoList(pnu);
	}

	//2024.02.21 김재운 토지대장 csv업로드
	@Override
	public List<LandInfoCodeVO> landInfoCodeChange(LandInfoCodeVO codeVO) {
		return landInfoDAO.landInfoCodeChange(codeVO);
	}
	@Override
	public void landInfoInsert(List<LandInfoVO> allLandInfo) {
		//삭제 후 인서트
		landInfoDAO.landInfoDelete();
		landInfoDAO.landInfoInsert(allLandInfo);
	}

	@Override
	public void landOwnInsert(List<LandOwnInfoVO> allOwnInfo) {
		//삭제 후 인서트
		landInfoDAO.landOwnDelete();
		landInfoDAO.landOwnInsert(allOwnInfo);
	}

	//2024.07.04 - 울진 공유재산 새올연계 데이터 불러오기
	@Override
	public SaeolLandInfoVO saeolLandInfoData(String pnu) {
		return landInfoDAO.saeolLandInfoData(pnu);
	}

	@Override
	public SaeolRealityInfoVO saeolRealityInfoData(String means_no) {
		return landInfoDAO.saeolRealityInfoData(means_no);
	}

	@Override
	public List<SaeolVarianceInfoVO> saeolVarianceInfoList(String means_no) {
		return landInfoDAO.saeolVarianceInfoList(means_no);
	}

	@Override
	public List<SaeolLoanInfoVO> saeolLoanInfoList(String means_no) {
		return landInfoDAO.saeolLoanInfoList(means_no);
	}

	@Override
	public List<SaeolOccuInfoVO> saeolOccuInfoList(String means_no) {
		return landInfoDAO.saeolOccuInfoList(means_no);
	}

	@Override
	public List<LayerVO> tgLayerManager() {
		return landInfoDAO.tgLayerManager();
	}

	@Override
	public List<LinkedHashMap<String, Object>> usePlanList(HashMap<String, String> uesPlanMap) {
		return landInfoDAO.usePlanList(uesPlanMap);
	}
}
