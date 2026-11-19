// Scrolled to the end of a page, nothing readable may sit under the fixed
// ocean footer. The shell reserves space for it; this proves the reserve is
// still big enough, which is the one thing a horizontal-overflow probe cannot
// see. The app scrolls inside <main>, not the window.
export const CLEARANCE = `(async () => {
  const scroller = document.querySelector('main') || document.scrollingElement;
  if (scroller) {
    // Late query/error UI can grow the page after the first scroll. Measure
    // the real page end, rather than mistaking that growth for covered links.
    for (let attempt = 0; attempt < 4; attempt++) {
      scroller.scrollTop = scroller.scrollHeight;
      await new Promise((r) => setTimeout(r, 250));
      if (scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop < 2) break;
    }
  }
  // The decorative overlays: fixed or absolute, ignored by the pointer, and
  // sitting against the bottom of the viewport.
  const overlays = [];
  for (const el of document.querySelectorAll('body *')) {
    const style = getComputedStyle(el);
    if (style.position !== 'fixed' && style.position !== 'absolute') continue;
    if (style.pointerEvents !== 'none') continue;
    const r = el.getBoundingClientRect();
    if (r.height === 0 || r.width < window.innerWidth * 0.5) continue;
    if (r.bottom < window.innerHeight - 4 || r.top > window.innerHeight) continue;
    // A band along the bottom, not a page-height decorative layer: a tall
    // layer covers the whole viewport by definition and would flag everything.
    if (r.height > window.innerHeight * 0.35) continue;
    overlays.push(r);
  }
  if (overlays.length === 0) return { covered: [], overlays: 0 };

  const TEXTY = new Set(['A', 'BUTTON', 'P', 'SPAN', 'STRONG', 'LI', 'DD', 'DT', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LABEL', 'SMALL']);
  const covered = [];
  for (const el of document.querySelectorAll('body *')) {
    if (!TEXTY.has(el.tagName)) continue;
    if (el.closest('[aria-hidden="true"]')) continue;
    if (!el.textContent || !el.textContent.trim()) continue;
    const style = getComputedStyle(el);
    if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) continue;
    const bounds = el.getBoundingClientRect();
    if (bounds.height === 0 || bounds.width === 0) continue;
    // DOM bounds include content outside a nested scrollport. Only the part
    // actually painted through each clipping ancestor can meet the ocean.
    const r = { top: bounds.top, bottom: bounds.bottom, left: bounds.left, right: bounds.right };
    for (let parent = el.parentElement; parent; parent = parent.parentElement) {
      const parentStyle = getComputedStyle(parent);
      const clipsX = /^(auto|scroll|hidden|clip)$/.test(parentStyle.overflowX);
      const clipsY = /^(auto|scroll|hidden|clip)$/.test(parentStyle.overflowY);
      if (!clipsX && !clipsY) continue;
      const box = parent.getBoundingClientRect();
      const left = box.left + parent.clientLeft;
      const top = box.top + parent.clientTop;
      if (clipsX) { r.left = Math.max(r.left, left); r.right = Math.min(r.right, left + parent.clientWidth); }
      if (clipsY) { r.top = Math.max(r.top, top); r.bottom = Math.min(r.bottom, top + parent.clientHeight); }
    }
    if (r.bottom <= r.top || r.right <= r.left) continue;
    if (r.top >= window.innerHeight || r.bottom <= 0) continue;
    // Measured against each band in turn, on both axes.
    let overlap = 0;
    for (const band of overlays) {
      const vertical = Math.min(r.bottom, band.bottom) - Math.max(r.top, band.top);
      const horizontal = Math.min(r.right, band.right) - Math.max(r.left, band.left);
      if (vertical > 0 && horizontal > 0) overlap = Math.max(overlap, vertical);
    }
    if (overlap > 2) {
      covered.push({
        tag: el.tagName.toLowerCase(),
        text: el.textContent.trim().slice(0, 40),
        overlap: Math.round(overlap),
      });
      if (covered.length >= 6) break;
    }
  }
  return { covered, overlays: overlays.length };
})()`;

