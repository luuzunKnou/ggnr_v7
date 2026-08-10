import { useEffect, useRef } from 'react';
import { Map } from 'ol';
import { Draw } from 'ol/interaction';
import VectorSource from 'ol/source/Vector';
import VectorLayer from 'ol/layer/Vector';
import { Feature } from 'ol';
import { LineString, Polygon } from 'ol/geom';
import { getLength, getArea } from 'ol/sphere';
import { Style, Stroke, Fill, Circle as CircleStyle } from 'ol/style';
import { get as getProjection, transform } from 'ol/proj';
import { getCenter } from 'ol/extent';
import Overlay from 'ol/Overlay';
import { compareFeaturesByGeometryStackOrder } from '@/lib/mapLayerGeometryOrder';
import { bindMapViewportPointerPresence } from './mapViewportPointerPresence';

export type MeasureType = 'distance' | 'area';

export interface MeasureResult {
  type: MeasureType;
  value: number;
  unit: string;
  feature: Feature;
}

/**
 * 측정 기능 훅
 * 거리와 면적 측정을 위한 Draw 인터랙션 관리
 */
export function useMeasure(
  map: Map | null,
  measureType: MeasureType | null,
  onMeasureComplete?: (result: MeasureResult) => void
) {
  const drawRef = useRef<Draw | null>(null);
  const measureSourceRef = useRef<VectorSource | null>(null);
  const measureLayerRef = useRef<VectorLayer<VectorSource> | null>(null);
  const overlayRef = useRef<Overlay | null>(null); // 현재 그리는 중인 오버레이
  const overlayElementRef = useRef<HTMLDivElement | null>(null);
  const completedOverlaysRef = useRef<Overlay[]>([]); // 완료된 측정들의 오버레이 배열
  const pointerMoveHandlerRef = useRef<((e: any) => void) | null>(null);
  const sketchFeatureRef = useRef<Feature | null>(null);
  const isDrawingRef = useRef<boolean>(false);

  // 측정 레이어 초기화
  useEffect(() => {
    if (!map) return;

    if (!measureSourceRef.current) {
      measureSourceRef.current = new VectorSource();
    }

    if (!measureLayerRef.current) {
      const createStyle = (type: MeasureType) => {
        if (type === 'area') {
          return new Style({
            fill: new Fill({ color: 'rgba(51, 136, 255, 0.2)' }),
            stroke: new Stroke({ color: '#3388ff', width: 2 }),
            image: new CircleStyle({
              radius: 5,
              fill: new Fill({ color: '#3388ff' }),
              stroke: new Stroke({ color: '#fff', width: 2 }),
            }),
          });
        }
        return new Style({
          stroke: new Stroke({ color: '#3388ff', width: 2 }),
          image: new CircleStyle({
            radius: 5,
            fill: new Fill({ color: '#3388ff' }),
            stroke: new Stroke({ color: '#fff', width: 2 }),
          }),
        });
      };

      const measureLayer = new VectorLayer({
        source: measureSourceRef.current,
        renderOrder: compareFeaturesByGeometryStackOrder,
        style: (feature) => {
          const type = feature.get('measureType') as MeasureType;
          return type ? createStyle(type) : undefined;
        },
      });
      measureLayer.set('mapSplitNoMirror', true);
      map.addLayer(measureLayer);
      measureLayerRef.current = measureLayer;
    }

    return () => {
      if (measureLayerRef.current) {
        map.removeLayer(measureLayerRef.current);
        measureLayerRef.current = null;
      }
    };
  }, [map]);

  // 거리 계산 (미터 단위)
  const calculateDistance = (geometry: LineString): number => {
    const projection = map?.getView().getProjection();
    if (!projection) return 0;

    const projectionCode = projection.getCode();
    const coordinates = geometry.getCoordinates();

    try {
      // 투영 좌표계(EPSG:3857, EPSG:5181 등)는 이미 미터 단위이므로 직접 계산
      if (projectionCode === 'EPSG:3857' || projectionCode === 'EPSG:5181' || projectionCode.startsWith('EPSG:518')) {
        let totalDistance = 0;
        for (let i = 0; i < coordinates.length - 1; i++) {
          const [x1, y1] = coordinates[i];
          const [x2, y2] = coordinates[i + 1];
          totalDistance += Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));
        }
        return totalDistance;
      }

      // WGS84나 다른 지리 좌표계는 구면 거리 계산
      const wgs84Projection = getProjection('EPSG:4326');
      if (!wgs84Projection) return 0;

      const transformedCoords = coordinates.map((coord) =>
        projectionCode === 'EPSG:4326' ? coord : transform(coord, projection, wgs84Projection)
      );
      return getLength(new LineString(transformedCoords));
    } catch (e) {
      console.error('거리 계산 실패:', e);
      return 0;
    }
  };

  // 면적 계산 (제곱미터). ol/sphere getArea는 기본 projection=EPSG:3857 — 미리 4326으로 바꾸면 0에 가까운 값 나옴
  const calculateArea = (geometry: Polygon): number => {
    const projection = map?.getView().getProjection();
    if (!projection) return 0;

    try {
      return getArea(geometry, { projection: projection.getCode() });
    } catch (e) {
      console.error('면적 계산 실패:', e);
      return 0;
    }
  };

  // 측정값 포맷팅
  const formatMeasure = (value: number, type: MeasureType): { value: number; unit: string; text: string } => {
    if (type === 'distance') {
      return value >= 1000
        ? { value: value / 1000, unit: 'km', text: `${(value / 1000).toFixed(2)} km` }
        : { value, unit: 'm', text: `${value.toFixed(2)} m` };
    }
    // 면적: 항상 m², 천 단위 콤마
    const text = `${value.toLocaleString('ko-KR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })} m²`;
    return { value, unit: 'm²', text };
  };

  // 스타일 생성 함수
  const createStyle = (type: MeasureType) => {
    if (type === 'area') {
      return new Style({
        fill: new Fill({ color: 'rgba(51, 136, 255, 0.2)' }),
        stroke: new Stroke({ color: '#3388ff', width: 2 }),
        image: new CircleStyle({
          radius: 5,
          fill: new Fill({ color: '#3388ff' }),
          stroke: new Stroke({ color: '#fff', width: 2 }),
        }),
      });
    }
    return new Style({
      stroke: new Stroke({ color: '#3388ff', width: 2 }),
      image: new CircleStyle({
        radius: 5,
        fill: new Fill({ color: '#3388ff' }),
        stroke: new Stroke({ color: '#fff', width: 2 }),
      }),
    });
  };

  // Draw 인터랙션 설정
  useEffect(() => {
    if (!map || !measureSourceRef.current) {
      // 측정 비활성화 시 Draw 제거
      if (drawRef.current && map) {
        map.removeInteraction(drawRef.current);
        drawRef.current = null;
      }
      return;
    }

    // 기존 Draw 인터랙션 제거 (measureType 변경 시)
    if (drawRef.current) {
      try {
        map.removeInteraction(drawRef.current);
      } catch (e) {
        console.warn('기존 Draw 제거 중 오류:', e);
      }
      drawRef.current = null;
    }

    // measureType이 없으면 Draw를 추가하지 않음
    if (!measureType) return;

    let unbindPresence: (() => void) | null = null;

    // 약간의 지연을 두어 이전 Draw가 완전히 정리되도록 함
    const timeoutId = setTimeout(() => {
      if (!map || !measureSourceRef.current) return;

      const drawType = measureType === 'distance' ? 'LineString' : 'Polygon';
      const pointerOverRef = { current: false };
      const draw = new Draw({
        source: measureSourceRef.current,
        type: drawType,
        style: () => (pointerOverRef.current ? createStyle(measureType) : []),
      });

      const setSketchVisible = (visible: boolean) => {
        pointerOverRef.current = visible;
        try {
          draw.getOverlay()?.setVisible(visible);
        } catch {
          /* ignore */
        }
        if (!visible && overlayRef.current) {
          overlayRef.current.setPosition(undefined);
        }
        sketchFeatureRef.current?.changed();
        map.render();
      };

      // 분할 시 양쪽 Draw가 동시에 켜지므로, 포인터가 올라온 맵만 스케치 표시
      setSketchVisible(false);

      unbindPresence = bindMapViewportPointerPresence(map, {
        onEnter: () => setSketchVisible(true),
        onLeave: () => setSketchVisible(false),
      });

      // 임시 오버레이 생성 함수
      const createTemporaryOverlay = () => {
        if (overlayRef.current && map) {
          try {
            map.removeOverlay(overlayRef.current);
          } catch (e) {
            console.warn('기존 임시 오버레이 제거 중 오류:', e);
          }
        }

        const overlayElement = document.createElement('div');
        overlayElement.style.cssText = `
          background: white;
          color: black;
          padding: 6px 10px;
          border-radius: 4px;
          font-size: 12px;
          font-weight: 500;
          white-space: nowrap;
          pointer-events: none;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
          border: 1px solid rgba(0, 0, 0, 0.1);
          line-height: 1.4;
        `;

        const distanceLine = document.createElement('div');
        distanceLine.style.cssText = 'color: black; font-size: 12px;';
        distanceLine.id = 'measure-distance-line';

        const instructionLine = document.createElement('div');
        instructionLine.style.cssText = 'color: #666; font-size: 11px; margin-top: 2px;';
        instructionLine.id = 'measure-instruction-line';
        instructionLine.textContent = '더블클릭으로 마침';

        overlayElement.appendChild(distanceLine);
        overlayElement.appendChild(instructionLine);
        overlayElementRef.current = overlayElement;

        const overlay = new Overlay({
          element: overlayElement,
          positioning: 'bottom-center',
          stopEvent: false,
          offset: [0, -10],
        });
        map.addOverlay(overlay);
        overlayRef.current = overlay;
      };

      createTemporaryOverlay();

      // 그리기 시작 시 sketch feature 저장
      draw.on('drawstart', (e) => {
        sketchFeatureRef.current = e.feature;
        isDrawingRef.current = true; // 그리는 중 상태로 설정
        
        // 새로운 임시 오버레이 생성 (완료된 오버레이와 분리)
        createTemporaryOverlay();
        
        if (overlayRef.current && overlayElementRef.current) {
          overlayElementRef.current.style.display = 'block';
          const instructionLine = overlayElementRef.current.querySelector(
            '#measure-instruction-line'
          ) as HTMLElement | null;
          if (instructionLine) {
            instructionLine.style.display = 'block';
            instructionLine.textContent = '더블클릭으로 마침';
          }
          const distanceLine = overlayElementRef.current.querySelector(
            '#measure-distance-line'
          ) as HTMLElement | null;
          if (distanceLine && measureType === 'area') {
            distanceLine.innerHTML = '면적 측정 중';
          }
        }
      });

      // 실시간 측정값 계산을 위한 pointermove 핸들러
      const pointerMoveHandler = (e: any) => {
        // 그리는 중이 아니면 업데이트하지 않음
        if (!isDrawingRef.current || !overlayRef.current || !overlayElementRef.current || !sketchFeatureRef.current) return;

        const geometry = sketchFeatureRef.current.getGeometry();
        const currentPoint = e.coordinate;
        const projection = map.getView().getProjection();
        if (!projection) return;

        const projectionCode = projection.getCode();

        try {
          if (measureType === 'distance' && geometry instanceof LineString) {
            const coordinates = geometry.getCoordinates();
            if (coordinates.length < 1) return;

            let totalDistance = 0;

            // 투영 좌표계는 직접 미터 단위로 계산
            if (projectionCode === 'EPSG:3857' || projectionCode === 'EPSG:5181' || projectionCode.startsWith('EPSG:518')) {
              // 기존 좌표들 사이의 거리 계산
              for (let i = 0; i < coordinates.length - 1; i++) {
                const [x1, y1] = coordinates[i];
                const [x2, y2] = coordinates[i + 1];
                totalDistance += Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));
              }
              
              // 마지막 점과 현재 커서 위치 사이의 거리 추가
              if (coordinates.length > 0) {
                const [lastX, lastY] = coordinates[coordinates.length - 1];
                const [currentX, currentY] = currentPoint;
                totalDistance += Math.sqrt(Math.pow(currentX - lastX, 2) + Math.pow(currentY - lastY, 2));
              }
            } else {
              // WGS84나 다른 지리 좌표계는 구면 거리 계산
              const wgs84Projection = getProjection('EPSG:4326');
              if (!wgs84Projection) return;

              const allCoordsWGS84 = coordinates.map((coord) =>
                projectionCode === 'EPSG:4326' ? coord : transform(coord, projection, wgs84Projection)
              );
              const currentPointWGS84 =
                projectionCode === 'EPSG:4326' ? currentPoint : transform(currentPoint, projection, wgs84Projection);
              allCoordsWGS84.push(currentPointWGS84);
              totalDistance = getLength(new LineString(allCoordsWGS84));
            }

            const formatted = formatMeasure(totalDistance, 'distance');
            // "총거리 : XXXm" 형식으로 표시 (숫자 부분은 파란색)
            const distanceLine = overlayElementRef.current.querySelector('#measure-distance-line') as HTMLElement;
            if (distanceLine) {
              distanceLine.innerHTML = `총거리 : <span style="color: #3388ff; font-weight: 600;">${formatted.text}</span>`;
            }
            overlayRef.current.setPosition(currentPoint);
          } else if (measureType === 'area') {
            // 면적: 그리는 중에는 계산하지 않음(스케치 좌표·Mercator 왜곡으로 완료 값과 어긋남). 완료(drawend) 시 m² 계산.
            const distanceLine = overlayElementRef.current.querySelector(
              '#measure-distance-line'
            ) as HTMLElement | null;
            if (distanceLine) {
              distanceLine.textContent = '면적 측정 중';
            }
            overlayRef.current.setPosition(currentPoint);
          }
        } catch (e) {
          console.error('측정값 계산 실패:', e);
        }
      };

      pointerMoveHandlerRef.current = pointerMoveHandler;
      map.on('pointermove', pointerMoveHandler);

      // 그리기 취소
      draw.on('drawabort', () => {
        isDrawingRef.current = false;
        if (overlayRef.current && overlayElementRef.current) {
          overlayElementRef.current.style.display = 'none';
        }
      });

      // 그리기 완료
      draw.on('drawend', (e) => {
        const feature = e.feature;
        const geometry = feature.getGeometry();
        if (!geometry) return;

        const isDistance = geometry instanceof LineString;
        const isArea = geometry instanceof Polygon;
        
        if (!isDistance && !isArea) return;
        
        const measureValue = isDistance 
          ? calculateDistance(geometry) 
          : calculateArea(geometry);
        const finalMeasureType: MeasureType = isDistance ? 'distance' : 'area';
        const formatted = formatMeasure(measureValue, finalMeasureType);

        // 피처에 측정 정보 저장
        feature.set('measureType', finalMeasureType);
        feature.set('measureValue', formatted.value);
        feature.set('measureUnit', formatted.unit);

        // 최종 스타일 적용
        feature.setStyle([createStyle(finalMeasureType)]);

        // 그리기 종료 상태로 설정 (pointermove 핸들러가 더 이상 업데이트하지 않도록)
        isDrawingRef.current = false;

        // 거리 또는 면적 측정 완료 시 오버레이로 텍스트 표시 (흰색 배경)
        let displayPoint: [number, number] = [0, 0];

        if (isDistance) {
          // 거리는 종료 지점에 표시
          const coordinates = geometry.getCoordinates();
          const lastCoord = coordinates[coordinates.length - 1];
          if (lastCoord && Array.isArray(lastCoord) && lastCoord.length >= 2) {
            displayPoint = [lastCoord[0] as number, lastCoord[1] as number];
          }
        } else if (geometry instanceof Polygon) {
          // 면적은 다각형의 중심에 표시
          const extent = geometry.getExtent();
          const center = getCenter(extent);
          displayPoint = [center[0], center[1]];
        }

        const completedOverlayElement = document.createElement('div');
        completedOverlayElement.style.cssText = `
          background: white;
          color: black;
          padding: 6px 10px;
          border-radius: 4px;
          font-size: 12px;
          font-weight: 500;
          white-space: nowrap;
          pointer-events: none;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
          border: 1px solid rgba(0, 0, 0, 0.1);
        `;
        completedOverlayElement.innerHTML =
          finalMeasureType === 'area'
            ? `총면적 : <span style="color: #3388ff; font-weight: 600;">${formatted.text}</span>`
            : `<span style="color: #3388ff; font-weight: 600;">${formatted.text}</span>`;

        const positioning = isDistance ? 'bottom-center' : 'center-center';
        const offset = isDistance ? [0, -10] : [0, 0];

        const completedOverlay = new Overlay({
          element: completedOverlayElement,
          positioning: positioning,
          stopEvent: false,
          offset: offset,
        });

        completedOverlay.setPosition(displayPoint);
        map.addOverlay(completedOverlay);
        completedOverlaysRef.current.push(completedOverlay);
        
        // 현재 그리는 중인 오버레이는 숨김 (다음 그리기를 위해 재사용)
        if (overlayRef.current && overlayElementRef.current) {
          overlayElementRef.current.style.display = 'none';
        }

        const result: MeasureResult = {
          type: finalMeasureType,
          value: formatted.value,
          unit: formatted.unit,
          feature,
        };

        onMeasureComplete?.(result);
      });

      map.addInteraction(draw);
      drawRef.current = draw;
    }, 0);

    // cleanup 함수: Draw 인터랙션 제거 및 timeout 정리
    return () => {
      clearTimeout(timeoutId);
      unbindPresence?.();
      unbindPresence = null;

      // pointermove 핸들러 제거
      if (pointerMoveHandlerRef.current && map) {
        map.un('pointermove', pointerMoveHandlerRef.current);
        pointerMoveHandlerRef.current = null;
      }
      
      if (drawRef.current && map) {
        try {
          // 지도에서 Draw 인터랙션 제거
          const interactions = map.getInteractions();
          if (interactions.getArray().includes(drawRef.current)) {
            map.removeInteraction(drawRef.current);
          }
        } catch (e) {
          console.warn('Draw 인터랙션 제거 중 오류:', e);
        } finally {
          drawRef.current = null;
        }
      }
      // 오버레이 숨김
      if (overlayRef.current && overlayElementRef.current) {
        overlayElementRef.current.style.display = 'none';
      }
      sketchFeatureRef.current = null;
    };
  }, [map, measureType]);

  // 오버레이 정리
  useEffect(() => {
    return () => {
      if (map) {
        if (overlayRef.current) {
          try {
            map.removeOverlay(overlayRef.current);
          } catch (e) {
            console.warn('오버레이 제거 중 오류:', e);
          }
          overlayRef.current = null;
          overlayElementRef.current = null;
        }

        // 완료된 오버레이들 제거
        if (completedOverlaysRef.current.length > 0) {
          completedOverlaysRef.current.forEach((overlay) => {
            try {
              map.removeOverlay(overlay);
            } catch (e) {
              console.warn('완료된 오버레이 제거 중 오류:', e);
            }
          });
          completedOverlaysRef.current = [];
        }
      }
    };
  }, [map]);

  // 측정 초기화 함수
  const clearMeasurements = () => {
    if (measureSourceRef.current) {
      measureSourceRef.current.clear();
    }
    
    // 완료된 오버레이들 제거
    if (map && completedOverlaysRef.current.length > 0) {
      completedOverlaysRef.current.forEach((overlay) => {
        try {
          map.removeOverlay(overlay);
        } catch (e) {
          console.warn('완료된 오버레이 제거 중 오류:', e);
        }
      });
      completedOverlaysRef.current = [];
    }
    
    // 현재 그리는 중인 오버레이도 숨김
    if (overlayRef.current && overlayElementRef.current) {
      overlayElementRef.current.style.display = 'none';
    }
  };

  return {
    drawRef,
    measureSourceRef,
    measureLayerRef,
    clearMeasurements,
  };
}
