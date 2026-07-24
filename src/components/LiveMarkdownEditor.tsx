import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MutableRefObject,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { createId } from "../core/ids";
import { renderMarkdown } from "../core/markdown";
import { parseNoteBlocks, serializeNoteBlocks } from "../core/noteBlocks";

export interface LiveMarkdownFormatHandlers {
  wrapSelection: (before: string, after: string) => void;
  insertLinePrefix: (prefix: string) => void;
}

interface LiveMarkdownEditorProps {
  markdown: string;
  onUpdateMarkdown: (markdown: string) => void;
  onTextareaRef: (ref: HTMLTextAreaElement | null) => void;
  onRegisterFormatHandlers?: (handlers: LiveMarkdownFormatHandlers | null) => void;
  placeholder?: string;
}

/** Inclusive block-index range for multi-block document selection. */
interface BlockRange {
  start: number;
  end: number;
}

interface PointerDragState {
  originBlock: number;
  fromTextarea: boolean;
  /** True once the pointer left the origin block (multi-block select). */
  crossed: boolean;
}

/**
 * Typora-style live note editor with document-level block selection.
 *
 * - Inactive blocks always stay rendered (Enter → previous line previews).
 * - Active block is a source textarea.
 * - Cmd/Ctrl+A and cross-block mouse drag select blocks while keeping render —
 *   never flattens the note back into raw source.
 * - Copy / cut / delete / type operate on the selected block range.
 */
