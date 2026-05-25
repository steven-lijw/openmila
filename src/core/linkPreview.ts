export interface LinkPreview {
  kind: "youtube" | "image" | "website";
  title: string;
  subtitle: string;
  imageUrl: string | null;
  href: string;
}

function normalizeUrl(rawUrl: string): URL | null {
  if (!rawUrl.trim()) {
    return null;
  }

  try {
    return new URL(rawUrl);
  } catch {
    try {
      return new URL(`https://${rawUrl}`);
    } catch {
      return null;
    }
  }
}

function getYouTubeVideoId(url: URL): string | null {
  if (url.hostname === "youtu.be") {
    return url.pathname.slice(1) || null;
  }

  if (url.hostname.includes("youtube.com")) {
    return url.searchParams.get("v");
  }

  return null;
}

export function getLinkPreview(rawUrl: string): LinkPreview | null {
  const url = normalizeUrl(rawUrl);
  if (!url) {
    return null;
  }

  const videoId = getYouTubeVideoId(url);
  if (videoId) {
    return {
      kind: "youtube",
      title: "YouTube preview",
      subtitle: url.hostname,
      imageUrl: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
      href: url.toString(),
    };
  }

  if (/\.(png|jpg|jpeg|gif|webp|avif)$/i.test(url.pathname)) {
    return {
      kind: "image",
      title: url.pathname.split("/").pop() || "Image preview",
      subtitle: url.hostname,
      imageUrl: url.toString(),
      href: url.toString(),
    };
  }

  return {
    kind: "website",
    title: url.hostname.replace(/^www\./, ""),
    subtitle: url.pathname === "/" ? "Website link" : url.pathname,
    imageUrl: null,
    href: url.toString(),
  };
}
