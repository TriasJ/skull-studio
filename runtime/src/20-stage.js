/* Stage: PIXI Application bootstrap + letterboxed root in design space.
   root is the ONLY node the resize handler writes (one-writer rule). */
(function () {
  "use strict";
  const S = window.SKULL;

  S.initStage = async function (deck) {
    const app = new PIXI.Application();
    await app.init({
      backgroundColor: deck.background ? parseInt(deck.background.slice(1), 16) : 0x000000,
      resizeTo: window,
      antialias: false,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      autoDensity: true,
      preference: "webgl",
    });
    document.body.appendChild(app.canvas);

    const root = new PIXI.Container();
    app.stage.addChild(root);

    const slideHost = new PIXI.Container();
    const gizmos = new PIXI.Container(); // editor overlays, drawn in design space
    root.addChild(slideHost, gizmos);

    // workspace inset: the editor docks its panels by shrinking the area the
    // slide is letterboxed into (canvas stays full-window; only root moves)
    const inset = (S.inset = { left: 0, right: 0, top: 0, bottom: 0 });
    S.setInset = function (v) {
      Object.assign(inset, { left: 0, right: 0, top: 0, bottom: 0 }, v || {});
      layout();
    };

    function layout() {
      // v8: app.screen is in logical (CSS) pixels - no resolution division
      const W = Math.max(50, app.screen.width - inset.left - inset.right);
      const H = Math.max(50, app.screen.height - inset.top - inset.bottom);
      const s = Math.min(W / deck.designWidth, H / deck.designHeight);
      root.scale.set(s);
      root.position.set(
        inset.left + (W - deck.designWidth * s) / 2,
        inset.top + (H - deck.designHeight * s) / 2
      );
    }
    layout();
    S.relayout = layout;
    // pixi's resizeTo resize is async - polling the screen size each frame
    // (cheap compare) beats racing window "resize" events on zoom/maximize
    let lastW = app.screen.width, lastH = app.screen.height;
    app.ticker.add(() => {
      if (app.screen.width !== lastW || app.screen.height !== lastH) {
        lastW = app.screen.width;
        lastH = app.screen.height;
        layout();
      }
    });

    // pointer position in design space, for parallax + editor
    const pointer = { x: deck.designWidth / 2, y: deck.designHeight / 2, nx: 0, ny: 0 };
    app.canvas.addEventListener("pointermove", (ev) => {
      const local = root.toLocal({ x: ev.clientX, y: ev.clientY });
      pointer.x = local.x;
      pointer.y = local.y;
      pointer.nx = S.clamp((local.x / deck.designWidth) * 2 - 1, -1, 1);
      pointer.ny = S.clamp((local.y / deck.designHeight) * 2 - 1, -1, 1);
    });

    S.app = app;
    S.root = root;
    S.slideHost = slideHost;
    S.gizmos = gizmos;
    S.pointer = pointer;
    return app;
  };
})();
