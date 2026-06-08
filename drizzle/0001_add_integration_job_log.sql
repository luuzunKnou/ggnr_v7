CREATE TABLE "integration_job_log" (
	"ijl_key" serial PRIMARY KEY NOT NULL,
	"ijl_system" varchar(30) NOT NULL,
	"ijl_started_at" timestamp DEFAULT now() NOT NULL,
	"ijl_finished_at" timestamp,
	"ijl_status" varchar(20) NOT NULL,
	"ijl_message" text
);
