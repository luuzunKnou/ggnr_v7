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

		var serviceKey = "dpeDzr70q5P1mLRdtcj1YVE3Po0OCaBEf6Wyi1SSErnKBu3XzCLnQiYxknChirRI9LybE2vSMEn0SZ%2FrRYytdw%3D%3D";
		var pnu = "${pnu}";
		
		var xhr = new XMLHttpRequest();
		var url = 'http://apis.data.go.kr/1611000/nsdi/LandUseService/attr/getLandUseAttr'; /*URL*/
		var domain = $(location).attr("host")
		
		/* 
		if(domain.indexOf("yeongju.go.kr") != -1){ 
			url = "https://yeongju.go.kr/map/datageo/1611000/nsdi/LandUseService/attr/getLandUseAttr";		
 		};
		*/

		if(document.location.href.indexOf("https") != -1){
			url = "https://yeongju.go.kr/map/datageo/1611000/nsdi/LandUseService/attr/getLandUseAttr";		
 		};
		
 		
		var queryParams = '?' + encodeURIComponent('serviceKey') + '='+ serviceKey; /*Service Key*/
		queryParams += '&' + encodeURIComponent('pnu') + '=' + encodeURIComponent(pnu); /**/
		//queryParams += '&' + encodeURIComponent('cnflcAt') + '=' + encodeURIComponent('1'); /**/
		//queryParams += '&' + encodeURIComponent('prposAreaDstrcCodeNm') + '=' + encodeURIComponent('상대보호구역'); /**/
		queryParams += '&' + encodeURIComponent('format') + '=' + encodeURIComponent('json'); /**/
		queryParams += '&' + encodeURIComponent('numOfRows') + '=' + encodeURIComponent('1000000'); /**/
		//queryParams += '&' + encodeURIComponent('pageNo') + '=' + encodeURIComponent('1'); /**/
		
		xhr.open('GET', url + queryParams);
		xhr.onreadystatechange = function () {
		    if (this.readyState == 4) {
 				var result = JSON.parse(this.responseText);
		        var totalCount=result.landUses.totalCount;
		        
		        var appendStr = " ";
		        
	        	appendStr = "<p class='no-result'>검색 결과가 없습니다.</p>";
	        	$(".noData").empty();
 				$(".noData").append(appendStr); 
	        	return;
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
	<div id="info_detail_div" class="noData">
	</div>
</body>
</html>