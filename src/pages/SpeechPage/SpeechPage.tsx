import { useState } from 'react';
import { SettingCard } from '../../components/settings/SettingCard/SettingCard';
import { SettingRow } from '../../components/settings/SettingRow/SettingRow';
import { ToggleSwitch } from '../../components/settings/ToggleSwitch/ToggleSwitch';
import type { LabConfig } from '../../services/config/labConfig';

interface SpeechPanelProps {
  labConfig: LabConfig | null;
  onSaveLabConfig: (config: LabConfig) => void;
}

export function SpeechPanel({ labConfig, onSaveLabConfig }: SpeechPanelProps) {
  const [asr, setAsr] = useState(labConfig?.asr ?? null);
  const [tts, setTts] = useState(labConfig?.agent.tts ?? null);
  const [qwenTts, setQwenTts] = useState(labConfig?.agent.qwen_tts ?? null);

  if (!labConfig || !asr || !tts || !qwenTts) {
    return <p style={{ color: 'var(--muted)', fontSize: 14 }}>正在加载配置…</p>;
  }

  function handleSave() {
    if (!labConfig || !asr || !tts || !qwenTts) return;
    onSaveLabConfig({
      ...labConfig,
      asr,
      agent: { ...labConfig.agent, tts, qwen_tts: qwenTts },
    });
  }

  return (
    <>
      <div className="group-title group-title--standalone">ASR 语音识别</div>

      <SettingCard>
        <SettingRow name="推理设备" description="cpu 或 cuda" icon="💻">
          <div className="driver-select-wrap">
            {(['cpu', 'cuda'] as const).map((d) => (
              <button
                key={d}
                type="button"
                className={`driver-option${asr.device === d ? ' driver-option--active' : ''}`}
                onClick={() => setAsr({ ...asr, device: d })}
              >
                {d}
              </button>
            ))}
          </div>
        </SettingRow>

        <SettingRow name="ASR 引擎" description="sherpa 或 qwen_asr" icon="🎙">
          <div className="driver-select-wrap">
            {(['sherpa', 'qwen_asr'] as const).map((p) => (
              <button
                key={p}
                type="button"
                className={`driver-option${asr.asr_model_provider === p ? ' driver-option--active' : ''}`}
                onClick={() => setAsr({ ...asr, asr_model_provider: p })}
              >
                {p}
              </button>
            ))}
          </div>
        </SettingRow>

        <SettingRow name="FFMPEG 路径" description="ffmpeg 可执行文件路径或命令名" icon="🎬">
          <input
            className="proxy-input"
            value={asr.FFMPEG_PATH}
            onChange={(e) => setAsr({ ...asr, FFMPEG_PATH: e.target.value })}
          />
        </SettingRow>

        <SettingRow name="句子分割" description="超过此长度时分段" icon="✂">
          <input
            className="proxy-input"
            type="number"
            value={asr.max_sentence_length}
            onChange={(e) => setAsr({ ...asr, max_sentence_length: Number(e.target.value) })}
          />
        </SettingRow>
      </SettingCard>

      {asr.asr_model_provider === 'sherpa' ? (
        <>
          <div className="group-title">Sherpa-ONNX 配置</div>
          <SettingCard>
            <SettingRow name="模型目录" icon="📂">
              <input
                className="proxy-input workspace-input"
                value={asr.sherpa.asr_model_dir}
                onChange={(e) => setAsr({ ...asr, sherpa: { ...asr.sherpa, asr_model_dir: e.target.value } })}
              />
            </SettingRow>
            <SettingRow name="线程数" icon="⚡">
              <input
                className="proxy-input"
                type="number"
                value={asr.sherpa.num_threads}
                onChange={(e) => setAsr({ ...asr, sherpa: { ...asr.sherpa, num_threads: Number(e.target.value) } })}
              />
            </SettingRow>
          </SettingCard>
        </>
      ) : null}

      {asr.asr_model_provider === 'qwen_asr' ? (
        <>
          <div className="group-title">Qwen ASR 配置</div>
          <SettingCard>
            <SettingRow name="推理设备" description="CPU 或 GPU" icon="💻">
              <div className="driver-select-wrap">
                {(['CPU', 'GPU'] as const).map((d) => (
                  <button
                    key={d}
                    type="button"
                    className={`driver-option${asr.qwen_asr.device === d ? ' driver-option--active' : ''}`}
                    onClick={() => setAsr({ ...asr, qwen_asr: { ...asr.qwen_asr, device: d } })}
                  >
                    {d}
                  </button>
                ))}
              </div>
            </SettingRow>
            <SettingRow name="0.6B 模型路径" icon="📂">
              <input
                className="proxy-input workspace-input"
                value={asr.qwen_asr.model_0_6b_path}
                onChange={(e) => setAsr({ ...asr, qwen_asr: { ...asr.qwen_asr, model_0_6b_path: e.target.value } })}
              />
            </SettingRow>
            <SettingRow name="1.7B 模型路径" icon="📂">
              <input
                className="proxy-input workspace-input"
                value={asr.qwen_asr.model_1_7b_path}
                onChange={(e) => setAsr({ ...asr, qwen_asr: { ...asr.qwen_asr, model_1_7b_path: e.target.value } })}
              />
            </SettingRow>
          </SettingCard>
        </>
      ) : null}

      <div className="group-title">TTS 语音合成</div>

      <SettingCard>
        <SettingRow name="TTS 引擎" description="gsv_lite / genie_tts / qwen_tts" icon="🔊">
          <div className="driver-select-wrap">
            {(['gsv_lite', 'genie_tts', 'qwen_tts'] as const).map((p) => (
              <button
                key={p}
                type="button"
                className={`driver-option${tts.provider === p ? ' driver-option--active' : ''}`}
                onClick={() => setTts({ ...tts, provider: p })}
              >
                {p}
              </button>
            ))}
          </div>
        </SettingRow>

        <SettingRow name="声音资源目录" icon="📂">
          <input
            className="proxy-input workspace-input"
            value={tts.voice_assets_root}
            onChange={(e) => setTts({ ...tts, voice_assets_root: e.target.value })}
          />
        </SettingRow>
      </SettingCard>

      {tts.provider === 'genie_tts' ? (
        <>
          <div className="group-title">Genie TTS 配置</div>
          <SettingCard>
            <SettingRow name="语言" description="auto / zh / en / ja …" icon="🌍">
              <input
                className="proxy-input"
                value={tts.genie_tts.language}
                onChange={(e) => setTts({ ...tts, genie_tts: { ...tts.genie_tts, language: e.target.value } })}
              />
            </SettingRow>
            <SettingRow name="使用 RoBERTa" icon="🔢">
              <ToggleSwitch
                label="使用 RoBERTa"
                checked={tts.genie_tts.use_roberta}
                onChange={(next) => setTts({ ...tts, genie_tts: { ...tts.genie_tts, use_roberta: next } })}
              />
            </SettingRow>
            <SettingRow name="ONNX 线程数" icon="⚡">
              <input
                className="proxy-input"
                type="number"
                value={tts.genie_tts.onnx_intra_threads}
                onChange={(e) => setTts({ ...tts, genie_tts: { ...tts.genie_tts, onnx_intra_threads: Number(e.target.value) } })}
              />
            </SettingRow>
          </SettingCard>
        </>
      ) : null}

      {tts.provider === 'qwen_tts' ? (
        <>
          <div className="group-title">Qwen TTS 配置</div>
          <SettingCard>
            <SettingRow name="推理设备" description="cuda 或 cpu" icon="💻">
              <div className="driver-select-wrap">
                {(['cuda', 'cpu'] as const).map((d) => (
                  <button
                    key={d}
                    type="button"
                    className={`driver-option${qwenTts.device === d ? ' driver-option--active' : ''}`}
                    onClick={() => setQwenTts({ ...qwenTts, device: d })}
                  >
                    {d}
                  </button>
                ))}
              </div>
            </SettingRow>
            <SettingRow name="默认模型" description="0.6b 或 1.7b" icon="🤖">
              <div className="driver-select-wrap">
                {(['0.6b', '1.7b'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    className={`driver-option${qwenTts.model_name === m ? ' driver-option--active' : ''}`}
                    onClick={() => setQwenTts({ ...qwenTts, model_name: m })}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </SettingRow>
            <SettingRow name="CUDA Graphs 预热" icon="🔥">
              <ToggleSwitch
                label="CUDA Graphs 预热"
                checked={qwenTts.warmup_cuda_graphs}
                onChange={(next) => setQwenTts({ ...qwenTts, warmup_cuda_graphs: next })}
              />
            </SettingRow>
            <SettingRow name="0.6B 模型路径" icon="📂">
              <input
                className="proxy-input workspace-input"
                value={qwenTts.model_0_6b_path}
                onChange={(e) => setQwenTts({ ...qwenTts, model_0_6b_path: e.target.value })}
              />
            </SettingRow>
            <SettingRow name="1.7B 模型路径" icon="📂">
              <input
                className="proxy-input workspace-input"
                value={qwenTts.model_1_7b_path}
                onChange={(e) => setQwenTts({ ...qwenTts, model_1_7b_path: e.target.value })}
              />
            </SettingRow>
          </SettingCard>
        </>
      ) : null}

      <div className="settings-save-row">
        <button type="button" className="settings-save-button" onClick={handleSave}>
          保存
        </button>
      </div>

      <div className="footer-space" />
    </>
  );
}
