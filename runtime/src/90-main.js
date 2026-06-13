/* Boot: parse embedded manifest, apply stored edits, start the deck. */
(async function () {
  "use strict";
  const S = window.SKULL;

  try {
    let manifest = JSON.parse(document.getElementById("manifest").textContent || "null");
    if (!manifest && window.STUDIO) {
      const res = await fetch("/api/manifest");
      if (!res.ok) throw new Error("No project yet - import a PDF from the Studio home page");
      S.manifestRev = res.headers.get("x-manifest-rev");
      manifest = await res.json();
    }
    if (!manifest) throw new Error("no manifest embedded");

    await S.initStage(manifest.deck);

    const persist = (S.persist = new S.Persist(manifest));
    persist.applyStored();

    const manager = (S.manager = new S.SlideManager(manifest));
    S.parallax = new S.ParallaxController();
    manager.bindInput();

    // editor modules are stripped from viewer-only builds
    if (S.Editor) {
      const editor = (S.editor = new S.Editor(manager));
      S.inspector = new S.Inspector(editor);
      editor.rigEditor = new S.RigEditor(editor);
      S.timelineStrip = new S.TimelineStrip();
      if (S.initStudioMenus) S.initStudioMenus(editor);
    }

    await manager.goto(0, true);

    // standalone-editor builds (--editor) or any build opened with #editor
    if (S.editor && (window.EDITOR_AUTOOPEN || location.hash === "#editor")) {
      S.editor.toggle();
    }

    const spinner = document.getElementById("boot-spinner");
    if (spinner) {
      spinner.style.opacity = "0";
      setTimeout(() => spinner.remove(), 500);
    }

    // verification hooks
    window.__deck = {
      get slideCount() { return manager.slideCount; },
      get current() { return manager.current; },
      goto: (i) => manager.goto(i),
      manifest,
    };
    console.info(`[skull] ready: ${manager.slideCount} slides`);
  } catch (err) {
    console.error("[skull] boot failed:", err);
    const spinner = document.getElementById("boot-spinner");
    if (spinner) spinner.textContent = "ERROR: " + err.message;
  }
})();
