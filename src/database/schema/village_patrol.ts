/**
 * village_patrol — 마을순찰대 편성 명단 (layer 스키마)
 * 기동 시 ensureLayerAppTables 가 없으면 생성한다.
 * 유니크: 읍면+마을+조+성명+연락처 (편성 자리당 1행)
 */
import { pgSchema, serial, text, uniqueIndex } from 'drizzle-orm/pg-core'

const layer = pgSchema('layer')

export const villagePatrol = layer.table(
  'village_patrol',
  {
    id: serial('id').primaryKey().notNull(),
    eup: text('eup').notNull().default(''),
    village: text('village').notNull().default(''),
    team: text('team').notNull().default('A조'),
    name: text('name').notNull().default(''),
    affiliation: text('affiliation').notNull().default(''),
    phone: text('phone').notNull().default(''),
    note: text('note').notNull().default(''),
  },
  (t) => [
    uniqueIndex('village_patrol_assignment_uidx').on(
      t.eup,
      t.village,
      t.team,
      t.name,
      t.phone
    ),
  ]
)

export const villagePatrolTableComment = '마을순찰대 편성 명단'

export const villagePatrolColumnComments: Record<string, string> = {
  id: '키',
  eup: '읍면',
  village: '마을',
  team: '조',
  name: '성명',
  affiliation: '소속',
  phone: '연락처',
  note: '비고',
}
