import { render, screen } from '@testing-library/react';
import { ToolsPage } from './ToolsPage';

const loadPreview = vi.hoisted(() => vi.fn());

vi.mock('./Live2DPreviewTool', () => {
  loadPreview();
  return {
    Live2DPreviewTool: ({ isActive }: { isActive: boolean }) => (
      <input aria-label="preview" data-active={String(isActive)} />
    ),
  };
});

it('defers the saved preview until tools are opened and keeps it mounted afterwards', async () => {
  localStorage.setItem('live2d.activeTool', 'live2d');
  try {
    const { rerender } = render(<ToolsPage isActive={false} />);
    expect(loadPreview).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('preview')).not.toBeInTheDocument();

    rerender(<ToolsPage isActive />);
    const preview = await screen.findByLabelText('preview');
    expect(loadPreview).toHaveBeenCalledTimes(1);
    expect(preview).toHaveAttribute('data-active', 'true');

    rerender(<ToolsPage isActive={false} />);
    expect(screen.getByLabelText('preview')).toBe(preview);
    expect(preview).toHaveAttribute('data-active', 'false');
  } finally {
    localStorage.removeItem('live2d.activeTool');
  }
});
