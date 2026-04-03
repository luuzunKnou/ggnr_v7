CREATE TABLE "comp" (
	"comp_key" serial PRIMARY KEY NOT NULL,
	"comp_date" timestamp,
	"comp_cu" varchar,
	"comp_ct" varchar,
	"comp_cg" varchar,
	"comp_adr" varchar,
	"comp_name" varchar,
	"comp_tel" varchar,
	"comp_content" varchar,
	"comp_extra" json
);
--> statement-breakpoint
CREATE TABLE "compd" (
	"compd_key" serial PRIMARY KEY NOT NULL,
	"comp_key" integer NOT NULL,
	"compd_date" timestamp,
	"compd_cu" varchar,
	"compd_ct" varchar,
	"compd_cg" varchar,
	"compd_state" varchar,
	"compd_contents" varchar,
	"compd_extra" json
);
--> statement-breakpoint
CREATE TABLE "excel_sync_log" (
	"esl_key" serial PRIMARY KEY NOT NULL,
	"esl_eh_key" integer,
	"esl_table_name" varchar NOT NULL,
	"esl_key_field" varchar NOT NULL,
	"esl_key_value" varchar NOT NULL,
	"esl_operation" varchar,
	"esl_old_data" jsonb,
	"esl_new_data" jsonb,
	"esl_applied_at" timestamp,
	"esl_rolled_back" boolean DEFAULT false,
	"esl_rolled_back_at" timestamp,
	"esl_created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "excel_upload_history" (
	"eh_key" serial PRIMARY KEY NOT NULL,
	"eh_source_path" varchar,
	"eh_table_name" varchar NOT NULL,
	"eh_table_kor_name" varchar,
	"eh_group" varchar,
	"eh_row_count" integer,
	"eh_result" varchar,
	"eh_contents" varchar,
	"eh_create_date" timestamp,
	"eh_create_user" integer,
	"eh_geocoding_header_kor" varchar,
	"eh_geocoding_header_eng" varchar,
	"eh_geometry_type" varchar
);
--> statement-breakpoint
CREATE TABLE "gp_map" (
	"gp_key" serial PRIMARY KEY NOT NULL,
	"ug_name" varchar,
	"perm_key" integer
);
--> statement-breakpoint
CREATE TABLE "layer_detail_history" (
	"dh_key" serial PRIMARY KEY NOT NULL,
	"dh_lh_key" integer,
	"dh_group" varchar,
	"dh_name" varchar,
	"dh_kor_name" varchar,
	"dh_type" varchar,
	"dh_old_data" integer,
	"dh_new_data" integer,
	"dh_append_count" integer,
	"dh_conflict_count" integer,
	"dh_remove_count" integer,
	"dh_contents" varchar,
	"dh_result" varchar,
	"dh_shp_path" varchar
);
--> statement-breakpoint
CREATE TABLE "layer_history" (
	"lh_key" serial PRIMARY KEY NOT NULL,
	"lh_contents" varchar,
	"lh_success_count" integer,
	"lh_fail_count" integer,
	"lh_create_user" integer,
	"lh_create_date" date
);
--> statement-breakpoint
CREATE TABLE "log_kais" (
	"log_kais_key" serial PRIMARY KEY NOT NULL,
	"log_kais_cntc_cd" varchar(20),
	"log_kais_name" varchar(200) NOT NULL,
	"log_kais_date" varchar(8) NOT NULL,
	"log_kais_request_date" timestamp DEFAULT now() NOT NULL,
	"log_kais_result_code" varchar(50),
	"log_kais_response_code" varchar(50),
	"log_kais_response_msg" text,
	"log_kais_status" varchar(200) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "perm" (
	"perm_key" serial PRIMARY KEY NOT NULL,
	"perm_name" varchar,
	"perm_is_hidden" boolean,
	"perm_etc" varchar
);
--> statement-breakpoint
CREATE TABLE "ser" (
	"ser_eng" varchar PRIMARY KEY NOT NULL,
	"ser_kor" varchar,
	"ser_type" varchar,
	"ser_menu" varchar,
	"ser_cat" varchar,
	"ser_idx" integer,
	"ser_work_type" varchar,
	"ser_is_private" boolean,
	"ser_has_contents" boolean DEFAULT true,
	"ser_has_file" boolean DEFAULT true,
	"ser_data_table" varchar,
	"ser_data_query" varchar,
	"ser_url" varchar,
	"ser_is_del" boolean
);
--> statement-breakpoint
CREATE TABLE "serd" (
	"serd_key" serial PRIMARY KEY NOT NULL,
	"ser_eng" varchar,
	"serd_join_key" varchar,
	"serd_type" varchar,
	"serd_kor" varchar,
	"serd_url" varchar
);
--> statement-breakpoint
CREATE TABLE "serp_map" (
	"serp_key" serial PRIMARY KEY NOT NULL,
	"perm_key" integer,
	"ser_eng" varchar,
	"serp_type" smallint DEFAULT 3 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_log" (
	"sl_key" serial PRIMARY KEY NOT NULL,
	"sl_dh_key" integer,
	"sl_table_name" varchar NOT NULL,
	"sl_key_field" varchar NOT NULL,
	"sl_key_value" varchar NOT NULL,
	"sl_operation" varchar,
	"sl_old_data" jsonb,
	"sl_new_data" jsonb,
	"sl_applied_at" timestamp,
	"sl_rolled_back" boolean DEFAULT false,
	"sl_rolled_back_at" timestamp,
	"sl_created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "sys" (
	"sys_key" serial PRIMARY KEY NOT NULL,
	"sys_kor" varchar,
	"sys_eng" varchar,
	"sys_img" varchar,
	"sys_idx" integer,
	"sys_col" varchar,
	"sys_link" varchar,
	"sys_detail" varchar,
	"sys_is_private" boolean DEFAULT false
);
--> statement-breakpoint
CREATE TABLE "sysp_map" (
	"sysp_key" serial PRIMARY KEY NOT NULL,
	"perm_key" integer,
	"sys_key" text
);
--> statement-breakpoint
CREATE TABLE "sysser_map" (
	"sysser_key" serial PRIMARY KEY NOT NULL,
	"sys_key" integer,
	"ser_eng" varchar
);
--> statement-breakpoint
CREATE TABLE "tp_map" (
	"tp_key" serial PRIMARY KEY NOT NULL,
	"ut_name" varchar,
	"perm_key" integer
);
--> statement-breakpoint
CREATE TABLE "ug" (
	"ug_name" varchar PRIMARY KEY NOT NULL,
	"ug_is_del" boolean,
	"ug_is_hidden" boolean,
	"ug_etc" varchar
);
--> statement-breakpoint
CREATE TABLE "up_map" (
	"up_key" serial PRIMARY KEY NOT NULL,
	"usr_id" varchar,
	"perm_key" integer
);
--> statement-breakpoint
CREATE TABLE "usr" (
	"usr_id" varchar PRIMARY KEY NOT NULL,
	"ug_name" varchar NOT NULL,
	"ut_name" varchar NOT NULL,
	"usr_name" varchar,
	"usr_pwd" varchar,
	"usr_tel" varchar,
	"usr_mail" varchar,
	"usr_is_manager" boolean,
	"usr_is_so" boolean,
	"usr_is_del" boolean,
	"usr_is_hidden" boolean,
	"usr_etc" varchar,
	"usr_req_time" timestamp,
	"usr_ok_time" timestamp,
	"usr_cancle_time" timestamp
);
--> statement-breakpoint
CREATE TABLE "usr_access_request" (
	"uar_key" serial PRIMARY KEY NOT NULL,
	"usr_id" varchar NOT NULL,
	"target_type" varchar NOT NULL,
	"ser_eng" varchar,
	"sys_key" text,
	"requested_serp_type" smallint,
	"state" varchar DEFAULT 'pending' NOT NULL,
	"created_at" timestamp NOT NULL,
	"processed_at" timestamp,
	"processed_by" varchar,
	"reject_reason" varchar,
	"request_reason" text
);
--> statement-breakpoint
CREATE TABLE "usr_ser_grant" (
	"usg_key" serial PRIMARY KEY NOT NULL,
	"usr_id" varchar NOT NULL,
	"ser_eng" varchar NOT NULL,
	"serp_type" smallint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usr_sys_grant" (
	"usy_key" serial PRIMARY KEY NOT NULL,
	"usr_id" varchar NOT NULL,
	"sys_key" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ut" (
	"ut_name" varchar PRIMARY KEY NOT NULL,
	"ug_name" varchar NOT NULL,
	"ut_is_del" boolean,
	"ut_is_hidden" boolean,
	"ut_etc" varchar
);
--> statement-breakpoint
ALTER TABLE "compd" ADD CONSTRAINT "compd_comp_key_comp_comp_key_fk" FOREIGN KEY ("comp_key") REFERENCES "public"."comp"("comp_key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "excel_sync_log" ADD CONSTRAINT "excel_sync_log_esl_eh_key_excel_upload_history_eh_key_fk" FOREIGN KEY ("esl_eh_key") REFERENCES "public"."excel_upload_history"("eh_key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gp_map" ADD CONSTRAINT "gp_map_ug_name_ug_ug_name_fk" FOREIGN KEY ("ug_name") REFERENCES "public"."ug"("ug_name") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gp_map" ADD CONSTRAINT "gp_map_perm_key_perm_perm_key_fk" FOREIGN KEY ("perm_key") REFERENCES "public"."perm"("perm_key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "layer_detail_history" ADD CONSTRAINT "layer_detail_history_dh_lh_key_layer_history_lh_key_fk" FOREIGN KEY ("dh_lh_key") REFERENCES "public"."layer_history"("lh_key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "serd" ADD CONSTRAINT "serd_ser_eng_ser_ser_eng_fk" FOREIGN KEY ("ser_eng") REFERENCES "public"."ser"("ser_eng") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "serp_map" ADD CONSTRAINT "serp_map_perm_key_perm_perm_key_fk" FOREIGN KEY ("perm_key") REFERENCES "public"."perm"("perm_key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_log" ADD CONSTRAINT "sync_log_sl_dh_key_layer_detail_history_dh_key_fk" FOREIGN KEY ("sl_dh_key") REFERENCES "public"."layer_detail_history"("dh_key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sysp_map" ADD CONSTRAINT "sysp_map_perm_key_perm_perm_key_fk" FOREIGN KEY ("perm_key") REFERENCES "public"."perm"("perm_key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sysser_map" ADD CONSTRAINT "sysser_map_sys_key_sys_sys_key_fk" FOREIGN KEY ("sys_key") REFERENCES "public"."sys"("sys_key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sysser_map" ADD CONSTRAINT "sysser_map_ser_eng_ser_ser_eng_fk" FOREIGN KEY ("ser_eng") REFERENCES "public"."ser"("ser_eng") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tp_map" ADD CONSTRAINT "tp_map_ut_name_ut_ut_name_fk" FOREIGN KEY ("ut_name") REFERENCES "public"."ut"("ut_name") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tp_map" ADD CONSTRAINT "tp_map_perm_key_perm_perm_key_fk" FOREIGN KEY ("perm_key") REFERENCES "public"."perm"("perm_key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "up_map" ADD CONSTRAINT "up_map_usr_id_usr_usr_id_fk" FOREIGN KEY ("usr_id") REFERENCES "public"."usr"("usr_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "up_map" ADD CONSTRAINT "up_map_perm_key_perm_perm_key_fk" FOREIGN KEY ("perm_key") REFERENCES "public"."perm"("perm_key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usr" ADD CONSTRAINT "usr_ug_name_ug_ug_name_fk" FOREIGN KEY ("ug_name") REFERENCES "public"."ug"("ug_name") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usr" ADD CONSTRAINT "usr_ut_name_ut_ut_name_fk" FOREIGN KEY ("ut_name") REFERENCES "public"."ut"("ut_name") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usr_access_request" ADD CONSTRAINT "usr_access_request_usr_id_usr_usr_id_fk" FOREIGN KEY ("usr_id") REFERENCES "public"."usr"("usr_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usr_ser_grant" ADD CONSTRAINT "usr_ser_grant_usr_id_usr_usr_id_fk" FOREIGN KEY ("usr_id") REFERENCES "public"."usr"("usr_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usr_sys_grant" ADD CONSTRAINT "usr_sys_grant_usr_id_usr_usr_id_fk" FOREIGN KEY ("usr_id") REFERENCES "public"."usr"("usr_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ut" ADD CONSTRAINT "ut_ug_name_ug_ug_name_fk" FOREIGN KEY ("ug_name") REFERENCES "public"."ug"("ug_name") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "serp_map_perm_ser_uq" ON "serp_map" USING btree ("perm_key","ser_eng");--> statement-breakpoint
CREATE UNIQUE INDEX "sysp_map_perm_sys_uq" ON "sysp_map" USING btree ("perm_key","sys_key");--> statement-breakpoint
CREATE UNIQUE INDEX "usr_ser_grant_usr_ser_uq" ON "usr_ser_grant" USING btree ("usr_id","ser_eng");--> statement-breakpoint
CREATE UNIQUE INDEX "usr_sys_grant_usr_sys_uq" ON "usr_sys_grant" USING btree ("usr_id","sys_key");