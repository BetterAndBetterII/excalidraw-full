import { useState, useCallback, useEffect } from "react";
import { useAtom } from "jotai";
import { IStorageAdapter, CanvasMetadata, CanvasData } from "../data/storage";
import { AuthError } from "../data/storageAdapters/BackendStorageAdapter";
import { ExcalidrawImperativeAPI } from "../../packages/excalidraw/types";
import { currentCanvasIdAtom } from "../app-jotai";
import { CREATIONS_SIDEBAR_NAME } from "../app_constants";

export const useCanvasManagement = ({
  storageAdapter,
  excalidrawAPI,
  setErrorMessage,
  resetSaveStatus,
}: {
  storageAdapter: IStorageAdapter;
  excalidrawAPI: ExcalidrawImperativeAPI | null | undefined;
  setErrorMessage: (msg: string) => void;
  resetSaveStatus: () => void;
}) => {
  const [canvases, setCanvases] = useState<CanvasMetadata[]>([]);
  const [currentCanvasId, setCurrentCanvasId] = useAtom(currentCanvasIdAtom);

  const refreshCanvases = useCallback(async () => {
    try {
      const canvases = await storageAdapter.listCanvases();
      console.log("canvases", canvases);
      setCanvases(canvases);
    } catch (error) {
      console.error(error);
      setErrorMessage("Could not list your creations.");
    }
  }, [storageAdapter, setErrorMessage]);

  useEffect(() => {
    refreshCanvases();
  }, [refreshCanvases]);

  const openSidebar = excalidrawAPI?.getAppState().openSidebar;
  useEffect(() => {
    if (
      openSidebar?.name === "default" &&
      openSidebar?.tab === CREATIONS_SIDEBAR_NAME
    ) {
      refreshCanvases();
    }
  }, [openSidebar, refreshCanvases]);

  const handleCanvasSelect = useCallback(
    async (id: string) => {
      if (!excalidrawAPI) {
        return;
      }
      try {
        const canvasData = await storageAdapter.loadCanvas(id);
        if (canvasData) {
          excalidrawAPI.updateScene({ appState: { openSidebar: null } });
          excalidrawAPI.addFiles(Object.values(canvasData.files));
          excalidrawAPI.updateScene({
            elements: canvasData.elements,
            appState: canvasData.appState,
            commitToHistory: true,
          });
          setCurrentCanvasId(id);
          resetSaveStatus();
        }
      } catch (error) {
        setErrorMessage("Could not load the canvas.");
      }
    },
    [
      storageAdapter,
      excalidrawAPI,
      setErrorMessage,
      setCurrentCanvasId,
      resetSaveStatus,
    ],
  );

  const handleCanvasDelete = useCallback(
    async (id: string) => {
      if (window.confirm("Are you sure you want to delete this canvas?")) {
        try {
          await storageAdapter.deleteCanvas(id);
          if (currentCanvasId === id) {
            setCurrentCanvasId(null);
            excalidrawAPI?.resetScene();
            resetSaveStatus();
          }
          await refreshCanvases();
        } catch (error: any) {
          if (error instanceof AuthError) {
            setErrorMessage("您需要登录才能删除此画布。");
          } else {
            setErrorMessage("Could not delete the canvas.");
          }
        }
      }
    },
    [
      storageAdapter,
      refreshCanvases,
      setErrorMessage,
      currentCanvasId,
      setCurrentCanvasId,
      excalidrawAPI,
      resetSaveStatus,
    ],
  );

  const handleCanvasCreate = useCallback(
    async (newName: string) => {
      if (!excalidrawAPI) {
        return;
      }
      try {
        const appState = { ...excalidrawAPI.getAppState(), name: newName };
        const newCanvasData = {
          elements: [],
          appState,
          files: {},
        };
        const createdCanvas = await storageAdapter.createCanvas(
          newCanvasData as CanvasData,
        );
        await refreshCanvases();
        excalidrawAPI.resetScene();
        excalidrawAPI.updateScene({ appState: { name: newName } });
        setCurrentCanvasId(createdCanvas.id);
      } catch (error: any) {
        if (error instanceof AuthError) {
          setErrorMessage("您需要登录才能创建新画布。");
        } else {
          setErrorMessage("Could not create new canvas.");
        }
      }
    },
    [
      excalidrawAPI,
      storageAdapter,
      refreshCanvases,
      setErrorMessage,
      setCurrentCanvasId,
    ],
  );

  const handleCanvasRename = useCallback(
    async (id: string, newName: string) => {
      try {
        await storageAdapter.renameCanvas(id, newName);
        await refreshCanvases();
        if (excalidrawAPI && currentCanvasId === id) {
          excalidrawAPI.updateScene({ appState: { name: newName } });
        }
      } catch (error: any) {
        if (error instanceof AuthError) {
          setErrorMessage("您需要登录才能重命名此画布。");
        } else {
          setErrorMessage("Could not rename the canvas.");
        }
      }
    },
    [
      storageAdapter,
      refreshCanvases,
      setErrorMessage,
      excalidrawAPI,
      currentCanvasId,
    ],
  );

  const handleCanvasSaveAs = useCallback(
    async (newName: string) => {
      if (!excalidrawAPI) {
        return;
      }
      try {
        const appState = { ...excalidrawAPI.getAppState(), name: newName };
        const elements = excalidrawAPI.getSceneElements();
        const files = excalidrawAPI.getFiles();

        const newCanvasData = {
          elements,
          appState,
          files,
        };
        const createdCanvas = await storageAdapter.createCanvas(
          newCanvasData as CanvasData,
        );
        await refreshCanvases();
        // After saving as, we should switch to the new canvas
        setCurrentCanvasId(createdCanvas.id);
      } catch (error: any) {
        if (error instanceof AuthError) {
          setErrorMessage("您需要登录才能另存为新画布。");
        } else {
          setErrorMessage("Could not save as new canvas.");
        }
      }
    },
    [
      excalidrawAPI,
      storageAdapter,
      refreshCanvases,
      setErrorMessage,
      setCurrentCanvasId,
    ],
  );

  return {
    canvases,
    handleCanvasSelect,
    handleCanvasDelete,
    handleCanvasCreate,
    handleCanvasRename,
    handleCanvasSaveAs,
    refreshCanvases,
  };
};