export function LiveMarkdownEditor(props: LiveMarkdownEditorProps) {
  const {
    markdown,
    onUpdateMarkdown,
    onTextareaRef,
    onRegisterFormatHandlers,
    placeholder = "Start writing…",
  } = props;

  const [blocks, setBlocks] = useState<string[]>(() => parseNoteBlocks(markdown));
  /** null = all rendered (still inside the card edit session). */
  const [activeIndex, setActiveIndex] = useState<number | null>(0);
  const [focusTick, setFocusTick] = useState(0);
  /** Multi-block selection (inclusive). null = no document selection. */
  const [blockSelection, setBlockSelection] = useState<BlockRange | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const lastEmittedRef = useRef(markdown);
  const blocksRef = useRef(blocks);
  const activeIndexRef = useRef(activeIndex);
  const blockSelectionRef = useRef(blockSelection);
  const caretRef = useRef<"start" | "end" | number>("end");
  const pointerDragRef = useRef<PointerDragState | null>(null);
  blocksRef.current = blocks;
  activeIndexRef.current = activeIndex;
  blockSelectionRef.current = blockSelection;

  const keysRef = useRef<string[]>(blocks.map(() => createId("mdblock")));
  syncSlotKeys(keysRef, blocks.length);

  // ── external markdown → local blocks ──────────────────────────────────────
  useEffect(() => {
    if (markdown === lastEmittedRef.current) {
      return;
    }
    lastEmittedRef.current = markdown;
    const next = parseNoteBlocks(markdown);
    setBlocks(next);
    blocksRef.current = next;
    syncSlotKeys(keysRef, next.length);
    setActiveIndex((i) => (i === null ? null : Math.min(i, next.length - 1)));
    setBlockSelection((sel) => {
      if (!sel) {
        return null;
      }
      const last = Math.max(0, next.length - 1);
      return { start: Math.min(sel.start, last), end: Math.min(sel.end, last) };
    });
  }, [markdown]);

  const commit = useCallback(
    (next: string[]) => {
      setBlocks(next);
      blocksRef.current = next;
      const stored = serializeNoteBlocks(next);
      lastEmittedRef.current = stored;
      onUpdateMarkdown(stored);
    },
    [onUpdateMarkdown],
  );

  const activate = useCallback((index: number, caret: "start" | "end" | number = "end") => {
    caretRef.current = caret;
    setBlockSelection(null);
    blockSelectionRef.current = null;
    setActiveIndex(index);
    setFocusTick((t) => t + 1);
  }, []);

  /**
   * Select an inclusive block range. All blocks stay rendered (no source flatten).
   * Focuses the editor root so copy/cut/delete keyboard shortcuts work.
   */
  const selectBlocks = useCallback((start: number, end: number) => {
    const last = Math.max(0, blocksRef.current.length - 1);
    const lo = Math.max(0, Math.min(start, end, last));
    const hi = Math.max(0, Math.min(Math.max(start, end), last));
    const range = { start: lo, end: hi };
    blockSelectionRef.current = range;
    setBlockSelection(range);
    // Deactivate source field so every selected block shows rendered markdown.
    setActiveIndex(null);
    activeIndexRef.current = null;
  }, []);

  // Keep keyboard focus on the editor root while a block selection is active.
  useLayoutEffect(() => {
    if (!blockSelection) {
      return;
    }
    rootRef.current?.focus({ preventScroll: true });
  }, [blockSelection]);

  const clearBlockSelection = useCallback(() => {
    blockSelectionRef.current = null;
    setBlockSelection(null);
  }, []);

  // Focus after the source field mounts / switches.
  useLayoutEffect(() => {
    if (activeIndex === null || focusTick === 0) {
      return;
    }
    const el = textareaRef.current;
    if (!el) {
      return;
    }
    el.focus();
    const len = el.value.length;
    const caret = caretRef.current;
    if (caret === "start") {
      el.setSelectionRange(0, 0);
    } else if (typeof caret === "number") {
      const pos = Math.max(0, Math.min(caret, len));
      el.setSelectionRange(pos, pos);
    } else {
      el.setSelectionRange(len, len);
    }
  }, [activeIndex, focusTick]);

  // Auto-size source to content.
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el || activeIndex === null) {
      return;
    }
    el.style.height = "0px";
    el.style.height = `${Math.max(el.scrollHeight, 24)}px`;
  }, [blocks, activeIndex]);

  useEffect(() => {
    onTextareaRef(activeIndex !== null ? textareaRef.current : null);
    return () => onTextareaRef(null);
  }, [activeIndex, onTextareaRef]);

  // ── mutations ─────────────────────────────────────────────────────────────
  const updateActive = (value: string) => {
    const i = activeIndexRef.current;
    if (i === null) {
      return;
    }
    const next = blocksRef.current.slice();
    next[i] = value;
    commit(next);
  };

  const splitAtCaret = (value: string, start: number, end: number) => {
    const i = activeIndexRef.current;
    if (i === null) {
      return;
    }
    const before = value.slice(0, start);
    const after = value.slice(end);
    const next = blocksRef.current.slice();
    next[i] = before;
    next.splice(i + 1, 0, after);
    insertSlotKey(keysRef, i + 1);
    commit(next);
    activate(i + 1, "start");
  };

  const mergeWithPrevious = (value: string) => {
    const i = activeIndexRef.current;
    if (i === null || i <= 0) {
      return;
    }
    const prev = blocksRef.current[i - 1] ?? "";
    const caret = prev.length;
    const next = blocksRef.current.slice();
    next.splice(i - 1, 2, prev + value);
    removeSlotKey(keysRef, i);
    commit(next);
    activate(i - 1, caret);
  };

  const selectedMarkdown = useCallback(() => {
    const sel = blockSelectionRef.current;
    if (!sel) {
      return "";
    }
    return serializeNoteBlocks(blocksRef.current.slice(sel.start, sel.end + 1));
  }, []);

  const deleteBlockSelection = useCallback(() => {
    const sel = blockSelectionRef.current;
    if (!sel) {
      return;
    }
    const next = blocksRef.current.slice();
    next.splice(sel.start, sel.end - sel.start + 1);
    if (next.length === 0) {
      next.push("");
    }
    // Drop keys for removed slots.
    const removeCount = sel.end - sel.start + 1;
    for (let n = 0; n < removeCount; n++) {
      removeSlotKey(keysRef, sel.start);
    }
    syncSlotKeys(keysRef, next.length);
    commit(next);
    clearBlockSelection();
    const focusAt = Math.min(sel.start, next.length - 1);
    activate(focusAt, "start");
  }, [activate, clearBlockSelection, commit]);

  const replaceBlockSelectionWith = useCallback(
    (text: string) => {
      const sel = blockSelectionRef.current;
      if (!sel) {
        return;
      }
      const inserted = parseNoteBlocks(text);
      const next = blocksRef.current.slice();
      next.splice(sel.start, sel.end - sel.start + 1, ...inserted);
      // Rebuild keys for simplicity in the replaced span.
      const keys = keysRef.current.slice();
      keys.splice(
        sel.start,
        sel.end - sel.start + 1,
        ...inserted.map(() => createId("mdblock")),
      );
      keysRef.current = keys;
      commit(next);
      clearBlockSelection();
      const focusAt = sel.start + inserted.length - 1;
      const last = inserted[inserted.length - 1] ?? "";
      activate(Math.max(0, focusAt), last.length);
    },
    [activate, clearBlockSelection, commit],
  );

  const wrapSelection = useCallback(
    (before: string, after: string) => {
      // Document block selection: wrap each selected block's full content.
      const sel = blockSelectionRef.current;
      if (sel) {
        const next = blocksRef.current.slice();
        for (let i = sel.start; i <= sel.end; i++) {
          const body = next[i] ?? "";
          next[i] = before + body + after;
        }
        commit(next);
        // Keep multi-select + rendered state.
        selectBlocks(sel.start, sel.end);
        return;
      }

      const el = textareaRef.current;
      const i = activeIndexRef.current;
      if (!el || i === null) {
        return;
      }
      const start = el.selectionStart;
      const end = el.selectionEnd;
      const value = el.value;
      const nextValue =
        value.slice(0, start) + before + value.slice(start, end) + after + value.slice(end);
      const next = blocksRef.current.slice();
      next[i] = nextValue;
      commit(next);
      requestAnimationFrame(() => {
        el.focus();
        el.setSelectionRange(start + before.length, start + before.length + (end - start));
      });
    },
    [commit, selectBlocks],
  );

  const insertLinePrefix = useCallback(
    (prefix: string) => {
      const sel = blockSelectionRef.current;
      if (sel) {
        const next = blocksRef.current.slice();
        for (let i = sel.start; i <= sel.end; i++) {
          const body = next[i] ?? "";
          const lines = body.split("\n").map((line) => prefix + line);
          next[i] = lines.join("\n");
        }
        commit(next);
        selectBlocks(sel.start, sel.end);
        return;
      }

      const el = textareaRef.current;
      const i = activeIndexRef.current;
      if (!el || i === null) {
        return;
      }
      const start = el.selectionStart;
      const value = el.value;
      const lineStart = value.lastIndexOf("\n", start - 1) + 1;
      const nextValue = value.slice(0, lineStart) + prefix + value.slice(lineStart);
      const next = blocksRef.current.slice();
      next[i] = nextValue;
      commit(next);
      requestAnimationFrame(() => {
        el.focus();
        el.setSelectionRange(start + prefix.length, start + prefix.length);
      });
    },
    [commit, selectBlocks],
  );

  useEffect(() => {
    if (!onRegisterFormatHandlers) {
      return;
    }
    if (activeIndex === null && !blockSelection) {
      onRegisterFormatHandlers(null);
      return () => onRegisterFormatHandlers(null);
    }
    onRegisterFormatHandlers({ wrapSelection, insertLinePrefix });
    return () => onRegisterFormatHandlers(null);
  }, [activeIndex, blockSelection, onRegisterFormatHandlers, wrapSelection, insertLinePrefix]);

  // ── clipboard for block selection ─────────────────────────────────────────
  useEffect(() => {
    const onCopy = (event: ClipboardEvent) => {
      const sel = blockSelectionRef.current;
      if (!sel || !rootRef.current) {
        return;
      }
      // Only handle when the selection belongs to this editor.
      if (
        document.activeElement !== rootRef.current &&
        !rootRef.current.contains(document.activeElement)
      ) {
        return;
      }
      const text = selectedMarkdown();
      event.preventDefault();
      event.clipboardData?.setData("text/plain", text);
    };

    const onCut = (event: ClipboardEvent) => {
      const sel = blockSelectionRef.current;
      if (!sel || !rootRef.current) {
        return;
      }
      if (
        document.activeElement !== rootRef.current &&
        !rootRef.current.contains(document.activeElement)
      ) {
        return;
      }
      const text = selectedMarkdown();
      event.preventDefault();
      event.clipboardData?.setData("text/plain", text);
      deleteBlockSelection();
    };

    document.addEventListener("copy", onCopy);
    document.addEventListener("cut", onCut);
    return () => {
      document.removeEventListener("copy", onCopy);
      document.removeEventListener("cut", onCut);
    };
  }, [deleteBlockSelection, selectedMarkdown]);

  // ── cross-block pointer selection ─────────────────────────────────────────
  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      const drag = pointerDragRef.current;
      if (!drag || (event.buttons & 1) === 0) {
        return;
      }
      const root = rootRef.current;
      if (!root) {
        return;
      }
      const hit = hitTestBlockIndex(root, event.clientX, event.clientY);
      if (hit === null) {
        return;
      }
      if (hit !== drag.originBlock) {
        drag.crossed = true;
      }
      if (drag.crossed) {
        selectBlocks(drag.originBlock, hit);
      }
    };

    const onPointerUp = (event: PointerEvent) => {
      const drag = pointerDragRef.current;
      pointerDragRef.current = null;
      if (!drag) {
        return;
      }

      // Multi-block drag → keep the rendered block selection and take keyboard focus.
      if (drag.crossed) {
        rootRef.current?.focus({ preventScroll: true });
        return;
      }

      // Plain click (no block boundary crossed) → exit multi-select and edit that block.
      // Previously we bailed out whenever blockSelection was already set, which trapped
      // the user in a permanent selected state with no way to type again.
      const root = rootRef.current;
      const hit = root ? hitTestBlockIndex(root, event.clientX, event.clientY) : null;
      const target = hit ?? drag.originBlock;
      activate(target, "end");
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, [activate, selectBlocks]);

  // Document-level shortcuts while a rendered block selection is active.
  // (More reliable than only listening on the root div, which can lose focus.)
  useEffect(() => {
    if (!blockSelection) {
      return;
    }

    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (!blockSelectionRef.current) {
        return;
      }
      // Ignore when typing in an unrelated field.
      const t = event.target;
      if (
        t instanceof HTMLInputElement ||
        t instanceof HTMLTextAreaElement ||
        (t instanceof HTMLElement && t.isContentEditable)
      ) {
        // Our editor has no textarea while multi-selecting; skip if some other field.
        if (!rootRef.current?.contains(t)) {
          return;
        }
      }

      const mod = event.metaKey || event.ctrlKey;

      if (mod && event.key === "b") {
        event.preventDefault();
        wrapSelection("**", "**");
        return;
      }
      if (mod && event.key === "i") {
        event.preventDefault();
        wrapSelection("*", "*");
        return;
      }
      if (mod && event.shiftKey && event.key.toLowerCase() === "x") {
        event.preventDefault();
        wrapSelection("~~", "~~");
        return;
      }
      if (mod && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "a") {
        event.preventDefault();
        selectBlocks(0, blocksRef.current.length - 1);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        const focusAt = blockSelectionRef.current?.start ?? 0;
        clearBlockSelection();
        activate(focusAt, "end");
        return;
      }
      if (event.key === "Backspace" || event.key === "Delete") {
        // Stop the workspace "delete selected card" handler from also firing.
        event.preventDefault();
        event.stopImmediatePropagation();
        deleteBlockSelection();
        return;
      }
      if (event.key === "Enter" && !mod) {
        event.preventDefault();
        replaceBlockSelectionWith("");
        return;
      }
      if (!mod && !event.altKey && event.key.length === 1 && !event.isComposing) {
        event.preventDefault();
        replaceBlockSelectionWith(event.key);
      }
    };

    // Capture phase so we run before the workspace "delete card" window listener.
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [
    activate,
    blockSelection,
    clearBlockSelection,
    deleteBlockSelection,
    replaceBlockSelectionWith,
    selectBlocks,
    wrapSelection,
  ]);

  // ── keyboard ──────────────────────────────────────────────────────────────
  const onKeyDownLive = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    const el = event.currentTarget;
    const { selectionStart, selectionEnd, value } = el;
    const mod = event.metaKey || event.ctrlKey;
    const i = activeIndexRef.current;
    if (i === null) {
      return;
    }

    if (mod && event.key === "b") {
      event.preventDefault();
      wrapSelection("**", "**");
      return;
    }
    if (mod && event.key === "i") {
      event.preventDefault();
      wrapSelection("*", "*");
      return;
    }
    if (mod && event.shiftKey && event.key.toLowerCase() === "x") {
      event.preventDefault();
      wrapSelection("~~", "~~");
      return;
    }

    // Cmd/Ctrl+A → select entire note as rendered blocks (no source flatten).
    if (mod && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "a") {
      event.preventDefault();
      selectBlocks(0, blocksRef.current.length - 1);
      return;
    }

    if (event.key === "Enter" && !event.shiftKey && !mod) {
      event.preventDefault();
      splitAtCaret(value, selectionStart, selectionEnd);
      return;
    }

    if (event.key === "Backspace" && selectionStart === 0 && selectionEnd === 0 && i > 0) {
      event.preventDefault();
      mergeWithPrevious(value);
      return;
    }

    if (event.key === "ArrowUp" && selectionStart === 0 && selectionEnd === 0 && i > 0) {
      event.preventDefault();
      activate(i - 1, "end");
      return;
    }

    if (
      event.key === "ArrowDown" &&
      selectionStart === value.length &&
      selectionEnd === value.length &&
      i < blocksRef.current.length - 1
    ) {
      event.preventDefault();
      activate(i + 1, "start");
    }
  };

  const onBlur = () => {
    requestAnimationFrame(() => {
      const focused = document.activeElement;
      if (rootRef.current?.contains(focused)) {
        return;
      }
      if (focused instanceof HTMLElement && focused.closest(".format-btn, .color-bar")) {
        return;
      }
      // Textarea unmount during select-all briefly parks focus on <body> — recover.
      if (
        blockSelectionRef.current &&
        (focused === document.body ||
          focused === document.documentElement ||
          focused === null)
      ) {
        rootRef.current?.focus({ preventScroll: true });
        return;
      }
      const stored = serializeNoteBlocks(blocksRef.current);
      const next = parseNoteBlocks(stored);
      lastEmittedRef.current = stored;
      setBlocks(next);
      blocksRef.current = next;
      syncSlotKeys(keysRef, next.length);
      clearBlockSelection();
      setActiveIndex(null);
      onUpdateMarkdown(stored);
    });
  };

  const beginPointerDrag = (
    event: ReactPointerEvent,
    originBlock: number,
    fromTextarea: boolean,
  ) => {
    if (event.button !== 0) {
      return;
    }
    pointerDragRef.current = { originBlock, fromTextarea, crossed: false };
  };

  const isEmpty = blocks.length === 1 && blocks[0] === "";
  const keys = keysRef.current;
  const sel = blockSelection;

  return (
    <div
      ref={rootRef}
      className={`live-md-editor markdown-body${sel ? " live-md-has-selection" : ""}`}
      tabIndex={sel ? 0 : -1}
      onMouseDown={(event) => event.stopPropagation()}
      onBlur={onBlur}
    >
      {blocks.map((block, index) => {
        const isSelected = Boolean(sel && index >= sel.start && index <= sel.end);
        // While a multi-block selection is active, keep every block rendered.
        const showSource = activeIndex === index && !sel;

        if (showSource) {
          return (
            <textarea
              key={keys[index]}
              ref={(el) => {
                textareaRef.current = el;
                if (el) {
                  onTextareaRef(el);
                }
              }}
              data-md-block-index={index}
              className={`live-md-source${isSelected ? " live-md-block-selected" : ""}`}
              value={block}
              placeholder={isEmpty ? placeholder : undefined}
              rows={1}
              spellCheck
              onChange={(event) => updateActive(event.target.value)}
              onKeyDown={onKeyDownLive}
              onBlur={onBlur}
              onPointerDown={(event) => {
                beginPointerDrag(event, index, true);
              }}
            />
          );
        }

        const html = block ? renderMarkdown(block) : "";
        return (
          <div
            key={keys[index]}
            data-md-block-index={index}
            className={`live-md-block${html ? "" : " live-md-block-empty"}${
              isSelected ? " live-md-block-selected" : ""
            }`}
            dangerouslySetInnerHTML={{ __html: html || "<br>" }}
            onPointerDown={(event) => {
              event.preventDefault();
              beginPointerDrag(event, index, false);
            }}
          />
        );
      })}

      {activeIndex === null && !sel ? (
        <button
          type="button"
          className="live-md-tail"
          aria-label="Continue writing"
          onMouseDown={(event) => {
            event.preventDefault();
            if (isEmpty) {
              activate(0);
              return;
            }
            const next = [...blocksRef.current, ""];
            insertSlotKey(keysRef, next.length - 1);
            commit(next);
            activate(next.length - 1);
          }}
        />
      ) : null}
    </div>
  );
}

