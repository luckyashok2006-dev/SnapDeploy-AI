/**
 * SnapDeploy AI — Preview Form-Control Compatibility Shim
 *
 * Scoped strictly to the Live Preview runtime iframe.
 * Prevents Chromium from launching detached, out-of-bounds native OS select
 * popups (<select>) inside CSS-transformed iframes by rendering an accessible,
 * scale-inheriting in-document dropdown portal directly within the iframe DOM.
 *
 * Guarantees:
 * 1. Zero VFS / project source code modifications.
 * 2. Uses exclusively safe DOM APIs (textContent, createElement, etc.), never innerHTML.
 * 3. Handles pointerdown, mousedown, and keyboard activation paths.
 * 4. Full keyboard navigation: ArrowUp/Down, Home, End, Enter, Space, Escape, with Tab preservation.
 * 5. Accounts for scroll offsets (scrollX / scrollY) and viewport boundary clamping.
 * 6. Dispatches genuine 'input' and 'change' events with bubbling for full framework fidelity.
 */

export interface FormShimOptions {
  theme?: 'dark' | 'light' | 'auto';
  maxHeight?: number;
}

interface ActiveSelectState {
  menu: HTMLElement;
  select: HTMLSelectElement;
  highlightedIndex: number;
  doc: Document;
  win: Window;
  cleanupListeners: () => void;
  openedAt: number;
}

let activeState: ActiveSelectState | null = null;

/**
 * Closes any currently open in-document preview select dropdown
 */
export function closeActivePreviewSelectMenu(): void {
  if (activeState) {
    const { menu, cleanupListeners } = activeState;
    cleanupListeners();
    menu.remove();
    activeState = null;
  }
}

/**
 * Returns whether a preview select menu is currently open
 */
export function isPreviewSelectMenuOpen(): boolean {
  return activeState !== null;
}

/**
 * Attaches the form-control compatibility shim to a preview iframe document.
 * Returns an unbind / cleanup function.
 */
export function attachPreviewFormShim(
  iframe: HTMLIFrameElement,
  options: FormShimOptions = {}
): () => void {
  let doc: Document | null = null;
  let win: Window | null = null;

  try {
    doc = iframe.contentDocument;
    win = iframe.contentWindow;
  } catch {
    // Cross-origin fallback
    return () => {};
  }

  if (!doc || !win) return () => {};

  const targetDoc = doc;
  const targetWin = win;
  const docAny = targetDoc as any;

  // Idempotency: prevent duplicate listener registration on the same document
  if (docAny.__snapdeploy_form_shim_attached) {
    return docAny.__snapdeploy_form_shim_cleanup || (() => {});
  }
  docAny.__snapdeploy_form_shim_attached = true;

  // Handler for pointerdown and mousedown
  const handlePointerOrMouse = (e: Event) => {
    const mouseEvent = e as MouseEvent | PointerEvent;
    // Only handle primary button clicks (left click / touch)
    if (mouseEvent.button !== 0 && mouseEvent.type !== 'pointerdown') return;

    const target = mouseEvent.target as HTMLElement | null;
    if (!target) return;

    const select = target.closest('select');
    if (!select || select.disabled || select.multiple) return;

    // Prevent Chromium from spawning native OS WebPagePopup
    e.preventDefault();
    e.stopPropagation();

    // Toggle if clicking the same select that is currently open (ignore rapid duplicate events from same click)
    if (activeState && activeState.select === select) {
      if (Date.now() - activeState.openedAt < 250) {
        return;
      }
      closeActivePreviewSelectMenu();
      return;
    }

    openPreviewSelectMenu(select, targetDoc, targetWin, options);
  };

  // Handler for keyboard activation on select
  const handleKeyDown = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement | null;
    if (!target) return;

    const select = target.closest('select');
    if (!select || select.disabled || select.multiple) return;

    // Open menu on Space, Enter, or ArrowDown / ArrowUp when closed
    if (!activeState) {
      if (
        e.key === ' ' ||
        e.key === 'Enter' ||
        e.key === 'ArrowDown' ||
        e.key === 'ArrowUp' ||
        (e.altKey && e.key === 'ArrowDown')
      ) {
        e.preventDefault();
        e.stopPropagation();
        openPreviewSelectMenu(select, targetDoc, targetWin, options);
      }
    }
  };

  // Handler for clicks outside to close
  const handleDocumentClick = (e: MouseEvent) => {
    if (!activeState) return;
    const target = e.target as HTMLElement | null;
    if (target && !activeState.menu.contains(target) && target !== activeState.select && !target.closest('select')) {
      closeActivePreviewSelectMenu();
    }
  };

  // Attach event listeners with capture to intercept before native browser popup initiation
  targetDoc.addEventListener('pointerdown', handlePointerOrMouse, { capture: true });
  targetDoc.addEventListener('mousedown', handlePointerOrMouse, { capture: true });
  targetDoc.addEventListener('keydown', handleKeyDown, { capture: true });
  targetDoc.addEventListener('click', handleDocumentClick, { capture: true });

  const cleanup = () => {
    docAny.__snapdeploy_form_shim_attached = false;
    delete docAny.__snapdeploy_form_shim_cleanup;
    closeActivePreviewSelectMenu();
    targetDoc.removeEventListener('pointerdown', handlePointerOrMouse, { capture: true });
    targetDoc.removeEventListener('mousedown', handlePointerOrMouse, { capture: true });
    targetDoc.removeEventListener('keydown', handleKeyDown, { capture: true });
    targetDoc.removeEventListener('click', handleDocumentClick, { capture: true });
  };
  docAny.__snapdeploy_form_shim_cleanup = cleanup;
  return cleanup;
}

