/* AssetCache: base64 data URI -> decoded Image -> PIXI.Texture, cached by path.
   Deliberately bypasses PIXI.Assets: multi-MB data-URI strings make terrible
   loader cache keys, and v8 Texture.from() no longer URL-loads anyway. */
(function () {
  "use strict";
  const S = window.SKULL;

  const images = new Map();   // path -> Promise<HTMLImageElement>
  const textures = new Map(); // path -> PIXI.Texture

  function loadImage(path) {
    if (images.has(path)) return images.get(path);
    // built file: base64 in window.ASSETS; studio dev mode: URL under ASSET_BASE
    const uri = (window.ASSETS || {})[path] ||
      (window.ASSET_BASE ? window.ASSET_BASE + path + "?v=" + (S.assetEpoch || 0) : null);
    const p = new Promise((resolve, reject) => {
      if (!uri) return reject(new Error("asset not embedded: " + path));
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("decode failed: " + path));
      img.src = uri;
    });
    images.set(path, p);
    return p;
  }

  S.assets = {
    async texture(path) {
      if (textures.has(path)) return textures.get(path);
      const img = await loadImage(path);
      if (img.decode) { try { await img.decode(); } catch (e) { /* already usable */ } }
      const tex = PIXI.Texture.from(img);
      textures.set(path, tex);
      return tex;
    },
    // free GPU memory; pixel data stays in the Image, re-upload is automatic
    unload(path) {
      const tex = textures.get(path);
      if (tex) tex.source.unload();
    },
  };
})();
