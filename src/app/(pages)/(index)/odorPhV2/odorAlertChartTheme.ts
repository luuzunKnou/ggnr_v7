import type { PpmZoneBounds } from '@/app/(pages)/(index)/odorPhV2/odorAlertDetailMock'

/** 표7 배경 — 정상(녹) · 주의(투명) · 경보(연붉) */
export function ppmZoneBoxAnnotations(
  zones: PpmZoneBounds,
  axis: 'x' | 'y'
): Record<string, object> {
  const band = (key: string, from: number, to: number, color: string) =>
    axis === 'x'
      ? {
          [key]: {
            type: 'box' as const,
            xMin: from,
            xMax: to,
            backgroundColor: color,
            borderWidth: 0,
            drawTime: 'beforeDatasetsDraw' as const,
          },
        }
      : {
          [key]: {
            type: 'box' as const,
            yMin: from,
            yMax: to,
            backgroundColor: color,
            borderWidth: 0,
            drawTime: 'beforeDatasetsDraw' as const,
          },
        }

  return {
    ...band('zoneNormal', 0, zones.normalMax, 'rgba(34, 197, 94, 0.22)'),
    ...band('zoneCaution', zones.normalMax, zones.cautionMax, 'rgba(0, 0, 0, 0)'),
    ...band('zoneAlert', zones.cautionMax, zones.chartMax, 'rgba(248, 113, 113, 0.22)'),
  }
}

/** 자동가동 기준선 — 적색 점선 */
export function thresholdLineAnnotation(
  thresholdPpm: number,
  axis: 'x' | 'y'
): Record<string, object> {
  if (axis === 'x') {
    return {
      autoRunLine: {
        type: 'line' as const,
        scaleID: 'x',
        value: thresholdPpm,
        borderColor: 'rgb(239, 68, 68)',
        borderWidth: 1.5,
        borderDash: [6, 4],
        drawTime: 'afterDatasetsDraw' as const,
      },
    }
  }
  return {
    autoRunLine: {
      type: 'line' as const,
      scaleID: 'y',
      value: thresholdPpm,
      borderColor: 'rgb(239, 68, 68)',
      borderWidth: 1.5,
      borderDash: [6, 4],
      drawTime: 'afterDatasetsDraw' as const,
    },
  }
}
