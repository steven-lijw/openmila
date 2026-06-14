import { createBoardBundle, createCardMeta } from "./model";
import { createSlug } from "./ids";
import type {
  AppState,
  BoardBundle,
  BoardCard,
  BoardFile,
  CardMeta,
  CardType,
  ColumnCard,
  Edge,
  Point,
  WorkspaceFile,
} from "../types";

export function getBoard(state: AppState, boardId: string): BoardBundle {
  const bundle = state.boards[boardId];
  if (!bundle) {
    throw new Error(`Board not loaded: ${boardId}`);
  }
  return bundle;
}

export function getCard(board: BoardFile, cardId: string): CardMeta {
  const card = board.cards.find((item) => item.id === cardId);
  if (!card) {
    throw new Error(`Card not found: ${cardId}`);
  }
  return card;
}

export function patchCard(board: BoardFile, cardId: string, updater: (card: CardMeta) => CardMeta): BoardFile {
  return {
    ...board,
    cards: board.cards.map((card) => (card.id === cardId ? updater(card) : card)),
  };
}

export function replaceBoardBundle(bundle: BoardBundle, board: BoardFile): BoardBundle {
  return {
    ...bundle,
    board,
  };
}

export function addCardToBoard(bundle: BoardBundle, card: CardMeta): BoardBundle {
  return replaceBoardBundle(bundle, {
    ...bundle.board,
    cards: [...bundle.board.cards, card],
  });
}

export function removeCardFromBoard(bundle: BoardBundle, cardId: string): BoardBundle {
  const nextCards = bundle.board.cards.filter((card) => card.id !== cardId);
  const nextEdges = bundle.board.edges.filter((edge) => edge.fromCardId !== cardId && edge.toCardId !== cardId);
  const nextBoard = nextCards.reduce<BoardFile>(
    (boardState, card) => {
      if (card.type !== "column") {
        return boardState;
      }
      return patchCard(boardState, card.id, (currentCard) => {
        if (currentCard.type !== "column") {
          return currentCard;
        }
        return {
          ...currentCard,
          childCardIds: currentCard.childCardIds.filter((childId) => childId !== cardId),
        };
      });
    },
    {
      ...bundle.board,
      cards: nextCards,
      edges: nextEdges,
    },
  );

  const nextDocuments = { ...bundle.documents };
  delete nextDocuments[cardId];

  return {
    board: nextBoard,
    documents: nextDocuments,
  };
}

export function addDocument(bundle: BoardBundle, cardId: string, markdown: string): BoardBundle {
  return {
    ...bundle,
    documents: {
      ...bundle.documents,
      [cardId]: markdown,
    },
  };
}

export function setBoardTitle(bundle: BoardBundle, title: string): BoardBundle {
  return replaceBoardBundle(bundle, {
    ...bundle.board,
    title,
    slug: createSlug(title),
  });
}

/**
 * Update only the board's title, leaving the slug (and therefore the on-disk
 * directory name) untouched. Used while the user is typing the title so that
 * the slug — which maps to the on-disk path — stays in sync with the disk
 * until a debounced commit renames the directory and updates the slug atomically.
 */
export function setBoardTitleOnly(bundle: BoardBundle, title: string): BoardBundle {
  return replaceBoardBundle(bundle, {
    ...bundle.board,
    title,
  });
}

export function createCardCreationResult(
  workspace: WorkspaceFile,
  bundle: BoardBundle,
  type: CardType,
  position: Point,
): { workspace: WorkspaceFile; boardBundle: BoardBundle; createdBoard?: BoardBundle; createdCardId: string } {
  let card = createCardMeta(type, position);
  let createdBoard: BoardBundle | undefined;

  if (card.type === "board") {
    createdBoard = createBoardBundle({
      title: card.title,
      parentBoardId: bundle.board.id,
    });
    card = {
      ...card,
      childBoardId: createdBoard.board.id,
    } satisfies BoardCard;
  }

  const nextBundle = addCardToBoard(bundle, card);
  return {
    workspace,
    boardBundle: nextBundle,
    createdBoard,
    createdCardId: card.id,
  };
}

