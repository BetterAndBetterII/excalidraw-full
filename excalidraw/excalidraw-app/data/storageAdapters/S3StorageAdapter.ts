import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectsCommand,
} from "@aws-sdk/client-s3";
import {
  CanvasData,
  CanvasMetadata,
  dehydrateCanvasData,
  hydrateCanvasData,
  IStorageAdapter,
} from "../storage";
import { generateThumbnail } from "../thumbnail";

const KEY_PREFIX_METADATA = "excalidraw-canvas-meta-";
const KEY_PREFIX_DATA = "excalidraw-canvas-data-";

export class S3StorageAdapter implements IStorageAdapter {
  private s3: S3Client;
  private bucketName: string;

  constructor(config: {
    accessKeyId: string;
    secretAccessKey: string;
    region: string;
    bucketName: string;
  }) {
    this.s3 = new S3Client({
      region: config.region,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
    this.bucketName = config.bucketName;
  }

  private async getObject(key: string): Promise<any | null> {
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucketName,
        Key: key,
      });
      const response = await this.s3.send(command);
      const body = await response.Body?.transformToString();
      return body ? JSON.parse(body) : null;
    } catch (error: any) {
      if (error.name === "NoSuchKey") {
        return null;
      }
      throw error;
    }
  }

  async listCanvases(): Promise<CanvasMetadata[]> {
    const command = new ListObjectsV2Command({
      Bucket: this.bucketName,
      Prefix: KEY_PREFIX_METADATA,
    });
    const response = await this.s3.send(command);
    if (!response.Contents) {
      return [];
    }

    const metadataPromises = response.Contents.map((obj: { Key?: string }) =>
      this.getObject(obj.Key!),
    );
    const results = await Promise.all(metadataPromises);
    return results.filter(
      (m: CanvasMetadata | null): m is CanvasMetadata => m !== null,
    );
  }

  async loadCanvas(id: string): Promise<CanvasData | null> {
    const rawData = await this.getObject(`${KEY_PREFIX_DATA}${id}`);
    return rawData ? hydrateCanvasData(rawData) : null;
  }

  async saveCanvas(id: string, data: CanvasData): Promise<void> {
    const metadataKey = `${KEY_PREFIX_METADATA}${id}`;
    const dataKey = `${KEY_PREFIX_DATA}${id}`;

    const existingMetadata = await this.getObject(metadataKey);
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

    await Promise.all([
      this.s3.send(
        new PutObjectCommand({
          Bucket: this.bucketName,
          Key: metadataKey,
          Body: JSON.stringify(updatedMetadata),
          ContentType: "application/json",
        }),
      ),
      this.s3.send(
        new PutObjectCommand({
          Bucket: this.bucketName,
          Key: dataKey,
          Body: JSON.stringify(dehydratedData),
          ContentType: "application/json",
        }),
      ),
    ]);
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
      thumbnail: data.elements.length > 0 ? thumbnail : undefined,
    };

    const metadataKey = `${KEY_PREFIX_METADATA}${newId}`;
    const dataKey = `${KEY_PREFIX_DATA}${newId}`;
    const dehydratedData = dehydrateCanvasData(data);

    await Promise.all([
      this.s3.send(
        new PutObjectCommand({
          Bucket: this.bucketName,
          Key: metadataKey,
          Body: JSON.stringify(newMetadata),
          ContentType: "application/json",
        }),
      ),
      this.s3.send(
        new PutObjectCommand({
          Bucket: this.bucketName,
          Key: dataKey,
          Body: JSON.stringify(dehydratedData),
          ContentType: "application/json",
        }),
      ),
    ]);

    return newMetadata;
  }

  async deleteCanvas(id: string): Promise<void> {
    const command = new DeleteObjectsCommand({
      Bucket: this.bucketName,
      Delete: {
        Objects: [
          { Key: `${KEY_PREFIX_METADATA}${id}` },
          { Key: `${KEY_PREFIX_DATA}${id}` },
        ],
      },
    });
    await this.s3.send(command);
  }

  async renameCanvas(id: string, newName: string): Promise<void> {
    const metadataKey = `${KEY_PREFIX_METADATA}${id}`;
    const metadata = await this.getObject(metadataKey);
    if (!metadata) {
      throw new Error("Canvas metadata not found. Cannot rename.");
    }
    metadata.name = newName;
    metadata.updatedAt = new Date().toISOString();

    const data = await this.loadCanvas(id);
    if (!data) {
      throw new Error("Canvas data not found. Cannot rename.");
    }
    data.appState.name = newName;

    await this.saveCanvas(id, data);
  }
}
