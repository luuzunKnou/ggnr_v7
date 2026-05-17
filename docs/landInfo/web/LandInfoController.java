package component.landInfo.web;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import javax.annotation.Resource;
import javax.servlet.http.HttpServletRequest;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Controller;
import org.springframework.ui.ModelMap;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseBody;
import org.springframework.web.multipart.MultipartFile;

import component.admin.layerPerm.service.LayerVO;
import component.admin.service.service.ServiceService;
import component.admin.users.service.UsersVO;
import component.contextListener.saeolSOAP.service.SaeolLandInfoVO;
import component.contextListener.saeolSOAP.service.SaeolLoanInfoVO;
import component.contextListener.saeolSOAP.service.SaeolOccuInfoVO;
import component.contextListener.saeolSOAP.service.SaeolRealityInfoVO;
import component.contextListener.saeolSOAP.service.SaeolVarianceInfoVO;
import component.landInfo.service.LandInfoCodeVO;
import component.landInfo.service.LandInfoService;
import component.landInfo.service.LandInfoVO;
import component.landInfo.service.LandOwnInfoVO;
import component.util.GetSessionValueHelper;
import component.util.SystemInfoRepository;

@Controller
@RequestMapping("/landInfo/*")
public class LandInfoController {
	private static final Logger LOGGER = LoggerFactory.getLogger(LandInfoController.class);
	
	@Resource(name="LandInfoService")
	protected LandInfoService landInfoService;
	
	@Resource(name = "ServiceService")
    protected ServiceService serviceService;
	
	@RequestMapping("/landInfoMain.do")
	public String landInfoMain(ModelMap model, HttpServletRequest request, String pnu, String title, String roadaddr, String full_address, String service_key) {
		LOGGER.info("Call landInfoMain.do.."+pnu + ":" + title);
		
		// 권한 확인
		UsersVO usersVO = ((UsersVO) GetSessionValueHelper.getInstance().getSessionUsersVO(request));
		
		//MAP의 서비스 목록 불러오기
		List<LinkedHashMap<String, Object>> serviceList = serviceService.selectServiceList(usersVO.getUsers_key(), "2", null);
		//HashMapListHelper.getInstance().printAllData(serviceList); 
		model.addAttribute("serviceList", serviceList);
		
		System.out.println("usersVO.getUsers_key() : " + usersVO.getUsers_key());
		System.out.println("service_key : " + service_key);
				
		//토지정보, 토지이동내역, 소유자정보, 공시지가
		List<LandInfoVO> landInfoCheck = new ArrayList<>();
		try {
			//영주시 것만 가져올 수 있고 나머지는 전부 못가져옴
			landInfoCheck = landInfoService.getLandInfoList(pnu);
		} catch (Exception e) {
			// TODO: handle exception
			landInfoCheck = null;
		}
		
		model.addAttribute("pnu", pnu);
		model.addAttribute("title", title);
		model.addAttribute("roadaddr", roadaddr);
		model.addAttribute("full_address", full_address);
		model.addAttribute("landInfoCheck", landInfoCheck);
		 
		return "component/landInfo/landInfoMain";
	}
	
	@RequestMapping("/landBasicInfo.do")
	public String landBasicInfo(ModelMap model, HttpServletRequest request, String pnu) {
		LOGGER.info("Call landBasicInfo.do..");
		model.addAttribute("pnu", pnu);
		return "component/landInfo/landBasicInfo";
	}
	
	@RequestMapping("/landCharacter.do")
	public String landCharacter(ModelMap model, HttpServletRequest request, String pnu) {
		LOGGER.info("Call landCharacter.do..");
		model.addAttribute("pnu", pnu);
		model.addAttribute("VworldAuthKey", SystemInfoRepository.getInstance().get("VworldAuthKey").getSi_value());
		return "component/landInfo/landCharacter";
	}
	
