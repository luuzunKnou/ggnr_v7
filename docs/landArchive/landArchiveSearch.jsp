<%@ page language="java" contentType="text/html; charset=UTF-8"
    pageEncoding="UTF-8"%>
<%@ taglib prefix="c" uri="http://java.sun.com/jsp/jstl/core" %>
<%@ taglib prefix="spring" uri="http://www.springframework.org/tags"%>
<%@ taglib prefix="ui" uri="http://egovframework.gov/ctl/ui"%>
<%@ taglib uri="http://java.sun.com/jsp/jstl/functions" prefix="fn" %>

 <link href="${pageContext.request.contextPath}/css/component/oldland.css" rel="stylesheet"/>

<script type="text/javascript">
	function search_info(){
		$(".list_div").empty();
		$(".info_div").empty();
		$(".image_div").empty();
		
		var kind = $(".kindSel").val();
		var emdName = $("#emd_sel option:selected").text();
		if (emdName == "전체") {
			emdName = "";
		} 
		
		var liName= $("#li_sel option:selected").text();
		if (liName == "전체") {
			liName = "";
		}
		
		var address = emdName+" "+liName;
		var jibun_fst = $(".jibun_fst").val();
		var jibun_snd = $(".jibun_snd").val();
 		var mountain;
 		var registName =$(".nocorp").val();
	
 	 	  	if($(".mountain_sel").is(":checked") == true){
				mountain = "true";
			} else {	
 				mountain = "";
			}
   	
		//검색조건이 없을 경우 검색불가
		if(kind == "" && address == " " && jibun_fst == "" && jibun_snd == "" && mountain == ""  ){
			alert("주소를 입력하거나 파일 종류를 선택해주세요.");
			return
		}
		
		//본번(jibun_fst)이나 부번(jibun_snd)에 0으로 시작하는 지번 입력시 반려창을 띄움
		if(jibun_fst!=undefined&&jibun_snd!=undefined){ 
			
			if(jibun_fst.charAt(0) === '0' || jibun_snd.charAt(0) === '0'){
 				alert('지번을 재확인해주세요.');
 				return;}
 		}
		
		$(".list_div").empty();
		var appendLoading = "<div class='loadingDiv'>" + 
								"<img src='${pageContext.request.contextPath}/images/landArchive/Progress_Loading.gif'>" + 
							"</div>";
		$(".list_div").append(appendLoading);				
		$(".list_div").load(
				"<c:url value='/landArchive/landArchiveList.do'/>",
				{kind:kind, address:address, jibun_fst:jibun_fst, jibun_snd:jibun_snd,mountain:mountain,registName:registName}
			);
		
		//일직면 망호리, 일직면 망호리, 350, 23
	}
	
	//종류 선택시마다 새html을 생성하는 형식으로 검색창 구성
	$(document).ready(function() {
		//지도에서 검색화면으로 넘어온 경우 처리
		var isSearch = false;
		if('${file_name}' != null && '${file_name}' != '' ) {
			var targetVal = $('select[name=emd_cd] option:contains("${file_name}")').val();
			$("select[name=emd_cd]").val(targetVal);
			isSearch = true;
		} 
		
		if('${dongli}' != null && '${dongli}' != '' ) {
			var dong = getKorean('${dongli}')
			var targetVal = $('select[name=li_cd] option:contains('+dong+')').val();
			$("select[name=li_cd]").val(targetVal)
			isSearch = true;
		} 
		
		if('${firstJibun}' != null && '${firstJibun}' != '' ) {
			var first = "${firstJibun}"
			if(first.indexOf('산') != -1){
				$("input:checkbox[name='mountain']").prop('checked',true)
			}
			$(".jibun_fst").val(getNumber(first));
			isSearch = true;
		} 
		
		if('${secJibun}' != null && '${secJibun}' != '' ) {
			$(".jibun_snd").val(getNumber("${secJibun}"));
			isSearch = true;
		}
		
		if(isSearch){
			search_info(1);
		}
		
		updateLiList();

	    $("#selKind").change(function(){
	    	var emd = $('#emd_sel').val();
	    	var li = $('#li_sel').val();
	    	var kind = $(".kindSel").val();
	    	$(".search_div > .search_wrap").children().not(".searchBtn,.kindDiv").remove();
	        if (kind == "비법인") {
				var appendStr = "<div class='nocorpDiv'> \
	        	    <label class=\"label\">등록명</label> \
	        	    <input type='text' class='nocorp' /> \
	        		</div>";
	        	 $(".kindDiv").after(appendStr);
	        } else if(kind != "비법인"){
	        	var emdLiMountainJibun = '<div class="emdliDiv">   \
	                <label class="label">읍면동</label> \
	                <select name="emd_cd" id="emd_sel" class="kindSel"> \
	                    <option value="">전체</option> \
	                    <c:forEach items="${emdList}" var="item" varStatus="status"> \
	                        <option value="${item.emd_cd}">${item.emd_kor_nm}</option> \
	                    </c:forEach> \
	                </select> \
	                <label class="label">리</label> \
	                <select name="li_cd" id="li_sel" class="kindSel"> \
	                    <option value="">전체</option> \
	                    <c:forEach items="${liList}" var="item" varStatus="status"> \
	                        <option value="${item.li_cd}">${item.li_kor_nm}</option> \
	                    </c:forEach> \
	                </select> \
	            </div> \
	                <div class="mountainDiv"> \
                <span class="mountainText">산</span> \
                <label class="switch"> \
                    <input type="checkbox" name="mountain" class="mountain_sel"> \
                    <span class="slider round"></span> \
                </label> \
                <label class="sLabel"> \
                    <label class="jibunText">지번</label> \
                    <input type="text" class="jibun_fst"> \
                    <span class="dash">-</span> \
                    <input type="text" class="jibun_snd"> \
                </label> \
            </div>';
	            $(".kindDiv").after(emdLiMountainJibun);  
         		$('#emd_sel').val(emd);
		    	$('#li_sel').val(li);
	            updateLiList();
	        }
	    });
	});
	
	 function updateLiList() {
		// 읍면동 선택시 리 목록 가져오기
		 $("#emd_sel").change(function(e){
				var query = {emd_cd  : $("#emd_sel").val()}; 
				$.ajax({ 
					url  : "${pageContext.request.contextPath}/landArchive/selectLiList.do", 
					type : "post", 
					data : query, 
					success : function(data){ 
						var appendStr = ""; 
						appendStr += '<option value="">전체</option>';
						$.each(data, function(i){  
							appendStr += '<option value="'+data[i].li_cd+'">'+data[i].li_kor_nm+'</option>';
						});  
						$("#li_sel").html(appendStr); 
					}
				})
			});
	}
	 
	 
	 //지번에 숫자만 입력하게 하기
	 function inputNumberOnly(el) {
		 el.value = el.value.replace(/[^0-9]/g, '');
	}

