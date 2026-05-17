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
		var url = "http://apis.data.go.kr/1611000/nsdi/IndvdHousingPriceService/attr/getIndvdHousingPriceAttr";
		var domain = $(location).attr("host")
		
		/* 
		if(domain.indexOf("yeongju.go.kr") != -1){ 
			url = "https://yeongju.go.kr/map/datageo/1611000/nsdi/IndvdHousingPriceService/attr/getIndvdHousingPriceAttr";		
 		};
 		*/
 		
		if(document.location.href.indexOf("https") != -1){
			url = "https://yeongju.go.kr/map/datageo/1611000/nsdi/IndvdHousingPriceService/attr/getIndvdHousingPriceAttr";		
 		};
		
		var queryParams = '?' + encodeURIComponent('ServiceKey') + '='+ serviceKey; /*Service Key*/
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
		    	console.log(result);
		        var totalCount=result.indvdHousingPrices.totalCount;
		    	
		        var appendStr = " ";
		        
		        console.log(totalCount);
		        if(totalCount == 0){
		        	appendStr = "<p class='no-result'>검색 결과가 없습니다.</p>";
		        	$(".housingPrice").empty();
	 				$(".housingPrice").append(appendStr); 
		        	return;
		        } 
		        
 				for(var i=totalCount-1; i>=0; i--){ 
 	 				appendStr += '<table>'
 					appendStr += '	<tr>'
	 				appendStr += '		<th>기준년월</th>'
	 				appendStr += '		<td>'+result.indvdHousingPrices.field[i].stdrYear+ '-' + result.indvdHousingPrices.field[i].stdrMt +'</td>'
	 				appendStr += '		<th>주택가격(원)</th>'
	 				appendStr += '		<td>'+setComma(result.indvdHousingPrices.field[i].housePc)+'원</td>'
 					appendStr += '	</tr>'
 					appendStr += '	<tr>'
	 				appendStr += '		<th class="smallFont">토지대장면적(㎡)</th>'
	 				appendStr += '		<td>'+setComma(result.indvdHousingPrices.field[i].ladRegstrAr)+'㎡</td>'
	 				appendStr += '		<th class="smallFont">산정대지면적(㎡)</th>'
	 				appendStr += '		<td>'+setComma(result.indvdHousingPrices.field[i].calcPlotAr)+'㎡</td>'
 					appendStr += '	</tr>'
 					appendStr += '	<tr>'
	 				appendStr += '		<th class="smallFont">건물전체연면적(㎡)</th>'
	 				appendStr += '		<td>'+setComma(result.indvdHousingPrices.field[i].buldAllTotAr)+'㎡</td>'
	 				appendStr += '		<th class="smallFont">건물산정연면적(㎡)</th>'
	 				appendStr += '		<td>'+setComma(result.indvdHousingPrices.field[i].buldCalcTotAr)+'㎡</td>'
 					appendStr += '	</tr>'
 					appendStr += '</table>'			
 				}
	        	$(".housingPrice").empty();
 				$(".housingPrice").append(appendStr);
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
	<div id="info_detail_div" class="housingPrice">
	</div>
</body>
</html>