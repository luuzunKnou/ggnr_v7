<%@ page language="java" contentType="text/html; charset=UTF-8"
    pageEncoding="UTF-8"%>
<%@ taglib prefix="c" uri="http://java.sun.com/jsp/jstl/core" %>
<%@ taglib prefix="spring" uri="http://www.springframework.org/tags"%>
<%@ taglib prefix="ui" uri="http://egovframework.gov/ctl/ui"%>
<%@ taglib uri="http://java.sun.com/jsp/jstl/functions" prefix="fn" %>
<%@ taglib prefix="fmt" uri="http://java.sun.com/jsp/jstl/fmt" %>

<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title> <%=component.util.SystemInfoRepository.getInstance().getAppName_KR()%> </title>
<script type="text/javascript" charset="UTF-8" src="<c:url value='/js/component/util.js' />"></script>
<style>
	#sub_list_div{
		border-top: none;
	}
	
	.titleDiv {
	    border-bottom: 0.2rem solid #626262;
	    font-size: 1rem;
	    font-weight: bolder;
	    padding: 0.8rem 0rem;
	}
	#warningText{
		color: gray;
	}
	.subDiv{
		margin-top: 3rem;
	}
	.subTitle{
		margin: 1rem 0;
	    font-size: 1.2rem;
	    font-weight: bold;
	}
	.fileFont{
		font-size: 1.1rem;
		margin-right: 6rem;
	}
	.inputDiv{
		margin-left: 4rem;
	}
	.fileName{
		width: 30rem;
		height: 1.3rem;
		padding: 0 0 0.5rem 1rem;
		border: none;
		border-bottom: 1px solid #B4CFE0;
		font-size: 1rem;
	}
	.inputExcel{
		display: none;
	}
	label{
		border: none;
		background : #B4CFE0;
		color: white;
		font-size: 0.9rem;
		padding: 0.2rem 1rem 0.3rem;
		border-radius: 20px;
		cursor: pointer;
	}
	label:hover{
		background : #4DADE9;
	}
	.dataUpload{
		margin-top: 4rem;
		margin-left:22rem;
	    background-color: #B4CFE0;
	    border-radius: 1rem;
	    padding: 0.5rem;
	    color: white;
	    font-size: 1rem;
	    text-align: center;
	    width: 10rem;
	    height: 3rem;
	    cursor: pointer;
	    border: none;
	}
	.dataUpload:hover{
		background : #4DADE9;
	}