</script>
<style type="text/css">
	.kindDiv {
		margin-left: 9px;
		margin-top: 9px;
	}
     .kindSel {
		border-radius: 0px;
		border: 1px solid #BFBFBF;
		height: 28px;
		width: 150px;
		text-align: center;
		padding-left: 5px;
	}
         
	.label {
		text-align: center;
		font-size: 13px;
		display: inline-block;
		width: 80px;
		color: white;
		background: #67819E;
		margin-top: 5px;
	}
     
	#emd_cd {
		margin-left: 15px;
	}
	.emdliDiv{
		margin-left: 9px;
		margin-top: 2px;
	}
	.search_select_address{
		border-radius: 0px;
		border: 1px solid #BFBFBF;
		height: 28px;
		width: 80px;
		text-align: center;
		padding-left: 5px;
	}
      
	input[type="checkbox"] {
		zoom: 1.5;
		margin-left: 2px;
		margin-top: -2px;
		margin-bottom: 2px;
	}

	.search_item_div.half {
		margin-left: 13px;
		margin-top: 7px;
	}
	.jibunDiv {
		margin-left: 13px;
		margin-top: 7px;
	}
   
	.mountainDiv {margin-top: 6px; }
	.mountainDiv input { width:50px; }
	.mountainDiv .dash { display: contents; font-weight:bold; width:10px; }	
	.mountainText {margin-left:3px;} 
	.mountainDiv span { margin-left:20px; font-size:15px; font-weight:bolder; }	
	.switch .mountain_sel { margin-left:-9px;}
	.sLabel{ position:absolute; font-size:15px; font-weight:bolder; left:102px; margin-right:2px; }
	.mountainDiv .jibun_fst {
		border-radius: 0px;
    	margin: -3px 0 0 0;
    	vertical-align: middle;
    	border: solid 1px #BFBFBF;
	} 		   
     .mountainDiv .jibun_snd{
		border-radius: 0px;
		margin: -3px 0 0 0;
		vertical-align: middle;
		border: solid 1px #BFBFBF;
	} 

	.searchBtn {
		top: 190px;
		left: 8px;
		width: 251px;
		background-color: #67819E;
		margin: 0 auto;
		margin-top: 5px;
		cursor: pointer;
		margin-bottom: 2px;
	}      
	  
	.searchBtn:hover {
		background-color: #2488df;
		transition: all 0.5s;
	}
	.search_icon_div{
		display: flex;
		flex-direction: row;
		justify-content: center;
	 }
	.loadingDiv {
		display: flex;
		width: 50px;
		margin-top: 70px;
		margin-left: auto;
		margin-right: auto;
		height: 50px;
	}
        
	.mountain_sel {
		display: inline-block;
		width: 15px; 
		height: 15px; 
		margin-right: 16px;
	}
	.jibunText {margin-right:3px;}
    
	.nocorpDiv{margin-left: 9px;} 
	.nocorp {border-radius: 0px;
		border: 1px solid #BFBFBF;
		height: 23px;
		width: 149px;
		text-align: center
	}   
		input::-webkit-inner-spin-button {
	  appearance: none;
	  -moz-appearance: none;
	  -webkit-appearance: none;
	}
       
