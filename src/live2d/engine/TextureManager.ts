/**
 * WebGL texture creation from base64-encoded image data.
 */

import { CubismInit } from './CubismFrameworkInit';

export interface TextureInfo {
  id: WebGLTexture;
  width: number;
  height: number;
  fileName: string;
}

function base64ToBlobUrl(base64: string, mime: string): string {
  const byteChars = atob(base64);
  const len = byteChars.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = byteChars.charCodeAt(i);
  }
  return URL.createObjectURL(new Blob([bytes], { type: mime }));
}

/**
 * Decode a base64 PNG (or JPEG) into an HTMLImageElement.
 * Returns a promise that resolves when the image is loaded.
 */
function loadImageFromBase64(base64: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const blobUrl = base64ToBlobUrl(base64, 'image/png');
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(blobUrl);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(blobUrl);
      reject(new Error('Failed to load image'));
    };
    img.src = blobUrl;
  });
}

/**
 * Create a WebGL texture from an HTMLImageElement.
 */
function imageToTexture(img: HTMLImageElement, usePremultiply: boolean): WebGLTexture {
  const gl = CubismInit.gl;
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);

  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

  if (usePremultiply) {
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 1);
  }

  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.bindTexture(gl.TEXTURE_2D, null);

  return tex;
}

/**
 * Load textures from base64 data (keyed by relative filename).
 * Returns TextureInfo[] in the order defined by `fileNames`.
 */
export async function createTextures(
  fileNames: string[],
  base64Files: Record<string, string>,
  usePremultiply = true,
): Promise<TextureInfo[]> {
  const results: TextureInfo[] = [];

  for (const name of fileNames) {
    const b64 = base64Files[name];
    if (!b64) {
      console.warn(`[TextureManager] Missing texture: ${name}`);
      continue;
    }

    const img = await loadImageFromBase64(b64);
    const id = imageToTexture(img, usePremultiply);

    results.push({ id, width: img.width, height: img.height, fileName: name });
  }

  return results;
}
