/**
 * Cross-browser file picker.
 * Uses showOpenFilePicker when available (Chromium); falls back to a hidden
 * <input type="file"> which Safari and Firefox support.
 */

export type PickFileOptions = {
  /** accept attribute, e.g. "image/*" or ".pdf,.doc" */
  accept?: string;
  multiple?: boolean;
};

/**
 * Prompt the user to pick one or more files.
 * Resolves to an empty array if the user cancels.
 */
export async function pickFiles(options: PickFileOptions = {}): Promise<File[]> {
  const multiple = options.multiple === true;

  if (typeof window.showOpenFilePicker === "function") {
    try {
      const handles = await window.showOpenFilePicker({
        excludeAcceptAllOption: false,
        multiple,
        ...(options.accept
          ? {
              // Chromium types API is richer; a single catch-all is fine for our tools.
              types: [
                {
                  description: "Files",
                  accept: acceptToTypes(options.accept),
                },
              ],
            }
          : {}),
      });
      const files: File[] = [];
      for (const handle of handles) {
        files.push(await handle.getFile());
      }
      return files;
    } catch (error) {
      // Cancel → empty; other errors rethrow.
      if (
        error &&
        typeof error === "object" &&
        ((error as { name?: string }).name === "AbortError" ||
          (error as { name?: string }).name === "NotAllowedError")
      ) {
        return [];
      }
      // If the typed types config is rejected, fall through to <input>.
    }
  }

  return pickFilesViaInput(options);
}

export async function pickSingleFile(options: PickFileOptions = {}): Promise<File | null> {
  const files = await pickFiles({ ...options, multiple: false });
  return files[0] ?? null;
}

function pickFilesViaInput(options: PickFileOptions): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = options.multiple === true;
    if (options.accept) {
      input.accept = options.accept;
    }
    // iOS Safari sometimes needs the input in the DOM to fire change.
    input.style.position = "fixed";
    input.style.left = "-9999px";
    input.style.top = "0";
    input.style.opacity = "0";
    document.body.appendChild(input);

    let settled = false;
    const cleanup = () => {
      if (input.parentNode) {
        input.parentNode.removeChild(input);
      }
      window.removeEventListener("focus", onFocus);
    };
    const finish = (files: File[]) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve(files);
    };

    input.addEventListener("change", () => {
      finish(Array.from(input.files ?? []));
    });

    // Detect cancel: focus returns to window without a change event.
    const onFocus = () => {
      window.setTimeout(() => {
        if (!settled) {
          finish([]);
        }
      }, 400);
    };
    window.addEventListener("focus", onFocus);

    input.click();
  });
}

function acceptToTypes(accept: string): Record<string, string[]> {
  // Map a simple accept string into the Chromium accept object shape.
  // "image/*" → { "image/*": [] }; ".png,.jpg" → { "application/octet-stream": [".png", ".jpg"] }
  const parts = accept.split(",").map((p) => p.trim()).filter(Boolean);
  const result: Record<string, string[]> = {};
  for (const part of parts) {
    if (part.includes("/")) {
      result[part] = result[part] ?? [];
    } else if (part.startsWith(".")) {
      const key = "application/octet-stream";
      result[key] = result[key] ?? [];
      result[key].push(part);
    }
  }
  if (Object.keys(result).length === 0) {
    return { "*/*": [] };
  }
  return result;
}
