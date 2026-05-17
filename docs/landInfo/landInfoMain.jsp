<%@ page language="java" contentType="text/html; charset=UTF-8"
    pageEncoding="UTF-8"%>
<%@ taglib prefix="c" uri="http://java.sun.com/jsp/jstl/core" %>
<%@ taglib prefix="spring" uri="http://www.springframework.org/tags"%>
<%@ taglib prefix="ui" uri="http://egovframework.gov/ctl/ui"%>
<%@ taglib uri="http://java.sun.com/jsp/jstl/functions" prefix="fn" %>
   
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title> <%=component.util.SystemInfoRepository.getInstance().getAppName_KR()%> </title>

<style type="text/css">
	.land_info_address_div {overflow: hidden; height: 70px; font-size: 14px; padding-top: 10px;}  
	.land_info_address_div > div { display: inline-block;}
	.btnEum{float: right;width: 160px;padding-right: 10px;}
	.info_jibun	 {line-height: 30px;}
	.info_road	 {line-height: 30px;}
	.infoAddressKind {color: white; background-color: #777777; border-radius: 3px; display:inline-block; 
				 	  width: 50px; height: 19px; line-height: 19px; text-align: center; margin-right: 5px; margin-left: 15px;}
	
	.buttonDiv {padding: 10px; overflow: hidden;}
	.buttonDiv ul {display: table;   width: 100%;  table-layout: fixed;}		 	  
	.buttonDiv ul .infoTab {padding-top:4px; text-align: center; height: 36px; border: solid 1px #cccccc; line-height: 15px; color: #777777; cursor: pointer; display:table-cell; vertical-align:middle;}
	.buttonDiv ul .infoTab:hover {color: #0A9E95; border: solid 1px #0A9E95;}
	.select_li {padding-top:4px; text-align: center; height: 36px; border: solid 1px #cccccc; line-height: 15px; color: #777777; cursor: pointer;  display:table-cell; vertical-align:middle;}
/* 				color: #0A9E95; border: solid 1px #0A9E95;}  */
	
	.no-result {font-size: 15px; margin: 10px;}
	.smallFont {font-size: 12px !important;}
	
	.loadingImg {margin-left: 250px; margin-top: 170px;}
	
	.btnClose {top: 7px; right: 7px; cursor: pointer;}
	.source_div{text-align: right;margin-right: 8px;}
	.source_div > img{width: 20px;}
</style>

<script type="text/javascript">
	$(document).ready(function(){
		var landInfo_service_name = "";
		if(getCookie("currentInfoDetail") == "" || getCookie("currentInfoDetail") == "null" || getCookie("currentInfoDetail") == null){
			/* R 권한이 없다면 화면을 보여주지 않음. */
			<c:set var="loop_flag" value="false" />
		 	<c:forEach items="${serviceList}" var="serviceList" varStatus="status">
		 		<c:choose>
					<c:when test="${serviceList.sd_perm_type eq 'RL' || status.index eq 0}">	
		 				<c:if test="${serviceList.service_type eq 'landInfo_sub'}">
		 					landInfo_service_name = '${serviceList.service_name}';
						</c:if>
					</c:when>
				</c:choose>
			</c:forEach>
			
			if(landInfo_service_name != ""){
				setCookie("currentInfoDetail", landInfo_service_name, 365);	
			}else{
				setCookie("currentInfoDetail", "noData", 365);	
			}			
		}
		else{
			landInfo_service_name = getCookie("currentInfoDetail");
		}
		
		var appendStr = " ";
		appendStr += '<ul>'
		<!-- 2023.02.15 김동현 -->
		<!-- serviceList 에서 landInfo_sub 만 불러오기 제외시키키 -->
		<c:forEach items="${serviceList}" var="serviceList" varStatus="status">
	 		<c:choose>
 				<c:when test="${serviceList.sd_perm_type eq 'RL'}">		 				
	 				<c:if test="${serviceList.service_type eq 'landInfo_sub'}">
	 				appendStr += '<li class="infoTab ';
	 				appendStr += '${serviceList.service_name}';
	 				appendStr += '" onclick="onClickInfo('
	 				appendStr += '\'${serviceList.service_name}\',this)">${serviceList.service_kor_name}</li>';
					</c:if>
				</c:when>
			</c:choose>
		</c:forEach>
		appendStr += '</ul>'	
		
		$(".buttonDiv").append(appendStr); 
		
		onClickInfo(landInfo_service_name, $("."+landInfo_service_name));
				
		//li안에 있는 띄어쓰기를 <br> 로 변경하는 함수
		 spaceChangeBr();
	});

	//li안에 있는 띄어쓰기를 <br> 로 변경하기 -> 2024.04.26 김재운 - li 전체가 변경이 되는게 문제라서 변경
	function spaceChangeBr(){
		//var liSelect = document.querySelectorAll("li");
		var liSelect = $('.buttonDiv li');
		
	    
		$.each(liSelect,function(index){
			var innerText = $(this).text();
			
			$(this).html($(this).html().replace(" ", "<br>"));			
		});
	}
	
	function onClickInfo(type, button){
		setCookie("currentInfoDetail", type, 365);

		$(".buttonDiv ul li").attr("class","infoTab")
		$(button).attr("class","select_li");
		
		var pnu = "${pnu}"; 
		
		//2024.06.03 김재운 - 클릭한 type 이름으로 url 이동 -> 소스수정		
 		$("#info_list_div").empty();
		$("#info_list_div").load("<c:out value='${pageContext.request.contextPath}'/>"+"/landInfo/"+type.trim()+".do?pnu="+pnu); 

	}
	
	function onClickEum() {
		var newWindow = window.open('', 'Eum', 'width=1400,height=970');
		newWindow.document.write('<html><head><title>새 창</title></head><body>');
		newWindow.document.write('<p>페이지 이동 중입니다..</p>');
		newWindow.document.write('</body></html>');

		document.frm.target = 'Eum';
		document.frm.submit();
	}
	
	// 2024.12.12 수범 : vworld 중복 처리 함수 추가
	// 필요 인자 : 1. 남길 필드명 2. 원본 객체 배열
	// 반환 : 중복처리된 객체 배열 데이터
	function getReduceDuplicateProcessedData(fieldsToKeep, originObjectArray, sortOption) {
	    if (typeof sortOption === 'undefined') {
	        sortOption = null;
	    }
	
	    // 중복을 제거하기 위한 객체 사용
	    var duplicateProcessedSet = {};
	
	    for (var i = 0; i < originObjectArray.length; i++) {
	        var item = originObjectArray[i];
	
	        // 특정 필드만 남긴 객체 생성
	        var filteredItem = {};
	        for (var j = 0; j < fieldsToKeep.length; j++) {
	            var field = fieldsToKeep[j];
	            if (item[field] !== undefined) {
	                filteredItem[field] = item[field];
	            }
	        }
	
	        // 문자열로 변환하여 중복 확인 (객체 키로 사용)
	        var key = JSON.stringify(filteredItem);
	        duplicateProcessedSet[key] = filteredItem;
	    }
	
	    // 객체를 배열로 변환
	    var dataArray = [];
	    for (var key in duplicateProcessedSet) {
	        if (duplicateProcessedSet.hasOwnProperty(key)) {
	            dataArray.push(duplicateProcessedSet[key]);
	        }
	    }
	
	    // 정렬 옵션 처리
	    if (sortOption !== null) {
	        dataArray = sortDataByDateDescending(dataArray, sortOption);
	    } else {
	        dataArray = sortDataByDateDescending(dataArray, null, true);
	    }
	
	    return dataArray;
	}
	
	function sortDataByDateDescending(dataArray, dateField, isComposite) {
	    if(typeof isComposite == undefined){
	    	isComposite = false;
	    }
		
		
		if(isComposite){
	    	return dataArray.sort(function(a, b) {
		        // 날짜 값을 추출
		        var dateA = isComposite
				    ? new Date(a.stdrYear + '-' + ('0' + a.stdrMt).slice(-2))
				    : new Date(a[dateField]);
				
				var dateB = isComposite
				    ? new Date(b.stdrYear + '-' + ('0' + b.stdrMt).slice(-2))
				    : new Date(b[dateField]);


		        // 내림차순 정렬
		        return dateB - dateA;
		    });
	    }
	    else{
	    	return dataArray.sort(function(a, b) {
                const dateA = new Date(a[dateField]); // Date 객체 생성
                const dateB = new Date(b[dateField]);
                return dateB - dateA; // 내림차순 정렬
            });
	    }
		
	}
	
</script>
</head>
<body> 
	<form name="frm" id="frm" action="http://www.eum.go.kr/web/ar/lu/luLandDet.jsp" method="post">
		<input name="selGbn" type="hidden" value="umd">
		<input name="isNoScr" type="hidden" value="script">
		<input name="s_type" type="hidden" value="1">
		<input name="viewType" type="hidden">
		<input name="p_location" type="hidden">
		<input name="p_type" type="hidden">
		<input name="p_type1" type="hidden">
		<input name="p_type2" type="hidden">
		<input name="p_type3" type="hidden">
		<input name="p_type4" type="hidden">
		<input name="p_type5" type="hidden">
		<input name="p_type6" type="hidden">
		<input name="p_type7" type="hidden">
		<input name="mode" type="hidden" value="search">            
		<input name="ucodes" id="ucodes" type="hidden" value="">
		<input name="markUcodes" id="markUcodes" type="hidden" value="">
		<input name="adzoom" id="adzoom" type="hidden" value="">
		<input name="scale" id="scale" type="hidden" value="">
		<input name="scaleFlag" id="scaleFlag" type="hidden" value="">
		<input name="hash" type="hidden" value="">
		<input name="mobile_yn" type="hidden" value="">
		
		<!-- 내용 입력 -->
		<input name="sggcd" id="sggcd" type="hidden" value="${fn:substring(pnu,0,5) }">
		<input name="pnu" id="pnu" type="hidden" value="${pnu}">	
	</form>
	<div id="land_info_wrap_div">
		<div id="sub_title_div" class="land_info_title">
			<h1>${title}</h1>
		</div>
		<div class="land_info_address_div">
			<div>
				<div class="info_jibun">
					<p><span class="infoAddressKind">지번</span>${full_address}</p>
				</div>
				<div class="info_road">
					<p><span class="infoAddressKind">도로명</span><c:if test="${roadaddr ne ''}">${roadaddr}</c:if></p>				
				</div>
			</div>
			<img class="btnEum" src="${pageContext.request.contextPath}/images/analyseMap/sub/land_joint_inquiry_btn.png" onclick="onClickEum()">
		</div>
		
		<div class="padLine">
		
		</div>
		
		<div class="buttonDiv">
<!-- 			<ul> -->
<!-- 				2023.02.15 김동현 -->
<!--  				serviceList 에서 landInfo_sub 만 불러오기 제외시키키 -->
<%-- 				<c:forEach items="${serviceList}" var="serviceList" varStatus="status"> --%>
<%-- 			 		<c:choose> --%>
<%-- 		 				<c:when test="${serviceList.sd_perm_type eq 'RL'}">		 				 --%>
<%-- 			 				<c:if test="${serviceList.service_type eq 'landInfo_sub'}"> --%>
<%-- 			 					<li class="infoTab '${serviceList.service_name}'" onclick="onClickInfo('${serviceList.service_name}',this)">${serviceList.service_kor_name}</li> --%>
<%-- 							</c:if> --%>
<%-- 						</c:when> --%>
<%-- 					</c:choose> --%>
<%-- 				</c:forEach> --%>
<!-- 			</ul> -->
		</div>
		
		<div id="info_list_div">
		</div>
		<div class="btnClose">
			<img class="btnClose" alt="닫기" src="${pageContext.request.contextPath}/images/civil/sub/popup_close.png" onclick="closeLandDetail()">
		</div>
	</div>
</body>
</html>