export function moveCardToRoot(bundle: BoardBundle, cardId: string, position: Point): BoardBundle {
  const card = getCard(bundle.board, cardId);
  let nextBundle = bundle;

  if (card.parentId) {
    const parentCard = getCard(bundle.board, card.parentId);
    if (parentCard.type === "column") {
      nextBundle = replaceBoardBundle(nextBundle, patchCard(nextBundle.board, parentCard.id, (current) => {
        if (current.type !== "column") {
          return current;
        }
        return {
          ...current,
          childCardIds: current.childCardIds.filter((childId) => childId !== cardId),
        };
      }));
    }
  }

  return replaceBoardBundle(nextBundle, patchCard(nextBundle.board, cardId, (current) => {
    return {
      ...current,
      parentId: null,
      position,
    };
  }));
}

export function moveCardToColumn(
  bundle: BoardBundle,
  cardId: string,
  columnId: string,
  insertIndex?: number,
): BoardBundle {
  const column = getCard(bundle.board, columnId);
  if (column.type !== "column") {
    throw new Error("Drop target is not a column");
  }

  let nextBundle = bundle;
  const movingCard = getCard(bundle.board, cardId);

  if (movingCard.parentId && movingCard.parentId !== columnId) {
    const previousParent = getCard(bundle.board, movingCard.parentId);
    if (previousParent.type === "column") {
      nextBundle = replaceBoardBundle(nextBundle, patchCard(nextBundle.board, previousParent.id, (current) => {
        if (current.type !== "column") {
          return current;
        }
        return {
          ...current,
          childCardIds: current.childCardIds.filter((childId) => childId !== cardId),
        };
      }));
    }
  }

  const baseIds = column.childCardIds.filter((childId) => childId !== cardId);
  const nextIndex = insertIndex === undefined ? baseIds.length : Math.max(0, Math.min(insertIndex, baseIds.length));
  const nextChildCardIds = [...baseIds.slice(0, nextIndex), cardId, ...baseIds.slice(nextIndex)];

  nextBundle = replaceBoardBundle(nextBundle, patchCard(nextBundle.board, columnId, (current) => {
    if (current.type !== "column") {
      return current;
    }
    return {
      ...current,
      childCardIds: nextChildCardIds,
    };
  }));

  return replaceBoardBundle(nextBundle, patchCard(nextBundle.board, cardId, (current) => {
    return {
      ...current,
      parentId: columnId,
    };
  }));
}

export function setCardDocument(bundle: BoardBundle, cardId: string, markdown: string): BoardBundle {
  return {
    ...bundle,
    documents: {
      ...bundle.documents,
      [cardId]: markdown,
    },
  };
}

export function updateEdgeList(board: BoardFile, edge: Edge): BoardFile {
  const duplicate = board.edges.some(
    (item) =>
      (item.fromCardId === edge.fromCardId && item.toCardId === edge.toCardId) ||
      (item.fromCardId === edge.toCardId && item.toCardId === edge.fromCardId),
  );
  if (duplicate || edge.fromCardId === edge.toCardId) {
    return board;
  }
  return {
    ...board,
    edges: [...board.edges, edge],
  };
}

export function removeEdge(board: BoardFile, edgeId: string): BoardFile {
  return {
    ...board,
    edges: board.edges.filter((item) => item.id !== edgeId),
  };
}

export function moveCardsToFront(board: BoardFile, cardIds: string[]): BoardFile {
  if (cardIds.length === 0) {
    return board;
  }
  const cardIdSet = new Set(cardIds);
  const remainingCards = board.cards.filter((card) => !cardIdSet.has(card.id));
  const movedCards = board.cards.filter((card) => cardIdSet.has(card.id));
  return {
    ...board,
    cards: [...remainingCards, ...movedCards],
  };
}
