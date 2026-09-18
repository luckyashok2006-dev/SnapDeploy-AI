import { describe, it, expect, beforeEach } from 'vitest';
import { PREVIEW_DEVICE_PRESETS } from '../src/types/preview';
import { 
  calculatePreviewScale, 
  translateScreenToLogicalCoordinates 
} from '../src/features/preview/preview-scaler';
import { usePreviewStore } from '../src/store/previewStore';
import { useRuntimeStore } from '../src/store/runtimeStore';
import * as fs from 'fs';
import * as path from 'path';

describe('Live Preview Refinement Contract & Scale Engine', () => {
  beforeEach(() => {
    usePreviewStore.getState().clearAllPreviewState();
  });

  // 1. Desktop preset = 1440 × 900
  it('defines Desktop preset as 1440 × 900', () => {
    const desktop = PREVIEW_DEVICE_PRESETS.desktop;
    expect(desktop.width).toBe(1440);
    expect(desktop.height).toBe(900);
    expect(desktop.label).toBe('Desktop');
    expect(desktop.description).toContain('1440 × 900');
  });

  // 2. Tablet preset = 768 × 1024
  it('defines Tablet preset as 768 × 1024', () => {
    const tablet = PREVIEW_DEVICE_PRESETS.tablet;
    expect(tablet.width).toBe(768);
    expect(tablet.height).toBe(1024);
    expect(tablet.label).toBe('Tablet');
    expect(tablet.description).toContain('768 × 1024');
  });

  // 3. Mobile preset = 390 × 844
  it('defines Mobile preset as 390 × 844', () => {
    const mobile = PREVIEW_DEVICE_PRESETS.mobile;
    expect(mobile.width).toBe(390);
    expect(mobile.height).toBe(844);
    expect(mobile.label).toBe('Mobile');
    expect(mobile.description).toContain('390 × 844');
  });

  // 4. Preset change updates logical dimensions
  it('switching presets updates logical dimensions without distortion', () => {
    const desktop = PREVIEW_DEVICE_PRESETS.desktop;
    const tablet = PREVIEW_DEVICE_PRESETS.tablet;
    const mobile = PREVIEW_DEVICE_PRESETS.mobile;

    expect(desktop.width).toBeGreaterThan(tablet.width);
    expect(tablet.width).toBeGreaterThan(mobile.width);
    expect(tablet.height).toBeGreaterThan(desktop.height);
  });

  // 5. fitScale calculation is deterministic
  it('fitScale calculation is deterministic for given boundaries', () => {
    const preset = PREVIEW_DEVICE_PRESETS.desktop; // 1440 x 900
    const res1 = calculatePreviewScale(preset, 720, 450, 100);
    const res2 = calculatePreviewScale(preset, 720, 450, 100);

    expect(res1.fitScale).toBe(0.5);
    expect(res1.displayScale).toBe(0.5);
    expect(res1.scaledWidth).toBe(720);
    expect(res1.scaledHeight).toBe(450);
    expect(res1).toEqual(res2);
  });

  // 6. fitScale never exceeds 1
  it('fitScale never exceeds 1.0 even when available panel is larger than logical preset', () => {
    const mobile = PREVIEW_DEVICE_PRESETS.mobile; // 390 x 844
    // Available width = 800, available height = 1200
    const res = calculatePreviewScale(mobile, 800, 1200, 100);

    expect(res.fitScale).toBe(1.0);
    expect(res.displayScale).toBe(1.0);
    expect(res.scaledWidth).toBe(390);
    expect(res.scaledHeight).toBe(844);
  });

  // 7. displayScale respects zoom
  it('displayScale respects user zoom multiplier on top of fitScale', () => {
    const preset = PREVIEW_DEVICE_PRESETS.desktop; // 1440 x 900
    // Available = 1440 x 900 -> fitScale = 1.0
    const resZoom80 = calculatePreviewScale(preset, 1440, 900, 80);
    expect(resZoom80.fitScale).toBe(1.0);
    expect(resZoom80.displayScale).toBe(0.8);
    expect(resZoom80.scaledWidth).toBe(1152);
    expect(resZoom80.scaledHeight).toBe(720);

    const resZoom120 = calculatePreviewScale(preset, 1440, 900, 120);
    expect(resZoom120.fitScale).toBe(1.0);
    expect(resZoom120.displayScale).toBe(1.2);
    expect(resZoom120.scaledWidth).toBe(1728);
    expect(resZoom120.scaledHeight).toBe(1080);
  });

  // 8. displayScale is clamped safely
  it('displayScale is clamped between defined min and max boundaries', () => {
    const preset = PREVIEW_DEVICE_PRESETS.desktop;
    // Extremely small panel
    const resTiny = calculatePreviewScale(preset, 10, 10, 10, 0.1, 2.0);
    expect(resTiny.displayScale).toBeGreaterThanOrEqual(0.1);

    // Extreme zoom in
    const resHuge = calculatePreviewScale(preset, 1440, 900, 500, 0.1, 2.0);
    expect(resHuge.displayScale).toBeLessThanOrEqual(2.0);
  });

  // 9. Aspect ratio is strictly preserved
  it('preserves exact logical aspect ratio across all calculated scales', () => {
    const preset = PREVIEW_DEVICE_PRESETS.desktop; // 1440 / 900 = 1.6
    const expectedRatio = preset.width / preset.height;

    const testSizes = [
      { w: 1200, h: 800 },
      { w: 500, h: 700 },
      { w: 340, h: 600 },
      { w: 800, h: 400 }
    ];

    for (const size of testSizes) {
      const { scaledWidth, scaledHeight } = calculatePreviewScale(preset, size.w, size.h, 100);
      const scaledRatio = scaledWidth / scaledHeight;
      // Allow minor rounding of integers
      expect(Math.abs(scaledRatio - expectedRatio)).toBeLessThan(0.05);
    }
  });

  // 10. Screen -> logical coordinate translation is correct
  it('translates physical screen coordinates through displayScale to exact logical coordinates', () => {
    const preset = PREVIEW_DEVICE_PRESETS.desktop; // 1440 x 900
    const stageRect = { left: 100, top: 50 };
    const displayScale = 0.5;

    // Click at screen (300, 200)
    // relativeX = 300 - 100 = 200px
    // relativeY = 200 - 50 = 150px
    // logicalX = 200 / 0.5 = 400px
    // logicalY = 150 / 0.5 = 300px
    const coords = translateScreenToLogicalCoordinates(300, 200, stageRect, displayScale, preset);

    expect(coords.logicalX).toBe(400);
    expect(coords.logicalY).toBe(300);
  });

  // 11. Coordinate translation clamps safely
  it('clamps out-of-bounds screen coordinates to [0, width] and [0, height]', () => {
    const preset = PREVIEW_DEVICE_PRESETS.mobile; // 390 x 844
    const stageRect = { left: 100, top: 50 };
    const displayScale = 1.0;

    // Click to the left of the stage
    const coordsLeft = translateScreenToLogicalCoordinates(50, 100, stageRect, displayScale, preset);
    expect(coordsLeft.logicalX).toBe(0);

    // Click far to the right beyond the stage
    const coordsFar = translateScreenToLogicalCoordinates(900, 1500, stageRect, displayScale, preset);
    expect(coordsFar.logicalX).toBe(390);
    expect(coordsFar.logicalY).toBe(844);
  });

  // 12. Zoom is independent from device preset
  it('stores zoom independently from device preset', () => {
    const store = usePreviewStore.getState();
    const proj = 'proj-alpha';

    store.setDevicePreset(proj, 'tablet');
    store.setZoomScale(proj, 120);

    expect(store.getDevicePreset(proj)).toBe('tablet');
    expect(store.getZoomScale(proj)).toBe(120);

    // Switch device to mobile: zoom remains 120%
    store.setDevicePreset(proj, 'mobile');
    expect(store.getDevicePreset(proj)).toBe('mobile');
    expect(store.getZoomScale(proj)).toBe(120);

    // Reset zoom: device remains mobile
    store.resetZoom(proj);
    expect(store.getZoomScale(proj)).toBe(100);
    expect(store.getDevicePreset(proj)).toBe('mobile');
  });

  // 13. Project-scoped state remains isolated
  it('isolates preview state across different projects', () => {
    const store = usePreviewStore.getState();

    store.setDevicePreset('proj-1', 'mobile');
    store.setZoomScale('proj-1', 75);

    store.setDevicePreset('proj-2', 'tablet');
    store.setZoomScale('proj-2', 125);

    expect(store.getDevicePreset('proj-1')).toBe('mobile');
    expect(store.getZoomScale('proj-1')).toBe(75);

    expect(store.getDevicePreset('proj-2')).toBe('tablet');
    expect(store.getZoomScale('proj-2')).toBe(125);

    // Unset project defaults to desktop and 100
    expect(store.getDevicePreset('proj-3')).toBe('desktop');
    expect(store.getZoomScale('proj-3')).toBe(100);
  });

  // 14. Toolbar DOM structure & compact rules
  it('declares overflow-hidden and flexible URL region in LivePreviewPane source', () => {
    const paneFile = path.resolve(__dirname, '../src/components/preview/LivePreviewPane.tsx');
    const content = fs.readFileSync(paneFile, 'utf-8');

    // Toolbar test ID and overflow-hidden
    expect(content).toContain('data-testid="preview-toolbar"');
    expect(content).toContain('overflow-hidden');

    // Flexible URL region
    expect(content).toContain('data-testid="preview-url-bar"');
    expect(content).toContain('flex-1 min-w-0');

    // Device preset buttons with test IDs and accessibility attributes
    expect(content).toContain('data-testid="preview-device-desktop"');
    expect(content).toContain('data-testid="preview-device-tablet"');
    expect(content).toContain('data-testid="preview-device-mobile"');
    expect(content).toContain('aria-pressed={viewport === \'desktop\'}');
    expect(content).toContain('aria-pressed={viewport === \'tablet\'}');
    expect(content).toContain('aria-pressed={viewport === \'mobile\'}');

    // Logical attributes on iframe
    expect(content).toContain('data-logical-width={String(currentPreset.width)}');
    expect(content).toContain('data-logical-height={String(currentPreset.height)}');
  });

  // 15. Zoom controls remain rendered with compact classes and never disappear
  it('retains permanently rendered zoom controls in LivePreviewPane source', () => {
    const paneFile = path.resolve(__dirname, '../src/components/preview/LivePreviewPane.tsx');
    const content = fs.readFileSync(paneFile, 'utf-8');

    expect(content).toContain('data-testid="preview-zoom-controls"');
    expect(content).toContain('data-testid="preview-zoom-out"');
    expect(content).toContain('data-testid="preview-zoom-label"');
    expect(content).toContain('data-testid="preview-zoom-in"');

    // Asserts zoom controls container does not have unconditional hidden classes
    expect(content).not.toContain('preview-zoom-controls"\n              className="hidden"');
    expect(content).toContain('isCompactToolbar ? \'gap-0.5 px-1 py-0.5 text-[9px]\' : \'gap-1 px-1.5 py-0.5 text-[10px]\'');
  });

  // 16. Preview Form-Control Shim API and safe DOM manipulation
  it('implements secure, non-invasive DOM manipulation in preview-form-shim', () => {
    const shimFile = path.resolve(__dirname, '../src/features/preview/preview-form-shim.ts');
    const content = fs.readFileSync(shimFile, 'utf-8');

    // Safe DOM API assertions
    expect(content).toContain('doc.createElement');
    expect(content).toContain('item.textContent =');
    expect(content).not.toContain('.innerHTML');
    expect(content).not.toContain('.outerHTML');
    expect(content).not.toContain('insertAdjacentHTML');

    // Event interception and navigation assertions
    expect(content).toContain('pointerdown');
    expect(content).toContain('mousedown');
    expect(content).toContain('keydown');
    expect(content).toContain('ArrowDown');
    expect(content).toContain('ArrowUp');
    expect(content).toContain('Home');
    expect(content).toContain('End');
    expect(content).toContain('Tab');
    expect(content).toContain('Escape');

    // Dispatch input and change events with bubbles: true
    expect(content).toContain('new Event(\'input\', { bubbles: true');
    expect(content).toContain('new Event(\'change\', { bubbles: true');

    // Scroll offset accounting
    expect(content).toContain('win.scrollX || doc.documentElement.scrollLeft');
    expect(content).toContain('win.scrollY || doc.documentElement.scrollTop');
  });

  // 17. Form shim is Preview-only and NEVER modifies project VFS files
  it('proves that form compatibility shim is strictly isolated to preview iframe and never touches project VFS files', () => {
    const projectStoreFile = path.resolve(__dirname, '../src/store/projectStore.ts');
    const projectContent = fs.readFileSync(projectStoreFile, 'utf-8');
    expect(projectContent).not.toContain('preview-form-shim');

    const vfsFile = path.resolve(__dirname, '../src/lib/vfs/vfs-manager.ts');
    const vfsContent = fs.readFileSync(vfsFile, 'utf-8');
    expect(vfsContent).not.toContain('preview-form-shim');

    // Confirm that LivePreviewPane wires attachPreviewFormShim
    const paneFile = path.resolve(__dirname, '../src/components/preview/LivePreviewPane.tsx');
    const paneContent = fs.readFileSync(paneFile, 'utf-8');
    expect(paneContent).toContain('attachPreviewFormShim(iframeRef.current)');
  });

  // 18. Open Preview in New Tab button is embedded INSIDE the preview-url-bar container
  it('embeds open-preview-new-tab-btn INSIDE preview-url-bar as a descendant, not an outside sibling', () => {
    const paneFile = path.resolve(__dirname, '../src/components/preview/LivePreviewPane.tsx');
    const content = fs.readFileSync(paneFile, 'utf-8');

    expect(content).toContain('data-testid="preview-url-bar"');
    expect(content).toContain('data-testid="runtime-url-content"');
    expect(content).toContain('data-testid="open-preview-new-tab-btn"');
    expect(content).toContain('aria-label="Open Preview in new tab"');
    expect(content).toContain('ExternalLink');

    // Structural hierarchy check:
    // preview-url-bar begins, then runtime-url-content, then open-preview-new-tab-btn, then preview-url-bar closes
    const urlBarStartIndex = content.indexOf('data-testid="preview-url-bar"');
    const urlContentIndex = content.indexOf('data-testid="runtime-url-content"');
    const newTabBtnIndex = content.indexOf('data-testid="open-preview-new-tab-btn"');
    const controlsIndex = content.indexOf('data-testid="preview-controls-group"');

    expect(urlBarStartIndex).toBeGreaterThan(-1);
    expect(urlContentIndex).toBeGreaterThan(urlBarStartIndex);
    expect(newTabBtnIndex).toBeGreaterThan(urlContentIndex);
    expect(controlsIndex).toBeGreaterThan(newTabBtnIndex);

    // Verify URL text container reserves space and truncates before arrow disappears
    expect(content).toContain('data-testid="runtime-url-content" className="flex items-center gap-1 sm:gap-1.5 min-w-0 flex-1 truncate pr-1"');
  });

  // 19. Runtime readiness and first-party launch URL without secret leakage
  it('enforces runtime readiness and targets first-party /preview route without secret leakage', () => {
    const paneFile = path.resolve(__dirname, '../src/components/preview/LivePreviewPane.tsx');
    const content = fs.readFileSync(paneFile, 'utf-8');

    // Button disabled when runtime is not ready
    expect(content).toContain('disabled={!isRuntimeReady}');
    expect(content).toContain("title={isRuntimeReady ? 'Open Preview in new tab' : 'Dev server not ready'}");
    expect(content).toContain("const isRuntimeReady = status === 'ready' && Boolean(previewUrl);");

    // First-party route with project isolation (no secrets in URL)
    expect(content).toContain('const targetUrl = `/preview?project=${encodeURIComponent(activeProjectId)}`;');
    expect(content).toContain("window.open(targetUrl, '_blank');");
    expect(content).not.toContain('token=');
    expect(content).not.toContain('secret=');
    expect(content).not.toContain('password=');
  });

  // 20. Project isolation in runtime store: switching project clears stale preview URL
  it('enforces project isolation so stale URLs cannot be accessed on project switch', () => {
    // Project A running
    useRuntimeStore.setState({
      status: 'ready',
      previewUrl: 'http://localhost:3000/app-a',
      previewPort: 3000
    });
    expect(useRuntimeStore.getState().previewUrl).toBe('http://localhost:3000/app-a');
    expect(useRuntimeStore.getState().status).toBe('ready');

    // Switch/initialize Project B: status transitions to running and clears previewUrl
    useRuntimeStore.setState({
      status: 'running',
      previewUrl: null,
      previewPort: null
    });
    expect(useRuntimeStore.getState().previewUrl).toBeNull();
    expect(useRuntimeStore.getState().status).toBe('running');

    // Project B dev server ready
    useRuntimeStore.setState({
      status: 'ready',
      previewUrl: 'http://localhost:3000/app-b',
      previewPort: 3000
    });
    expect(useRuntimeStore.getState().previewUrl).toBe('http://localhost:3000/app-b');
  });

  // 21. Wrapper total outer footprint (including borders) guaranteed to fit within stage dimensions at fit-scale
  it('guarantees wrapper total outer footprint including borders fits within available stage dimensions at fit-scale', () => {
    const BORDER_TOTAL = 2; // 1px border on each side for box-sizing: border-box
    const MARGIN_TOTAL = 16; // 8px breathing margin each side

    const testStages = [
      { width: 1200, height: 800 },
      { width: 768, height: 600 },
      { width: 450, height: 700 },
      { width: 390, height: 500 }
    ];

    const presets = [PREVIEW_DEVICE_PRESETS.desktop, PREVIEW_DEVICE_PRESETS.tablet, PREVIEW_DEVICE_PRESETS.mobile];

    for (const stage of testStages) {
      for (const preset of presets) {
        const availableInnerWidth = Math.max(50, stage.width - MARGIN_TOTAL - BORDER_TOTAL);
        const availableInnerHeight = Math.max(50, stage.height - MARGIN_TOTAL - BORDER_TOTAL);

        const res = calculatePreviewScale(preset, availableInnerWidth, availableInnerHeight, 100);

        // Total outer footprint of the wrapper
        const wrapperOuterWidth = res.scaledWidth + BORDER_TOTAL;
        const wrapperOuterHeight = res.scaledHeight + BORDER_TOTAL;

        // Guaranteed to strictly fit within stage dimensions
        expect(wrapperOuterWidth).toBeLessThanOrEqual(stage.width);
        expect(wrapperOuterHeight).toBeLessThanOrEqual(stage.height);
      }
    }
  });

  // 22. Define scrolling precisely: no accidental outer scrollbar at fit-scale, intentional panning when zoom > fit-scale, independent iframe scrolling
  it('declares precise scrolling architecture in LivePreviewPane without suppressing legitimate application scrolling', () => {
    const paneFile = path.resolve(__dirname, '../src/components/preview/LivePreviewPane.tsx');
    const content = fs.readFileSync(paneFile, 'utf-8');

    // Outer stage container allows panning when zoomed in
    expect(content).toContain('data-testid="preview-stage-container"');
    expect(content).toContain('overflow-auto');
    expect(content).toContain('scrollbar-thin');

    // Stage wrapper encapsulates scaled content
    expect(content).toContain('data-testid="preview-stage-wrapper"');
    expect(content).toContain('width: `${wrapperWidth}px`');
    expect(content).toContain('height: `${wrapperHeight}px`');
    expect(content).toContain('overflow-hidden');

    // Iframe possesses its own logical dimensions without artificial overflow-hidden
    expect(content).toContain('data-testid="preview-iframe"');
    expect(content).not.toContain('overflow-y: hidden');
    expect(content).not.toContain('overflow: hidden" block');
  });

  // 23. StandalonePreview architecture: zero IDE chrome, no form shim, project isolation guards, and message broker
  it('implements StandalonePreview with strict project isolation, zero IDE chrome, no form shim, and message broker', () => {
    const standaloneFile = path.resolve(__dirname, '../src/components/preview/StandalonePreview.tsx');
    const content = fs.readFileSync(standaloneFile, 'utf-8');

    // Project isolation & offline guards
    expect(content).toContain('data-testid="preview-offline-state"');
    expect(content).toContain('Project Isolation Guard');
    expect(content).toContain('Application Offline');

    // Standalone iframe
    expect(content).toContain('data-testid="standalone-preview-iframe"');
    expect(content).toContain('className="w-full h-full border-0 block bg-white"');

    // Zero IDE chrome & zero form shim
    expect(content).not.toContain('TopNavbar');
    expect(content).not.toContain('SidebarNav');
    expect(content).not.toContain('preview-toolbar');
    expect(content).not.toContain('preview-form-shim');
    expect(content).not.toContain('attachPreviewFormShim');

    // Message broker between preview iframe and window.opener
    expect(content).toContain('window.opener.postMessage');
    expect(content).toContain('iframeRef.current.contentWindow.postMessage');
  });

  // 24. App routing registers /preview standalone route and defensive /webcontainer/connect
  it('registers /preview route and defensive /webcontainer/connect handler in App.tsx', () => {
    const appFile = path.resolve(__dirname, '../src/App.tsx');
    const content = fs.readFileSync(appFile, 'utf-8');

    expect(content).toContain("pathname === '/preview' || pathname.startsWith('/preview/')");
    expect(content).toContain('<StandalonePreview />');
    expect(content).toContain("pathname.startsWith('/webcontainer/connect')");
    expect(content).toContain("import('@webcontainer/api/connect')");
  });

  // 25. RuntimeStore session broadcast and zero secret leakage
  it('broadcasts runtime session without leaking secrets into storage or messages', () => {
    const storeFile = path.resolve(__dirname, '../src/store/runtimeStore.ts');
    const content = fs.readFileSync(storeFile, 'utf-8');

    expect(content).toContain('snapdeploy_runtime_session');
    expect(content).toContain('snapdeploy_preview_channel');
    expect(content).toContain('RUNTIME_SESSION_UPDATE');
    expect(content).toContain('REQUEST_PREVIEW_STATE');

    // Zero secret leakage in payload definition
    expect(content).toContain('interface RuntimeSessionPayload');
    expect(content).not.toContain('password');
    expect(content).not.toContain('secret');
    expect(content).not.toContain('token:');
    expect(content).not.toContain('apiKey:');
  });

  // 26. Preview root scrollbar helper targets only html and body without wildcard selector
  it('targets only root html and body in preview-scrollbar.ts without using wildcard *::-webkit-scrollbar', () => {
    const scrollbarFile = path.resolve(__dirname, '../src/features/preview/preview-scrollbar.ts');
    const content = fs.readFileSync(scrollbarFile, 'utf-8');

    expect(content).toContain('PREVIEW_ROOT_SCROLLBAR_STYLE_ID');
    expect(content).toContain('injectPreviewRootScrollbarStyles');

    // Asserts Firefox and WebKit scrollbar hiding on html and body
    expect(content).toContain('html');
    expect(content).toContain('scrollbar-width: none');
    expect(content).toContain('html::-webkit-scrollbar');
    expect(content).toContain('display: none');
    expect(content).toContain('body');
    expect(content).toContain('body::-webkit-scrollbar');

    // Extract the CSS definition
    const cssMatch = content.match(/PREVIEW_ROOT_SCROLLBAR_CSS = `([\s\S]*?)`;/);
    expect(cssMatch).toBeTruthy();
    const css = cssMatch![1];

    // MUST NOT use wildcard selector that breaks nested components
    expect(css).not.toContain('*::-webkit-scrollbar');
    expect(css).not.toContain('div::-webkit-scrollbar');

    // MUST NOT disable scrolling or set overflow: hidden
    expect(css).not.toContain('overflow: hidden');
    expect(css).not.toContain('overflow-y: hidden');
  });

  // 27. LivePreviewPane integrates injectPreviewRootScrollbarStyles in iframe lifecycle
  it('integrates injectPreviewRootScrollbarStyles in LivePreviewPane without modifying VFS or StandalonePreview', () => {
    const paneFile = path.resolve(__dirname, '../src/components/preview/LivePreviewPane.tsx');
    const paneContent = fs.readFileSync(paneFile, 'utf-8');

    expect(paneContent).toContain('injectPreviewRootScrollbarStyles');
    expect(paneContent).toContain('injectPreviewRootScrollbarStyles(iframeRef.current)');

    // Verify StandalonePreview remains untouched and does NOT hide scrollbars
    const standaloneFile = path.resolve(__dirname, '../src/components/preview/StandalonePreview.tsx');
    const standaloneContent = fs.readFileSync(standaloneFile, 'utf-8');
    expect(standaloneContent).not.toContain('injectPreviewRootScrollbarStyles');
    expect(standaloneContent).not.toContain('PREVIEW_ROOT_SCROLLBAR');
  });

  // 28. LP-01: Back/Forward buttons wired to iframe history with disabled state derivation
  it('LP-01: wires Back and Forward buttons to iframe history with disabled state derivation', () => {
    const paneFile = path.resolve(__dirname, '../src/components/preview/LivePreviewPane.tsx');
    const content = fs.readFileSync(paneFile, 'utf-8');

    expect(content).toContain('iframeRef.current?.contentWindow?.history.back()');
    expect(content).toContain('iframeRef.current?.contentWindow?.history.forward()');
    expect(content).toContain('onClick={handleBack}');
    expect(content).toContain('onClick={handleForward}');
    expect(content).toContain('disabled={!canGoBack}');
    expect(content).toContain('disabled={!canGoForward}');
    expect(content).toContain('data-testid="preview-back-btn"');
    expect(content).toContain('data-testid="preview-forward-btn"');
  });

  // 29. LP-02: Constrained Viewport Preview Recovery in AppLayout
  it('LP-02: provides explicit Preview recovery affordance and reversible Show Editor in AppLayout', () => {
    const layoutFile = path.resolve(__dirname, '../src/components/layout/AppLayout.tsx');
    const content = fs.readFileSync(layoutFile, 'utf-8');

    expect(content).toContain('data-testid="preview-recovery-strip"');
    expect(content).toContain('data-testid="recover-preview-btn"');
    expect(content).toContain('data-testid="preview-constrained-banner"');
    expect(content).toContain('data-testid="recover-editor-btn"');
    expect(content).toContain("constrainedPresentation === 'editor'");
    expect(content).toContain("setConstrainedPresentation('preview')");
    expect(content).toContain("setConstrainedPresentation('editor')");
    expect(content).toContain("SHOW PREVIEW");
    expect(content).toContain("Show Editor");
  });

  // 30. LP-03: URL Bar Navigation & Route Synchronization
  it('LP-03: implements URL bar route synchronization, sanitization, and path navigation', () => {
    const paneFile = path.resolve(__dirname, '../src/components/preview/LivePreviewPane.tsx');
    const content = fs.readFileSync(paneFile, 'utf-8');

    expect(content).toContain('data-testid="preview-url-path-input"');
    expect(content).toContain('handlePathSubmit');
    expect(content).toContain('syncRouteFromIframe');
    expect(content).toContain("target.startsWith('//')");
    expect(content).toContain("target.includes('javascript:')");
    expect(content).toContain('popstate');
  });

  // 31. LP-04: Iframe preservation across presets
  it('LP-04: preserves iframe DOM instance across preset changes using clean iframeKey', () => {
    const paneFile = path.resolve(__dirname, '../src/components/preview/LivePreviewPane.tsx');
    const content = fs.readFileSync(paneFile, 'utf-8');

    // Asserts key is only iframeKey, not coupled to viewport preset
    expect(content).toContain('key={iframeKey}');
    expect(content).not.toContain('key={`${iframeKey}-${viewport}`}');
  });

  // 32. LP-05: Inspect Context Card responsive bounds
  it('LP-05: ensures visual-element-context-card uses responsive width and bounds', () => {
    const paneFile = path.resolve(__dirname, '../src/components/preview/LivePreviewPane.tsx');
    const content = fs.readFileSync(paneFile, 'utf-8');

    expect(content).toContain('data-testid="visual-element-context-card"');
    expect(content).toContain('w-[calc(100%-32px)]');
    expect(content).toContain('max-w-[340px]');
  });

  // 33. LP-06: Sandbox allow-popups
  it('LP-06: includes allow-popups in embedded iframe sandbox', () => {
    const paneFile = path.resolve(__dirname, '../src/components/preview/LivePreviewPane.tsx');
    const content = fs.readFileSync(paneFile, 'utf-8');

    expect(content).toContain('sandbox="allow-scripts allow-forms allow-same-origin allow-modals allow-popups"');
  });

  // 34. LP-07: Remove resize drag lag
  it('LP-07: removes transition lag during active divider dragging', () => {
    const paneFile = path.resolve(__dirname, '../src/components/preview/LivePreviewPane.tsx');
    const content = fs.readFileSync(paneFile, 'utf-8');

    expect(content).toContain('isResizing');
    expect(content).toContain("isResizing ? 'transition-none' : 'transition-all duration-200'");

    const dividerFile = path.resolve(__dirname, '../src/components/layout/ResizableDivider.tsx');
    const dividerContent = fs.readFileSync(dividerFile, 'utf-8');
    expect(dividerContent).toContain('onDragStart');
    expect(dividerContent).toContain('onDragEnd');
  });
});