/**
 * Positions and opens the in-document dropdown menu for a target <select>
 */
function openPreviewSelectMenu(
  select: HTMLSelectElement,
  doc: Document,
  win: Window,
  options: FormShimOptions
): void {
  closeActivePreviewSelectMenu();

  const rect = select.getBoundingClientRect();
  const scrollX = win.scrollX || doc.documentElement.scrollLeft || 0;
  const scrollY = win.scrollY || doc.documentElement.scrollTop || 0;

  const menu = doc.createElement('div');
  menu.setAttribute('data-testid', 'preview-select-menu');
  menu.setAttribute('role', 'listbox');
  menu.setAttribute('aria-label', select.getAttribute('aria-label') || select.name || 'Options');

  // Compute styles using DOM APIs
  const computed = win.getComputedStyle(select);
  const fontSize = computed.fontSize || '14px';
  const fontFamily = computed.fontFamily || 'system-ui, sans-serif';

  Object.assign(menu.style, {
    position: 'absolute',
    zIndex: '2147483647',
    backgroundColor: '#0F172A',
    color: '#F8FAFC',
    border: '1px solid rgba(255, 255, 255, 0.15)',
    borderRadius: '8px',
    boxShadow: '0 12px 30px -4px rgba(0, 0, 0, 0.6), 0 4px 12px -2px rgba(0, 0, 0, 0.4)',
    padding: '4px',
    minWidth: `${Math.max(rect.width, 160)}px`,
    maxWidth: '420px',
    maxHeight: `${options.maxHeight || 280}px`,
    overflowY: 'auto',
    fontFamily,
    fontSize,
    boxSizing: 'border-box'
  });

  // Calculate vertical position (check available viewport space)
  const viewportHeight = doc.documentElement.clientHeight;
  const viewportWidth = doc.documentElement.clientWidth;
  const estimatedMenuHeight = Math.min(select.options.length * 36 + 12, options.maxHeight || 280);

  const spaceBelow = viewportHeight - rect.bottom;
  const spaceAbove = rect.top;

  let topPos: number;
  if (spaceBelow < estimatedMenuHeight && spaceAbove > spaceBelow) {
    // Open upward
    topPos = rect.top + scrollY - estimatedMenuHeight - 4;
  } else {
    // Open downward
    topPos = rect.bottom + scrollY + 4;
  }

  // Calculate horizontal position with boundary clamping
  let leftPos = rect.left + scrollX;
  const menuWidth = Math.max(rect.width, 160);
  if (leftPos + menuWidth > viewportWidth + scrollX - 8) {
    leftPos = Math.max(scrollX + 8, viewportWidth + scrollX - menuWidth - 8);
  }
  if (leftPos < scrollX + 8) {
    leftPos = scrollX + 8;
  }

  menu.style.top = `${Math.max(scrollY + 4, topPos)}px`;
  menu.style.left = `${leftPos}px`;

  let highlightedIndex = select.selectedIndex >= 0 ? select.selectedIndex : 0;
  const optionElements: HTMLElement[] = [];

  // Populate options using safe DOM manipulation (never innerHTML)
  Array.from(select.options).forEach((opt, idx) => {
    const item = doc.createElement('div');
    item.setAttribute('data-testid', `preview-select-option-${idx}`);
    item.setAttribute('role', 'option');
    item.setAttribute('aria-selected', idx === select.selectedIndex ? 'true' : 'false');
    item.textContent = opt.textContent || opt.label || '';

    const isSelected = idx === select.selectedIndex;
    const isHighlighted = idx === highlightedIndex;

    applyOptionStyle(item, isSelected, isHighlighted, opt.disabled);

    if (!opt.disabled) {
      item.addEventListener('mouseenter', () => {
        highlightedIndex = idx;
        updateHighlight();
      });

      item.addEventListener('click', (optClickEvent) => {
        optClickEvent.stopPropagation();
        selectOption(idx);
      });
    }

    menu.appendChild(item);
    optionElements.push(item);
  });

  function updateHighlight() {
    optionElements.forEach((el, i) => {
      const isSelected = i === select.selectedIndex;
      const isHighlighted = i === highlightedIndex;
      const disabled = select.options[i]?.disabled || false;
      applyOptionStyle(el, isSelected, isHighlighted, disabled);
      if (isHighlighted) {
        el.scrollIntoView({ block: 'nearest' });
      }
    });
  }

  function selectOption(idx: number) {
    const opt = select.options[idx];
    if (!opt || opt.disabled) return;

    select.selectedIndex = idx;
    select.value = opt.value;

    // Dispatch input and change events with bubbles: true
    const inputEvent = new Event('input', { bubbles: true, cancelable: true });
    const changeEvent = new Event('change', { bubbles: true, cancelable: true });
    select.dispatchEvent(inputEvent);
    select.dispatchEvent(changeEvent);

    closeActivePreviewSelectMenu();
    select.focus();
  }

  // Keyboard navigation inside open menu
  const handleMenuKeyDown = (e: KeyboardEvent) => {
    if (!activeState) return;

    switch (e.key) {
      case 'ArrowDown': {
        e.preventDefault();
        e.stopPropagation();
        let next = highlightedIndex + 1;
        while (next < select.options.length && select.options[next].disabled) {
          next++;
        }
        if (next < select.options.length) {
          highlightedIndex = next;
          updateHighlight();
        }
        break;
      }

      case 'ArrowUp': {
        e.preventDefault();
        e.stopPropagation();
        let prev = highlightedIndex - 1;
        while (prev >= 0 && select.options[prev].disabled) {
          prev--;
        }
        if (prev >= 0) {
          highlightedIndex = prev;
          updateHighlight();
        }
        break;
      }

      case 'Home': {
        e.preventDefault();
        e.stopPropagation();
        let first = 0;
        while (first < select.options.length && select.options[first].disabled) {
          first++;
        }
        if (first < select.options.length) {
          highlightedIndex = first;
          updateHighlight();
        }
        break;
      }

      case 'End': {
        e.preventDefault();
        e.stopPropagation();
        let last = select.options.length - 1;
        while (last >= 0 && select.options[last].disabled) {
          last--;
        }
        if (last >= 0) {
          highlightedIndex = last;
          updateHighlight();
        }
        break;
      }

      case 'Enter':
      case ' ': {
        e.preventDefault();
        e.stopPropagation();
        selectOption(highlightedIndex);
        break;
      }

      case 'Escape': {
        e.preventDefault();
        e.stopPropagation();
        closeActivePreviewSelectMenu();
        select.focus();
        break;
      }

      case 'Tab': {
        // Preserve natural Tab navigation: close menu cleanly and let focus advance naturally
        closeActivePreviewSelectMenu();
        // Do NOT call e.preventDefault()
        break;
      }
    }
  };

  // Close menu if window resizes or document scrolls significantly
  const handleScrollOrResize = () => {
    if (activeState) {
      closeActivePreviewSelectMenu();
    }
  };

  doc.addEventListener('keydown', handleMenuKeyDown, { capture: true });
  win.addEventListener('resize', handleScrollOrResize, { passive: true });
  doc.addEventListener('scroll', handleScrollOrResize, { passive: true, capture: true });

  const cleanupListeners = () => {
    doc.removeEventListener('keydown', handleMenuKeyDown, { capture: true });
    win.removeEventListener('resize', handleScrollOrResize);
    doc.removeEventListener('scroll', handleScrollOrResize, { capture: true });
  };

  doc.body.appendChild(menu);

  activeState = {
    menu,
    select,
    highlightedIndex,
    doc,
    win,
    cleanupListeners,
    openedAt: Date.now()
  };

  // Ensure initially highlighted item is visible in menu
  if (highlightedIndex >= 0 && optionElements[highlightedIndex]) {
    optionElements[highlightedIndex].scrollIntoView({ block: 'nearest' });
  }
}

function applyOptionStyle(
  item: HTMLElement,
  isSelected: boolean,
  isHighlighted: boolean,
  disabled: boolean
) {
  Object.assign(item.style, {
    padding: '8px 12px',
    borderRadius: '6px',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? '0.45' : '1',
    backgroundColor: isSelected
      ? '#7C3AED'
      : isHighlighted
      ? 'rgba(255, 255, 255, 0.08)'
      : 'transparent',
    color: isSelected ? '#FFFFFF' : isHighlighted ? '#E2E8F0' : '#CBD5E1',
    fontWeight: isSelected ? '600' : '400',
    fontSize: 'inherit',
    lineHeight: '1.4',
    userSelect: 'none',
    transition: 'background-color 0.1s ease, color 0.1s ease'
  });
}
