<%@ page language="java" contentType="text/html; charset=utf-8" pageEncoding="utf-8"%>
<%@ taglib prefix="c" uri="http://java.sun.com/jsp/jstl/core" %>
<%@ taglib prefix="spring" uri="http://www.springframework.org/tags"%>
<%@ taglib prefix="ui" uri="http://egovframework.gov/ctl/ui"%>
<%@ taglib uri="http://java.sun.com/jsp/jstl/functions" prefix="fn" %>
 
<!DOCTYPE html>
<html lang ="ko">
<head>
<meta charset="UTF-8">
<title><spring:eval expression="@appProperty['App.AppName_KR']"></spring:eval></title>
<link href="${pageContext.request.contextPath}/css/component/viewer.css" rel="stylesheet">
<script type="text/javascript" charset="UTF-8" src="<c:url value='/js/component/oldland/oldlandViewer.js' />"></script>
<script type="text/javascript" charset="UTF-8" src="<c:url value='/js/component/landArchiveZoom.js' />"></script>

<style type="text/css">
	table {
		width: 100%;
		padding-top: 9px; 
		font-size: 14px; 
		overflow-y:scroll 
	}
	.info_header_table{height: 200px;}
	.info_main_table{height: clac(100% - 200px);}
	
	table > tbody > tr > td{
		border: 1px solid #000000;
		text-align: left;
		padding-left: 9px;
		word-break:break-all;
	}
	
	.main_div{
		overflow-y: auto;
		height: 490px; 
	}
	
	.info_header_table {
		width:265px; 
		table-layout: fixed;
	}
	.info_main_table { 
		height:60px; 
		table-layout: fixed;
	}
	.info_main_table > tbody > tr{
		height: 30px;
	}
	.info_main_table > tbody > tr:first-child{
		position: sticky;
		top: 0;
		background: #67819e;
		color:white;
	}
	.info_header_sec{margin-bottom: 30px;}
	.info_header {
		background-color: #67819e;
		 color: white; 
		 height: 30px; 
		 line-height: 30px;
		 font-size: 17px; 
		 font-weight: 400; 
		 text-align: left;
		 padding-left:15px;
	 }
	
	.imageView {
		width: 100%;
		height: 100%;
	}
	.imageWrapper {
		width: 100%; 
		height: 100%; 
		cursor: pointer;
	}
	
	.showOldlandTranslate {
		background-color: #F7F7F7; border: solid 1px #F7F7F7; border-radius: 5px; cursor: pointer;
		color: #67819E; font-size: 13px; margin-left: 70px; padding: 0 10px;
	}

</style>
<script type="text/javascript"> 
	var filePath = $(".filePath").val();
	var fileName = $(".fileName").val();
	var kind = "${kind}";
	var resultSize = ${size};
	var viewer;
	
	if(kind == "지적도"){ //지적도의 경우 filePath에 fileName이 포함되어 있어 예외처리함.
		showImage((filePath).replace(/\\/gi,"\/"));
	} else {
		showImage((filePath).replace(/\\/gi,"\/"));
	}
	
	function showImage(imagePath){
		// 돋보기 숨기기
		var glass = $(".img-magnifier-glass");
		glass.remove();
	    
		$(".image_div").empty();
		var appendLoading = "<div class='loadingDiv'>" + 
				"<img src='${pageContext.request.contextPath}/images/landArchive/Progress_Loading.gif'>" + 
			"</div>";
		$(".image_div").append(appendLoading);	
		$("#fileImg").attr("src",
				"${pageContext.request.contextPath}/conn?wnm=getfiledirect&path="+imagePath
		);
		console.log("${pageContext.request.contextPath}/conn?wnm=getfiledirect&path="+imagePath)
	}		
	
	function showViewer() {// 이미지 뷰어가 이미 생성된 경우 파괴 

		if (viewer) {
	        viewer.destroy();
	    }
	    
		//여러장
	    viewer = new Viewer(document.getElementById('fileImg'), {
	        hidden : function() {
	        	viewer.destroy();
	   		},
	   	});   
		viewer.view(); //index를 위한
	}
	
	//토지대장 번역결과로 이동
	function showOldlandTranslate(hjd, jibun,isSan){
		var emd = hjd.split(" ")[0];
		var ri = hjd.split(" ")[1];
		if (isSan === "true") {// 임야대장 번역
			changeMenu('1013', "oldland/oldlandMain.do?emd=" + emd + "&li=" + ri + "&jibun=" + (jibun).replace(" ","")+"&isSan=true", '', '');
		}// 토지대장 번역
		else{ 
			changeMenu('1013', "oldland/oldlandMain.do?emd=" + emd + "&li=" + ri + "&jibun=" + (jibun).replace(" ","")+"&isSan=false", '', '');
		}
	}
</script>
</head>
<body>	
	<input type="hidden" class="filePath" value="${path_name}">
	<input type="hidden" class="fileName" value="${file_name}">	
 		<div class="info_header_sec">
			<p class="info_header">  
				<c:forEach var="item" items="${result[0]}">
					<c:if test="${item.key eq '문서종류'}">
						${item.value}
						<c:if test="${item.value eq '토지대장'}">
							<span class="showOldlandTranslate" onclick="showOldlandTranslate('${hjd}', '${jibun}')">변역결과보기</span>
						</c:if>
						<c:if test="${item.value eq '임야대장'}">
							<span class="showOldlandTranslate" onclick="showOldlandTranslate('${hjd}', '${jibun}','true')">변역결과보기</span>
						</c:if>
					</c:if>
				</c:forEach>
			</p>
			<table class="info_header_table">
				<tbody>
					<c:forEach var="item" items="${infoHeader}">
						<c:if test="${item.key ne '파일경로' and item.key ne '파일명' }">
						    <tr> 
						      	<td>${item.key}</td>
						      	<td>${item.value}</td>
						    </tr>
					    </c:if>
				    </c:forEach>
			    </tbody>
		    </table> 
		</div>
						
		<c:if test="${not (result[0]['기록물종류'] eq '비법인')}">
	 	<div class="main_div">
		 	<table class="info_main_table">
		 		<tbody>
		 			<tr>
		 				<th>지번</th>
					</tr>
				 	<c:forEach items="${result}" var="list" varStatus="status">
				 		 <tr>
							<td>${list["행정동"]} ${list["지번"]}</td>
						</tr>
				    </c:forEach>
		    	</tbody>
		 	</table>
	 	</div>
	</c:if>	
</body>
</html>