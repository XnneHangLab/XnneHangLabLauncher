import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { ProfilesPage } from './ProfilesPage';
import labConfig from '../../test/fixtures/lab-config.json';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), convertFileSrc: (path: string) => path }));

it('keeps empty OCR input visible, rejects invalid saves, and saves a valid integer', async () => {
  const user = userEvent.setup();
  vi.mocked(invoke).mockImplementation(async (command) => {
    if (command === 'list_profiles') return [{ file: 'test', character_name: 'Test', description: '', avatar: '', avatar_abs_path: null }];
    if (command === 'read_lab_config') return labConfig;
    if (command === 'read_profile') return {
      profile: { description: 'test' },
      plugins: { enabled: ['screen_shot'], screen_shot: { enable_ocr: false, ocr_threads: 2 } },
    };
    if (command === 'read_live2d_presets') return [];
    return undefined;
  });
  render(<ProfilesPage />);
  const row = (await screen.findByText('screen_shot')).closest('.plugin-item') as HTMLElement;
  await user.click(within(row).getByRole('button', { name: '›' }));
  const input = screen.getByRole('spinbutton', { name: 'ocr_threads' });
  expect(input).toHaveAttribute('min', '1');
  expect(input).toHaveAttribute('max', '32');
  expect(input).toHaveAttribute('step', '1');

  for (const value of ['', '0', '33', '1.5']) {
    await user.clear(input);
    expect(input).toHaveValue(null);
    if (value) await user.type(input, value);
    await user.click(screen.getByRole('button', { name: '保存' }));
    expect(await screen.findByText('OCR 线程数必须是 1–32 的整数，请填写后再保存。')).toBeInTheDocument();
    expect(vi.mocked(invoke).mock.calls.filter(([command]) => command === 'write_profile')).toHaveLength(0);
  }

  await user.clear(input);
  await user.type(input, '32');
  await user.click(screen.getByRole('button', { name: '保存' }));
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('write_profile', {
    file: 'test',
    config: {
      profile: { description: 'test' },
      plugins: { enabled: ['screen_shot'], screen_shot: { enable_ocr: false, ocr_threads: 32 } },
    },
  }));
  expect(screen.queryByText('OCR 线程数必须是 1–32 的整数，请填写后再保存。')).not.toBeInTheDocument();
});
