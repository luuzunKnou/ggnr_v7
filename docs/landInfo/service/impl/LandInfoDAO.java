package component.landInfo.service.impl;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;

import org.springframework.stereotype.Repository;

import component.admin.layerPerm.service.LayerVO;
import component.contextListener.saeolSOAP.service.SaeolLandInfoVO;
import component.contextListener.saeolSOAP.service.SaeolLoanInfoVO;
import component.contextListener.saeolSOAP.service.SaeolOccuInfoVO;
import component.contextListener.saeolSOAP.service.SaeolRealityInfoVO;
import component.contextListener.saeolSOAP.service.SaeolVarianceInfoVO;
import component.landInfo.service.LandInfoCodeVO;
import component.landInfo.service.LandInfoVO;
import component.landInfo.service.LandOwnInfoVO;
import egovframework.com.cmm.service.impl.EgovComAbstractDAO;

@Repository("LandInfoDAO")
@SuppressWarnings("unchecked")
public class LandInfoDAO extends EgovComAbstractDAO{

	public List<LandInfoVO> getLandInfoList(String pnu) {
		// TODO Auto-generated method stub
		return (List<LandInfoVO>) list("LandInfoDAO.getLandInfoList", pnu);
	}

	public List<LandOwnInfoVO> getLandOwnInfoList(String pnu) {
		// TODO Auto-generated method stub
		return (List<LandOwnInfoVO>) list("LandInfoDAO.getLandOwnInfoList", pnu);
	}
	
	public List<LandInfoCodeVO> landInfoCodeChange(LandInfoCodeVO codeVO) {
		
		return(List<LandInfoCodeVO>)list("LandInfoDAO.landInfoCodeChange", codeVO);
	}
	
	public void landInfoDelete() {
		delete("landInfoDAO.landInfoDelete");
	}
	
	public void landInfoInsert(List<LandInfoVO> allLandInfo) {
		int batchSize = 100;
		
		List<List<LandInfoVO>> file = partitionInfoList(allLandInfo, batchSize);
		
		for(List<LandInfoVO> insert : file) {
			insert("LandInfoDAO.landInfoInsert", insert);
		}
		delete("LandInfoDAO.deleteDuplicateData");
	}
	
	public void landOwnDelete() {
		delete("landInfoDAO.landOwnDelete");
	}
	
	public void landOwnInsert(List<LandOwnInfoVO> allOwnInfo) {
		int batchSize = 100;
		
		List<List<LandOwnInfoVO>> file = partitionOwnList(allOwnInfo, batchSize);
		
		for(List<LandOwnInfoVO> insert : file) {
			insert("LandInfoDAO.landOwnInsert", insert);
		}
	}
	
	private List<List<LandInfoVO>> partitionInfoList(List<LandInfoVO> list, int batchSize) {
	    List<List<LandInfoVO>> partitions = new ArrayList<>();

	    for (int i = 0; i < list.size(); i += batchSize) {
	        int endIndex = Math.min(i + batchSize, list.size());
	        List<LandInfoVO> batchList = list.subList(i, endIndex);
	        partitions.add(batchList);
	    }

	    return partitions;
	}
	
	private List<List<LandOwnInfoVO>> partitionOwnList(List<LandOwnInfoVO> list, int batchSize) {
	    List<List<LandOwnInfoVO>> partitions = new ArrayList<>();

	    for (int i = 0; i < list.size(); i += batchSize) {
	        int endIndex = Math.min(i + batchSize, list.size());
	        List<LandOwnInfoVO> batchList = list.subList(i, endIndex);
	        partitions.add(batchList);
	    }

	    return partitions;
	}
	
	//2024.07.04 - 울진 공유재산 새올연계 데이터 불러오기
	public SaeolLandInfoVO saeolLandInfoData(String pnu) {
		return (SaeolLandInfoVO) select ("LandInfoDAO.saeolLandInfoData", pnu);
	}

	public SaeolRealityInfoVO saeolRealityInfoData(String means_no) {
		return (SaeolRealityInfoVO) select("LandInfoDAO.saeolRealityInfoData", means_no);
	}
	
	public List<SaeolVarianceInfoVO> saeolVarianceInfoList(String means_no) {
		return (List<SaeolVarianceInfoVO>) list("LandInfoDAO.saeolVarianceInfoList", means_no);
	}
	
	public List<SaeolLoanInfoVO> saeolLoanInfoList(String means_no) {
		return (List<SaeolLoanInfoVO>) list("LandInfoDAO.saeolLoanInfoList", means_no);
	}
	
	public List<SaeolOccuInfoVO> saeolOccuInfoList(String means_no) {
		return (List<SaeolOccuInfoVO>) list("LandInfoDAO.saeolOccuInfoList", means_no);
	}
	
	public List<LayerVO> tgLayerManager(){
		return(List<LayerVO>) list("LandInfoDAO.tgLayerManager");
	} 
	
	public List<LinkedHashMap<String, Object>> usePlanList(HashMap<String, String> uesPlanMap) {
		return (List<LinkedHashMap<String, Object>>) list("LandInfoDAO.usePlanList", uesPlanMap);
	}
}
