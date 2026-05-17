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
      <style type="text/css">
   .landArchiveWrap {padding-top: 5px;}
   
   .selectTitle01 {
      line-height: 20px;
      font-size: 13px;
      cursor: pointer;
      font-weight: bold; 
      color: #374857;
      font-family: 맑은 고딕;
      margin-left: 10px; 
   }
   
   .selectTitle01 > div:first-child {
      height: 10px;
      line-height:10px;
      display: inline-block;
   }      
   .selectTitle01 > div:first-child > img {
      width:10px; height:10px;
   }
   .selectTitle01 > .container, .hoverSpan {
      text-align: left;
      height: 10px;
      /* line-height: 10px; */
      display: inline;
   }
   .selectTitle01 > .hoverImg {
      margin-top: 6px;
      height: 11px;
      width: 9px;
   }   
   .selectTitle01 .showDown0002{ color: #67819E; margin-left: 26px; height:15px; display:none; }   
   .selectTitle01 .showDown002 { color: #67819E; margin-left: 26px; height:15px; display:none;}   
   .selectTitle01 .showDown02 { color: #67819E; margin-left: 37px;}
   .selectTitle01 .showDown02 li {margin-left: 6px; font-size: 12px; font-family: 맑은 고딕;}
   
   .selectTitle02 {line-height: 18px; font-size: 12px; cursor: pointer; font-weight: bold; color: #374857; font-family: 맑은 고딕;}
   .selectTitle02 > .container > p:first-child {margin-top: 3px;}
   .selectTitle02 span { font-size:13px; padding-top: 5px; margin-left: 1px;}
   .selectTitle02 > .container > p:last-child{margin-bottom: 3px;}
   
   .selectTitle02 .showDown02 {display: none; color: #67819E; }
   .selectTitle02 .showDown02 li {margin-left: 6px; font-size: 12px; font-family: 맑은 고딕;}
   
   .selectTitle02 img {width: 10px; height: 10px; margin-top: 6px; margin-left: 10px;}
   
   .selected {color: #67819e !important;}
   
   .showDown01 {display: none;}
   .showDown02 {display: none;}
   
   .selectTitle02 span > p {display:none;}
	
	.selectTitle03 img{width: 10px; height: 10px; margin-top: 6px; margin-left:21px;}

   .search_header {
      display:flex;
      flex-direction:row;
       height: 33px;
       width: 100%;
       background-color: #67819e;
       position: relative;
      }
   .icon_div{
       display: inline-block;
      }
   .icon_div > img {
      height: 30px;
      margin-left: 7px;
      }
   .search_header span {
       color: white;
       text-align: center;
       font-size: 14px;
       margin-left: 33px;
      }
   .search_header > span{
      color: white;
      margin-left: 3px;
      font-size: 18px;
      }
   .list_div{
      margin-top: 0;
      }
   .loadingDiv {
      display: flex;
        width: 50px;
        margin-top: 70px;
        margin-left: auto;
        margin-right: auto;
        height: 50px;
        } 
   .resultEmpty{
      text-align: center;
      font-size: 15px;
      font-family: 맑은 고딕;
   }
   
   
</style> 
<script type="text/javascript">
   function showLandArchiveMenu(idx){
      $(".c1List_"+idx).toggle();
   } 
    
   
   
   function showLandArchiveCatMenu(object) {
	    $(object).siblings(".showDown01").toggle();
   }

   function showLandArchiveSubMenu(object){
	   $(object).siblings(".data_ptag").toggle();
    /*    var pEle;
       if($(object).prop("tagName")==="IMG"){
          pEle = $(object).siblings("span").find('p');
       }else {
          pEle = $(object).find('p');
       }
       for (i = 0; i < pEle.length; i++) {
          if($(pEle[i]).css("display")=="none"){
             $(pEle[i]).css("display","block");
          }else{
             $(pEle[i]).css("display","none");
          } 
       } */
   }
   

   
   
   function onItemSelectCat(file_name, kind, object,hjd_name,jibun){      
	      if(typeof object == "undefined"){
	         object = $(".permSelected"); 
	      }
	      $(".container.showDown002.selected").attr("class", "container showDown002");
	        
	      getItemDetail(file_name, kind, "false",hjd_name,jibun);
	   }
   
   function onItemSelect(file_name, kind, object,hjd_name,jibun){      
      if(typeof object == "undefined"){
         object = $(".permSelected"); 
      }
      $(".container.showDown02.selected").attr("class", "container showDown02");
      /* $(object).attr("class","container showDown02 selected"); */
      getItemDetail(file_name, kind, "false",hjd_name,jibun);
   }
   
   function getItemDetail(file_name,kind,isGetAllData,hjd_name,jibun){
      $(".info_div").empty();
      var appendLoading = "<div class='loadingDiv'>" + 
            "<img src='${pageContext.request.contextPath}/images/landArchive/Progress_Loading.gif'>" + 
         "</div>";
      $(".info_div").append(appendLoading);
      $(".info_div").load(
            "<c:url value='/landArchive/landArchiveInfo.do'/>",
            {file_name:file_name,kind:kind,isGetAllData:isGetAllData,hjd:hjd_name,jibun:jibun}
      );
   }
   
   $( document ).ready(function() {
	   
      $('.data_ptag').click(function(event) {
          event.stopPropagation();
      });
      
      //IMG HOVER
      $(".hoverImg").mouseenter(function() {
         var originSrc = $(this).attr("src");
         var newSrc = originSrc.replace("_off","_on");
         $(this).attr("src",newSrc);
      });
      
      //IMG HOVER
      $(".hoverImg").mouseleave(function() {
          var originSrc = $(this).attr("src");
         var newSrc = originSrc.replace("_on","_off");
         $(this).attr("src",newSrc);
      });
   });
   
</script>
</head>
<body>
<!-- 비법인 경우 등록명만 뜨도록 처리 -->
   <div class="search_header">
      <div class="icon_div">
         <img alt="btn_icon.png" src="${pageContext.request.contextPath}/images/landArchive/btn_icon.png">
      </div>
      <span>검색결과</span>
   </div>
   <div> 
      <div class="landArchiveWrap">
         <c:if test="${empty landArchiveList}"> <p class="resultEmpty">검색결과가 없습니다.</p></c:if>
         <c:forEach items="${landArchiveList}" var="landArchiveList" varStatus="status1">
            <ul class="selectTitle01">
                <img src= "${pageContext.request.contextPath}/images/landArchive/exp_open_off.png" onclick="showLandArchiveMenu(${status1.index})" class="hoverImg">
                <c:choose> 
                  <c:when test="${landArchiveList.landArchiveResultCatList[0].cat1 eq '비법인'}">
                     <span class="container hoverSpan" onclick="showLandArchiveMenu(${status1.index})">${landArchiveList.hjdon_name}</span>
                     <c:forEach items="${landArchiveList.landArchiveResultCatList}" var="landArchiveResultCatList" varStatus="status2">
                     <li class="selectTitle02 showDown01 c1List_${status1.index}">
							<img src= "${pageContext.request.contextPath}/images/landArchive/exp_open_off.png" onclick="showLandArchiveSubMenu(this)" class="hoverImg" id="detailList">
							<c:forEach items="${landArchiveResultCatList.landArchiveResultItemList}" var="landArchiveResultItemList" varStatus="status3">
							<span class="container hoverSpan" onclick="showLandArchiveSubMenu(this)">${landArchiveResultCatList.cat1} (${fn:length(landArchiveResultItemList.landArchiveResultFinalList)})
								</span>
									<c:forEach items="${landArchiveResultItemList.landArchiveResultFinalList}" var="landArchiveResultFinalList"  varStatus="status4">
                                        <p class="container showDown0002 data_ptag c3List_${status3.index}" onclick="onItemSelectCat('${landArchiveResultFinalList.file_name}', '${landArchiveResultCatList.cat1}', this,'${landArchiveList.hjdon_name}','${landArchiveList.jibun}')">
                                            ${landArchiveResultFinalList.cat4}</p>
                                    </c:forEach>
								</c:forEach>
							</c:forEach>
                  </c:when> 
                  <c:when test = "${landArchiveList.landArchiveResultCatList[0].landArchiveResultItemList[0].cat3 eq '기타'}">
               		<li class="selectTitle02 showDown01 c1List_${status1.index}">
                     <img src= "${pageContext.request.contextPath}/images/landArchive/exp_open_off.png" onclick="showLandArchiveCatMenu(this)" class="hoverImg" id="detailList">
                     <span class="container hoverSpan" onclick="showLandArchiveCatMenu(this)">${landArchiveResultCatList.cat1}</br>
                        </span><c:forEach items="${landArchiveResultCatList.landArchiveResultItemList}" var="landArchiveResultItemList" varStatus="status3">
                            <span class="selectTitle03 showDown01 c2List_${status2.index}">
                                <img src= "${pageContext.request.contextPath}/images/landArchive/exp_open_off.png" onclick="showLandArchiveSubMenu(this)" class="hoverImg selectTitle03 ">
                                <span class="container hoverSpan " id="${landArchiveResultFinalList.file_name}" onclick="showLandArchiveSubMenu(this)">기타</br>
                                    </span><c:forEach items="${landArchiveResultItemList.landArchiveResultFinalList}" var="landArchiveResultFinalList"  varStatus="status4">
                                        <p class="container showDown02 data_ptag c3List_${status3.index}" onclick="onItemSelect('${landArchiveResultFinalList.file_name}', '${landArchiveResultCatList.cat1}', this,'${landArchiveList.hjdon_name}','${landArchiveList.jibun}')">
                                            ${landArchiveResultFinalList.cat4}
                                        </p>
                                    </c:forEach>
                            </span>
                        </c:forEach>                
                  	</li>
               		</c:when>
                  <c:otherwise>
                	<span class="container hoverSpan" onclick="showLandArchiveMenu(${status1.index})">${landArchiveList.hjdon_name} ${landArchiveList.jibun}</span>
                	
                	<c:forEach items="${landArchiveList.landArchiveResultCatList}" var="landArchiveResultCatList" varStatus="status2"> 
						<li class="selectTitle02 showDown01 c1List_${status1.index}">
								<c:choose>
									<c:when test="${landArchiveResultCatList.cat1 eq '수치지적부'|| landArchiveResultCatList.cat1 eq '토지조사부' || landArchiveResultCatList.cat1 eq '구토지대장' || landArchiveResultCatList.cat1 eq '구대장'}">
										<img src= "${pageContext.request.contextPath}/images/landArchive/exp_open_off.png" onclick="showLandArchiveSubMenu(this)" class="hoverImg" id="detailList">   		
											<c:forEach items="${landArchiveResultCatList.landArchiveResultItemList}" var="landArchiveResultItemList" varStatus="status3">
												 <span class="container hoverSpan" onclick="showLandArchiveSubMenu(this)">  ${landArchiveResultCatList.cat1}  (${fn:length(landArchiveResultItemList.landArchiveResultFinalList)}) </span>
													<c:forEach items="${landArchiveResultItemList.landArchiveResultFinalList}" var="landArchiveResultFinalList"  varStatus="status4">
				                                        <p class="container showDown002 data_ptag c3List_${status3.index}" onclick="onItemSelect('${landArchiveResultFinalList.file_name}', '${landArchiveResultCatList.cat1}', this,'${landArchiveList.hjdon_name}','${landArchiveList.jibun}')">
				                                            ${landArchiveResultFinalList.cat4} 
				                                        </p>
			                                    	</c:forEach>  	
											</c:forEach>	
									</c:when>
									<c:otherwise>
									<img src= "${pageContext.request.contextPath}/images/landArchive/exp_open_off.png" onclick="showLandArchiveCatMenu(this)" class="hoverImg" id="detailList">   
									<span class="container hoverSpan" onclick="showLandArchiveCatMenu(this)">${landArchiveResultCatList.cat1}</span></br>
										<c:forEach items="${landArchiveResultCatList.landArchiveResultItemList}" var="landArchiveResultItemList" varStatus="status3">					
												<span class="selectTitle03 showDown01 c2List_${status2.index}">
													<img src= "${pageContext.request.contextPath}/images/landArchive/exp_open_off.png" onclick="showLandArchiveSubMenu(this)" class="hoverImg  ">
													<span class="container hoverSpan" id="${landArchiveResultFinalList.file_name}" onclick="showLandArchiveSubMenu(this)"> ${landArchiveResultItemList.cat3} (${fn:length(landArchiveResultItemList.landArchiveResultFinalList)})</br></span>
														<c:forEach items="${landArchiveResultItemList.landArchiveResultFinalList}" var="landArchiveResultFinalList"  varStatus="status4">
					                                        <p class="container showDown02 data_ptag c3List_${status3.index}" onclick="onItemSelect('${landArchiveResultFinalList.file_name}', '${landArchiveResultCatList.cat1}', this,'${landArchiveList.hjdon_name}','${landArchiveList.jibun}')">
					                                            ${landArchiveResultFinalList.cat4}
					                                        </p>
				                                    	</c:forEach>
		                                    	</span>
										</c:forEach>
									</c:otherwise>
								</c:choose>
						</li>
                    </c:forEach>                
                </c:otherwise>  
                </c:choose> 
            </ul>
            </c:forEach>
      </div>
   </div>      
</body>
</html>