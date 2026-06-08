import { useEffect, useRef, useState } from "react";
import { getLinkPreview } from "../core/linkPreview";
import { fetchPageMeta, type PageMeta } from "../core/fetchMeta";

interface Props {
  url: string;
}

function isYouTubeUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.hostname.includes("youtube.com") || u.hostname === "youtu.be";
  } catch {
    return false;
  }
}

export function LinkPreviewDisplay({ url }: Props) {
  const [syncPreview, setSyncPreview] = useState(() => getLinkPreview(url));
  const [meta, setMeta] = useState<PageMeta | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    // Reset sync preview when URL changes
    setSyncPreview(getLinkPreview(url));
    setMeta(null);

    // Cancel any in-flight fetch
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    if (!url) return;

    if (isYouTubeUrl(url)) {
      fetch(
        `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`,
        { signal: controller.signal },
      )
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (!controller.signal.aborted && data?.title) {
            setMeta({
              title: data.title,
              description: data.author_name ?? null,
              image: null,
            });
          }
        })
        .catch(() => {});
      return;
    }

    fetchPageMeta(url).then((result) => {
      if (!controller.signal.aborted && result) setMeta(result);
    });

    return () => { controller.abort(); };
  }, [url]);

  if (!syncPreview) {
    return <div className="card-preview card-preview-empty">Enter a URL…</div>;
  }

  const title = meta?.title ?? syncPreview.title;
  const subtitle = meta?.description ?? syncPreview.subtitle;
  const imageUrl = meta?.image ?? syncPreview.imageUrl;

  return (
    <div className="link-preview">
      {imageUrl ? (
        <img src={imageUrl} alt={title} className="link-preview-image" />
      ) : null}
      <div className="link-preview-copy">
        <div className="link-preview-title">{title}</div>
        <div className="link-preview-subtitle">{subtitle}</div>
      </div>
    </div>
  );
}