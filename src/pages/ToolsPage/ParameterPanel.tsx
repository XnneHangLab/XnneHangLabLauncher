import { useMemo, useState } from 'react';
import { useEditor } from './EditorProvider';
import type { ParamMeta } from './EditorProvider';

const groupLabels: Record<ParamMeta['group'], string> = {
  standard: '常用控制',
  expression: '表情绑定',
  motion: '动作参数',
  all: '全部参数',
};

export function ParameterPanel() {
  const { modelLoaded, paramValues, paramRanges, paramMetas, isPlaying, setParameter, resetAllParameters } = useEditor();
  const [showAll, setShowAll] = useState(false);

  const visibleMetas = useMemo(() => {
    const metas = paramMetas.length > 0
      ? paramMetas
      : Object.keys(paramValues).map((id) => ({ id, label: id, group: 'all' as const, sources: ['全部'] }));
    return showAll ? metas : metas.filter((meta) => meta.group !== 'all');
  }, [paramMetas, paramValues, showAll]);

  const ids = Object.keys(paramValues);

  return (
    <div className="live2d-param-panel">
      <div className="live2d-param-panel__title">
        <span>参数</span>
        <div className="live2d-param-actions">
          {modelLoaded && paramMetas.some((meta) => meta.group === 'all') && (
            <button type="button" className="live2d-param-reset-all" onClick={() => setShowAll((value) => !value)}>
              {showAll ? '隐藏全部' : '显示全部'}
            </button>
          )}
          {modelLoaded && ids.length > 0 && (
            <button
              type="button"
              className="live2d-param-reset-all"
              onClick={resetAllParameters}
              disabled={isPlaying}
              title={isPlaying ? '播放动作时暂不支持全部重置，避免重写 motion 基线' : '全部重置为默认参数'}
            >
              全部重置
            </button>
          )}
        </div>
      </div>
      <div className="live2d-param-list">
        {!modelLoaded || ids.length === 0 ? (
          <div className="live2d-panel-empty">加载模型后显示</div>
        ) : visibleMetas.length === 0 ? (
          <div className="live2d-panel-empty">没有可用参数，点击「显示全部」查看原始参数</div>
        ) : (
          visibleMetas.map((meta, index) => {
            const previous = visibleMetas[index - 1];
            const range = paramRanges[meta.id] ?? { min: -30, max: 30, default: 0 };
            return (
              <div key={meta.id}>
                {previous?.group !== meta.group && (
                  <div className="live2d-param-group-title">{groupLabels[meta.group]}</div>
                )}
                <ParameterSlider
                  meta={meta}
                  value={paramValues[meta.id]}
                  min={range.min}
                  max={range.max}
                  defaultValue={range.default}
                  onChange={setParameter}
                />
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function ParameterSlider({
  meta,
  value,
  min,
  max,
  defaultValue,
  onChange,
}: {
  meta: ParamMeta;
  value: number;
  min: number;
  max: number;
  defaultValue: number;
  onChange: (id: string, val: number) => void;
}) {
  const step = (max - min) / 200;
  const changed = Math.abs(value - defaultValue) > Math.max(step / 2, 0.001);
  const sourceText = meta.sources.join('、');
  const title = `${meta.label}\n${meta.id}\n${sourceText}\n[${min.toFixed(1)}, ${max.toFixed(1)}]`;

  function commitInput(valueText: string) {
    const nextValue = Number(valueText);
    if (Number.isFinite(nextValue)) onChange(meta.id, nextValue);
  }

  return (
    <div className="live2d-param-item">
      <label className="live2d-param-label" title={title}>
        <span className="live2d-param-label__name">{meta.label}</span>
        {meta.label !== meta.id && <span className="live2d-param-label__id">{meta.id}</span>}
      </label>
      <input
        type="range"
        className="live2d-param-slider"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(meta.id, Number(e.target.value))}
        onDoubleClick={() => onChange(meta.id, defaultValue)}
      />
      <input
        type="number"
        className="live2d-param-number"
        min={min}
        max={max}
        step={step}
        value={Number(value.toFixed(2))}
        onChange={(e) => commitInput(e.target.value)}
        onDoubleClick={() => onChange(meta.id, defaultValue)}
      />
      <button
        type="button"
        className="live2d-param-reset"
        title={changed ? '已修改，点击重置为默认值' : '当前为默认值'}
        onClick={() => onChange(meta.id, defaultValue)}
      >
        {changed ? '●' : '↺'}
      </button>
    </div>
  );
}
