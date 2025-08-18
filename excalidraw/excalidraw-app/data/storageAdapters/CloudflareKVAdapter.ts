import { generateThumbnail } from "../thumbnail";
import {
  CanvasData,
  CanvasMetadata,
  dehydrateCanvasData,
  hydrateCanvasData,
  IStorageAdapter,
} from "../storage";

const KEY_PREFIX_METADATA = "excalidraw-canvas-meta:";
const KEY_PREFIX_DATA = "excalidraw-canvas-data:";

export class CloudflareKVAdapter implements IStorageAdapter {
  private kv_url: string;
  private apiToken: string;
  private baseUrl: string;

  constructor(config: { kv_url: string; apiToken: string }) {
    this.kv_url = config.kv_url;
    this.apiToken = config.apiToken;
    this.baseUrl = `https://${this.kv_url}`;
  }

  private getAuthHeaders() {
    return {
      Authorization: `Bearer ${this.apiToken}`,
      "Content-Type": "application/json",
    };
  }

  async listCanvases(): Promise<CanvasMetadata[]> {
    const response = await fetch(
      `${this.baseUrl}/keys?prefix=${KEY_PREFIX_METADATA}`,
      {
        headers: this.getAuthHeaders(),
      },
    );

    if (!response.ok) {
      console.error(
        "Failed to list canvases from Cloudflare KV",
        await response.text(),
      );
      throw new Error("Failed to list canvases from Cloudflare KV.");
    }

    const { result: keys } = (await response.json()) as {
      result: { name: string }[];
    };
    if (!keys || keys.length === 0) {
      return [];
    }

    const metadataPromises = keys.map((key) =>
      this.getCanvasMetadata(key.name),
    );
    const metadata = await Promise.all(metadataPromises);

    // Filter out any nulls that might have occurred if a key was deleted between listing and fetching
    return metadata.filter((m): m is CanvasMetadata => m !== null);
  }

  private async getCanvasMetadata(key: string): Promise<CanvasMetadata | null> {
    const response = await fetch(`${this.baseUrl}/values/${key}`, {
      headers: this.getAuthHeaders(),
    });
    if (!response.ok) {
      if (response.status === 404) {
        return null;
      }
      console.error(
        `Failed to fetch metadata for key ${key}`,
        await response.text(),
      );
      return null;
    }
    return response.json();
  }

  async loadCanvas(id: string): Promise<CanvasData | null> {
    const key = `${KEY_PREFIX_DATA}${id}`;
    const response = await fetch(`${this.baseUrl}/values/${key}`, {
      headers: this.getAuthHeaders(),
    });

    if (!response.ok) {
      if (response.status === 404) {
        return null;
      }
      throw new Error(`Failed to load canvas ${id} from Cloudflare KV.`);
    }

    const rawData = await response.json();
    return hydrateCanvasData(rawData);
  }

  async saveCanvas(id: string, data: CanvasData): Promise<void> {
    const metadataKey = `${KEY_PREFIX_METADATA}${id}`;
    const dataKey = `${KEY_PREFIX_DATA}${id}`;

    const existingMetadata = await this.getCanvasMetadata(metadataKey);
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

    const dehydratedData = dehydrateCanvasData(data);
    const bulkPayload = [
      { key: metadataKey, value: JSON.stringify(updatedMetadata) },
      { key: dataKey, value: JSON.stringify(dehydratedData) },
    ];

    const response = await fetch(`${this.baseUrl}/bulk`, {
      method: "PUT",
      headers: this.getAuthHeaders(),
      body: JSON.stringify(bulkPayload),
    });

    if (!response.ok) {
      throw new Error(`Failed to save canvas ${id} to Cloudflare KV.`);
    }
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
      // Assuming userId comes from a context, hardcoding for now
      thumbnail: data.elements.length > 0 ? thumbnail : undefined,
    };

    const metadataKey = `${KEY_PREFIX_METADATA}${newId}`;
    const dataKey = `${KEY_PREFIX_DATA}${newId}`;
    const dehydratedData = dehydrateCanvasData(data);

    const bulkPayload = [
      { key: metadataKey, value: JSON.stringify(newMetadata) },
      { key: dataKey, value: JSON.stringify(dehydratedData) },
    ];

    const response = await fetch(`${this.baseUrl}/bulk`, {
      method: "PUT",
      headers: this.getAuthHeaders(),
      body: JSON.stringify(bulkPayload),
    });

    if (!response.ok) {
      throw new Error("Failed to create canvas in Cloudflare KV.");
    }

    return newMetadata;
  }

  async deleteCanvas(id: string): Promise<void> {
    const keysToDelete = [
      `${KEY_PREFIX_METADATA}${id}`,
      `${KEY_PREFIX_DATA}${id}`,
    ];

    const response = await fetch(`${this.baseUrl}/bulk`, {
      method: "DELETE",
      headers: this.getAuthHeaders(),
      body: JSON.stringify(keysToDelete),
    });

    if (!response.ok) {
      throw new Error(`Failed to delete canvas ${id} from Cloudflare KV.`);
    }
  }

  async renameCanvas(id: string, newName: string): Promise<void> {
    const metadataKey = `${KEY_PREFIX_METADATA}${id}`;
    const dataKey = `${KEY_PREFIX_DATA}${id}`;

    const [metadata, data] = await Promise.all([
      this.getCanvasMetadata(metadataKey),
      this.loadCanvas(id),
    ]);

    if (!metadata) {
      throw new Error("Canvas metadata not found. Cannot rename.");
    }
    if (!data) {
      throw new Error("Canvas data not found. Cannot rename.");
    }

    const updatedMetadata: CanvasMetadata = { ...metadata, name: newName };
    const updatedData: CanvasData = {
      ...data,
      appState: { ...data.appState, name: newName },
    };

    const dehydratedData = dehydrateCanvasData(updatedData);
    const bulkPayload = [
      { key: metadataKey, value: JSON.stringify(updatedMetadata) },
      { key: dataKey, value: JSON.stringify(dehydratedData) },
    ];

    const response = await fetch(`${this.baseUrl}/bulk`, {
      method: "PUT",
      headers: this.getAuthHeaders(),
      body: JSON.stringify(bulkPayload),
    });

    if (!response.ok) {
      throw new Error(`Failed to rename canvas ${id} in Cloudflare KV.`);
    }
  }
}
