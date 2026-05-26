import { createId, createSlug } from "./ids";
import type {
  BoardBundle,
  BoardCard,
  BoardFile,
  BoardIndexItem,
  CardMeta,
  CardType,
  ColumnCard,
  FileCard,
  ImageCard,
  LinkCard,
  NoteCard,
  Point,
  WorkspaceFile,
} from "../types";

const DEFAULT_CARD_SIZE = {
  note: { width: 304, height: 64 },
  todo: { width: 304, height: 64 },
  link: { width: 304, height: 64 },
  image: { width: 280, height: 220 },
  file: { width: 320, height: 260 },
  column: { width: 300, height: 360 },
  board: { width: 304, height: 64 },
} as const;

export function createWorkspace(): { workspace: WorkspaceFile; rootBoard: BoardBundle } {
  const rootBoardId = createId("board");
  const rootBoardSlug = "root-board";
  const rootBoard = createBoardBundle({
    id: rootBoardId,
    slug: rootBoardSlug,
    title: "Main Board",
    parentBoardId: null,
  });

  return {
    workspace: {
      version: 1,
      rootBoardId,
      recentBoardId: rootBoardId,
      boards: [
        {
          id: rootBoardId,
          slug: rootBoardSlug,
          title: "Main Board",
          parentBoardId: null,
        },
      ],
    },
    rootBoard,
  };
}

export function createBoardBundle(input: {
  id?: string;
  slug?: string;
  title: string;
  parentBoardId: string | null;
}): BoardBundle {
  const id = input.id ?? createId("board");
  return {
    board: {
      version: 1,
      id,
      slug: input.slug ?? createSlug(input.title),
      title: input.title,
      parentBoardId: input.parentBoardId,
      viewport: { x: 0, y: 0, zoom: 1 },
      cards: [],
      edges: [],
    },
    documents: {},
  };
}

export function createCardMeta(type: CardType, position: Point): CardMeta {
  const size = DEFAULT_CARD_SIZE[type];

  if (type === "note" || type === "todo") {
    const card: NoteCard = {
      id: createId(type),
      type,
      title: type === "note" ? "Untitled note" : "Untitled to-do",
      parentId: null,
      position,
      size,
    };
    return card;
  }

  if (type === "link") {
    const card: LinkCard = {
      id: createId("link"),
      type: "link",
      title: "New link",
      parentId: null,
      position,
      size,
      url: "",
    };
    return card;
  }

  if (type === "image") {
    const card: ImageCard = {
      id: createId("image"),
      type: "image",
      title: "New image",
      parentId: null,
      position,
      size,
      assetPath: "",
    };
    return card;
  }

  if (type === "file") {
    const card: FileCard = {
      id: createId("file"),
      type: "file",
      title: "New file",
      parentId: null,
      position,
      size,
      assetPath: "",
      mimeType: "",
      extension: "",
      sizeBytes: 0,
    };
    return card;
  }

  if (type === "column") {
    const card: ColumnCard = {
      id: createId("column"),
      type: "column",
      title: "Column",
      parentId: null,
      position,
      size,
      childCardIds: [],
    };
    return card;
  }

  const boardCard: BoardCard = {
    id: createId("boardcard"),
    type: "board",
    title: "New board",
    parentId: null,
    position,
    size,
    childBoardId: "",
  };
  return boardCard;
}

export function createBoardIndexItem(board: BoardFile): BoardIndexItem {
  return {
    id: board.id,
    slug: board.slug,
    title: board.title,
    parentBoardId: board.parentBoardId,
  };
}
