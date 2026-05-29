import { useEffect, useState } from "react";
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
  const [syncPreview] = useState(() => getLinkPreview(url));
  const [meta, setMeta] = useState<PageMeta | null>(null);

  useEffect(() => {
    if (!url) return;
    setMeta(null);

    if (isYouTubeUrl(url)) {
      // YouTube oEmbed is CORS-allowed from the browser
      fetch(
        `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`,
      )
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (data?.title) {
            setMeta({
              title: data.title,
              description: data.author_name ?? null,
              image: null, // keep the sync img.youtube.com thumbnail
            });
          }
        })
        .catch(() => {});
      return;
    }

    // Non-YouTube: fetch metadata from our /api/meta endpoint
    fetchPageMeta(url).then((result) => {
      if (result) setMeta(result);
    });
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
