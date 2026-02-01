import { register } from 'ol/proj/proj4';
import proj4 from 'proj4';

/**
 * 좌표계 등록 및 초기화
 * OpenLayers에서 사용할 좌표계를 proj4로 등록
 */

// google 좌표계
proj4.defs(
  'EPSG:3857',
  '+proj=merc +a=6378137 +b=6378137 +lat_ts=0.0 +lon_0=0.0 +x_0=0.0 +y_0=0 +k=1.0 +units=m +nadgrids=@null +no_defs'
);

// UTM-K 좌표계
proj4.defs(
  'EPSG:5179',
  '+proj=tmerc +lat_0=38 +lon_0=127.5 +k=0.9996 +x_0=1000000 +y_0=2000000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs'
);

// 중부원점(GRS80) [200,000 500,000] - 카카오맵용
proj4.defs(
  'EPSG:5181',
  '+proj=tmerc +lat_0=38 +lon_0=127 +k=1 +x_0=200000 +y_0=500000 +ellps=GRS80 +units=m +no_defs'
);

// WGS 위경도
proj4.defs(
  'EPSG:4326',
  '+title=WGS 84 (long/lat) +proj=longlat +ellps=WGS84 +datum=WGS84 +units=degrees'
);

// 서부원점(GRS80) [200,000 500,000]
proj4.defs(
  'EPSG:5180',
  '+proj=tmerc +lat_0=38 +lon_0=125 +k=1 +x_0=200000 +y_0=500000 +ellps=GRS80 +units=m +no_defs'
);

// 제주원점(GRS80) [200,000 550,000]
proj4.defs(
  'EPSG:5182',
  '+proj=tmerc +lat_0=38 +lon_0=127 +k=1 +x_0=200000 +y_0=550000 +ellps=GRS80 +units=m +no_defs'
);

// 동부원점(GRS80) [200,000 500,000]
proj4.defs(
  'EPSG:5183',
  '+proj=tmerc +lat_0=38 +lon_0=129 +k=1 +x_0=200000 +y_0=500000 +ellps=GRS80 +units=m +no_defs'
);

// 울릉원점(GRS80) [200,000 500,000]
proj4.defs(
  'EPSG:5184',
  '+proj=tmerc +lat_0=38 +lon_0=131 +k=1 +x_0=200000 +y_0=500000 +ellps=GRS80 +units=m +no_defs'
);

// 서부원점(GRS80) [200,000 600,000]
proj4.defs(
  'EPSG:5185',
  '+proj=tmerc +lat_0=38 +lon_0=125 +k=1 +x_0=200000 +y_0=600000 +ellps=GRS80 +units=m +no_defs'
);

// 중부원점(GRS80) [200,000 600,000]
proj4.defs(
  'EPSG:5186',
  '+proj=tmerc +lat_0=38 +lon_0=127 +k=1 +x_0=200000 +y_0=600000 +ellps=GRS80 +units=m +no_defs'
);

// 동부원점(GRS80) [200,000 600,000]
proj4.defs(
  'EPSG:5187',
  '+proj=tmerc +lat_0=38 +lon_0=129 +k=1 +x_0=200000 +y_0=600000 +ellps=GRS80 +units=m +no_defs'
);

// 울릉원점(GRS80) [200,000 600,000]
proj4.defs(
  'EPSG:5188',
  '+proj=tmerc +lat_0=38 +lon_0=131 +k=1 +x_0=200000 +y_0=600000 +ellps=GRS80 +units=m +no_defs'
);

// 중부원점(Bessel) [200,000 500,000]
proj4.defs(
  'EPSG:5174',
  '+proj=tmerc +lat_0=38 +lon_0=127.0028902777778 +k=1 +x_0=200000 +y_0=500000 +ellps=bessel +towgs84=-115.80,474.99,674.11,1.16,-2.31,-1.63,6.43 +units=m +no_defs'
);

// 동부원점(Bessel) [200,000 500,000]
proj4.defs(
  'EPSG:5176',
  '+proj=tmerc +lat_0=38 +lon_0=129.0028902777778 +k=1 +x_0=200000 +y_0=500000 +ellps=bessel +towgs84=-115.80,474.99,674.11,1.16,-2.31,-1.63,6.43 +units=m +no_defs'
);

// proj4를 OpenLayers에 등록
register(proj4);
