import { useState } from 'react';
import { useEditor } from './EditorProvider';
import type { ExpressionPresetConfig, ExpressionRole } from './EditorProvider';

const roleLabels: Record<ExpressionRole, string> = {
  expression: '临时表情',
  appearance: '持久外观',
  system: '默认启动',
  watermark: '水印/版权',
  test: '测试/排除',
  unknown: '未分类',
};

const roleFilterLabels: Record<ExpressionRole | 'all', string> = {
  all: '全部',
  ...roleLabels,
};

export function ExpressionPanel() {
  const {
    modelLoaded,
    expressionMetas,
    expressionConfigs,
    activeExpressionPreviews,
    previewExpression,
    updateExpressionConfig,
    timelinePlayback,
    expressionSegmentMarkers,
    segmentExpressionKeyAtTime,
    segmentExpressionKeysAtTime,
    assignExpressionToSegmentAtTime,
  } = useEditor();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [roleFilter, setRoleFilter] = useState<ExpressionRole | 'all'>('all');
  const roleCounts = expressionMetas.reduce<Record<ExpressionRole | 'all', number>>((counts, meta) => {
    const role = expressionConfigs[meta.name]?.role ?? 'unknown';
    counts.all += 1;
    counts[role] += 1;
    return counts;
  }, {
    all: 0,
    expression: 0,
    appearance: 0,
    system: 0,
    watermark: 0,
    test: 0,
    unknown: 0,
  });
  const filteredExpressionMetas = roleFilter === 'all'
    ? expressionMetas
    : expressionMetas.filter((meta) => (expressionConfigs[meta.name]?.role ?? 'unknown') === roleFilter);

  return (
    <div className="live2d-param-panel">
      <div className="live2d-param-panel__title">
        <span>EXP 列表</span>
        {modelLoaded && <span className="live2d-expression-count">{filteredExpressionMetas.length}/{expressionMetas.length}</span>}
      </div>
      {modelLoaded && expressionMetas.length > 0 && (
        <div className="live2d-expression-filters">
          {(Object.keys(roleFilterLabels) as Array<ExpressionRole | 'all'>).map((role) => (
            <button
              key={role}
              type="button"
              className={`live2d-expression-filter${roleFilter === role ? ' live2d-expression-filter--active' : ''}`}
              onClick={() => setRoleFilter(role)}
              disabled={role !== 'all' && roleCounts[role] === 0}
              title={roleFilterLabels[role]}
            >
              <span>{roleFilterLabels[role]}</span>
              <span className="live2d-expression-filter__count">{roleCounts[role]}</span>
            </button>
          ))}
        </div>
      )}
      <div className="live2d-expression-list">
        {!modelLoaded ? (
          <div className="live2d-panel-empty">加载模型后显示</div>
        ) : expressionMetas.length === 0 ? (
          <div className="live2d-panel-empty">没有找到 exp3 表情；若模型把 exp 放在其它目录，请导入包含 exp 目录的调用版/适配版 model3。</div>
        ) : filteredExpressionMetas.length === 0 ? (
          <div className="live2d-panel-empty">该分类下暂无 exp 表情</div>
        ) : (
          filteredExpressionMetas.map((meta) => {
            const config = expressionConfigs[meta.name];
            const isExpanded = expanded === meta.name;
            const expressionPreviewKey = meta.name || meta.file;
            const isPreviewing = activeExpressionPreviews.includes(expressionPreviewKey);
            const isSegmentAssigned = segmentExpressionKeysAtTime(timelinePlayback.totalTime).includes(expressionPreviewKey);
            return (
              <div key={`${meta.name}:${meta.file}`} className="live2d-expression-card">
                <div className="live2d-expression-head">
                  <button
                    type="button"
                    className="live2d-expression-expand"
                    onClick={() => setExpanded(isExpanded ? null : meta.name)}
                    title="查看参数包"
                  >
                    {isExpanded ? '▾' : '▸'}
                  </button>
                  <div className="live2d-expression-title">
                    <span className="live2d-expression-name" title={meta.name}>{config?.label || meta.name}</span>
                    <span className="live2d-expression-file" title={meta.file}>{meta.file}</span>
                  </div>
                  {timelinePlayback.totalDuration > 0 && (
                    <button
                      type="button"
                      className={`live2d-btn live2d-btn--xs${isSegmentAssigned ? ' live2d-expression-preview--active' : ''}`}
                      onClick={() => {
                        assignExpressionToSegmentAtTime(timelinePlayback.totalTime, expressionPreviewKey);
                      }}
                      title={isSegmentAssigned ? '从当前片段移除表情' : '分配给当前时间线片段'}
                    >
                      ◆
                    </button>
                  )}
                  <button
                    type="button"
                    className={`live2d-btn live2d-btn--xs${isPreviewing ? ' live2d-expression-preview--active' : ''}`}
                    onClick={() => previewExpression(expressionPreviewKey)}
                    disabled={meta.parameters.length === 0}
                  >
                    {isPreviewing ? '取消预览' : '预览'}
                  </button>
                </div>

                <div className="live2d-expression-tags">
                  <span>{meta.parameters.length} 参数</span>
                  {meta.guessedTags.map((tag) => <span key={tag}>{tag}</span>)}
                  {meta.parseError && <span className="live2d-expression-tag--warn">解析失败</span>}
                </div>

                {config && (
                  <ExpressionConfigControls
                    config={config}
                    onChange={(patch) => updateExpressionConfig(meta.name, patch)}
                  />
                )}

                {isExpanded && (
                  <div className="live2d-expression-ops">
                    {meta.parseError ? (
                      <div className="live2d-panel-empty">{meta.parseError}</div>
                    ) : meta.parameters.length === 0 ? (
                      <div className="live2d-panel-empty">该 exp 没有可识别参数</div>
                    ) : (
                      meta.parameters.map((operation) => (
                        <div key={`${operation.id}:${operation.blend}:${operation.value}`} className="live2d-expression-op">
                          <span title={operation.id}>{operation.id}</span>
                          <span>{operation.blend}</span>
                          <span>{operation.value.toFixed(3)}</span>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function ExpressionConfigControls({
  config,
  onChange,
}: {
  config: ExpressionPresetConfig;
  onChange: (patch: Partial<Omit<ExpressionPresetConfig, 'name' | 'file'>>) => void;
}) {
  return (
    <div className="live2d-expression-config">
      <input
        type="text"
        className="live2d-expression-input"
        value={config.label}
        title="显示名称 / emotionMap key"
        onChange={(event) => onChange({ label: event.target.value })}
      />
      <select
        className="live2d-expression-select"
        value={config.role}
        onChange={(event) => onChange({ role: event.target.value as ExpressionRole })}
      >
        {Object.entries(roleLabels).map(([value, label]) => (
          <option key={value} value={value}>{label}</option>
        ))}
      </select>
      <input
        type="text"
        className="live2d-expression-input live2d-expression-input--desc"
        value={config.description ?? ''}
        placeholder="说明"
        onChange={(event) => onChange({ description: event.target.value })}
      />
    </div>
  );
}
