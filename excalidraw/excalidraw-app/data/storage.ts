import { ExcalidrawElement } from "../../packages/excalidraw/element/types";
import {
  AppState,
  BinaryFiles,
  Collaborator,
  SocketId,
} from "../../packages/excalidraw/types";

/**
 * Describes the metadata of a canvas.
 */
export interface CanvasMetadata {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  thumbnail?: string;
}

/**
 * Encapsulates the complete data for a single canvas.
 */
export interface CanvasData {
  elements: readonly ExcalidrawElement[];
  appState: AppState;
  files: BinaryFiles;
  thumbnail?: string;
}

/**
 * Defines the contract for all storage adapters.
 * Any storage backend (default server, Cloudflare KV, S3, etc.)
 * must implement this interface to be compatible with the application.
 */
export interface IStorageAdapter {
  /**
   * Lists all canvases available for the current user.
   */
  listCanvases(): Promise<CanvasMetadata[]>;

  /**
   * Loads a single canvas's data.
   * @param id The unique identifier of the canvas to load.
   * @returns The canvas data, or null if not found.
   */
  loadCanvas(id: string): Promise<CanvasData | null>;

  /**
   * Saves a canvas's data. This is typically used for updating an existing canvas.
   * @param id The unique identifier of the canvas to save.
   * @param data The complete data of the canvas.
   */
  saveCanvas(id: string, data: CanvasData): Promise<void>;

  /**
   * Creates a new canvas.
   * @param data The initial data for the new canvas.
   * @returns The metadata of the newly created canvas.
   */
  createCanvas(data: CanvasData): Promise<CanvasMetadata>;

  /**
   * Deletes a canvas.
   * @param id The unique identifier of the canvas to delete.
   */
  deleteCanvas(id: string): Promise<void>;

  /**
   * Renames a canvas.
   * @param id The unique identifier of the canvas to rename.
   * @param newName The new name for the canvas.
   */
  renameCanvas(id: string, newName: string): Promise<void>;
}

/**
 * Converts a raw JSON object into a CanvasData object, ensuring complex types
 * like Map are correctly instantiated.
 * @param data The raw data from the API.
 */
export const hydrateCanvasData = (data: any): CanvasData => {
  const canvasData: CanvasData = { ...data };

  // Ensure collaborators is a Map, not an object.
  if (
    canvasData.appState &&
    canvasData.appState.collaborators &&
    !(canvasData.appState.collaborators instanceof Map)
  ) {
    canvasData.appState.collaborators = new Map(
      Object.entries(
        canvasData.appState.collaborators as { [key: string]: Collaborator },
      ).map(([key, value]) => [key as SocketId, value]),
    );
  } else if (canvasData.appState && !canvasData.appState.collaborators) {
    // Ensure collaborators is at least an empty Map if it's missing.
    canvasData.appState.collaborators = new Map();
  }

  return canvasData;
};

/**
 * Prepares canvas data for JSON serialization, converting complex types like Map
 * into plain objects.
 * @param data The CanvasData object to dehydrate.
 */
export const dehydrateCanvasData = (data: CanvasData) => {
  const dehydratedData = {
    ...data,
    appState: {
      ...data.appState,
      collaborators:
        data.appState.collaborators instanceof Map
          ? Object.fromEntries(data.appState.collaborators)
          : data.appState.collaborators,
    },
  };
  return dehydratedData;
};
