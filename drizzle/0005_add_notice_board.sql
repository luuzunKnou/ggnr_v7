-- 공지사항
CREATE TABLE IF NOT EXISTS notice (
  notice_key serial PRIMARY KEY NOT NULL,
  notice_title varchar NOT NULL,
  notice_contents text,
  notice_is_pinned boolean NOT NULL DEFAULT false,
  notice_is_del boolean NOT NULL DEFAULT false,
  notice_view_cnt integer NOT NULL DEFAULT 0,
  notice_create_date timestamp,
  notice_create_user varchar,
  notice_update_date timestamp,
  notice_update_user varchar
);

COMMENT ON TABLE notice IS '공지사항';
COMMENT ON COLUMN notice.notice_key IS '공지키';
COMMENT ON COLUMN notice.notice_title IS '제목';
COMMENT ON COLUMN notice.notice_contents IS '내용';
COMMENT ON COLUMN notice.notice_is_pinned IS '상단고정';
COMMENT ON COLUMN notice.notice_is_del IS '삭제여부';
COMMENT ON COLUMN notice.notice_view_cnt IS '조회수';
COMMENT ON COLUMN notice.notice_create_date IS '등록일시';
COMMENT ON COLUMN notice.notice_create_user IS '등록자';
COMMENT ON COLUMN notice.notice_update_date IS '수정일시';
COMMENT ON COLUMN notice.notice_update_user IS '수정자';

-- 자료실
CREATE TABLE IF NOT EXISTS board (
  board_key serial PRIMARY KEY NOT NULL,
  board_title varchar NOT NULL,
  board_contents text,
  board_is_del boolean NOT NULL DEFAULT false,
  board_view_cnt integer NOT NULL DEFAULT 0,
  board_create_date timestamp,
  board_create_user varchar,
  board_update_date timestamp,
  board_update_user varchar
);

COMMENT ON TABLE board IS '자료실';
COMMENT ON COLUMN board.board_key IS '게시키';
COMMENT ON COLUMN board.board_title IS '제목';
COMMENT ON COLUMN board.board_contents IS '내용';
COMMENT ON COLUMN board.board_is_del IS '삭제여부';
COMMENT ON COLUMN board.board_view_cnt IS '조회수';
COMMENT ON COLUMN board.board_create_date IS '등록일시';
COMMENT ON COLUMN board.board_create_user IS '등록자';
COMMENT ON COLUMN board.board_update_date IS '수정일시';
COMMENT ON COLUMN board.board_update_user IS '수정자';
