package component.landInfo.service;

import java.util.Date;

import component.util.PagingVO;

public class LandOwnInfoVO extends PagingVO{
	
	private	String	pnu;
	private	String	soyu_address;
	private	String	soyu_name;
	private	String	soyu_cd;
	private	String	soyu_gubun;
	private	String	soyu_share;
	private	String	soyu_trans_date;
	private	String	soyu_trans_reason;
	private	String	soyu_trans_reason_cd;
	private Date  insert_date;
	public String getPnu() {
		return pnu;
	}
	public void setPnu(String pnu) {
		this.pnu = pnu;
	}
	public String getSoyu_address() {
		return soyu_address;
	}
	public void setSoyu_address(String soyu_address) {
		this.soyu_address = soyu_address;
	}
	public String getSoyu_name() {
		return soyu_name;
	}
	public void setSoyu_name(String soyu_name) {
		this.soyu_name = soyu_name;
	}
	public String getSoyu_cd() {
		return soyu_cd;
	}
	public void setSoyu_cd(String soyu_cd) {
		this.soyu_cd = soyu_cd;
	}
	public String getSoyu_gubun() {
		return soyu_gubun;
	}
	public void setSoyu_gubun(String soyu_gubun) {
		this.soyu_gubun = soyu_gubun;
	}
	public String getSoyu_share() {
		return soyu_share;
	}
	public void setSoyu_share(String soyu_share) {
		this.soyu_share = soyu_share;
	}
	public String getSoyu_trans_date() {
		return soyu_trans_date;
	}
	public void setSoyu_trans_date(String soyu_trans_date) {
		this.soyu_trans_date = soyu_trans_date;
	}
	public String getSoyu_trans_reason() {
		return soyu_trans_reason;
	}
	public void setSoyu_trans_reason(String soyu_trans_reason) {
		this.soyu_trans_reason = soyu_trans_reason;
	}
	public String getSoyu_trans_reason_cd() {
		return soyu_trans_reason_cd;
	}
	public void setSoyu_trans_reason_cd(String soyu_trans_reason_cd) {
		this.soyu_trans_reason_cd = soyu_trans_reason_cd;
	}
	public Date getInsert_date() {
		return insert_date;
	}
	public void setInsert_date(Date insert_date) {
		this.insert_date = insert_date;
	}
	@Override
	public String toString() {
		return "LandOwnInfoVO [pnu=" + pnu + ", soyu_address=" + soyu_address + ", soyu_name=" + soyu_name
				+ ", soyu_cd=" + soyu_cd + ", soyu_gubun=" + soyu_gubun + ", soyu_share=" + soyu_share
				+ ", soyu_trans_date=" + soyu_trans_date + ", soyu_trans_reason=" + soyu_trans_reason
				+ ", soyu_trans_reason_cd=" + soyu_trans_reason_cd + ", getPnu()=" + getPnu() + ", getSoyu_address()="
				+ getSoyu_address() + ", getSoyu_name()=" + getSoyu_name() + ", getSoyu_cd()=" + getSoyu_cd()
				+ ", getSoyu_gubun()=" + getSoyu_gubun() + ", getSoyu_share()=" + getSoyu_share()
				+ ", getSoyu_trans_date()=" + getSoyu_trans_date() + ", getSoyu_trans_reason()="
				+ getSoyu_trans_reason() + ", getSoyu_trans_reason_cd()=" + getSoyu_trans_reason_cd() + ", toString()="
				+ super.toString() + ", getCurrentPage()=" + getCurrentPage() + ", getStartPage()=" + getStartPage()
				+ ", getEndPage()=" + getEndPage() + ", getTotal()=" + getTotal() + ", getCntPerPage()="
				+ getCntPerPage() + ", getLastPage()=" + getLastPage() + ", getStart()=" + getStart() + ", getEnd()="
				+ getEnd() + ", getCntPage()=" + getCntPage() + ", getClass()=" + getClass() + ", hashCode()="
				+ hashCode() + ", insert_date"+ getInsert_date() +"]";
	}
}
