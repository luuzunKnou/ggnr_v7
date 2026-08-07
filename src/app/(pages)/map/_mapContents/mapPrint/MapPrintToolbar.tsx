'use client';

import {
  MapPin,
  MessageSquareText,
  Ruler,
  Square,
  Mountain,
  TrendingUp,
  CircleDot,
  Spline,
  RectangleHorizontal,
  Pentagon,
  Circle,
  Crosshair,
  Scissors,
  Undo2,
  Redo2,
  RotateCcw,
  ImageDown,
  Printer,
  Layers,
  Globe,
  X,
} from 'lucide-react';
import { DEFAULT_PRINT_COLOR, type MapPrintTool } from './mapPrintTypes';

type Props = {
  color: string;
  onColorChange: (c: string) => void;
  activeTool: MapPrintTool;
  onToolChange: (t: MapPrintTool) => void;
  onCoordOpen: () => void;
  onDeleteSelected: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onClear: () => void;
  onSaveImage: () => void;
  onPrint: () => void;
  onClearLayers: () => void;
  onToggleLayers: () => void;
  onToggleBackground: () => void;
  onClose: () => void;
  layerPanelOpen: boolean;
  backgroundPanelOpen: boolean;
};

function ToolBtn({
  active,
  title,
  onClick,
  children,
  className = '',
}: {
  active?: boolean;
  title: string;
  onClick: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      className={`map-print-tool-btn${active ? ' is-active' : ''}${className ? ` ${className}` : ''}`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export function MapPrintToolbar({
  color,
  onColorChange,
  activeTool,
  onToolChange,
  onCoordOpen,
  onDeleteSelected,
  onUndo,
  onRedo,
  onClear,
  onSaveImage,
  onPrint,
  onClearLayers,
  onToggleLayers,
  onToggleBackground,
  onClose,
  layerPanelOpen,
  backgroundPanelOpen,
}: Props) {
  const toggle = (t: MapPrintTool) => onToolChange(activeTool === t ? null : t);

  return (
    <div className="map-print-toolbar map-print-ignore">
      <div className="map-print-toolbar-left">
        <label className="map-print-tool-btn map-print-color-btn" title="색상 수정">
          <span
            className="map-print-color-swatch"
            style={{ background: color || DEFAULT_PRINT_COLOR }}
          >
            <input
              type="color"
              value={color || DEFAULT_PRINT_COLOR}
              onChange={(e) => onColorChange(e.target.value)}
              aria-label="색상 수정"
            />
          </span>
          색상
        </label>
        <span className="map-print-vsep" />
        <ToolBtn active={activeTool === 'symbol'} title="위치 선택" onClick={() => toggle('symbol')}>
          <MapPin />
          위치 선택
        </ToolBtn>
        <ToolBtn active={activeTool === 'comment'} title="글자 입력" onClick={() => toggle('comment')}>
          <MessageSquareText />
          글자 입력
        </ToolBtn>
        <span className="map-print-vsep" />
        <ToolBtn active={activeTool === 'distance'} title="거리 측정" onClick={() => toggle('distance')}>
          <Ruler />
          거리
        </ToolBtn>
        <ToolBtn active={activeTool === 'area'} title="면적 측정" onClick={() => toggle('area')}>
          <Square />
          면적
        </ToolBtn>
        <ToolBtn active={activeTool === 'elevation'} title="고도" onClick={() => toggle('elevation')}>
          <Mountain />
          고도
        </ToolBtn>
        <ToolBtn active={activeTool === 'slope'} title="경사도" onClick={() => toggle('slope')}>
          <TrendingUp />
          경사도
        </ToolBtn>
        <span className="map-print-vsep" />
        <ToolBtn active={activeTool === 'point'} title="점" onClick={() => toggle('point')}>
          <CircleDot />
          점
        </ToolBtn>
        <ToolBtn active={activeTool === 'line'} title="선" onClick={() => toggle('line')}>
          <Spline />
          선
        </ToolBtn>
        <ToolBtn active={activeTool === 'box'} title="직사각형" onClick={() => toggle('box')}>
          <RectangleHorizontal />
          직사각형
        </ToolBtn>
        <ToolBtn active={activeTool === 'polygon'} title="다각형" onClick={() => toggle('polygon')}>
          <Pentagon />
          다각형
        </ToolBtn>
        <ToolBtn active={activeTool === 'square'} title="정사각형" onClick={() => toggle('square')}>
          <Square />
          정사각형
        </ToolBtn>
        <ToolBtn active={activeTool === 'circle'} title="원" onClick={() => toggle('circle')}>
          <Circle />
          원
        </ToolBtn>
        <span className="map-print-vsep" />
        <ToolBtn title="좌표 입력" onClick={onCoordOpen}>
          <Crosshair />
          좌표 입력
        </ToolBtn>
        <ToolBtn active={activeTool === 'select'} title="선택 삭제" onClick={() => toggle('select')}>
          <Scissors />
          선택 삭제
        </ToolBtn>
        {activeTool === 'select' && (
          <ToolBtn title="선택 항목 삭제" onClick={onDeleteSelected}>
            삭제 실행
          </ToolBtn>
        )}
        <ToolBtn title="되돌리기" onClick={onUndo}>
          <Undo2 />
          되돌리기
        </ToolBtn>
        <ToolBtn title="다시 실행" onClick={onRedo}>
          <Redo2 />
          다시 실행
        </ToolBtn>
        <ToolBtn title="초기화" onClick={onClear}>
          <RotateCcw />
          초기화
        </ToolBtn>
        <span className="map-print-vsep" />
        <ToolBtn title="이미지 저장" onClick={onSaveImage}>
          <ImageDown />
          이미지 저장
        </ToolBtn>
      </div>

      <div className="map-print-toolbar-right">
        <ToolBtn title="인쇄" onClick={onPrint}>
          <Printer />
          인쇄
        </ToolBtn>
        <span className="map-print-vsep" />
        <ToolBtn title="레이어 모두 끄기" onClick={onClearLayers} className="map-print-tool-icon">
          <span className="map-print-layers-clear" aria-hidden>
            <Layers />
            <span className="map-print-slash" />
          </span>
        </ToolBtn>
        <ToolBtn
          active={layerPanelOpen}
          title="업무지도"
          onClick={onToggleLayers}
          className="map-print-tool-icon"
        >
          <Layers />
        </ToolBtn>
        <ToolBtn
          active={backgroundPanelOpen}
          title="배경지도"
          onClick={onToggleBackground}
          className="map-print-tool-icon"
        >
          <Globe />
        </ToolBtn>
        <ToolBtn title="닫기" onClick={onClose} className="map-print-close-btn">
          <X />
          닫기
        </ToolBtn>
      </div>
    </div>
  );
}
