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
<script type="text/javascript">
	$(document).ready(function(){ 
		commaPointOnElement('','cost');
		convertToDate();
	});

	//2023.01.03 날짜 찍는 함수
	function convertToDate() {		
	  var tdSelect = document.querySelectorAll(".date");
	  
	  $.each(tdSelect,function(index){
	      var innerText = $(this).text();
	      var intNumber = innerText.toString().split('.');
	      
    	  var year = intNumber[0].substr(0, 4);
	   	  var month = intNumber[0].substr(4, 2);
		  var day = intNumber[0].substr(6, 2);
		  
		  var date = year + '-' + month + '-' + day;
		  
		  if(intNumber[0].length != 8){
			  $(this).text('');
		  }else{
			  $(this).text(date);
		  }
		  
	   });
	}
</script>

<style>
	#info_detail_div {width: 100%; height:480px; overflow-y: auto;}
	#info_detail_div table {
		/* 		width: calc(100% - 20px); */
			    width: 100%;
		}
	#info_detail_div th {background-color: #F4F4F4; font-size: 14px; line-height: 30px; width: 130px; color: #383838; border: solid 1px #CCCCCC;}
	#info_detail_div td {font-size: 14px; padding-left: 5px; width: 146px; color: #777777; border: solid 1px #CCCCCC;} 
	
	.detail_section {
		margin:10px;
		margin-bottom:22px;
	}
	
	.detail_section_title{
		font-size: 13px;
		font-weight: bold;
		color: #383838;
	}
	
	table {
		margin-top:5px;
		margin-bottom:10px;
	}
</style>

</head>
<body> 
	<div id="info_detail_div" class="landCharacter">
		<c:if test="${fn:length(landOwnInfoList) == 0 && fn:length(landInfoList) == 0}">
			<p class="no-result">검색 결과가 없습니다.</p>
		</c:if>		
		<c:if test="${fn:length(landOwnInfoList) > 0 || fn:length(landInfoList) > 0 || fn:length(usePlanList) >0}">
			<div class="detail_section">
				<div class="detail_section_title">1. 토지정보</div>
				<table>
					<tbody>
					<tr>
						<th>
							지목
						</th>
						<td>
							${landInfoList[0].jimok}
						</td>
						<th>
							면적
						</th>
						<td>
							<span class ="cost">${landInfoList[0].area}</span>㎡
						</td>
					</tr>
					</tbody>
				</table>
			</div>
			<div class="detail_section">
				<div class="detail_section_title">2. 토지이동내역 </div>
				<table>
					<tbody>
					<tr>
						<th>
							토지이동사유
						</th>
						<td>
							${landInfoList[0].land_move_reason}
						</td>
						<th>
							토지이동일자
						</th>
						<td>
							<span class ="date">${landInfoList[0].land_move_date}</span>
						</td>
					</tr>
					
					</tbody>
				</table>
			</div>
			<div class="detail_section">
				<c:if test="${fn:length(landOwnInfoList) > 0}">
				<div class="detail_section_title">3. 소유자정보 (소유자 : ${fn:length(landOwnInfoList)}명) </div>
					<c:forEach items="${landOwnInfoList}" var="item" varStatus="status">
						<table>
							<tbody>
							<tr>
								<th>
									소유자 주소
								</th>
								<td colspan="3">
									${item.soyu_address}
								</td>
							</tr>
							<tr>
								<th>
									소유자명
								</th>
								<td>
									${item.soyu_name}
								</td>
								<th>
									소유구분
								</th>
								<td>
									${item.soyu_gubun}
								</td>
							</tr>
							<tr>
								<th>
									소유권지분
								</th>
								<td>
									${item.soyu_share}
								</td>
								<th>
									소유권 변경일자
								</th>
								<td>
									<span class ="date">${item.soyu_trans_date}</span>
								</td>
							</tr>
							<tr>
								<th>
									소유권 변경원인
								</th>
								<td>
									${item.soyu_trans_reason}
								</td>
								<th>
									시스템 반영일자
								</th>
								<td>
									<fmt:formatDate value="${item.insert_date}" pattern="yyyy-MM-dd" />
								</td>
							</tr>
							</tbody>
						</table>
					</c:forEach>
				</c:if>
				<c:if test="${fn:length(landOwnInfoList) == 0}">
					<div class="detail_section_title">3. 소유자정보 (소유자 : 1명) </div>
					<table>
						<tbody>
						<tr>
							<th>
								소유자 주소
							</th>
							<td colspan="3">
								${landInfoList[0].soyu_address}
							</td>
						</tr>
						<tr>
							<th>
								소유자명
							</th>
							<td>
								${landInfoList[0].soyu_name}
							</td>
							<th>
								소유구분
							</th>
							<td>
								${landInfoList[0].soyu_gubun}
							</td>
						</tr>
						<tr>
							<th>
								소유권지분
							</th>
							<td>
								1
							</td>
							<th>
								소유권 변경일자
							</th>
							<td>
								<span class ="date">${landInfoList[0].soyu_trans_date}</span>
							</td>
						</tr>
						<tr>
							<th>
								소유권 변경원인
							</th>
							<td>
								${landInfoList[0].soyu_trans_reason}
							</td>
							<th>
								시스템 반영일자
							</th>
							<td>
								<fmt:formatDate value="${landInfoList[0].insert_date}" pattern="yyyy-MM-dd" />
							</td>
						</tr>
						</tbody>
					</table>
				</c:if>
			</div>
			<div class="detail_section">
				<div class="detail_section_title">4.지역지구등 지정여부</div>
				<table>
					<thead>
						<tr>
							<th colspan="2">용도지구명</th>
						</tr>
					</thead>
					<tbody>
					<c:forEach items="${usePlanList }" var="item" varStatus="stats">
						<tr>
							<td style="width: 5%; padding: 0; text-align: center;">${stats.count}</td>
							<td style="line-height: 30px;">${item.alias }<c:if test="${item.remark ne '' and item.remark != null}">(${item.remark })</c:if></td>
						</tr>
					</c:forEach>
					</tbody>
				</table>
			</div>
		</c:if>
	</div>
</body>
</html>