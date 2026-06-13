/* ParallaxController: one global pointer tracker; the ONLY writer of parallaxNodes. */
(function () {
  "use strict";
  const S = window.SKULL;

  const MAX_X = 26, MAX_Y = 16; // design-space px at depth 1

  class ParallaxController {
    constructor() {
      this.elements = [];
      this.cur = { nx: 0, ny: 0 };
      this.enabled = !S.reducedMotion;
      S.app.ticker.add(this.update, this);
    }
    setElements(els) {
      // release previous slide's nodes at rest
      for (const ev of this.elements) {
        if (ev.parallaxNode && !ev.parallaxNode.destroyed) ev.parallaxNode.position.set(0, 0);
      }
      this._all = els;
      this.elements = (this.enabled ? els.filter((e) => (e.spec.parallax || 0) > 0) : [])
        .filter((e) => e !== this.frozen);
    }
    /* hold one element still (gizmos align with the mesh while rig-editing) */
    freeze(ev) {
      this.frozen = ev;
      if (ev && ev.parallaxNode) ev.parallaxNode.position.set(0, 0);
      this.elements = this.elements.filter((e) => e !== ev);
    }
    unfreeze() {
      this.frozen = null;
      if (this._all) this.setElements(this._all);
    }
    update() {
      if (!this.elements.length) return;
      const target = S.pointer;
      this.cur.nx = S.lerp(this.cur.nx, target.nx, 0.06);
      this.cur.ny = S.lerp(this.cur.ny, target.ny, 0.06);
      for (const ev of this.elements) {
        if (!ev.parallaxNode || ev.parallaxNode.destroyed) continue; // element deleted
        const d = ev.spec.parallax || 0;
        ev.parallaxNode.position.set(this.cur.nx * d * MAX_X, this.cur.ny * d * MAX_Y);
      }
    }
  }

  S.ParallaxController = ParallaxController;
})();
