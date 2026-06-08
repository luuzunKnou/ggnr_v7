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

<script type="text/javascript">
	
	$(document).ready(function(){
		$("#info_detail_div").append('<img class="loadingImg" alt="로딩중" src="${pageContext.request.contextPath}/images/common/Progress_Loading.gif">');

		var pnu = "${pnu}";
		
		var xhr = new XMLHttpRequest();
		var url = "${pageContext.request.contextPath}/vworldLandUseAttr.api";
		
		var domain = $(location).attr('protocol') + '//' + $(location).attr('host');
		
		if(document.location.href.indexOf("https") != -1){
			url = "${pageContext.request.contextPath}/vworldLandUseAttr_https.api"
 		};
 		
 		var queryParams = '?' + encodeURIComponent('key') + '='+ "${VworldAuthKey}"; /*authKey*/
		queryParams += '&' + encodeURIComponent('pnu') + '=' + encodeURIComponent(pnu); /**/
		queryParams += '&' + encodeURIComponent('format') + '=' + encodeURIComponent('json'); /**/
		queryParams += '&' + encodeURIComponent('numOfRows') + '=' + encodeURIComponent('1000'); /*검색건수 최대 1000*/
		//queryParams += '&' + encodeURIComponent('cnflcAt') + '=' + encodeURIComponent('1'); /**/
		//queryParams += '&' + encodeURIComponent('prposAreaDstrcCodeNm') + '=' + encodeURIComponent('상대보호구역'); /**/
		//queryParams += '&' + encodeURIComponent('pageNo') + '=' + encodeURIComponent('1'); /**/
		xhr.open('GET', url + queryParams);
		xhr.onreadystatechange = function () {
		    if (this.readyState == 4) {
 				var result = JSON.parse(this.responseText);
	 			var totalCount=0;
	 			if(result.landUses){
	 				totalCount=result.landUses.totalCount;
	 			}else {
	 				totalCount=result.response.totalCount;
	 			}
		    	 
		        var appendStr = " ";
		        
		        if(totalCount == 0){
		        	appendStr = "<p class='no-result'>검색 결과가 없습니다.</p>";
		        	$(".landUsePlan").empty();
	 				$(".landUsePlan").append(appendStr); 
		        	return;
		        }
		        
		     	// 2024.12.12 수범 : vworld 데이터 중복 처리(토지이용계획,공시지가,특성정보)
		        var fieldsToKeep = [
		            "prposAreaDstrcCodeNm",
		            "cnflcAtNm",
		            "registDt"
		        ];
		     	// 공통함수 정의(위치 : landInfoMain.jsp)
		     	// 중복 처리 함수 필요 인자 : 1. 남길 필드명 2. 원본 객체 배열
		        var dataArray =getReduceDuplicateProcessedData(fieldsToKeep,result.landUses.field,"registDt");
		        
		        appendStr += '<div class="source_div"><img src="'+getContextPath()+'/images/icon/info_source.png">vworld 디지털 트윈국도 국가중점데이터</div>';
 				for(var i=0;i<dataArray.length;i++){ 
 	 				appendStr += '<table>'
 					appendStr += '	<tr>'
 					appendStr += '		<th>용도지역지구명</th>'
 					appendStr += '		<td colspan="3" class="prposAreaDstrcCodeNm">'+dataArray[i].prposAreaDstrcCodeNm+'</td>'
 					appendStr += '	</tr>'
 					appendStr += '	<tr>'
 					appendStr += '		<th>저촉여부</th>'
 					appendStr += '		<td class="cnflcAtNm">'+dataArray[i].cnflcAtNm+'</td>'
 					appendStr += '		<th>등록일자</th>'
 					appendStr += '		<td class="registDt">'+dataArray[i].registDt+'</td>'
 					appendStr += '	</tr>'
 					appendStr += '</table>'			
 				}

	        	$(".landUsePlan").empty();
 				$(".landUsePlan").append(appendStr);
		    }
		};
		
		xhr.send('');
	});
</script>

<style>
	#info_detail_div {width: 100%; height:480px; overflow-y: auto;}
	#info_detail_div table {width: calc(100% - 20px); margin: 10px;}
	#info_detail_div th {background-color: #F4F4F4; font-size: 14px; line-height: 30px; width: 130px; color: #383838; border: solid 1px #CCCCCC;}
	#info_detail_div td {font-size: 14px; padding-left: 5px; width: 146px; color: #777777; border: solid 1px #CCCCCC;} 
</style>

</head>
<body> 
	<div id="info_detail_div" class="landUsePlan">
	</div>
</body>
</html>