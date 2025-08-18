import { createStore, set, get, del, entries } from "idb-keyval";
import { CanvasData, CanvasMetadata, IStorageAdapter } from "../storage";
import { generateThumbnail } from "../thumbnail";

const metadataStore = createStore("excalidraw-canvases-metadata", "metadata");
const dataStore = createStore("excalidraw-canvases-data", "data");

export class IndexedDBStorageAdapter implements IStorageAdapter {
  async listCanvases(): Promise<CanvasMetadata[]> {
    const allEntries = await entries<string, CanvasMetadata>(metadataStore);
    return allEntries.map(([, metadata]) => metadata);
  }

  async loadCanvas(id: string): Promise<CanvasData | null> {
    const data = await get<CanvasData>(id, dataStore);
    return data === undefined ? null : data;
  }

  async saveCanvas(id: string, data: CanvasData): Promise<void> {
    const existingMetadata = await get<CanvasMetadata>(id, metadataStore);
    if (!existingMetadata) {
      throw new Error("Canvas metadata not found. Cannot save.");
    }
    const thumbnail = await generateThumbnail(
      data.elements,
      data.appState,
      data.files,
    );

    const updatedMetadata: CanvasMetadata = {
      ...existingMetadata,
      name: data.appState.name || existingMetadata.name,
      updatedAt: new Date().toISOString(),
      thumbnail: data.elements.length > 0 ? thumbnail : undefined,
    };

    await set(id, updatedMetadata, metadataStore);
    await set(id, data, dataStore);
  }

  async createCanvas(data: CanvasData): Promise<CanvasMetadata> {
    const newId = window.crypto.randomUUID();
    const now = new Date().toISOString();
    const thumbnail = await generateThumbnail(
      data.elements,
      data.appState,
      data.files,
    );

    const newMetadata: CanvasMetadata = {
      id: newId,
      name: data.appState.name || "Untitled Canvas",
      createdAt: now,
      updatedAt: now,
      // UserID is 0 for local, non-synced canvases
      thumbnail: data.elements.length > 0 ? thumbnail : undefined,
    };

    await set(newId, newMetadata, metadataStore);
    await set(newId, data, dataStore);

    return newMetadata;
  }

  async deleteCanvas(id: string): Promise<void> {
    await del(id, metadataStore);
    await del(id, dataStore);
  }

  async renameCanvas(id: string, newName: string): Promise<void> {
    // Update metadata
    const existingMetadata = await get<CanvasMetadata>(id, metadataStore);
    if (!existingMetadata) {
      throw new Error("Canvas metadata not found. Cannot rename.");
    }
    await set(id, { ...existingMetadata, name: newName }, metadataStore);

    // Update canvas data
    const existingData = await get<CanvasData>(id, dataStore);
    if (!existingData) {
      // This should not happen if metadata exists, but as a safeguard:
      throw new Error("Canvas data not found. Cannot rename.");
    }
    await set(
      id,
      {
        ...existingData,
        appState: { ...existingData.appState, name: newName },
      },
      dataStore,
    );
  }
}
