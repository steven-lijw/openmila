export interface FilePreviewMeta {
  extension: string;
  label: string;
  canRenderInline: boolean;
  kind: "pdf" | "document" | "presentation" | "spreadsheet" | "text" | "media" | "other";
}

const DOCUMENT_EXTENSIONS = new Set(["doc", "docx", "pages", "rtf"]);
const PRESENTATION_EXTENSIONS = new Set(["ppt", "pptx", "key"]);
const SPREADSHEET_EXTENSIONS = new Set(["xls", "xlsx", "csv", "numbers"]);
const TEXT_EXTENSIONS = new Set(["txt", "md", "json", "html", "htm", "csv"]);
const MEDIA_EXTENSIONS = new Set(["mp4", "webm", "mp3", "wav", "ogg"]);
const INLINE_EXTENSIONS = new Set(["pdf", "txt", "md", "json", "html", "htm", "csv", "mp4", "webm", "mp3", "wav", "ogg"]);

export function getFileExtension(fileName: string): string {
  const segments = fileName.toLowerCase().split(".");
  return segments.length > 1 ? segments.at(-1) ?? "" : "";
}

export function formatFileSize(sizeBytes: number): string {
  if (sizeBytes < 1024) {
    return `${sizeBytes} B`;
  }
  if (sizeBytes < 1024 * 1024) {
    return `${(sizeBytes / 1024).toFixed(1)} KB`;
  }
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function getFilePreviewMeta(input: { fileName: string; mimeType: string }) : FilePreviewMeta {
  const extension = getFileExtension(input.fileName);
  const lowerMimeType = input.mimeType.toLowerCase();

  if (extension === "pdf" || lowerMimeType === "application/pdf") {
    return {
      extension,
      label: "PDF",
      canRenderInline: true,
      kind: "pdf",
    };
  }

  if (DOCUMENT_EXTENSIONS.has(extension)) {
    return {
      extension,
      label: extension.toUpperCase(),
      canRenderInline: true,
      kind: "document",
    };
  }

  if (PRESENTATION_EXTENSIONS.has(extension)) {
    return {
      extension,
      label: extension.toUpperCase(),
      canRenderInline: true,
      kind: "presentation",
    };
  }

  if (SPREADSHEET_EXTENSIONS.has(extension)) {
    return {
      extension,
      label: extension.toUpperCase(),
      canRenderInline: true,
      kind: "spreadsheet",
    };
  }

  if (TEXT_EXTENSIONS.has(extension) || lowerMimeType.startsWith("text/")) {
    return {
      extension,
      label: extension ? extension.toUpperCase() : "TEXT",
      canRenderInline: true,
      kind: "text",
    };
  }

  if (MEDIA_EXTENSIONS.has(extension) || lowerMimeType.startsWith("audio/") || lowerMimeType.startsWith("video/")) {
    return {
      extension,
      label: extension ? extension.toUpperCase() : "MEDIA",
      canRenderInline: true,
      kind: "media",
    };
  }

  return {
    extension,
    label: extension ? extension.toUpperCase() : "FILE",
    canRenderInline: INLINE_EXTENSIONS.has(extension),
    kind: "other",
  };
}
