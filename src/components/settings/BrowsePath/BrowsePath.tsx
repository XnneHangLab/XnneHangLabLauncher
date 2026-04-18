interface BrowsePathProps {
  value: string;
  onChange: (v: string) => void;
  onBrowse: () => Promise<void>;
  wide?: boolean;
}

export function BrowsePath({ value, onChange, onBrowse, wide = false }: BrowsePathProps) {
  return (
    <div className="browse-wrap">
      <input
        className={`proxy-input${wide ? ' workspace-input' : ''}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <button type="button" className="browse-btn" onClick={onBrowse}>…</button>
    </div>
  );
}
