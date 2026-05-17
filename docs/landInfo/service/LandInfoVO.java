package component.landInfo.service;

import java.util.Date;

import component.util.PagingVO;

public class LandInfoVO extends PagingVO{
	
	private	String	pnu;
	private	String	administrative_district;
	private	String	issan;
	private	String	bon;
	private	String	bu;
	private	String	jimok_cd;
	private	String	jimok;
	private	String	area;
	private	String	land_move_reason_cd;
	private	String	land_move_reason;	
	private	String	land_move_date;
	private	String	soyu_address;
	private	String	soyu_name;
	private	String	soyu_cd;
	private	String	soyu_gubun;
	private	String	soyu_trans_date;
	private	String	soyu_trans_reason_cd;
	private	String	soyu_trans_reason;
	private	String	sharing_num;
	private	String	pnilp;
	private	String	pnlip_susi;
	private	String	pnlip_1y_ago;
	private	String	pnlip_1y_ago_susi;
	private	String	pnlip_2y_ago;
	private	String	pnlip_2y_ago_susi;
	private	String	pnlip_3y_ago;
	private	String	pnlip_3y_ago_susi;
	private	String	pnlip_4y_ago;
	private	String	pnlip_4y_ago_susi;
	private Date  insert_date;
	
	public String getPnu() {
		return pnu;
	}
	public void setPnu(String pnu) {
		this.pnu = pnu;
	}
	public String getAdministrative_district() {
		return administrative_district;
	}
	public void setAdministrative_district(String administrative_district) {
		this.administrative_district = administrative_district;
	}
	public String getIssan() {
		return issan;
	}
	public void setIssan(String issan) {
		this.issan = issan;
	}
	public String getBon() {
		return bon;
	}
	public void setBon(String bon) {
		this.bon = bon;
	}
	public String getBu() {
		return bu;
	}
	public void setBu(String bu) {
		this.bu = bu;
	}
	public String getJimok_cd() {
		return jimok_cd;
	}
	public void setJimok_cd(String jimok_cd) {
		this.jimok_cd = jimok_cd;
	}
	public String getJimok() {
		return jimok;
	}
	public void setJimok(String jimok) {
		this.jimok = jimok;
	}
	public String getArea() {
		return area;
	}
	public void setArea(String area) {
		this.area = area;
	}
	public String getLand_move_reason_cd() {
		return land_move_reason_cd;
	}
	public void setLand_move_reason_cd(String land_move_reason_cd) {
		this.land_move_reason_cd = land_move_reason_cd;
	}
	public String getLand_move_reason() {
		return land_move_reason;
	}
	public void setLand_move_reason(String land_move_reason) {
		this.land_move_reason = land_move_reason;
	}
	public String getLand_move_date() {
		return land_move_date;
	}
	public void setLand_move_date(String land_move_date) {
		this.land_move_date = land_move_date;
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
	public String getSoyu_trans_date() {
		return soyu_trans_date;
	}
	public void setSoyu_trans_date(String soyu_trans_date) {
		this.soyu_trans_date = soyu_trans_date;
	}
	public String getSoyu_trans_reason_cd() {
		return soyu_trans_reason_cd;
	}
	public void setSoyu_trans_reason_cd(String soyu_trans_reason_cd) {
		this.soyu_trans_reason_cd = soyu_trans_reason_cd;
	}
	public String getSoyu_trans_reason() {
		return soyu_trans_reason;
	}
	public void setSoyu_trans_reason(String soyu_trans_reason) {
		this.soyu_trans_reason = soyu_trans_reason;
	}
	public String getSharing_num() {
		return sharing_num;
	}
	public void setSharing_num(String sharing_num) {
		this.sharing_num = sharing_num;
	}
	public String getPnilp() {
		return pnilp;
	}
	public void setPnilp(String pnilp) {
		this.pnilp = pnilp;
	}
	public String getPnlip_susi() {
		return pnlip_susi;
	}
	public void setPnlip_susi(String pnlip_susi) {
		this.pnlip_susi = pnlip_susi;
	}
	public String getPnlip_1y_ago() {
		return pnlip_1y_ago;
	}
	public void setPnlip_1y_ago(String pnlip_1y_ago) {
		this.pnlip_1y_ago = pnlip_1y_ago;
	}
	public String getPnlip_1y_ago_susi() {
		return pnlip_1y_ago_susi;
	}
	public void setPnlip_1y_ago_susi(String pnlip_1y_ago_susi) {
		this.pnlip_1y_ago_susi = pnlip_1y_ago_susi;
	}
	public String getPnlip_2y_ago() {
		return pnlip_2y_ago;
	}
	public void setPnlip_2y_ago(String pnlip_2y_ago) {
		this.pnlip_2y_ago = pnlip_2y_ago;
	}
	public String getPnlip_2y_ago_susi() {
		return pnlip_2y_ago_susi;
	}
	public void setPnlip_2y_ago_susi(String pnlip_2y_ago_susi) {
		this.pnlip_2y_ago_susi = pnlip_2y_ago_susi;
	}
	public String getPnlip_3y_ago() {
		return pnlip_3y_ago;
	}
	public void setPnlip_3y_ago(String pnlip_3y_ago) {
		this.pnlip_3y_ago = pnlip_3y_ago;
	}
	public String getPnlip_3y_ago_susi() {
		return pnlip_3y_ago_susi;
	}
	public void setPnlip_3y_ago_susi(String pnlip_3y_ago_susi) {
		this.pnlip_3y_ago_susi = pnlip_3y_ago_susi;
	}
	public String getPnlip_4y_ago() {
		return pnlip_4y_ago;
	}
	public void setPnlip_4y_ago(String pnlip_4y_ago) {
		this.pnlip_4y_ago = pnlip_4y_ago;
	}
	public String getPnlip_4y_ago_susi() {
		return pnlip_4y_ago_susi;
	}
	public void setPnlip_4y_ago_susi(String pnlip_4y_ago_susi) {
		this.pnlip_4y_ago_susi = pnlip_4y_ago_susi;
	}
	public Date getInsert_date() {
		return insert_date;
	}
	public void setInsert_date(Date insert_date) {
		this.insert_date = insert_date;
	}
	@Override
	public String toString() {
		return "LandInfoVO [pnu=" + pnu + ", administrative_district=" + administrative_district + ", issan=" + issan
				+ ", bon=" + bon + ", bu=" + bu + ", jimok_cd=" + jimok_cd + ", jimok=" + jimok + ", area=" + area
				+ ", land_move_reason_cd=" + land_move_reason_cd + ", land_move_reason=" + land_move_reason
				+ ", land_move_date=" + land_move_date + ", soyu_address=" + soyu_address + ", soyu_name=" + soyu_name
				+ ", soyu_cd=" + soyu_cd + ", soyu_gubun=" + soyu_gubun + ", soyu_trans_date=" + soyu_trans_date
				+ ", soyu_trans_reason_cd=" + soyu_trans_reason_cd + ", soyu_trans_reason=" + soyu_trans_reason
				+ ", sharing_num=" + sharing_num + ", pnilp=" + pnilp + ", pnlip_susi=" + pnlip_susi + ", pnlip_1y_ago="
				+ pnlip_1y_ago + ", pnlip_1y_ago_susi=" + pnlip_1y_ago_susi + ", pnlip_2y_ago=" + pnlip_2y_ago
				+ ", pnlip_2y_ago_susi=" + pnlip_2y_ago_susi + ", pnlip_3y_ago=" + pnlip_3y_ago + ", pnlip_3y_ago_susi="
				+ pnlip_3y_ago_susi + ", pnlip_4y_ago=" + pnlip_4y_ago + ", pnlip_4y_ago_susi=" + pnlip_4y_ago_susi
				+ ", insert_date="+ insert_date +"]";
	}
}
