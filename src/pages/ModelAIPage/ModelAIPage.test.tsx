import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ModelAIPanel } from './ModelAIPage';
import type { LabConfig } from '../../services/config/labConfig';
import labConfigFixture from '../../test/fixtures/lab-config.json';

const labConfig = labConfigFixture as LabConfig;

describe('ModelAIPanel', () => {
  it('saves an explicit chat thinking mode', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();

    render(<ModelAIPanel labConfig={structuredClone(labConfig)} onSaveLabConfig={onSave} />);

    const selects = screen.getAllByRole('combobox');
    const selectedThinking = selects.find((select) => (select as HTMLSelectElement).value === 'disabled');
    expect(selectedThinking).toBeDefined();

    await user.selectOptions(selectedThinking as HTMLSelectElement, 'enabled');
    await user.click(screen.getByRole('button', { name: '保存' }));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: expect.objectContaining({
          chat_model: expect.objectContaining({ thinking_mode: 'enabled' }),
        }),
      }),
    );
  });
});
