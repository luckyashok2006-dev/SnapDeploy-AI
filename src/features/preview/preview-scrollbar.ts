/**
 * SnapDeploy AI — Preview Root Scrollbar Shim
 *
 * Scoped strictly to the embedded Live Preview runtime iframe.
 * Visually hides the root document scrollbar (html / body) inside the scaled
 * Live Preview canvas while keeping mouse wheel, trackpad, touch, keyboard,
 * and programmatic document scrolling 100% functional.
 *
 * Guarantees:
 * 1. Strictly targets `html` and `body` only. Never uses `*::-webkit-scrollbar`,
 *    preserving normal scrollbars for all nested application UI (tables, sidebars,
 *    dropdowns, custom scroll containers).
 * 2. Never sets `overflow: hidden` or `overflow-y: hidden` on the root document.
 * 3. Never touches VFS, project files, exported ZIPs, or StandalonePreview.
 * 4. Automatically attaches and re-attaches on iframe document load, reload, or navigation.
 */

export const PREVIEW_ROOT_SCROLLBAR_STYLE_ID = 'snapdeploy-preview-root-scrollbar-style';

export const PREVIEW_ROOT_SCROLLBAR_CSS = `
/* SnapDeploy Live Preview: Root Document Scrollbar Hiding */
html {
  scrollbar-width: none !important;
  -ms-overflow-style: none !important;
}
html::-webkit-scrollbar {
  display: none !important;
  width: 0 !important;
  height: 0 !important;
}
body {
  scrollbar-width: none !important;
  -ms-overflow-style: none !important;
}
body::-webkit-scrollbar {
  display: none !important;
  width: 0 !important;
  height: 0 !important;
}
`;

/**
 * Injects preview-only CSS to visually hide the root document scrollbar
 * within the preview iframe while preserving full scrolling capabilities.
 *
 * @param iframe HTMLIFrameElement
 * @returns Cleanup function to remove listeners and styles
 */
export function injectPreviewRootScrollbarStyles(iframe: HTMLIFrameElement): () => void {
  const applyStyles = () => {
    try {
      const doc = iframe.contentDocument;
      if (!doc) return;

      // Check if style already injected
      if (doc.getElementById(PREVIEW_ROOT_SCROLLBAR_STYLE_ID)) return;

      const style = doc.createElement('style');
      style.id = PREVIEW_ROOT_SCROLLBAR_STYLE_ID;
      style.setAttribute('data-preview-scrollbar-shim', 'true');
      style.textContent = PREVIEW_ROOT_SCROLLBAR_CSS;

      const target = doc.head || doc.documentElement;
      if (target) {
        target.appendChild(style);
      }
    } catch {
      // Cross-origin fallback
    }
  };

  // Apply immediately to current document
  applyStyles();

  // Listen for future load events on this iframe
  iframe.addEventListener('load', applyStyles);

  return () => {
    iframe.removeEventListener('load', applyStyles);
    try {
      const el = iframe.contentDocument?.getElementById(PREVIEW_ROOT_SCROLLBAR_STYLE_ID);
      el?.remove();
    } catch {}
  };
}
