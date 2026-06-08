<%@ page language="java" contentType="text/html; charset=UTF-8" pageEncoding="UTF-8"%> 
<%@ taglib prefix="c" uri="http://java.sun.com/jsp/jstl/core" %> 
<%@ taglib prefix="spring" uri="http://www.springframework.org/tags"%> 
<%@ taglib prefix="ui" uri="http://egovframework.gov/ctl/ui"%> 
<%@ taglib uri="http://java.sun.com/jsp/jstl/functions" prefix="fn" %>

<link href="${pageContext.request.contextPath}/css/component/map_main.css" rel="stylesheet"/>
<script type="text/javascript" charset="UTF-8" src="<c:url value='/js/component/landArchiveZoom.js' />"></script>

<style type="text/css">
	* {
		margin: 0;
		padding: 0;
		/*box-sizing: border-box;*/
	}
	html,
	body {
	    height: 100%;
	    overflow: hidden;
	}
  
	/* 상단 */
	.landarchive_wrap {
		position: relative;
		height: 100%;
		margin-top: 50px;
	}
  
	/* 메인 */
	.main {
		position: relative;
		display: flex;
		width: 100%;
		height: 100%;
		overflow: hidden;
	}

	/* 검색 및 목록 출력 영역 */
	.search_wrap {
	    position: relative;
	    width: 270px;
	    height: 100%;
	    border-right: solid 1px #67819e;
	}

	.search_div {
	    min-height: 112px;
	    border-bottom: solid 1px #234e70;
	}

	.list_div {
	    height: calc(100% - 488px);
	    border-bottom: solid 1px #234e70;
	    overflow-y: auto;
	    margin-top: 10px;
	}

	/* 검색 출력 영역  */
	.info_wrap {
		position: relative;
	    width: 270px;
	    height: 100%;
	    border-right: solid 1px #67819e;
	}
	.info_header {
		position: relative;
	}
	.info_body {
    	position: relative;
	}

	/* 지도 출력 영역 */
	.archive_wrap {
    	position: relative;
    	height: 100%;
	}
  
	.archive_img {
    	position: relative;
    	height: 100%;
    	width: 100%
	}
  
	.archive_wrap > #fileImg {
		max-width: 100%;
		max-height: 100%;
		display: flex;	
	    margin-left: auto;
	    margin-right: auto;
	}

	/*돋보기 css*/
	.img-magnifier-glass {
		position: absolute;
	    border: 1px solid #000;
	    border-radius: 50%; 
	    cursor: none;
	    width: 300px;
	    height: 300px;
	}
  
	.test_wrap {
		width: 1563px;
	    display: flex;
	    flex-direction: row;
	    align-items: center;
	    justify-content: center;
	}
	
	#printBtn{
		display: none;
		position: fixed;
		right: 2rem;
		top: 4rem;
		cursor: pointer;
		z-index: 1;
		cursor: pointer;
		background:
			url("${pageContext.request.contextPath}/images/oldlandBtn/print_off.png")
			no-repeat;
		border: none;
		width: 80px;
		height: 32px;
	}
	
	#printBtn:hover{
		background:
		url("${pageContext.request.contextPath}/images/oldlandBtn/print_on.png")
		no-repeat;
	}
	.info_div{
		overflow-y: auto;
	    height: calc(100% - 368px);
	    border-bottom: solid 1px #234e70;
	}
</style>

<div class="landarchive_wrap">
	<div class="main">
	    <!-- 검색 및 목록 출력 영역-->
	    <div class="search_wrap">    
			<div class="search_div">
				<c:import url="/landArchive/landArchiveSearch.do" />
			</div>   
		<div class="list_div"></div>
		<!-- 속성정보 출력 영역 -->
		<div class="info_div"></div>
		<div></div>
	    </div>
	    
	    <!-- 속성정보 출력 영역 -->
		<!-- <div class="info_wrap">
			<div class="info_div"></div>
		</div> -->
	    
	    <!-- 이미지파일 출력 영역-->
		<div class= "test_wrap">
			<div class="archive_wrap">	
				<button id="printBtn" onclick="landArchivePrint()"></button>
				<img alt="" id="fileImg" onclick="showViewer()">    	
			</div>
		</div>  
	</div>
</div>
<script>
	$("#fileImg").on("load", function() {
		var height = $(this).height(); 
		var width = $(this).width();
		$('#printBtn').css('display', 'block');
	});

	$(".archive_wrap").on('contextmenu', function(e) {
		var magnifierGlass = $('.img-magnifier-glass');
	    
		if (magnifierGlass.length > 0) { 	
			magnifierGlass.remove();
		} else {
	    	magnifierGlass.remove();
		 // magnify("fileImg", 1.7);
			var zoom = 1.9;
			magnify("fileImg", zoom);
	    // zoom값으로 돋보기 확대비율 조절    
			
	        // 최초 마우스 돋보기 이미지 위치 설정   및 위치     
			var mouseX = e.pageX - $(this).offset().left;
			var mouseY = e.pageY - $(this).offset().top;        
			var bw = 3;
			
			var glass = $(".img-magnifier-glass");
			var glassW = 200;
			var glassH = 200;
			var glassZ = 5;
			
			var img = $("#fileImg");
			var imgW = img.width() * zoom;
			var imgH = img.height() * zoom;
			
			glass.css({
				"display" : "block",
				"z-index": glassZ,
				"left": mouseX - glassW/2,	
				"top": mouseY - glassH/2,
				"background-image": "url('" + img.attr("src") + "')",
				"background-repeat": "no-repeat",
				"background-size": imgW + "px " + imgH + "px",
				"background-position": "-" + ((mouseX * zoom) - (glassW/2) + bw) + "px -" + ((mouseY * zoom) - (glassH/2) + bw) + "px"        	
			});
	
	        // 돋보기 이미지 클릭시 처리
			glass.on("click", function(e){
				e.preventDefault();
				showViewer();
			});  
		}
	    return false;
	});
	
	//2024.05.02 김재운 - 프린트 기능 추가
	function landArchivePrint(){
		
		var imgPath = (filePath).replace(/\\/gi,"\/");
		var url = "${pageContext.request.contextPath}/landArchive/landArchivePrint.do?imgPath=" + imgPath + "&width=" + $('#fileImg').width() + "&height=" + $('#fileImg').height();
		var popupWidth = $('#fileImg').width()+100;
		var popupHeight = $('#fileImg').height()+300;
		var targetTitle = "landArchivePrint";
		
		var openedWindow = openNewWindow(url, popupWidth, popupHeight, targetTitle);
	}
</script>