</style>

<!-- 검색조건 : 종류 /  행정동 주소 /본번 /부번 / -->
<div class="search_wrap">
	<div class="kindDiv">
		<label class="label">종류</label>
		<select class="kindSel" id ="selKind">
			<option value="">전체</option>
			<option value="면적측정부">면적측정부</option>
			<option value="지적도">지적도</option>
			<option value="수치지적부">수치지적부</option>
			<option value="토지조사부">토지조사부</option>
			<option value="이동지결의서">이동지결의서</option>
			<option value="측량결과도">측량결과도</option>
			<option value="비법인">비법인</option>
			<option value="지적재조사">지적재조사</option>
			<option value="특별조치법">특별조치법</option>
			<option value="도근측량부">도근측량부</option>
			<option value="구토지대장">구토지대장</option>
		</select>
	</div>   
	<div class="emdliDiv">  			
		<label class="label">읍면동</label>
		<select name = "emd_cd" id = "emd_sel" class="kindSel" >
			<option value="">전체</option>
			<c:forEach items="${emdList}" var="item" varStatus="status">
				<option value="${item.emd_cd}">${item.emd_kor_nm}</option>
			</c:forEach>	
		</select>
		<label class="label">리</label>
		<select name = "li_cd" id = "li_sel" class="kindSel" >
			<option value="">전체</option>
			<c:forEach items="${liList}" var="item" varStatus="status">
				<option value="${item.li_cd}">${item.li_kor_nm}</option>
			</c:forEach>
		</select>
	</div>			
		<div class="mountainDiv">
			<span class="mountainText">산</span>
			<label class="switch">
				<input type="checkbox" name ="mountain" class="mountain_sel">
				<span class="slider round"></span>
			</label>
			<label class="sLabel">
			<label class="jibunText">지번</label>
			<input type="text" class="jibun_fst" oninput="inputNumberOnly(this)" >
			<span class="dash">-</span>
			<input type="text" class="jibun_snd" oninput="inputNumberOnly(this)">
			</label>
		</div>		
   <div class="searchBtn" onclick="search_info()">
		<div class="search_icon_div">
     		<img alt="btn_search.png" src="${pageContext.request.contextPath}/images/landArchive/btn_search.png"/>
		</div>
	</div>
</div>