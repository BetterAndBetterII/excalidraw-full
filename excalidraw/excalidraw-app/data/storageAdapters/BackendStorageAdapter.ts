import {
  CanvasData,
  CanvasMetadata,
  dehydrateCanvasData,
  hydrateCanvasData,
  IStorageAdapter,
} from "../storage";
import { nanoid } from "nanoid";
import { generateThumbnail } from "../thumbnail";

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

const API_BASE_URL = "/api/v2/kv";

const getAuthHeaders = () => {
  const token = localStorage.getItem("token");
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
};

export class BackendStorageAdapter implements IStorageAdapter {
  async listCanvases(): Promise<CanvasMetadata[]> {
    const response = await fetch(API_BASE_URL, {
      method: "GET",
      headers: getAuthHeaders(),
    });
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        // For list, we can just return an empty array as if the user has no canvases.
        // This prevents an error popup when a logged-out user opens the app.
        return [];
      }
      throw new Error(`Failed to list canvases: ${response.statusText}`);
    }
    const canvases: CanvasMetadata[] = await response.json();
    return canvases;
  }

  async loadCanvas(id: string): Promise<CanvasData | null> {
    const response = await fetch(`${API_BASE_URL}/${id}`, {
      method: "GET",
      headers: getAuthHeaders(),
    });
    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new AuthError("User is not authenticated");
      }
      throw new Error(`Failed to load canvas: ${response.statusText}`);
    }
    const rawData = await response.json();
    return hydrateCanvasData(rawData);
  }

  async saveCanvas(id: string, data: CanvasData): Promise<void> {
    let dataForUpload: CanvasData;
    if (data.thumbnail) {
      dataForUpload = data;
    } else {
      const thumbnail = await generateThumbnail(
        data.elements,
        data.appState,
        data.files,
      );
      dataForUpload = {
        ...data,
        thumbnail: data.elements.length > 0 ? thumbnail : undefined,
      };
    }
    const saveData = dehydrateCanvasData(dataForUpload);

    const response = await fetch(`${API_BASE_URL}/${id}`, {
      method: "PUT",
      headers: getAuthHeaders(),
      body: JSON.stringify(saveData),
    });
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new AuthError("User is not authenticated");
      }
      throw new Error(`Failed to save canvas:  ${response.statusText}`);
    }
  }

  async createCanvas(data: CanvasData): Promise<CanvasMetadata> {
    const newId = nanoid();
    const token = localStorage.getItem("token");
    if (!token) {
      throw new Error("Authentication token not found.");
    }
    const thumbnail = await generateThumbnail(
      data.elements,
      data.appState,
      data.files,
    );
    const dataWithThumbnail: CanvasData = {
      ...data,
      thumbnail: data.elements.length > 0 ? thumbnail : undefined,
    };

    await this.saveCanvas(newId, dataWithThumbnail);
    return {
      id: newId,
      name: data.appState?.name || "Untitled",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      thumbnail: dataWithThumbnail.thumbnail,
    };
  }

  async deleteCanvas(id: string): Promise<void> {
    const response = await fetch(`${API_BASE_URL}/${id}`, {
      method: "DELETE",
      headers: getAuthHeaders(),
    });
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new AuthError("User is not authenticated");
      }
      throw new Error(`Failed to delete canvas: ${response.statusText}`);
    }
  }

  async renameCanvas(id: string, newName: string): Promise<void> {
    const canvasData = await this.loadCanvas(id);
    if (!canvasData) {
      throw new Error("Canvas not found, cannot rename.");
    }

    const updatedData: CanvasData = {
      ...canvasData,
      appState: {
        ...canvasData.appState,
        name: newName,
      },
    };

    await this.saveCanvas(id, updatedData);
  }
}
