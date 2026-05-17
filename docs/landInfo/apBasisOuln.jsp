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
		var url = 'http://apis.data.go.kr/1613000/ArchPmsHubService/getApBasisOulnInfo'; /*URL*/
		var domain = $(location).attr("host")
		
		if(document.location.href.indexOf("https") != -1){
			url = 'https://yeongju.go.kr/map/datageo/1613000/ArchPmsHubService/getApBasisOulnInfo';
		}
		
		
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
		    	console.log(xmlDoc);
		    	
		        var totalCount = xmlDoc.getElementsByTagName("totalCount")[0].childNodes[0].nodeValue;

		        if(totalCount > 10) {
		        	totalCount = 10;
		        } 
		        
		        if(totalCount == 0){
		        	appendStr = "<p class='no-result'>검색 결과가 없습니다.</p>";
		        	$(".apBasisOuln").empty();
	 				$(".apBasisOuln").append(appendStr); 
		        	return;
		        }
		        
		        appendStr += '<div class="source_div"><img src="'+getContextPath()+'/images/icon/info_source.png">공공데이터포털</div>';
 				for(var i=0; i<totalCount; i++){ 
 	 				appendStr += '<table>'				
					appendStr += '	<tr>' 
  					appendStr += '		<th>특수지명</th>'
  					appendStr += '		<td colspan="3">'+xmlDoc.getElementsByTagName("items")[0].getElementsByTagName("item")[i].getElementsByTagName("splotNm")[0].childNodes[0].nodeValue+'</td>'
  					appendStr += '	</tr>' 	 				
 					appendStr += '	<tr>' 
 					appendStr += '		<th>구역명</th>'
 					appendStr += '		<td>'+xmlDoc.getElementsByTagName("items")[0].getElementsByTagName("item")[i].getElementsByTagName("guyukCdNm")[0].childNodes[0].nodeValue+'</td>'
 					appendStr += '		<th>건축구분명</th>'
 					appendStr += '		<td>'+xmlDoc.getElementsByTagName("items")[0].getElementsByTagName("item")[i].getElementsByTagName("archGbCd")[0].childNodes[0].nodeValue+'</td>'
 					appendStr += '	</tr>'
 					appendStr += '	<tr>'
 					appendStr += '		<th>대지면적(㎡)</th>'
 					appendStr += '		<td>'+setComma(xmlDoc.getElementsByTagName("items")[0].getElementsByTagName("item")[i].getElementsByTagName("platArea")[0].childNodes[0].nodeValue)+'㎡</td>'
 					appendStr += '		<th>건축면적(㎡)</th>'
 					appendStr += '		<td>'+setComma(xmlDoc.getElementsByTagName("items")[0].getElementsByTagName("item")[i].getElementsByTagName("archArea")[0].childNodes[0].nodeValue)+'㎡</td>'
 					appendStr += '	</tr>'
 					appendStr += '	<tr>' 					
 					appendStr += '		<th>건폐율(%)</th>'
 					appendStr += '		<td>'+xmlDoc.getElementsByTagName("items")[0].getElementsByTagName("item")[i].getElementsByTagName("bcRat")[0].childNodes[0].nodeValue+'%</td>'
 					appendStr += '		<th>연면적(㎡)</th>'
 					appendStr += '		<td>'+setComma(xmlDoc.getElementsByTagName("items")[0].getElementsByTagName("item")[i].getElementsByTagName("totArea")[0].childNodes[0].nodeValue)+'㎡</td>'
 					appendStr += '	</tr>'
 					appendStr += '	<tr>' 					
 					appendStr += '		<th class="smallFont">용적률산정연면적(㎡)</th>'
 					appendStr += '		<td>'+setComma(xmlDoc.getElementsByTagName("items")[0].getElementsByTagName("item")[i].getElementsByTagName("vlRatEstmTotArea")[0].childNodes[0].nodeValue)+'㎡</td>'
 					appendStr += '		<th>용적률(%)</th>'
 					appendStr += '		<td>'+xmlDoc.getElementsByTagName("items")[0].getElementsByTagName("item")[i].getElementsByTagName("vlRat")[0].childNodes[0].nodeValue+'%</td>'
 					appendStr += '	</tr>'
 					appendStr += '	<tr>' 					
 					appendStr += '		<th>주건축물수</th>'
 					appendStr += '		<td>'+setComma(xmlDoc.getElementsByTagName("items")[0].getElementsByTagName("item")[i].getElementsByTagName("mainBldCnt")[0].childNodes[0].nodeValue)+'</td>'
 					appendStr += '		<th>부속건축물동수</th>'
 					appendStr += '		<td>'+setComma(xmlDoc.getElementsByTagName("items")[0].getElementsByTagName("item")[i].getElementsByTagName("atchBldDongCnt")[0].childNodes[0].nodeValue)+'</td>'
 					appendStr += '	</tr>'
 					appendStr += '	<tr>' 					
 					appendStr += '		<th>주용도</th>'
 					appendStr += '		<td>'+xmlDoc.getElementsByTagName("items")[0].getElementsByTagName("item")[i].getElementsByTagName("mainPurpsCdNm")[0].childNodes[0].nodeValue+'</td>'
 					appendStr += '		<th>세대수(세대)</th>'
 					appendStr += '		<td>'+setComma(xmlDoc.getElementsByTagName("items")[0].getElementsByTagName("item")[i].getElementsByTagName("hhldCnt")[0].childNodes[0].nodeValue)+'</td>'
 					appendStr += '	</tr>'
 					appendStr += '	<tr>' 					
 					appendStr += '		<th>호수(호)</th>'
 					appendStr += '		<td>'+setComma(xmlDoc.getElementsByTagName("items")[0].getElementsByTagName("item")[i].getElementsByTagName("hoCnt")[0].childNodes[0].nodeValue)+'호</td>'
 					appendStr += '		<th>가구수(가구)</th>'
 					appendStr += '		<td>'+setComma(xmlDoc.getElementsByTagName("items")[0].getElementsByTagName("item")[i].getElementsByTagName("fmlyCnt")[0].childNodes[0].nodeValue)+'</td>'
 					appendStr += '	</tr>'
 					appendStr += '	<tr>' 					
					appendStr += '		<th>착공예정일</th>'
					appendStr += '		<td>'+xmlDoc.getElementsByTagName("items")[0].getElementsByTagName("item")[i].getElementsByTagName("stcnsSchedDay")[0].childNodes[0].nodeValue+'</td>'
					appendStr += '		<th>착공연기일</th>'
					appendStr += '		<td>'+xmlDoc.getElementsByTagName("items")[0].getElementsByTagName("item")[i].getElementsByTagName("stcnsDelayDay")[0].childNodes[0].nodeValue+'</td>'
					appendStr += '	</tr>'
 					appendStr += '	<tr>' 					
  					appendStr += '		<th>실제착공일</th>'
  					appendStr += '		<td>'+xmlDoc.getElementsByTagName("items")[0].getElementsByTagName("item")[i].getElementsByTagName("realStcnsDay")[0].childNodes[0].nodeValue+'</td>'
  					appendStr += '		<th>건축허가일</th>'
  					appendStr += '		<td>'+xmlDoc.getElementsByTagName("items")[0].getElementsByTagName("item")[i].getElementsByTagName("archPmsDay")[0].childNodes[0].nodeValue+'</td>'
  					appendStr += '	</tr>'
  					appendStr += '	<tr>' 					
  					appendStr += '		<th>사용승인일</th>'
  					appendStr += '		<td>'+xmlDoc.getElementsByTagName("items")[0].getElementsByTagName("item")[i].getElementsByTagName("useAprDay")[0].childNodes[0].nodeValue+'</td>'
  					appendStr += '		<th>생성일자</th>'
  					appendStr += '		<td>'+xmlDoc.getElementsByTagName("items")[0].getElementsByTagName("item")[i].getElementsByTagName("crtnDay")[0].childNodes[0].nodeValue+'</td>'
  					appendStr += '	</tr>'
//   					appendStr += '	<tr>' 					
//   					appendStr += '		<th>관리허가대장</th>'
//   					appendStr += '		<td colspan="3">'+xmlDoc.getElementsByTagName("items")[0].getElementsByTagName("item")[i].getElementsByTagName("mgmPmsrgstPk")[0].childNodes[0].nodeValue+'</td>'
//   					appendStr += '	</tr>'
  					appendStr += '	<tr>' 					
  					appendStr += '		<th>블록</th>'
  					appendStr += '		<td>'+xmlDoc.getElementsByTagName("items")[0].getElementsByTagName("item")[i].getElementsByTagName("block")[0].childNodes[0].nodeValue+'</td>'
  					appendStr += '		<th>로트</th>'
  					appendStr += '		<td>'+xmlDoc.getElementsByTagName("items")[0].getElementsByTagName("item")[i].getElementsByTagName("lot")[0].childNodes[0].nodeValue+'</td>'  					
  					appendStr += '	</tr>'
   					appendStr += '	<tr>'
					appendStr += '		<th>지역명</th>'
  					appendStr += '		<td>'+xmlDoc.getElementsByTagName("items")[0].getElementsByTagName("item")[i].getElementsByTagName("jiyukCdNm")[0].childNodes[0].nodeValue+'</td>'
  					appendStr += '		<th>지구명</th>'
  					appendStr += '		<td>'+xmlDoc.getElementsByTagName("items")[0].getElementsByTagName("item")[i].getElementsByTagName("jiguCdNm")[0].childNodes[0].nodeValue+'</td>'
  					appendStr += '	</tr>'
 					appendStr += '</table>'			
 				}
	        	$(".apBasisOuln").empty();
 				$(".apBasisOuln").append(appendStr); 
 				
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
	<div id="info_detail_div" class="apBasisOuln">
	</div>
</body>
</html>