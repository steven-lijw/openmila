export type CardType = "note" | "todo" | "link" | "image" | "file" | "column" | "board";

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface ViewportState {
  x: number;
  y: number;
  zoom: number;
}

export interface WorkspaceFile {
  version: number;
  rootBoardId: string;
  recentBoardId: string;
  boards: BoardIndexItem[];
}

export interface BoardIndexItem {
  id: string;
  slug: string;
  title: string;
  parentBoardId: string | null;
}

interface CardBase {
  id: string;
  type: CardType;
  title: string;
  parentId: string | null;
  cardColor?: string;
}

export interface NoteCard extends CardBase {
  type: "note" | "todo";
  position: Point;
  size: Size;
}

export interface LinkCard extends CardBase {
  type: "link";
  position: Point;
  size: Size;
  url: string;
}

export interface ImageCard extends CardBase {
  type: "image";
  position: Point;
  size: Size;
  assetPath: string;
}

export interface FileCard extends CardBase {
  type: "file";
  position: Point;
  size: Size;
  assetPath: string;
  mimeType: string;
  extension: string;
  sizeBytes: number;
}

export interface ColumnCard extends CardBase {
  type: "column";
  position: Point;
  size: Size;
  childCardIds: string[];
}

export interface BoardCard extends CardBase {
  type: "board";
  position: Point;
  size: Size;
  childBoardId: string;
}

export type CardMeta = NoteCard | LinkCard | ImageCard | FileCard | ColumnCard | BoardCard;

export interface Edge {
  id: string;
  fromCardId: string;
  toCardId: string;
  arrowDirection?: "left" | "right" | "both";
  lineStyle?: "solid" | "dashed";
}

export interface BoardFile {
  version: number;
  id: string;
  slug: string;
  title: string;
  parentBoardId: string | null;
  viewport: ViewportState;
  cards: CardMeta[];
  edges: Edge[];
}

export interface BoardBundle {
  board: BoardFile;
  documents: Record<string, string>;
}

export interface AppState {
  vaultName: string | null;
  workspace: WorkspaceFile | null;
  boards: Record<string, BoardBundle>;
  currentBoardId: string | null;
  selectedCardIds: string[];
  activeCardId: string | null;
  connectFromCardId: string | null;
  isReady: boolean;
  isSaving: boolean;
  hasUnsavedChanges: boolean;
  error: string | null;
}

export interface ToolDefinition {
  type: CardType;
  title: string;
  subtitle: string;
}

export interface DragToolPayload {
  kind: "tool";
  toolType: CardType;
}

export interface DragCardPayload {
  kind: "card";
  sourceBoardId: string;
  cardId: string;
}