// ── hit-testing ─────────────────────────────────────────────────────────────

function hitTestBlockIndex(
  root: HTMLElement,
  clientX: number,
  clientY: number,
): number | null {
  const stack = document.elementsFromPoint(clientX, clientY);
  for (const node of stack) {
    if (!(node instanceof HTMLElement) || !root.contains(node)) {
      continue;
    }
    const host = node.closest<HTMLElement>("[data-md-block-index]");
    if (!host || !root.contains(host)) {
      continue;
    }
    const index = Number(host.dataset.mdBlockIndex);
    if (Number.isFinite(index) && index >= 0) {
      return index;
    }
  }
  return null;
}

// ── slot key helpers ────────────────────────────────────────────────────────

function syncSlotKeys(ref: MutableRefObject<string[]>, length: number) {
  if (ref.current.length < length) {
    const next = ref.current.slice();
    while (next.length < length) {
      next.push(createId("mdblock"));
    }
    ref.current = next;
  } else if (ref.current.length > length) {
    ref.current = ref.current.slice(0, length);
  }
}

function insertSlotKey(ref: MutableRefObject<string[]>, index: number) {
  const next = ref.current.slice();
  next.splice(index, 0, createId("mdblock"));
  ref.current = next;
}

function removeSlotKey(ref: MutableRefObject<string[]>, index: number) {
  ref.current = ref.current.filter((_, i) => i !== index);
}
