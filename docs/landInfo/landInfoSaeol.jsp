<%@ page language="java" contentType="text/html; charset=UTF-8"
    pageEncoding="UTF-8"%>
<%@ taglib prefix="c" 		uri="http://java.sun.com/jsp/jstl/core" %>
<%@ taglib prefix="spring" uri="http://www.springframework.org/tags"%>
<%@ taglib prefix="ui" 		uri="http://egovframework.gov/ctl/ui"%>
<%@ taglib prefix="fn"		uri="http://java.sun.com/jsp/jstl/functions" %>
<%@ taglib prefix="fmt"		uri="http://java.sun.com/jsp/jstl/fmt" %>
   
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title> <%=component.util.SystemInfoRepository.getInstance().getAppName_KR()%> </title>

<script type="text/javascript">
	
	$(document).ready(function(){
	})
	
</script>		
<style>
	#info_detail_div{
		height: 460px;
		overflow: auto;
	}
	.saeol_inner_div{
	    border: 1px solid #E6E6E6;
	    width: calc(100% - 20px);
	    margin: 0 auto 8px;
	}
	.header_div{
		background-color: #6DB5E3;
		height: 30px;
	}
	.header_div p{
		color: white;
		font-size: 15px;
		font-weight: lighter;
		line-height: 30px;
	}
	
	.header_div p img{
		height: 15px;
		width: 15px;
		padding:8px 5px 0 12px; 
	}
	.saeol_table table{
		width: calc(100% - 20px);
	    margin: 10px;
	}
	.saeol_table th{
	    background-color: #F4F4F4;
	    font-size: 14px;
	    width: 110px;
	    color: #383838;
	    border: solid 1px #CCCCCC;
	}
	.saeol_table td{
		padding: 0 5px;
		max-width: 83px;
		min-width: 50px;
	    color: #777777;
	    height: 25px;
	    border: solid 1px #CCCCCC;
	    text-overflow: ellipsis;
	    overflow: hidden;
	    white-space: nowrap;
	}
    .right_text{
    	color:#777777;
    	float: right;
    }
    .list_table td{
    	text-align: center;
    	max-width: unset;
    	min-width: unset;
    }
