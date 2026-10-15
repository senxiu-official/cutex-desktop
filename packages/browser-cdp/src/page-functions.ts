// Original fixed code. Every receiver is resolved into the executor's private main-frame
// isolated world. Never run these in the page/default world or accept agent JavaScript.
export const FRAME_IDENTITY = `function(mainWindow) {
  return this.ownerDocument && this.ownerDocument.defaultView === mainWindow;
}`;

export const INSPECT = `function(action) {
  if (!this.isConnected) return { error: 'stale_ref' };
  if (this.nodeType !== 1) return { error: 'not_actionable' };
  if (this.ownerDocument.defaultView !== window) return { error: 'unsupported_frame' };
  if (this.tagName === 'IFRAME' || this.tagName === 'FRAME') return { error: 'unsupported_frame' };
  const style = getComputedStyle(this);
  const rect = this.getBoundingClientRect();
  if (this.matches(':disabled') || this.closest('[inert]') || this.getAttribute('aria-disabled') === 'true' ||
      style.visibility !== 'visible' || style.display === 'none' || Number(style.opacity) === 0 ||
      this.getClientRects().length === 0 || rect.width <= 0 || rect.height <= 0)
    return { error: 'not_actionable' };
  const left = Math.max(0, rect.left), top = Math.max(0, rect.top);
  const right = Math.min(innerWidth, rect.right), bottom = Math.min(innerHeight, rect.bottom);
  if (right <= left || bottom <= top) return { error: 'not_actionable' };
  const x = (left + right) / 2, y = (top + bottom) / 2;
  const hit = this.ownerDocument.elementFromPoint(x, y);
  if (!hit || !(hit === this || this.contains(hit))) return { error: 'not_actionable' };
  if (action === 'fill') {
    const editable = this.tagName === 'TEXTAREA' || (this.tagName === 'INPUT' &&
      ['text','search','tel','url','password','email'].includes(this.type));
    if (!editable || this.readOnly) return { error: 'not_actionable' };
  }
  if (action === 'select' && this.tagName !== 'SELECT') return { error: 'not_actionable' };
  if ((action === 'check' || action === 'uncheck') && !(this.tagName === 'INPUT' && this.type === 'checkbox')) return { error: 'not_actionable' };
  return { x, y, checked: this.checked, rect: { x:left,y:top,width:right-left,height:bottom-top } };
}`;

// The receipt closure, listener and DOM wrappers stay in the isolated world. Main-world
// prototype/expando overrides cannot forge them. The page still controls its DOM and can
// suppress an event or change its value: this is an input receipt, not a business result.
export const ARM_RECEIPT = `function(action, key) {
  const node = this;
  const receipt = { seen: false, value: undefined, connected: true, cleanup: null };
  const type = action === 'click' ? 'click' : action === 'fill' ? 'input' : 'keydown';
  const listener = event => {
    if (!event.isTrusted || !(event.target === node || node.contains(event.target))) return;
    if (action === 'press' && event.key !== key) return;
    receipt.seen = true;
  };
  node.ownerDocument.addEventListener(type, listener, true);
  receipt.read = () => ({ seen: receipt.seen, value: node.value, connected: node.isConnected });
  receipt.cleanup = () => node.ownerDocument.removeEventListener(type, listener, true);
  return receipt;
}`;

export const SELECT_VALUE = `function() {
  if (!this.isConnected) return { error: 'stale_ref' };
  if (this.ownerDocument.activeElement !== this) return { error: 'not_actionable' };
  // Email controls do not implement the text selection API. Choose the native
  // keyboard path BEFORE any attempt; never retry after a setter throws.
  if (this.tagName === 'INPUT' && this.type === 'email') return { keyboardSelect: true };
  this.setSelectionRange(0, this.value.length);
  return { ok: true };
}`;

export const CHECK_FOCUS = `function() {
  return { focused: this.isConnected && this.ownerDocument.activeElement === this };
}`;

export const SCROLL_INTO_VIEW = `function() {
  if (!this.isConnected) return {error:'stale_ref'};
  if (this.ownerDocument.defaultView !== window || this.tagName === 'IFRAME' || this.tagName === 'FRAME') return {error:'unsupported_frame'};
  this.scrollIntoView({block:'center',inline:'center',behavior:'instant'});
  return {ok:true};
}`;
export const SELECT_OPTIONS = `function(by, values, apply) {
  if (!this.isConnected) return {error:'stale_ref'};
  if (this.tagName !== 'SELECT' || this.matches(':disabled') || this.closest('[inert]')) return {error:'not_actionable'};
  const options = Array.from(Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'options').get.call(this));
  const value = Object.getOwnPropertyDescriptor(HTMLOptionElement.prototype,'value').get;
  const label = Object.getOwnPropertyDescriptor(HTMLOptionElement.prototype,'label').get;
  const disabled = Object.getOwnPropertyDescriptor(HTMLOptionElement.prototype,'disabled').get;
  const selected = Object.getOwnPropertyDescriptor(HTMLOptionElement.prototype,'selected');
  const multiple = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'multiple').get.call(this);
  if (!multiple && values.length !== 1) return {error:'not_actionable'};
  const chosen = values.map(want => options.filter(o => (by === 'value' ? value : label).call(o) === want));
  if (chosen.some(matches => matches.length !== 1 || disabled.call(matches[0]) || matches[0].closest('optgroup:disabled'))) return {error:'not_actionable'};
  const wanted = new Set(chosen.flat());
  const expected = chosen.flat().map(o=>value.call(o));
  if (!apply) return {ok:true};
  for (const option of options) selected.set.call(option,wanted.has(option));
  // These standard select events are intentionally NOT claimed to be trusted.
  this.dispatchEvent(new Event('input',{bubbles:true})); this.dispatchEvent(new Event('change',{bubbles:true}));
  return {values:options.filter(o=>selected.get.call(o)).map(o=>value.call(o)), expected};
}`;
export const CHECKED_STATE = `function() {
  return {checked:this.tagName==='INPUT'&&Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'checked').get.call(this)};
}`;
export const ARM_MOTION = `function(kind) {
  const node=this, doc=this.ownerDocument||this.document;
  let seen=false; const type=kind==='hover'?'mousemove':'wheel';
  const listener=e=>{if(e.isTrusted&&(node===doc.defaultView||e.target===node||node.contains(e.target)))seen=true};
  doc.addEventListener(type,listener,true);
  return {read:()=>({seen}),cleanup:()=>doc.removeEventListener(type,listener,true)};
}`;
