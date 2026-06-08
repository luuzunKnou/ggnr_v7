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
<script type="text/javascript" charset="UTF-8" src="<c:url value='/js/component/xml2json.js' />"></script>
<script type="text/javascript">
	
	$(document).ready(function(){
		$("#info_detail_div").append('<img class="loadingImg" alt="로딩중" src="${pageContext.request.contextPath}/images/common/Progress_Loading.gif">');

		var serviceKey = "${dataPotalKey}"
		
		if(serviceKey == 'null' || typeof service_key == 'undefined'){
			serviceKey = "aiP4epT7GQrb64StfWRp3NF1Ng%2BIC%2Fg4pdDz%2BpKuU4Dh31MWXIyhos7HT6puzyJjWC0UuCugVMapD1bm9D7pTA%3D%3D";
		}
		
		var pnu = "${pnu}";
		
		var sigunguCd 	= pnu.substring(0,5); 	//시군구코드
		var bjdongCd 	= pnu.substring(5,10); 	//법정동코드
		var platGbCd 	= pnu.substring(10,11); //대지구분코드 (0:대지, 1:산)
		var bun 		= pnu.substring(11,15); //번
		var ji 			= pnu.substring(15,19); //지
		
		//대지구분코드가 PNU와 달라 -1을 해줌.
		platGbCd = parseInt(platGbCd)-1;
		
		var xhr = new XMLHttpRequest();
		var url = 'http://apis.data.go.kr/1613000/HsPmsHubService/getHpBasisOulnInfo'; /*URL*/
		var domain = $(location).attr("host")
		
		/* 
		if(domain.indexOf("yeongju.go.kr") != -1){ 
			url = "https://yeongju.go.kr/map/datageo/1611000/HsPmsService/getHpBasisOulnInfo";		
 		};
		*/
 		
		if(document.location.href.indexOf("https") != -1){
			url = "https://yeongju.go.kr/map/datageo/1613000/HsPmsHubService/getHpBasisOulnInfo";		
 		};
		
		var queryParams = '?' + encodeURIComponent('serviceKey') + '='+ serviceKey; /*Service Key*/
		queryParams += '&' + encodeURIComponent('sigunguCd') + '=' + encodeURIComponent(sigunguCd); /**/
		queryParams += '&' + encodeURIComponent('bjdongCd') + '=' + encodeURIComponent(bjdongCd); /**/
		queryParams += '&' + encodeURIComponent('platGbCd') + '=' + encodeURIComponent(platGbCd); /**/
		queryParams += '&' + encodeURIComponent('bun') + '=' + encodeURIComponent(bun); /**/
		queryParams += '&' + encodeURIComponent('ji') + '=' + encodeURIComponent(ji); /**/
		queryParams += '&' + encodeURIComponent('numOfRows') + '=' + encodeURIComponent('10'); /**/
		queryParams += '&' + encodeURIComponent('pageNo') + '=' + encodeURIComponent('1'); /**/
		queryParams += '&' + encodeURIComponent('format') + '=' + encodeURIComponent('json'); /**/
		xhr.open('GET', url + queryParams);
		xhr.setRequestHeader('Content-Type', 'multipart/form-data');

		xhr.onreadystatechange = function () {
		    if (this.readyState == 4) {
		    	var parser, xmlDoc;
		        var appendStr = "";

		    	parser=new DOMParser();
		    	xmlDoc=parser.parseFromString(this.responseText,"text/xml");
		    	//console.log(xmlDoc);
		    	
		        var totalCount = xmlDoc.getElementsByTagName("totalCount")[0].childNodes[0].nodeValue;

		        if(totalCount > 10) {
		        	totalCount = 10;
		        } 
		        
		        if(totalCount == 0){
		        	appendStr = "<p class='no-result'>검색 결과가 없습니다.</p>";
		        	$(".hpBasisOuln").empty();
	 				$(".hpBasisOuln").append(appendStr); 
		        	return;
		        }
				
		        appendStr += '<div class="source_div"><img src="'+getContextPath()+'/images/icon/info_source.png">공공데이터포털</div>';
 				for(var i=0; i<totalCount; i++){ 
 	 				appendStr += '<table>'
 					appendStr += '	<tr>' 
 					appendStr += '		<th>건물명</th>'
 					appendStr += '		<td>'+xmlDoc.getElementsByTagName("items")[0].getElementsByTagName("item")[i].getElementsByTagName("bldNm")[0].childNodes[0].nodeValue+'</td>'
 					appendStr += '		<th>특수지명</th>'
 					appendStr += '		<td>'+xmlDoc.getElementsByTagName("items")[0].getElementsByTagName("item")[i].getElementsByTagName("splotNm")[0].childNodes[0].nodeValue+'</td>'
 					appendStr += '	</tr>'
 					appendStr += '	<tr>' 					
 					appendStr += '		<th>블록</th>'
 					appendStr += '		<td>'+xmlDoc.getElementsByTagName("items")[0].getElementsByTagName("item")[i].getElementsByTagName("block")[0].childNodes[0].nodeValue+'</td>'
 					appendStr += '		<th>로트</th>'
 					appendStr += '		<td>'+xmlDoc.getElementsByTagName("items")[0].getElementsByTagName("item")[i].getElementsByTagName("lot")[0].childNodes[0].nodeValue+'</td>'
 					appendStr += '	</tr>'
 					appendStr += '	<tr>' 					
 					appendStr += '		<th>용도명</th>'
 					appendStr += '		<td>'+xmlDoc.getElementsByTagName("items")[0].getElementsByTagName("item")[i].getElementsByTagName("purpsCdNm")[0].childNodes[0].nodeValue+'</td>'
 					appendStr += '		<th>구조명</th>'
 					appendStr += '		<td>'+xmlDoc.getElementsByTagName("items")[0].getElementsByTagName("item")[i].getElementsByTagName("strctCdNm")[0].childNodes[0].nodeValue+'</td>'
 					appendStr += '	</tr>'
 					appendStr += '	<tr>' 					
 					appendStr += '		<th>주건축물수</th>'
 					appendStr += '		<td>'+setComma(xmlDoc.getElementsByTagName("items")[0].getElementsByTagName("item")[i].getElementsByTagName("mainBldCnt")[0].childNodes[0].nodeValue)+'</td>'
 					appendStr += '		<th>연면적(㎡)</th>'
 					appendStr += '		<td>'+setComma(xmlDoc.getElementsByTagName("items")[0].getElementsByTagName("item")[i].getElementsByTagName("totArea")[0].childNodes[0].nodeValue)+'㎡</td>'
 					appendStr += '	</tr>'
 					appendStr += '	<tr>' 					
 					appendStr += '		<th>총세대수(세대)</th>'
 					appendStr += '		<td>'+setComma(xmlDoc.getElementsByTagName("items")[0].getElementsByTagName("item")[i].getElementsByTagName("totHhldCnt")[0].childNodes[0].nodeValue)+'</td>'
 					appendStr += '		<th>철거멸실구분</th>'
 					appendStr += '		<td>'+xmlDoc.getElementsByTagName("items")[0].getElementsByTagName("item")[i].getElementsByTagName("demolExtngGbCdNm")[0].childNodes[0].nodeValue+'</td>'
 					appendStr += '	</tr>'
 					appendStr += '	<tr>' 					
 					appendStr += '		<th>철거시작일</th>'
 					appendStr += '		<td>'+xmlDoc.getElementsByTagName("items")[0].getElementsByTagName("item")[i].getElementsByTagName("demolStrtDay")[0].childNodes[0].nodeValue+'</td>'
 					appendStr += '		<th>철거종료일</th>'
 					appendStr += '		<td>'+xmlDoc.getElementsByTagName("items")[0].getElementsByTagName("item")[i].getElementsByTagName("demolEndDay")[0].childNodes[0].nodeValue+'</td>'
 					appendStr += '	</tr>'
 					appendStr += '	<tr>' 					
 					appendStr += '		<th>철거멸실일</th>'
 					appendStr += '		<td>'+xmlDoc.getElementsByTagName("items")[0].getElementsByTagName("item")[i].getElementsByTagName("demolExtngDay")[0].childNodes[0].nodeValue+'</td>'
 					appendStr += '		<th>건축허가일</th>'
 					appendStr += '		<td>'+xmlDoc.getElementsByTagName("items")[0].getElementsByTagName("item")[i].getElementsByTagName("apprvDay")[0].childNodes[0].nodeValue+'</td>'
 					appendStr += '	</tr>'
 					appendStr += '	<tr>' 					
 					appendStr += '		<th>착공예정일</th>'
 					appendStr += '		<td>'+xmlDoc.getElementsByTagName("items")[0].getElementsByTagName("item")[i].getElementsByTagName("stcnsSchedDay")[0].childNodes[0].nodeValue+'</td>'
 					appendStr += '		<th>착공일</th>'
 					appendStr += '		<td>'+xmlDoc.getElementsByTagName("items")[0].getElementsByTagName("item")[i].getElementsByTagName("stcnsDay")[0].childNodes[0].nodeValue+'</td>'
 					appendStr += '	</tr>'
 					appendStr += '	<tr>' 					
 					appendStr += '		<th>사용검사예정일</th>'
 					appendStr += '		<td>'+xmlDoc.getElementsByTagName("items")[0].getElementsByTagName("item")[i].getElementsByTagName("useInsptDay")[0].childNodes[0].nodeValue+'</td>'
 					appendStr += '		<th>사용검사일</th>'
 					appendStr += '		<td>'+xmlDoc.getElementsByTagName("items")[0].getElementsByTagName("item")[i].getElementsByTagName("useInsptSchedDay")[0].childNodes[0].nodeValue+'</td>'
 					appendStr += '	</tr>'
 					appendStr += '	<tr>' 					
  					appendStr += '		<th>생성일자</th>'
  					appendStr += '		<td>'+xmlDoc.getElementsByTagName("items")[0].getElementsByTagName("item")[i].getElementsByTagName("crtnDay")[0].childNodes[0].nodeValue+'</td>'
  					appendStr += '		<th>관리주택대장</th>'
  					appendStr += '		<td>'+xmlDoc.getElementsByTagName("items")[0].getElementsByTagName("item")[i].getElementsByTagName("mgmHsrgstPk")[0].childNodes[0].nodeValue+'</td>'
  					appendStr += '	</tr>'
 					appendStr += '</table>'			
 				}
	        	$(".hpBasisOuln").empty();
 				$(".hpBasisOuln").append(appendStr); 
 				
		    	/* var xml2json = new XMLtoJSON();
		    	console.log(this.responseText);
		    	
		    	var objson = xml2json.fromStr(this.responseText);
 				var result = objson.response.body;
 				console.log(result);
		        
 				var totalCount=result.totalCount;
		        
		      	console.log(totalCount);
		      	console.log(result.mainPurpsCdNm);
		      	
		        var appendStr = " ";
 				for(var i=0; i<totalCount; i++){ 
 	 				appendStr += '<table>'
 					appendStr += '	<tr>'
 					appendStr += '		<th>주용도코드명</th>'
 					appendStr += '		<td>'+result.mainPurpsCdNm+'</td>'
 					appendStr += '	</tr>'
 					appendStr += '</table>'			
 				}

 				$("#info_detail_div").append(appendStr); */
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
	<div id="info_detail_div" class="hpBasisOuln">
	</div>
</body>
</html>