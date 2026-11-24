import { useRef, type KeyboardEvent, type ReactNode } from 'react';

interface Props<T> {
  items: T[];
  getKey: (item: T) => string;
  selectedKey: string | null;
  onSelect: (item: T) => void;
  renderItem: (item: T, selected: boolean) => ReactNode;
  label: string;
  isDisabled?: (item: T) => boolean;
}

/**
 * Accessible single-select list (ARIA listbox) with roving focus:
 * ↑/↓ move, Home/End jump, Enter/Space select. Selection is never changed by focus alone.
 */
export function SelectList<T>({ items, getKey, selectedKey, onSelect, renderItem, label }: Props<T>) {
  const listRef = useRef<HTMLUListElement>(null);
  const selectedIndex = items.findIndex((i) => getKey(i) === selectedKey);
  const tabStop = selectedIndex >= 0 ? selectedIndex : 0;

  const focusAt = (idx: number) => {
    const el = listRef.current?.querySelectorAll<HTMLElement>('[role="option"]')[idx];
    el?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLLIElement>, idx: number) => {
    let next = -1;
    if (e.key === 'ArrowDown') next = Math.min(items.length - 1, idx + 1);
    else if (e.key === 'ArrowUp') next = Math.max(0, idx - 1);
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = items.length - 1;
    else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const item = items[idx];
      if (item !== undefined) onSelect(item);
      return;
    }
    if (next >= 0) {
      e.preventDefault();
      focusAt(next);
    }
  };

  return (
    <ul className="select-list" role="listbox" aria-label={label} ref={listRef}>
      {items.map((item, idx) => {
        const key = getKey(item);
        const selected = key === selectedKey;
        return (
          <li
            key={key}
            role="option"
            aria-selected={selected}
            tabIndex={idx === tabStop ? 0 : -1}
            className={`select-item${selected ? ' selected' : ''}`}
            onClick={() => onSelect(item)}
            onKeyDown={(e) => onKeyDown(e, idx)}
          >
            {renderItem(item, selected)}
          </li>
        );
      })}
    </ul>
  );
}