// Measure the clickable geometry, including native labels and the established
// compact-control pseudo hit areas. Inline prose links use the documented
// WCAG 2.5.8 inline exception; standalone links keep the 44px product floor.
export const TOUCH_TARGETS = String.raw`(() => {
  const selector = 'a[href],button,input:not([type="hidden"]),select,textarea,summary,[role="button"],[role="checkbox"],[role="radio"],[role="switch"],[role="tab"],[role="slider"],[role="combobox"],[role="separator"][tabindex],[contenteditable="true"]';
  const violations = [], exceptions = [];
  let measured = 0;
  const describe = (el) => el.id ? '#' + CSS.escape(el.id) : el.tagName.toLowerCase() + [...el.classList].slice(0, 3).map((name) => '.' + CSS.escape(name)).join('');
  const visible = (el) => {
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    for (let parent = el; parent; parent = parent.parentElement) if (Number(getComputedStyle(parent).opacity) === 0) return false;
    return true;
  };
  const rect = (box) => ({ left: box.left, top: box.top, right: box.right, bottom: box.bottom });
  const clip = (box, origin, includeSelf = false) => {
    const result = { ...box };
    let canScrollX = false, canScrollY = false;
    let apertureX = null, apertureY = null, maxWidth = Infinity, maxHeight = Infinity;
    for (let parent = includeSelf ? origin : origin.parentElement; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent), bounds = parent.getBoundingClientRect();
      // A scrollport can expose its offscreen controls. A hidden/clip ancestor
      // cannot expose the clipped part and genuinely shrinks the hit area.
      const left = bounds.left + parent.clientLeft, top = bounds.top + parent.clientTop;
      if (/^(auto|scroll)$/.test(style.overflowX) && parent.scrollWidth > parent.clientWidth) {
        canScrollX = true;
        apertureX = { left, right: left + parent.clientWidth };
        maxWidth = Math.min(maxWidth, parent.clientWidth);
      }
      if (/^(auto|scroll)$/.test(style.overflowY) && parent.scrollHeight > parent.clientHeight) {
        canScrollY = true;
        apertureY = { top, bottom: top + parent.clientHeight };
        maxHeight = Math.min(maxHeight, parent.clientHeight);
      }
      if (/^(hidden|clip)$/.test(style.overflowX)) {
        if (canScrollX) {
          apertureX.left = Math.max(apertureX.left, left);
          apertureX.right = Math.min(apertureX.right, left + parent.clientWidth);
          maxWidth = Math.min(maxWidth, Math.max(0, apertureX.right - apertureX.left));
        } else {
          result.left = Math.max(result.left, left);
          result.right = Math.min(result.right, left + parent.clientWidth);
        }
      }
      if (/^(hidden|clip)$/.test(style.overflowY)) {
        if (canScrollY) {
          apertureY.top = Math.max(apertureY.top, top);
          apertureY.bottom = Math.min(apertureY.bottom, top + parent.clientHeight);
          maxHeight = Math.min(maxHeight, Math.max(0, apertureY.bottom - apertureY.top));
        } else {
          result.top = Math.max(result.top, top);
          result.bottom = Math.min(result.bottom, top + parent.clientHeight);
        }
      }
    }
    return { width: Math.min(maxWidth, Math.max(0, result.right - result.left)), height: Math.min(maxHeight, Math.max(0, result.bottom - result.top)) };
  };
  const pixels = (value) => /^-?(?:\d+\.?\d*|\.\d+)px$/.test(value) ? Number.parseFloat(value) : null;
  for (const el of document.querySelectorAll(selector)) {
    if (el.matches(':disabled,[aria-disabled="true"]') || el.closest('[inert],[aria-hidden="true"]')) continue;
    const labels = [...(el.labels ?? [])].filter((label) => visible(label) && getComputedStyle(label).pointerEvents !== 'none');
    const style = getComputedStyle(el);
    if ((!visible(el) || style.pointerEvents === 'none') && labels.length === 0) continue;
    const bounds = el.getBoundingClientRect();
    const candidates = [clip(rect(bounds), el), ...labels.map((label) => clip(rect(label.getBoundingClientRect()), label))];
    if (style.position !== 'static' && style.pointerEvents !== 'none') for (const pseudo of ['::before', '::after']) {
      const hit = getComputedStyle(el, pseudo);
      if (hit.position !== 'absolute' || hit.content === 'none' || hit.content === 'normal' || hit.pointerEvents === 'none') continue;
      let width = pixels(hit.width), height = pixels(hit.height);
      if (width === null || height === null) continue;
      if (hit.boxSizing !== 'border-box') {
        width += (pixels(hit.paddingLeft) ?? 0) + (pixels(hit.paddingRight) ?? 0) + (pixels(hit.borderLeftWidth) ?? 0) + (pixels(hit.borderRightWidth) ?? 0);
        height += (pixels(hit.paddingTop) ?? 0) + (pixels(hit.paddingBottom) ?? 0) + (pixels(hit.borderTopWidth) ?? 0) + (pixels(hit.borderBottomWidth) ?? 0);
      }
      const left = pixels(hit.left) ?? (bounds.width - (pixels(hit.right) ?? 0) - width);
      const top = pixels(hit.top) ?? (bounds.height - (pixels(hit.bottom) ?? 0) - height);
      candidates.push(clip({ left: bounds.left + left, right: bounds.left + left + width, top: bounds.top + top, bottom: bounds.top + top + height }, el, true));
    }
    const area = candidates.sort((a, b) => Math.min(b.width, b.height) - Math.min(a.width, a.height) || b.width * b.height - a.width * a.height)[0];
    if (!area || area.width === 0 || area.height === 0) continue;
    measured++;
    if (area.width >= 43.99 && area.height >= 43.99) continue;
    const prose = el.tagName === 'A' && style.display === 'inline' && el.closest('p,li,dd,dt,blockquote,figcaption');
    if (prose) {
      const surrounding = prose.cloneNode(true);
      surrounding.querySelectorAll(selector).forEach((target) => target.remove());
      if (/[\p{L}\p{N}]/u.test(surrounding.textContent ?? '')) {
        exceptions.push({ selector: describe(el), reason: 'Inline sentence link: WCAG 2.5.8 inline exception' });
        continue;
      }
    }
    const labelled = (el.getAttribute('aria-labelledby') ?? '').split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? '').join(' ');
    violations.push({ selector: describe(el), tag: el.tagName.toLowerCase(), type: el.getAttribute('type') || el.getAttribute('role') || '', classes: [...el.classList].join(' '), width: Math.round(area.width * 100) / 100, height: Math.round(area.height * 100) / 100, text: (el.getAttribute('aria-label') || labelled.trim() || labels.map((label) => label.textContent).join(' ') || el.textContent || '').trim().slice(0, 100) });
  }
  return { measured, violations, exceptions };
})()`;
