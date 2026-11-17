/**
 * land_price_memo — 개별공시지가 필지 메모 (layer 스키마)
 * 기동 시 ensureLayerAppTables 가 없으면 생성한다.
 */
import { boolean, index, pgSchema, serial, text, timestamp } from 'drizzle-orm/pg-core';

const layer = pgSchema('layer');

export const landPriceMemo = layer.table(
  'land_price_memo',
  {
    memoKey: serial('memo_key').primaryKey().notNull(),
    pnu: text('pnu').notNull(),
    memoContents: text('memo_contents').notNull().default(''),
    memoCreateDate: timestamp('memo_create_date', { mode: 'string' }).notNull().defaultNow(),
    memoCreateUser: text('memo_create_user'),
    memoIsDel: boolean('memo_is_del').notNull().default(false),
  },
  (t) => [index('land_price_memo_pnu_idx').on(t.pnu)]
);

export const landPriceMemoTableComment = '개별공시지가 필지 메모';

export const landPriceMemoColumnComments: Record<string, string> = {
  memo_key: '키',
  pnu: '필지번호',
  memo_contents: '내용',
  memo_create_date: '작성일시',
  memo_create_user: '작성자 아이디',
  memo_is_del: '삭제여부',
};
