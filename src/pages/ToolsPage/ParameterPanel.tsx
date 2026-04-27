import { useEditor } from './EditorProvider';

export function ParameterPanel() {
  const { modelLoaded, paramValues, paramRanges, setParameter } = useEditor();

  const ids = Object.keys(paramValues);

  return (
    <div className="live2d-param-panel">
      <div className="live2d-param-panel__title">参数</div>
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
        step={(max - min) / 200}
        value={value}
        onChange={(e) => onChange(paramId, Number(e.target.value))}
        onDoubleClick={() => onChange(paramId, defaultValue)}
      />
      <span className="live2d-param-value">{value.toFixed(2)}</span>
    </div>
  );
}
