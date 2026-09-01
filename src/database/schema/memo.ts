/**
 * memo — 메모 (PostGIS Point, layer 스키마)
 * memo_city 등 계열은 동일 컬럼. 기동 시 ensureLayerAppTables 가 없으면 생성한다.
 */
import { boolean, pgSchema, serial, text, customType } from 'drizzle-orm/pg-core';

const layer = pgSchema('layer');

const geomPoint5181 = customType<{ data: string | null; driverData: string | null }>({
  dataType() {
    return 'geometry(Point,5181)';
  },
});

export const memo = layer.table('memo', {
  memoKey: serial('memo_key').primaryKey().notNull(),
  geom: geomPoint5181('geom'),
  address: text('address'),
  memoTitle: text('memo_title'),
  memoContents: text('memo_contents'),
  memoCreateDate: text('memo_create_date'),
  memoCreateUser: text('memo_create_user'),
  memoCreateGroup: text('memo_create_group'),
  memoIsDel: boolean('memo_is_del').default(false),
});

export const memoTableComment = '메모';

export const memoColumnComments: Record<string, string> = {
  memo_key: '키',
  geom: '위치',
  address: '주소',
  memo_title: '제목',
  memo_contents: '내용',
  memo_create_date: '작성일',
  memo_create_user: '작성자',
  memo_create_group: '작성그룹',
  memo_is_del: '삭제여부',
};
