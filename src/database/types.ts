/**
 * PostGIS Custom Types for Drizzle ORM
 */

// PostGIS Point 타입 (SRID 4326)
export const point = {
  dataType: 'geometry',
  notNull: false,
  sqlType: 'geometry(Point, 4326)',
};

// PostGIS Geometry 타입을 위한 커스텀 타입
export type Point = {
  type: 'Point';
  coordinates: [number, number]; // [longitude, latitude]
};
