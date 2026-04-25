/**
 * Live2D parameter panel — lists all model parameters with real-time sliders.
 */

import { useEditor } from './EditorProvider';

export function ParameterPanel() {
  const { modelLoaded, paramValues, setParameter } = useEditor();

  if (!modelLoaded) return null;

  const ids = Object.keys(paramValues);
  if (ids.length === 0) return null;

  return (
    <div className="live2d-param-panel">
      <div className="live2d-param-panel__title">参数列表</div>
      <div className="live2d-param-list">
        {ids.map((id) => (
          <ParameterSlider key={id} paramId={id} value={paramValues[id]} onChange={setParameter} />
        ))}
      </div>
    </div>
  );
}

function ParameterSlider({
  paramId,
  value,
  onChange,
}: {
  paramId: string;
  value: number;
  onChange: (id: string, val: number) => void;
}) {
  // Clamp to a reasonable range; Cubism params are typically [-30, 30] or [-1, 1]
  const min = -30;
  const max = 30;

  return (
    <div className="live2d-param-item">
      <label className="live2d-param-label" title={paramId}>
        {paramId.length > 18 ? `${paramId.slice(0, 16)}…` : paramId}
      </label>
      <input
        type="range"
        className="live2d-param-slider"
        min={min}
        max={max}
        step={0.1}
        value={value}
        onChange={(e) => onChange(paramId, Number(e.target.value))}
      />
      <span className="live2d-param-value">{value.toFixed(2)}</span>
    </div>
  );
}