	@RequestMapping("/landUsePlan.do")
	public String landUsePlan(ModelMap model, HttpServletRequest request, String pnu) {
		LOGGER.info("Call landUsePlan.do..");
		model.addAttribute("pnu", pnu);
		model.addAttribute("VworldAuthKey", SystemInfoRepository.getInstance().get("VworldAuthKey").getSi_value());
		return "component/landInfo/landUsePlan";
	}
	
	@RequestMapping("/brTitleInfo.do")
	public String brTitleInfo(ModelMap model, HttpServletRequest request, String pnu) {
		LOGGER.info("Call brTitleInfo.do..");
		model.addAttribute("pnu", pnu);
		model.addAttribute("dataPotalKey", SystemInfoRepository.getInstance().get("dataPotalKey").getSi_value());
		return "component/landInfo/brTitleInfo";
	}	
	
	@RequestMapping("/landPrice.do")
	public String landPrice(ModelMap model, HttpServletRequest request, String pnu) {
		LOGGER.info("Call landPrice.do..");
		model.addAttribute("pnu", pnu);
		model.addAttribute("VworldAuthKey", SystemInfoRepository.getInstance().get("VworldAuthKey").getSi_value());
		return "component/landInfo/landPrice";
	}	
	
	@RequestMapping("/housingPrice.do")
	public String housingPrice(ModelMap model, HttpServletRequest request, String pnu) {
		LOGGER.info("Call housingPrice.do..");
		model.addAttribute("pnu", pnu);
		return "component/landInfo/housingPrice";
	}	
	
	@RequestMapping("/possession.do")
	public String possession(ModelMap model, HttpServletRequest request, String pnu) {
		LOGGER.info("Call possession.do..");
		model.addAttribute("pnu", pnu);
		model.addAttribute("VworldAuthKey", SystemInfoRepository.getInstance().get("VworldAuthKey").getSi_value());
		return "component/landInfo/possession";
	}	
	
	@RequestMapping("/apBasisOuln.do")
	public String apBasisOuln(ModelMap model, HttpServletRequest request, String pnu) {
		LOGGER.info("Call apBasisOuln.do..");
		model.addAttribute("pnu", pnu);
		model.addAttribute("dataPotalKey", SystemInfoRepository.getInstance().get("dataPotalKey").getSi_value());
		return "component/landInfo/apBasisOuln";
	}	
	
	@RequestMapping("/hpBasisOuln.do")
	public String hpBasisOuln(ModelMap model, HttpServletRequest request, String pnu) {
		LOGGER.info("Call hpBasisOuln.do..");
		model.addAttribute("pnu", pnu);
		model.addAttribute("dataPotalKey", SystemInfoRepository.getInstance().get("dataPotalKey").getSi_value());
		return "component/landInfo/hpBasisOuln";
	}	
	
	//2023.01.03 김동현 추가
	//토지상세보기 추가
	@RequestMapping("/landDetailInfo.do")
	public String landDetailInfo(ModelMap model, HttpServletRequest request, String pnu) {
		LOGGER.info("Call landDetailInfo.do..");
		model.addAttribute("pnu", pnu);

		//토지정보, 토지이동내역, 소유자정보, 공시지가
		List<LandInfoVO> landInfoList = new ArrayList<>();
		//여러명
		List<LandOwnInfoVO> landOwnInfoList = new ArrayList<>();
		//2025.03.25 김재운 - 토이 이용 현황
		List<LinkedHashMap<String, Object>> usePlanList = new ArrayList<>();
		try {
			//영주시 것만 가져올 수 있고 나머지는 전부 못가져옴
			landInfoList = landInfoService.getLandInfoList(pnu);
			landOwnInfoList = landInfoService.getLandOwnInfoList(pnu);
			
			//2025.03.28 김재운 - 토지이용현황을 위해 추가
			List <LayerVO> tgLayerList = landInfoService.tgLayerManager();
			
			HashMap<String, String> uesPlanMap = new HashMap<>(); 
			
			StringBuilder queryBuilder = new StringBuilder();
			for (int i = 0; i < tgLayerList.size(); i++) {
			    if (i > 0) {
			        queryBuilder.append(" UNION ALL ");
			    }
			    queryBuilder.append("SELECT alias3, geom, remark FROM ").append(tgLayerList.get(i).getLayer_code());
			}

			String unionQuery = queryBuilder.toString(); // 최종 SQL 쿼리 문자열

			uesPlanMap.put("query", unionQuery);
			uesPlanMap.put("pnu", pnu);
			
			usePlanList = landInfoService.usePlanList(uesPlanMap);
			
		} catch (Exception e) {
			// TODO: handle exception
		}
		model.addAttribute("landInfoList", landInfoList);
		model.addAttribute("landOwnInfoList", landOwnInfoList);
		model.addAttribute("usePlanList", usePlanList);
		
		return "component/landInfo/landDetailInfo";
	}
	
