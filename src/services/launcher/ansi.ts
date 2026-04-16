const FG: Record<number, string> = {
  30: '#4d4d4d', 31: '#cc3333', 32: '#4ea64e', 33: '#c4a000',
  34: '#3465a4', 35: '#75507b', 36: '#06989a', 37: '#d3d7cf',
  90: '#888888', 91: '#ff5555', 92: '#5af542', 93: '#f1fa8c',
  94: '#8fa8d4', 95: '#ff79c6', 96: '#8be9fd', 97: '#ffffff',
};

const BG: Record<number, string> = {
  40: '#4d4d4d', 41: '#cc3333', 42: '#4ea64e', 43: '#c4a000',
  44: '#3465a4', 45: '#75507b', 46: '#06989a', 47: '#d3d7cf',
  100: '#888888', 101: '#ff5555', 102: '#5af542', 103: '#f1fa8c',
  104: '#8fa8d4', 105: '#ff79c6', 106: '#8be9fd', 107: '#ffffff',
};

function codesToStyle(codes: number[]): string {
  const parts: string[] = [];
  for (const c of codes) {
    if (c === 1) parts.push('font-weight:bold');
    else if (c === 2) parts.push('opacity:0.6');
    else if (c === 3) parts.push('font-style:italic');
    else if (c === 4) parts.push('text-decoration:underline');
    else if (FG[c]) parts.push(`color:${FG[c]}`);
    else if (BG[c]) parts.push(`background:${BG[c]}`);
  }
  return parts.join(';');
}

export function ansiToHtml(raw: string): string {
  const safe = raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  let html = '';
  let open = 0;
  const segments = safe.split(/(\x1b\[[0-9;]*m)/);

  for (const seg of segments) {
    const m = seg.match(/^\x1b\[([0-9;]*)m$/);
    if (!m) { html += seg; continue; }

    const codes = m[1] === '' ? [0] : m[1].split(';').map(Number);
    if (codes.includes(0)) {
      html += '</span>'.repeat(open);
      open = 0;
    } else {
      const style = codesToStyle(codes);
      if (style) { html += `<span style="${style}">`; open++; }
    }
  }

  html += '</span>'.repeat(open);
  return html;
}