</style>
</head>
<body>
    <div class="source_div">
        <img src="${pageContext.request.contextPath}/images/icon/info_source.png">새올 행정 시스템
    </div>
    <div id="info_detail_div" class="landPrice">
        <c:choose>
            <c:when test="${landVO eq null}">
                <p class='no-result'>검색 결과가 없습니다.</p>
            </c:when>
            <c:otherwise>
                <div class="saeol_table">
                    <div class="saeol_inner_div">
                        <div class="header_div">
                            <p><img src="${pageContext.request.contextPath}/svg/info.svg">관리항목</p>
                        </div>
                        <div>
                            <table>
                                <tbody>
                                    <tr>
                                        <th>재산구분</th>
                                        <td>${landVO.means_srv_code_nm}</td>
                                        <th>회계구분</th>
                                        <td>${landVO.means_srv_code_nm}</td>
                                    </tr>
                                    <tr>
                                        <th rowspan="3">소재지</th>
                                        <td>(분임관리관)<!-- 컬럼 없음 --></td>
                                        <td colspan="2">(비고)<!-- 컬럼 없음 --></td>
                                    </tr>
                                    <tr>
                                    	<td colspan="3">(지번) ${landVO.address }</td>
                                    </tr>
                                    <tr>
                                        <td colspan="3">(도로명 주소) ${landVO.rdn_whl_addr}</td>
                                    </tr>
                                    <tr>
                                        <th>세부부서명</th>
                                        <td>${landVO.gain_dep_nm}</td>
                                        <th>처분(매각)제한</th>
                                        <td>
											<c:choose>
												<c:when test="${landVO.sil_limit_yn_nm eq 'Y'}">
													제한
												</c:when>
												<c:when test="${landVO.sil_limit_yn_nm eq 'N'}">
													가능
												</c:when>
												<c:otherwise>
		                                        	${landVO.sil_limit_yn_nm}
												</c:otherwise>
											</c:choose>
                                        </td>
                                    </tr>
                                    <tr>
                                        <th>사업구분</th>
                                        <td>${landVO.develop_bsns}</td>
                                        <th>등기여부</th>
                                        <td>
											<c:choose>
												<c:when test="${landVO.regt_yn eq 'Y'}">
													등기 완료
												</c:when>
												<c:when test="${landVO.regt_yn eq 'N'}">
													미등기
												</c:when>
												<c:otherwise>
		                                        	${landVO.regt_yn}
												</c:otherwise>
											</c:choose>
                                        </td>
                                    </tr>
                                    <tr>
                                        <th>재산소유</th>
                                        <td colspan="3" title="${landVO.own_code_nm}">${landVO.own_code_nm}</td>
                                    </tr>
                                    <tr>
                                        <th rowspan="2">사업구분</th>
                                        <td colspan="3" title="${landVO.pln_bsns}">(계획사업) ${landVO.pln_bsns}</td>
                                    </tr>
                                    <tr>
                                        <td colspan="3" title="${landVO.develop_bsns}">(개발사업) ${landVO.develop_bsns}</td>
                                    </tr>
                                    <tr>
                                        <th>비고</th>
                                        <td colspan="3" title="${landVO.rm}">${landVO.rm}</td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </div>
                    <div class="saeol_inner_div">
                        <div class="header_div">
                            <p><img src="${pageContext.request.contextPath}/svg/info.svg">재산항목</p>
                        </div>
                        <div>
                            <table>
                                <tbody>
                                    <tr>
                                        <th>토지명칭</th>
                                        <td colspan="3" title="${landVO.means_nm}">${landVO.means_nm}</td>
                                    </tr>
                                    <tr>
                                        <th rowspan="3">지목</th>
                                        <td>(공부)${landVO.land_jimk_code_nm}</td>
                                        <th>공시지가</th>
                                        <td>
                                            <fmt:formatNumber value="${fn:trim(landVO.gsjg)}" pattern="#,###"/>
                                            <span class="right_text">(원/m<sup>2</sup>)</span>
                                        </td>
                                    </tr>
                                    <tr>
                                        <td>(현황)${landVO.real_jimk_code_nm}</td>
                                        <th rowspan="2">지목(공유지분)</th>
                                        <td>(공유지분1) <fmt:formatNumber value="${fn:trim(landVO.sha_quota1)}" pattern="#,###.####"/></td>
                                    </tr>
                                    <tr>
                                    	<td>(지적자료)${realVO.use_situ_jimk }</td>
                                    	<td>(공유지분2) <fmt:formatNumber value="${fn:trim(landVO.sha_quota2)}" pattern="#,###.####"/></td>
                                    </tr>
                                    <tr>
                                        <th>면적(공부)</th>
                                        <td>
                                          	<fmt:formatNumber value="${fn:trim(landVO.ar)}" pattern="#,###"/>
                                            <span class="right_text">(m<sup>2</sup>)</span>
                                        </td>
                                        <th>실면적</th>
                                        <td>
                                          	<fmt:formatNumber value="${fn:trim(landVO.real_ar)}" pattern="#,###"/>
                                            <span class="right_text">(m<sup>2</sup>)</span>
                                        </td>
                                    </tr>
                                    <tr>
                                    	<th>
                                    	재산가격
                                    	<br>
                                    	(평가 및 추정가액)
                                    	</th>
                                    	<td>
											<fmt:formatNumber value="${fn:trim(landVO.means_pc)}" pattern="#,###"/>
                                           	<span class="right_text">(원)</span>
                                    	</td>
                                    	<th>회계기준가액</th>
                                    	<td>
											<fmt:formatNumber value="${fn:trim(landVO.acct_crit_pc)}" pattern="#,###"/>
											<span class="right_text">(원)</span>
                                    	</td>
                                    </tr>
                                    <tr>
                                   		<th>면적(지적자료)</th>
                                   		<td>
											<fmt:formatNumber value="${fn:trim(realVO.use_tot_ar)}" pattern="#,###"/>
                                   			<span class="right_text">(m<sup>2</sup>)</span>
                                   		</td>
                                   		<th>소유자명(지적자료)</th>
                                   		<td>${realVO.use_bdng_owner_nm }</td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </div>
                    <div class="saeol_inner_div">
                        <div class="header_div">
                            <p><img src="${pageContext.request.contextPath}/svg/info.svg">취득정보 및 도시계획정보</p>
                        </div>
                        <div>
                            <table>
                            	<tbody>
                     		        <tr>
                                   		<th>취득방법</th>
                                   		<td>${landVO.gain_met_nm }</td>
                                   		<th>취득일</th>
                                   		<td>
	                                   		<fmt:parseDate value="${landVO.gain_ymd}" var="dateValue" pattern="yyyyMMdd"/>
											<fmt:formatDate value="${dateValue}" pattern="yyyy-MM-dd"/>
                                   		</td>
                                    </tr>
                                    <tr>
                                    	<th>취득사유</th>
                                    	<td title="${landVO.gain_why }">${landVO.gain_why }</td>
                                    	<th>취득부서</th>
                                    	<td title="${landVO.gain_dep_nm }">${landVO.gain_dep_nm }</td>
                                    </tr>
                                    <tr>
                                    	<th>취득가액</th>
                                    	<td>
											<fmt:formatNumber value="${fn:trim(landVO.gain_pc)}" pattern="#,###"/>
											<span class="right_text">(원)</span>
                                    	</td>
                                    	<th>(최초)취득면적</th>
                                    	<td>
											<fmt:formatNumber value="${fn:trim(landVO.gain_ar)}" pattern="#,###"/>
											<span class="right_text">(m<sup>2</sup>)</span>
                                    	</td>
                                    </tr>
                                    <tr>
                                    	<th>용도지역</th>
                                    	<td title="${landVO.srv_regn }">${landVO.srv_regn }</td>
                                    	<th>도시계획지구</th>
                                    	<td title="${landVO.city_pln_zone }">${landVO.city_pln_zone }</td>
                                    </tr>
                                    <tr>
                                    	<th>계획시설</th>
                                    	<td title="${landVO.pln_facil }" colspan="3">${landVO.pln_facil }</td>
                                    </tr>
                                    <tr>
                                    	<th>개발사업</th>
                                    	<td colspan="3" title="${landVO.develop_bsns }">${landVO.develop_bsns }</td>
                                    </tr>
                                    <tr>
                                    	<th>계획사업</th>
                                    	<td colspan="3" title="">${landVO.pln_bsns }</td>
                                    </tr>
                                    <tr>
                                    	<th>착공일</th>
                                    	<td><!-- 컬럼 없음 --></td>
                                    	<th>토지보상법에 의한 취득재산</th>
                                    	<td>${landVO.gain_met_se }</td>
                                    </tr>
                            	</tbody>
                            </table>
                        </div>
                    </div>
                    <div class="saeol_inner_div">
                        <div class="header_div">
                            <p><img src="${pageContext.request.contextPath}/svg/info.svg">이력</p>
                        </div>
                        <div>
                            <table class="list_table">
								<thead>
									<tr>
										<th>순번</th>
										<th>발생일</th>
										<th>이력항목</th>
										<th>변경전</th>
										<th>변경후</th>
										<th>비고</th>
									</tr>
								</thead>
								<tbody>
									<c:if test="${empty varianceList}">
										<tr> 
											<td colspan="6">검색결과가 없습니다.</td> 
										</tr>
									</c:if>
									<c:forEach items="${varianceList}" var="var" varStatus="status" >
										<tr>
											<td>${status.index+1 }</td>		
											<td>
												<fmt:parseDate value="${var.apply_ymd}" var="date" pattern="yyyyMMdd"/>
												<fmt:formatDate value="${date}" pattern="yyyy-MM-dd"/>
											</td>									
											<td>${var.his_se_nm }</td>									
											<td>${var.wrk_bf_vlu }</td>									
											<td>${var.wrk_atf_value }</td>									
											<td>${var.rm }</td>									
										</tr>
									</c:forEach>
								</tbody>
                            </table>
                        </div>
                    </div>
                    <div class="saeol_inner_div">
                        <div class="header_div">
                            <p><img src="${pageContext.request.contextPath}/svg/info.svg">대부/사용허가</p>
                        </div>
                        <div>
                            <table class="list_table">
								<thead>
									<tr>
										<th>순번</th>
										<th>수혜자</th>
										<th>대부(허가)기간</th>
										<th>대부(허가)면적(m<sup>2</sup>)</th>
										<th>대부(허가)료(원)</th>
										<th>결재</th>
									</tr>
								</thead>
								<tbody>
									<c:if test="${empty loanList}">
										<tr> 
											<td colspan="6">검색결과가 없습니다.</td> 
										</tr>
									</c:if>
									<c:forEach items="${loanList}" var="var" varStatus="status" >
										<tr class="list_tr">
											<td>${status.index+1 }</td>		
											<td style="max-width: 60px" title="${var.usr_nm }">${var.usr_nm }</td>									
											<td>
		                                   		<fmt:parseDate value="${var.loan_perm_gigan_st_ymd}" var="start" pattern="yyyyMMdd"/>
		                                   		<fmt:parseDate value="${var.loan_perm_gigan_end_ymd}" var="end" pattern="yyyyMMdd"/>
												<fmt:formatDate value="${start}" pattern="yyyy-MM-dd"/> ~ <fmt:formatDate value="${end}" pattern="yyyy-MM-dd"/>
											</td>									
											<td>${var.bdng_loan_use_ar }</td>									
											<td><fmt:formatNumber value="${fn:trim(var.per_amt)}" pattern="#,###"/></td>									
											<td><!-- 컬럽 없음 --></td>									
										</tr>
									</c:forEach>
								</tbody>
                            </table>
                        </div>
                    </div>
                    <div class="saeol_inner_div">
                        <div class="header_div">
                            <p><img src="${pageContext.request.contextPath}/svg/info.svg">무단점 사용지</p>
                        </div>
                        <div>
                            <table class="list_table">
								<thead>
									<tr>
										<th>순번</th>
										<th>점유자</th>
										<th>무단점유기간</th>
										<th>무단점유면적(m<sup>2</sup>)</th>
										<th>무단점유료(원)</th>
									</tr>
								</thead>
								<tbody>
									<c:if test="${empty occuList}">
										<tr> 
											<td colspan="6">검색결과가 없습니다.</td> 
										</tr>
									</c:if>
									<c:forEach items="${occuList}" var="var" varStatus="status" >
										<tr class="list_tr">
											<td>${status.index+1 }</td>		
											<td>${var.usr_nm }</td>									
											<td>
		                                   		<fmt:parseDate value="${var.poss_st_ymd}" var="start" pattern="yyyyMMdd"/>
		                                   		<fmt:parseDate value="${var.poss_end_ymd}" var="end" pattern="yyyyMMdd"/>
												<fmt:formatDate value="${start}" pattern="yyyy-MM-dd"/> ~ <fmt:formatDate value="${end}" pattern="yyyy-MM-dd"/>
											</td>									
											<td><fmt:formatNumber value="${fn:trim(var.poss_ar1)}" pattern="#,###"/></td>									
											<td><!-- 컬럼 없음 --></td>									
										</tr>
									</c:forEach>
								</tbody>
                            </table>
                        </div>
                    </div>
                </div>
            </c:otherwise>
        </c:choose>
    </div>
</body>
</html>