	//2023.02.16 김동현 추가
	//정보가 없을 때 빈 창 추가
	@RequestMapping("/noData.do")
	public String noData(ModelMap model, HttpServletRequest request, String pnu) {
		LOGGER.info("Call noData.do..");
		model.addAttribute("pnu", pnu);
		return "component/landInfo/noData";
	}
	
	//2024.02.12 김재운 추가
	//토지정보 업데이트 페이지 불러오기
	@RequestMapping("/landInfoUpdateMain.do")
	public String landInfoUpdateMain(ModelMap model, HttpServletRequest request) {
		LOGGER.info("Call landInfoUpdateMain.do..");
		
		return "component/landInfo/landInfoUpdate";
	}
	
	@ResponseBody
	@RequestMapping(value="landInfoUpdate.do",method=RequestMethod.POST)
	public boolean landInfoUpdate(@RequestParam("files") MultipartFile[] files, LandInfoVO landInfoVO, LandOwnInfoVO landOwnInfoVO, LandInfoCodeVO codeVO) {
		LOGGER.info("Call landInfoUpdate.do..");
		List<LandInfoCodeVO> codelist = landInfoService.landInfoCodeChange(codeVO);
		Map<String, List<LandInfoCodeVO>> userByDepartment = new HashMap<String, List<LandInfoCodeVO>>();
		for (LandInfoCodeVO landInfoCode : codelist) {
		    String key = landInfoCode.getCode_name();
		    if (userByDepartment.containsKey(key)) {
		        userByDepartment.get(key).add(landInfoCode);
		    } else {
		        List<LandInfoCodeVO> list = new ArrayList<LandInfoCodeVO>();
		        list.add(landInfoCode);
		        userByDepartment.put(key, list);
		    }
		}

		List<LandInfoVO> allLandList = new ArrayList<>();
		List<LandOwnInfoVO> allOwnList = new ArrayList<>();
		for(MultipartFile file:files) {
			try {
				InputStream stream = file.getInputStream();
				//인코딩 하지 않으면 글자가 깨져서 읽어짐 , UTF-8또한 글자가 깨져 EUC-KR로 인코딩
				BufferedReader reader = new BufferedReader(new InputStreamReader(stream, "EUC-KR"));
				String line;
				int lineNumber = 0;
				while((line = reader.readLine()) != null) {
					LandInfoVO landInfo = new LandInfoVO();
					LandOwnInfoVO own = new LandOwnInfoVO();
					if(lineNumber >= 1) {
						String[] column = line.split(",(?=(?:[^\"]*\"[^\"]*\")*[^\"]*$)", -1);
						for (int i = 0; i < column.length; i++) {
						    column[i] = column[i].replaceAll("\"", "");
						}
						if(!column[0].isEmpty()) {
							BigDecimal value = new BigDecimal(column[0].trim());
							landInfo.setPnu(value.toPlainString());
							own.setPnu(value.toPlainString());
						}

						if(!column[1].isEmpty()) {
							for(LandInfoCodeVO list : userByDepartment.get("pnu")) {
								if(list.getCode_number().equals(column[1].split(" ")[0])) {
									landInfo.setAdministrative_district(list.getNumber_kor_name());
								}
							}
						}
						
						landInfo.setBon(column[3]);
						landInfo.setBu(column[4]);
						
						if(!column[5].isEmpty()) {
							for(LandInfoCodeVO list : userByDepartment.get("jimok")) {
								if(list.getNumber_kor_name().equals(column[5])) {
									landInfo.setJimok_cd(list.getCode_number());
								}
							}
						}
						
						landInfo.setJimok(column[5]);
						landInfo.setArea(column[6]);
						
						if(!column[12].isEmpty()) {
							BigDecimal move_reason = new BigDecimal(column[12].trim());
							
							landInfo.setLand_move_reason_cd(move_reason.toString());
							for(LandInfoCodeVO list : userByDepartment.get("land_move_reason")) {
								if(list.getCode_number().equals(move_reason.toString())) {
									landInfo.setLand_move_reason(list.getNumber_kor_name());
								}
							}
						}
						
						
						landInfo.setLand_move_date(column[13]);
						landInfo.setSoyu_address(column[17]);
						landInfo.setSoyu_name(column[14]);
						
						own.setSoyu_address(column[17]);
						own.setSoyu_name(column[14]);
						
						if(!column[15].isEmpty()) {
							BigDecimal gubun = new BigDecimal(column[15].trim());
							
							landInfo.setSoyu_cd(gubun.toString());
							own.setSoyu_cd(gubun.toString());
							for(LandInfoCodeVO list : userByDepartment.get("soyu_gubun")) {
								if(list.getCode_number().equals(gubun.toString())) {
									landInfo.setSoyu_gubun(list.getNumber_kor_name());
									own.setSoyu_gubun(list.getNumber_kor_name());
								}
							}
						}
						
						if(!column[18].isEmpty()) {
							BigDecimal trans = new BigDecimal(column[18].trim());
							
							landInfo.setSoyu_trans_date(column[19]);
							landInfo.setSoyu_trans_reason_cd(trans.toString());
							
							own.setSoyu_trans_date(column[19]);
							own.setSoyu_trans_reason_cd(trans.toString());
						
							for(LandInfoCodeVO list : userByDepartment.get("soyu_trans_reason")) {
								if(list.getCode_number().equals(trans.toString())) {
									landInfo.setSoyu_trans_reason(list.getNumber_kor_name());
									own.setSoyu_trans_reason(list.getNumber_kor_name());
								}
							}
						}
							landInfo.setSharing_num(column[20]);
						
						
						allLandList.add(landInfo);
						allOwnList.add(own);
					}
					lineNumber++;
				}
			} catch (IOException e) {
				e.printStackTrace();
			}
		}
		landInfoService.landInfoInsert(allLandList);
		landInfoService.landOwnInsert(allOwnList);
		
		return true;
	}
	
	//2024.07.03 김재운 - 울진 공유재산 새올연계를 위해 추가
	@RequestMapping("/govlandSaeol.do")
	public String govlandSaeol(ModelMap model, HttpServletRequest request, String pnu) {
		LOGGER.info("Call govlandSaeol.do.." + pnu);
		SaeolLandInfoVO landVO = landInfoService.saeolLandInfoData(pnu);
		model.addAttribute("landVO", landVO);
		if(landVO != null){
			String means_no = String.valueOf(landVO.getMeans_no());
			SaeolRealityInfoVO realVO = landInfoService.saeolRealityInfoData(means_no);
			List<SaeolVarianceInfoVO> varianceList = landInfoService.saeolVarianceInfoList(means_no);
			List<SaeolLoanInfoVO> loanList = landInfoService.saeolLoanInfoList(means_no);
			List<SaeolOccuInfoVO> occuList = landInfoService.saeolOccuInfoList(means_no);
			model.addAttribute("realVO", realVO);
			model.addAttribute("varianceList", varianceList);
			model.addAttribute("loanList", loanList);
			model.addAttribute("occuList", occuList);
		}
		return "component/landInfo/landInfoSaeol";
	}
}