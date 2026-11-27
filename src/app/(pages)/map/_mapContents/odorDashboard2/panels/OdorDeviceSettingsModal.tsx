'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { MAP_UI_Z_CLASS } from '@/lib/mapUiZIndex'

const GARAM_AGENCY = '가람환경기술'

type GaramSwitchRow = {
  key: 'manualMode' | 'stopped' | 'blowerOn'
  label: string
  onLabel: string
  offLabel: string
  desc: string
  note: string
}

/** on/off 스위치로 묶은 가람 명령 (임계값 설정은 별도) */
const GARAM_SWITCHES: GaramSwitchRow[] = [
  {
    key: 'manualMode',
    label: '수동 모드',
    onLabel: '수동',
    offLabel: '자동',
    desc: 'ON: 자동 제어 해제·수동 조작 / OFF: H2S 기반 자동 송풍',
    note: '이미 동일 모드면 무시. 반영은 약 5초 이내',
  },
  {
    key: 'stopped',
    label: '정지',
    onLabel: '정지',
    offLabel: '가동',
    desc: '송풍기·측정펌프 전체 정지',
    note: '정지 시 즉시 전송 — 해당 프레임 측정값은 0',
  },
  {
    key: 'blowerOn',
    label: '송풍기 수동',
    onLabel: '가동',
    offLabel: '정지',
    desc: '1번 릴레이(송풍기) 강제 ON/OFF',
    note: '5분 수동 오버라이드 후 자동 복귀. 재수신 시 5분 연장',
  },
]

export type OdorDeviceCommonSettings = {
  startPpm: number
  stopPpm: number
  durationMin: number
  collectCycleMin: number
  manualActionMin: number
  thresholdOn: number
  thresholdOff: number
}

const DEFAULT_SETTINGS: OdorDeviceCommonSettings = {
  startPpm: 3,
  stopPpm: 1.5,
  durationMin: 1,
  collectCycleMin: 10,
  manualActionMin: 5,
  thresholdOn: 5,
  thresholdOff: 2,
}

type Props = {
  open: boolean
  agency: string
  sensorLabel: string
  onClose: () => void
}

function FieldRow({
  label,
  children,
  hint,
}: {
  label: string
  children: ReactNode
  hint?: string
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center justify-between gap-2">
        <span className="shrink-0 text-[11px] font-medium text-muted-foreground">{label}</span>
        {children}
      </div>
      {hint ? <p className="text-[10px] text-muted-foreground">{hint}</p> : null}
    </div>
  )
}

/** 네모 안 ON|OFF 글자 스위치 (예: 수동|자동) */
function LabeledSquareSwitch({
  checked,
  onLabel,
  offLabel,
  disabled,
  title,
  onCheckedChange,
}: {
  checked: boolean
  onLabel: string
  offLabel: string
  disabled?: boolean
  title: string
  onCheckedChange: (checked: boolean) => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={title}
      title={title}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        'inline-flex h-7 shrink-0 cursor-pointer items-stretch overflow-hidden rounded border border-border',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
        'disabled:cursor-not-allowed disabled:opacity-50'
      )}
    >
      <span
        className={cn(
          'inline-flex min-w-[2.25rem] items-center justify-center px-1.5 text-[10px] font-semibold',
          checked
            ? 'bg-primary text-white'
            : 'bg-background text-muted-foreground'
        )}
      >
        {onLabel}
      </span>
      <span className="w-px self-stretch bg-border" aria-hidden />
      <span
        className={cn(
          'inline-flex min-w-[2.25rem] items-center justify-center px-1.5 text-[10px] font-semibold',
          !checked
            ? 'bg-primary text-white'
            : 'bg-background text-muted-foreground'
        )}
      >
        {offLabel}
      </span>
    </button>
  )
}

function NumInput({
  value,
  onChange,
  min,
  max,
  step,
  unit,
  disabled,
  title,
}: {
  value: number
  onChange: (n: number) => void
  min?: number
  max?: number
  step?: number
  unit?: string
  disabled?: boolean
  title: string
}) {
  return (
    <div className="flex items-center gap-1">
      <input
        type="number"
        title={title}
        value={Number.isFinite(value) ? value : ''}
        min={min}
        max={max}
        step={step ?? 0.1}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="standard-detail-input h-7 w-20 text-right tabular-nums disabled:cursor-not-allowed disabled:opacity-50"
      />
      {unit ? <span className="text-[10px] text-muted-foreground">{unit}</span> : null}
    </div>
  )
}

/**
 * 대시보드2 상세 — 측정 기기 설정 모달.
 * 가람환경기술 전용 명령 + 공통 농도/수집/수동 설정.
 */
