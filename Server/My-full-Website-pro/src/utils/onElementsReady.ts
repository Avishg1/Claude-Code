/**
 * Calls `onReady` with the elements matching `ids` as soon as at least one of them is in the DOM.
 * Needed by hooks that live in the always-mounted layout: page sections are lazy-loaded,
 * so they usually don't exist yet when the layout's effects first run.
 * Returns a cleanup function that stops waiting.
 */
export const onElementsReady = (ids: readonly string[], onReady: (elements: HTMLElement[]) => void): (() => void) => {
  const find = () => ids.map((id) => document.getElementById(id)).filter((el): el is HTMLElement => el !== null);

  const found = find();
  if (found.length > 0) {
    onReady(found);
    return () => {};
  }

  const mutationObserver = new MutationObserver(() => {
    const elements = find();
    if (elements.length === 0) return;
    mutationObserver.disconnect();
    onReady(elements);
  });
  mutationObserver.observe(document.body, { childList: true, subtree: true });
  return () => mutationObserver.disconnect();
};