</style>
<script type="text/javascript">
	$(document).ready(function(){ 
		
	});
	
	function fileChange(data){
		var click = $('#'+data)
		var text = click.val()
		var textInput = click.prev().prev()
		var textLast = text.split('/').pop().split('\\').pop();
		textInput.val(textLast)
	}
	
	function checkFile(){
		var publicExcel = $('#publicExcel').val()
		var daejiExcel = $('#daejiExcel').val()
		var imyaExcel = $('#imyaExcel').val()
		if(publicExcel != '' && daejiExcel != '' && imyaExcel!=''){
			if( publicExcel == daejiExcel){
				if(confirm('같은 파일이 있습니다. \n그래도 업데이트 하시겠습니까?')){
					excelUpload();
				}
			}else if(daejiExcel == imyaExcel){
				if(confirm('같은 파일이 있습니다. \n그래도 업데이트 하시겠습니까?')){
					excelUpload();
				}
			}else if(imyaExcel == publicExcel){
				if(confirm('같은 파일이 있습니다. \n그래도 업데이트 하시겠습니까?')){
					excelUpload();
				}
			}else{
				excelUpload();
			}
			
		}else{
			if(publicExcel == '' && daejiExcel == '' && imyaExcel == ''){
				alert('파일이 없습니다. \n파일을 추가해주세요.')			
			}else{
				if(confirm('업데이트 파일에 빈 값이 있습니다. \n그래도 업데이트 하시겠습니까?')){
					if( publicExcel == daejiExcel && publicExcel != '' && daejiExcel != '' ){
						if(confirm('같은 파일이 있습니다. \n그래도 업데이트 하시겠습니까?')){
							excelUpload();
						}
					}else if(daejiExcel == imyaExcel && imyaExcel != '' && daejiExcel != '' ){
						if(confirm('같은 파일이 있습니다. \n그래도 업데이트 하시겠습니까?')){
							excelUpload();
						}
					}else if(imyaExcel == publicExcel && publicExcel != '' && imyaExcel != '' ){
						if(confirm('같은 파일이 있습니다. \n그래도 업데이트 하시겠습니까?')){
							excelUpload();
						}
					}else{
						excelUpload();
					}
				}
			}
		}
	}
	
	function excelUpload(){
		var publicExcel = $('#publicExcel')[0].files
		var daejiExcel = $('#daejiExcel')[0].files
		var imyaExcel = $('#imyaExcel')[0].files
		var formData = new FormData();
		if(publicExcel.length > 0){
			formData.append('files', $('#publicExcel')[0].files[0]);
		}
		
		if(daejiExcel.length > 0){
			formData.append('files', $('#daejiExcel')[0].files[0]);
		}
		
		if(imyaExcel.length > 0){
			formData.append('files', $('#imyaExcel')[0].files[0]);
		}
 		$.ajax({
			type:"POST",
			url: "${pageContext.request.contextPath}/landInfo/landInfoUpdate.do",
			data: formData,
			processData: false,
		    contentType: false,
			success: function(data){
				if(data){
					alert("데이터 업데이트가 완료되었습니다.");
					$('#publicExcel').val('')
					$('#daejiExcel').val('')
					$('#imyaExcel').val('')
					$('.fileName').val('')
				}else{
					alert("데이터 업데이트에 실패했습니다.");
				}
			},error: function(request,status,error){
				alert("데이터 업로드에 실패하였습니다. \n파일을 확인해주세요");
			},
			beforeSend: function () {
	             var width = 0;
	             var height = 0;
	             var left = 0;
	             var top = 0;

	             width = 50;
	             height = 50;

	             top = ( $(window).height() - height ) / 2 + $(window).scrollTop();
	             left = ( $(window).width() - width ) / 2 + $(window).scrollLeft();

	             if($("#div_ajax_load_image").length != 0) {
                   $("#div_ajax_load_image").css({
                          "top": top+"px",
                          "left": left+"px"
                   });
                   $("#div_ajax_load_image").show();
	             }
	             else {
	                    $('body').append('<div id="div_ajax_load_image" style="position:absolute; top:' + top + 'px; left:' + left + 'px; width:' + width + 'px; height:' + height + 
	                    'px; z-index:9999; background:#f0f0f0; filter:alpha(opacity=50); opacity:alpha*0.5; margin:auto; padding:0; "><img src="${pageContext.request.contextPath}/images/ajaxLoading.gif" style="width:50px; height:50px;"></div>');
	             }
		      }
		      , complete: function () {
		       $("#div_ajax_load_image").hide();
		      }
		})
	}
</script>
</head>
<body> 
	<div class="titleDiv">토지정보 업데이트</div>
	<p id="warningText">* 데이터 업데이트 시 기존의 데이터는 삭제됩니다.</p>
	<p id="warningText">* 업로드 시간은 데이터 양에 따라 변동됩니다.</p>
	<div class="subDiv">
		<div class="updateExcel">
			<p class="subTitle">공유지연명부</p>
			<div class="inputDiv">
				<a class="fileFont">파일명 : </a>
				<input type="text" class="fileName" readonly="readonly" placeholder="파일을 선택해주세요.">
				<label for="publicExcel">파일 찾기</label>
				<input type="file" class="inputExcel" id="publicExcel" onchange="fileChange('publicExcel')">
			</div>
		</div>
		<div class="updateExcel">
			<p class="subTitle">대지권등록부</p>
			<div class="inputDiv">
				<a class="fileFont">파일명 : </a>
				<input type="text" class="fileName" readonly="readonly" placeholder="파일을 선택해주세요.">
				<label for="daejiExcel">파일 찾기</label>
				<input type="file" class="inputExcel" id="daejiExcel" onchange="fileChange('daejiExcel')">
			</div>
		</div>
		<div class="updateExcel">
			<p class="subTitle">토지(임야)대장</p>
			<div class="inputDiv">
				<a class="fileFont">파일명 : </a>
				<input type="text" class="fileName" readonly="readonly" placeholder="파일을 선택해주세요.">
				<label for="imyaExcel">파일 찾기</label>
				<input type="file" class="inputExcel" id="imyaExcel" onchange="fileChange('imyaExcel')">
			</div>
		</div>
		<button class="dataUpload" onclick="checkFile()">토지정보 업로드</button>
	</div>
</body>
</html>