type GaramSwitchState = {
  manualMode: boolean
  stopped: boolean
  blowerOn: boolean
}

const DEFAULT_GARAM_SWITCHES: GaramSwitchState = {
  manualMode: false,
  stopped: false,
  blowerOn: false,
}

export function OdorDeviceSettingsModal({ open, agency, sensorLabel, onClose }: Props) {
  const garamEnabled = agency === GARAM_AGENCY
  const [settings, setSettings] = useState<OdorDeviceCommonSettings>(DEFAULT_SETTINGS)
  const [garamSwitches, setGaramSwitches] =
    useState<GaramSwitchState>(DEFAULT_GARAM_SWITCHES)

  useEffect(() => {
    if (!open) return
    setSettings(DEFAULT_SETTINGS)
    setGaramSwitches(DEFAULT_GARAM_SWITCHES)
  }, [open, agency, sensorLabel])

  const patch = (partial: Partial<OdorDeviceCommonSettings>) => {
    setSettings((prev) => ({ ...prev, ...partial }))
  }

  /** 스위치는 초안만 반영 — 실제 전송은 «적용» */
  const toggleGaramSwitch = (key: keyof GaramSwitchState, checked: boolean) => {
    if (!garamEnabled) return
    setGaramSwitches((prev) => ({ ...prev, [key]: checked }))
  }

  /** 공통·가람 명령·임계값을 한 번에 적용 (목업). 성공 안내는 window.alert — 지도 쪽 공통 패턴 */
  const applyAll = () => {
    const { thresholdOn: on, thresholdOff: off } = settings
    if (garamEnabled) {
      if (on < 0 || on > 100 || off < 0 || off > 100 || !(on > off)) {
        window.alert('임계값 조건 위반 (0~100, ON > OFF). 설정을 확인한 뒤 다시 적용해 주세요.')
        return
      }
    }

    const lines = [
      `[${sensorLabel}] 설정이 적용되었습니다.`,
      '',
      '· 공통 설정',
      `  농도 ${settings.startPpm}/${settings.stopPpm} ppm · 지속 ${settings.durationMin}분`,
      `  수집 ${settings.collectCycleMin}분 · 수동 ${settings.manualActionMin}분`,
    ]
    if (garamEnabled) {
      lines.push(
        '',
        '· 가람환경기술 명령',
        `  모드 ${garamSwitches.manualMode ? '수동' : '자동'} · 정지 ${garamSwitches.stopped ? 'ON' : 'OFF'} · 송풍기 ${garamSwitches.blowerOn ? '가동' : '정지'}`,
        `  임계값 ON ${on} / OFF ${off} ppm`
      )
    }
    window.alert(lines.join('\n'))
    onClose()
  }

  if (!open || typeof document === 'undefined') return null

  return createPortal(
    <div
      className={cn(
        'fixed inset-0 flex items-center justify-center bg-black/40 p-3',
        MAP_UI_Z_CLASS.nestedDialog
      )}
      role="dialog"
      aria-modal="true"
      aria-label="측정 기기 설정"
      onClick={onClose}
    >
      <div
        className="flex max-h-[min(92vh,720px)] w-full max-w-4xl flex-col overflow-hidden rounded border border-border bg-background shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-2">
          <div className="min-w-0">
            <h3 className="truncate text-[13px] font-semibold text-foreground">측정 기기 설정</h3>
            <p className="truncate text-[10px] text-muted-foreground" title={`${sensorLabel} · ${agency}`}>
              {sensorLabel} · {agency || '미지정'}
            </p>
          </div>
          <button
            type="button"
            title="닫기"
            className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded text-muted-foreground hover:bg-muted"
            onClick={onClose}
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden px-3 py-2.5 sm:flex-row sm:items-stretch">
          <section className="flex min-h-0 min-w-0 flex-1 flex-col gap-1.5 overflow-hidden">
            <h4 className="shrink-0 text-[12px] font-semibold text-foreground">공통 설정</h4>
            <ul className="min-h-0 flex-1 overflow-hidden rounded border border-border">
              <li className="space-y-1.5 border-b border-border px-2 py-1.5">
                <p className="text-[11px] font-medium text-foreground">농도제어 (기준 1분)</p>
                <div className="flex flex-wrap items-center gap-3">
                  <FieldRow label="시작농도">
                    <NumInput
                      title="시작농도"
                      value={settings.startPpm}
                      min={0}
                      unit="ppm"
                      onChange={(n) => patch({ startPpm: n })}
                    />
                  </FieldRow>
                  <FieldRow label="정지농도">
                    <NumInput
                      title="정지농도"
                      value={settings.stopPpm}
                      min={0}
                      unit="ppm"
                      onChange={(n) => patch({ stopPpm: n })}
                    />
                  </FieldRow>
                  <FieldRow label="지속시간">
                    <NumInput
                      title="지속시간"
                      value={settings.durationMin}
                      min={1}
                      step={1}
                      unit="분"
                      onChange={(n) => patch({ durationMin: Math.max(1, Math.round(n) || 1) })}
                    />
                  </FieldRow>
                </div>
              </li>
              <li className="flex items-start gap-2 border-b border-border px-2 py-1.5">
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-medium text-foreground">수집주기</p>
                  <p className="text-[10px] text-muted-foreground">단위: 분</p>
                </div>
                <div className="flex shrink-0 items-start pt-0.5">
                  <NumInput
                    title="수집주기"
                    value={settings.collectCycleMin}
                    min={1}
                    step={1}
                    unit="분"
                    onChange={(n) => patch({ collectCycleMin: Math.max(1, Math.round(n) || 1) })}
                  />
                </div>
              </li>
              <li className="flex items-start gap-2 px-2 py-1.5">
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-medium text-foreground">수동 동작시간</p>
                  <p className="text-[10px] text-muted-foreground">수동제어 · 단위: 분</p>
                </div>
                <div className="flex shrink-0 items-start pt-0.5">
                  <NumInput
                    title="수동 동작시간"
                    value={settings.manualActionMin}
                    min={1}
                    step={1}
                    unit="분"
                    onChange={(n) => patch({ manualActionMin: Math.max(1, Math.round(n) || 1) })}
                  />
                </div>
              </li>
            </ul>
          </section>

          <section className="flex min-h-0 min-w-0 flex-1 flex-col gap-1.5 overflow-hidden">
            <div className="flex shrink-0 items-center justify-between gap-2">
              <h4 className="text-[12px] font-semibold text-foreground">가람환경기술 명령</h4>
              {!garamEnabled ? (
                <span className="text-[10px] text-muted-foreground">해당 업체만 활성</span>
              ) : null}
            </div>
            <ul className="min-h-0 flex-1 overflow-y-auto rounded border border-border">
              {GARAM_SWITCHES.map((row) => {
                const checked = garamSwitches[row.key]
                return (
                  <li
                    key={row.key}
                    className="flex items-start gap-2 border-b border-border px-2 py-1.5"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] font-medium text-foreground">{row.label}</p>
                      <p className="text-[10px] text-muted-foreground">{row.desc}</p>
                      <p className="text-[10px] text-muted-foreground/80">{row.note}</p>
                    </div>
                    <div className="flex shrink-0 items-start pt-0.5">
                      <LabeledSquareSwitch
                        checked={checked}
                        onLabel={row.onLabel}
                        offLabel={row.offLabel}
                        disabled={!garamEnabled}
                        title={`${row.label} ${checked ? row.onLabel : row.offLabel}`}
                        onCheckedChange={(v) => toggleGaramSwitch(row.key, v)}
                      />
                    </div>
                  </li>
                )
              })}
              <li className="space-y-1.5 px-2 py-1.5">
                <div className="min-w-0">
                  <p className="text-[11px] font-medium text-foreground">자동제어 임계값 설정</p>
                  <p className="text-[10px] text-muted-foreground">
                    H2S ≥ ON → 가동 / H2S ≤ OFF → 정지 (EC1·EC2 최대값 기준)
                  </p>
                  <p className="text-[10px] text-muted-foreground/80">
                    조건: 0~100, ON &gt; OFF. «적용» 시 함께 전송. 재부팅 후 유지
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <FieldRow label="ON 레벨">
                    <NumInput
                      title="ON 레벨"
                      value={settings.thresholdOn}
                      min={0}
                      max={100}
                      unit="ppm"
                      disabled={!garamEnabled}
                      onChange={(n) => patch({ thresholdOn: n })}
                    />
                  </FieldRow>
                  <FieldRow label="OFF 레벨">
                    <NumInput
                      title="OFF 레벨"
                      value={settings.thresholdOff}
                      min={0}
                      max={100}
                      unit="ppm"
                      disabled={!garamEnabled}
                      onChange={(n) => patch({ thresholdOff: n })}
                    />
                  </FieldRow>
                </div>
              </li>
            </ul>
          </section>
        </div>

        <div className="flex shrink-0 items-center justify-end gap-1.5 border-t border-border px-3 py-2">
          <button
            type="button"
            title="닫기"
            className="standard-detail-hdr-btn cursor-pointer"
            onClick={onClose}
          >
            닫기
          </button>
          <button
            type="button"
            title="적용"
            className="standard-detail-hdr-btn-save cursor-pointer"
            onClick={applyAll}
          >
            적용
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
