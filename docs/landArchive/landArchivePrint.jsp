<%@ page language="java" contentType="text/html; charset=UTF-8"
    pageEncoding="UTF-8"%>
<%@ taglib prefix="c" uri="http://java.sun.com/jsp/jstl/core" %>
<%@ taglib prefix="spring" uri="http://www.springframework.org/tags"%>
<%@ taglib prefix="ui" uri="http://egovframework.gov/ctl/ui"%>
<%@ taglib uri="http://java.sun.com/jsp/jstl/functions" prefix="fn" %>
<!DOCTYPE html>
<html>
<head>
<script src="https://ajax.googleapis.com/ajax/libs/jquery/3.6.0/jquery.min.js"></script>
<meta charset="UTF-8">
<title> <%=component.util.SystemInfoRepository.getInstance().getAppName_KR()%> </title>
<style type="text/css">
     @media print {
        canvas {
			width: 80%;  /* 페이지 너비에 맞춤 */
	        height: 80%; /* 최대 높이 설정 */
	        object-fit: contain; /* 원본 비율 유지 */
        }
        #nonePrint{display:none !important}
    }

    .drawBtn_off, .drawReset{
    	border: 2px solid #43B5E1;
    	width: 7rem;
    	text-align: center;
    	cursor: pointer;
    	text-align: center;
    	border-radius: 12px;
	    line-height: 25px;
	    color: #43B5E1;
	    font-size: 14px;
	    font-weight: bold;
    }
    .drawReset{
    	width: 5rem !important;
    }
    
    .drawBtn_off:hover, .drawReset:hover,  .drawBtn_on{
    	border: 2px solid #43B5E1;
    	width: 7rem;
    	text-align: center;
    	cursor: pointer;
    	text-align: center;
    	border-radius: 12px;
	    line-height: 25px;
	    color: white;
	    font-size: 14px;
	    font-weight: bold;
	    background: #43B5E1;
    }
    
	#nonePrint {
	    display: flex;
	    align-items: center;
	    margin-bottom: 0.5rem;
	}
	
	.drawReset{
		margin-left: 0.4rem; 
	}
	
	.drawPrint{
    	position: absolute;
   		right: 4.5rem;
    	border: none;
    	background:url("${pageContext.request.contextPath}/images/map/print_off.png") no-repeat;
    	width: 30px;
    	height: 30px;
/*     	background:url("${pageContext.request.contextPath}/images/oldlandBtn/print_off.png") no-repeat;
		width: 80px;
		height: 32px; */
	}
	
	.drawPrint:hover{
	    background:url("${pageContext.request.contextPath}/images/map/print_on.png") no-repeat;
/* 	    background:url("${pageContext.request.contextPath}/images/oldlandBtn/print_on.png") no-repeat; */
	}

</style> 
<script type="text/javascript">
	
	$(document).ready(function(){
		$('#drawBtn').on('click',function(){
			var cla = $(this).attr('class')
			if(cla == 'drawBtn_off'){
				$(this).attr('class', 'drawBtn_on');
				$('#lan_canvas').css('cursor', 'pointer');
				
				enableDrawing();
				
			}else if(cla == 'drawBtn_on'){
				$(this).attr('class', 'drawBtn_off');
				$('#lan_canvas').off('mousemove');
				$('#lan_canvas').css('cursor', '');
				
				disableDrawing();
			}
		})
		
	})
	
	function canvasImg(){
		var canvas = document.getElementById("lan_canvas");
		var ctx = canvas.getContext("2d");
		
		var img = document.getElementById('fileImg');
		
		var width = '${width}';
		var height = '${height}';

		ctx.drawImage(img, 0, 0, width, height);
	}
	
	function enableDrawing(){
	    var canvas = document.getElementById("lan_canvas");
	    if(canvas){
	        canvas.addEventListener("mousedown", mDown, false);
	        canvas.addEventListener("mousemove", mMove, false);
	        canvas.addEventListener("mouseup", mUp, false);
	        canvas.addEventListener("mouseout", mOut, false);
	    }
	}

	function disableDrawing(){
	    var canvas = document.getElementById("lan_canvas");
	    if(canvas){
	        canvas.removeEventListener("mousedown", mDown, false);
	        canvas.removeEventListener("mousemove", mMove, false);
	        canvas.removeEventListener("mouseup", mUp, false);
	        canvas.removeEventListener("mouseout", mOut, false);
	    }
	}

	var startX, startY, stX, stY, endX, endY;
	var drag = false;
	var ctx;

	function mDown(me){
	    startX = me.offsetX;
	    startY = me.offsetY;
	    stX = me.offsetX; // 눌렀을 때 현재 마우스 X좌표를 stX에 담음
	    stY = me.offsetY; // 눌렀을 때 현재 마우스 Y좌표를 stY에 담음
	    drag = true; // 그림 그리기는 그리는 상태로 변경
	}

	function mMove(me){
	    if (!drag){
	        return;
	    }
	    var nowX = me.offsetX;
	    var nowY = me.offsetY;
	    canvasDraw(nowX, nowY); // 실질적으로 캔버스에 그림을 그리는 부분
	    stX = nowX;
	    stY = nowY;
	}

	function mUp(me){
	    endX = me.offsetX;
	    endY = me.offsetY;
	    drag = false; // 마우스를 떼었을 때 그리기 중지
	}

	function mOut(me){
	    drag = false; // 마우스가 캔버스 밖으로 벗어났을 때 그리기 중지
	}

	function canvasDraw(currentX, currentY){
	    if(!ctx){
	        var canvas = document.getElementById("lan_canvas");
	        ctx = canvas.getContext("2d");
	        ctx.fillStyle = "#FFFFFF";
	    }
	    ctx.fillRect(startX, startY, currentX - startX, currentY - startY); // 시작점과 끝점의 좌표 정보로 사각형을 그려준다.
	}
	
</script>
</head>
<body onload="canvasImg()">
   <div>
   		<div id="nonePrint">
   			<div class="drawBtn_off" id="drawBtn">개인정보 보호</div>
   			<div class="drawReset" onclick="canvasImg()">초기화</div>
   			<button class="drawPrint" onclick="window.print();"></button>
   		</div>
 		<img alt="이미지 사진" id="fileImg" onclick="showViewer()" src="${pageContext.request.contextPath}/conn?wnm=getfiledirect&path=${imgPath }" style="display: none;">
		<canvas id="lan_canvas" width="${width }px" height="${height }px"></canvas>
   </div>      
</body>
</html>