import { useEditor } from './EditorProvider';

export function ParameterPanel() {
  const { modelLoaded, paramValues, paramRanges, setParameter } = useEditor();

  const ids = Object.keys(paramValues);

  function resetAllParameters() {
    for (const id of ids) {
      const range = paramRanges[id] ?? { min: -30, max: 30, default: 0 };
      setParameter(id, range.default);
    }
  }

  return (
    <div className="live2d-param-panel">
      <div className="live2d-param-panel__title">
        <span>参数</span>
        {modelLoaded && ids.length > 0 && (
          <button type="button" className="live2d-param-reset-all" onClick={resetAllParameters}>
            全部重置
          </button>
        )}
      </div>
      <div className="live2d-param-list">
        {!modelLoaded || ids.length === 0 ? (
          <div className="live2d-panel-empty">加载模型后显示</div>
        ) : (
          ids.map((id) => {
            const range = paramRanges[id] ?? { min: -30, max: 30, default: 0 };
            return (
              <ParameterSlider
                key={id}
                paramId={id}
                value={paramValues[id]}
                min={range.min}
                max={range.max}
                defaultValue={range.default}
                onChange={setParameter}
              />
            );
          })
        )}
      </div>
    </div>
  );
}

function ParameterSlider({
  paramId,
  value,
  min,
  max,
  defaultValue,
  onChange,
}: {
  paramId: string;
  value: number;
  min: number;
  max: number;
  defaultValue: number;
  onChange: (id: string, val: number) => void;
}) {
  const label = paramId.length > 18 ? `${paramId.slice(0, 16)}…` : paramId;
  const step = (max - min) / 200;
  const changed = Math.abs(value - defaultValue) > Math.max(step / 2, 0.001);

  function commitInput(valueText: string) {
    const nextValue = Number(valueText);
    if (Number.isFinite(nextValue)) onChange(paramId, nextValue);
  }

  return (
    <div className="live2d-param-item">
      <label className="live2d-param-label" title={`${paramId}\n[${min.toFixed(1)}, ${max.toFixed(1)}]`}>
        {label}
      </label>
      <input
        type="range"
        className="live2d-param-slider"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(paramId, Number(e.target.value))}
        onDoubleClick={() => onChange(paramId, defaultValue)}
      />
      <input
        type="number"
        className="live2d-param-number"
        min={min}
        max={max}
        step={step}
        value={Number(value.toFixed(2))}
        onChange={(e) => commitInput(e.target.value)}
        onDoubleClick={() => onChange(paramId, defaultValue)}
      />
      <button
        type="button"
        className="live2d-param-reset"
        title={changed ? "已修改，点击重置为默认值" : "当前为默认值"}
        onClick={() => onChange(paramId, defaultValue)}
      >
        {changed ? '●' : '↺'}
      </button>
    </div>
  );
}
