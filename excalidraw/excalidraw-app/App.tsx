import polyfill from "../packages/excalidraw/polyfill";
import LanguageDetector from "i18next-browser-languagedetector";
import { useCallback, useEffect, useRef, useState, useMemo } from "react";
import { trackEvent } from "../packages/excalidraw/analytics";
import { getDefaultAppState } from "../packages/excalidraw/appState";
import { ErrorDialog } from "../packages/excalidraw/components/ErrorDialog";
import { TopErrorBoundary } from "./components/TopErrorBoundary";
import {
  APP_NAME,
  EDITOR_LS_KEYS,
  EVENT,
  THEME,
  TITLE_TIMEOUT,
  VERSION_TIMEOUT,
} from "../packages/excalidraw/constants";
import { loadFromBlob } from "../packages/excalidraw/data/blob";
import {
  ExcalidrawElement,
  FileId,
  NonDeletedExcalidrawElement,
  Theme,
} from "../packages/excalidraw/element/types";
import { useCallbackRefState } from "../packages/excalidraw/hooks/useCallbackRefState";
import { t } from "../packages/excalidraw/i18n";
import {
  Excalidraw,
  defaultLang,
  LiveCollaborationTrigger,
  TTDDialog,
  TTDDialogTrigger,
  Sidebar,
  DefaultSidebar,
} from "../packages/excalidraw/index";
import {
  AppState,
  ExcalidrawImperativeAPI,
  BinaryFiles,
  ExcalidrawInitialDataState,
  UIAppState,
} from "../packages/excalidraw/types";
import {
  debounce,
  getVersion,
  getFrame,
  isTestEnv,
  preventUnload,
  ResolvablePromise,
  resolvablePromise,
  isRunningInIframe,
} from "../packages/excalidraw/utils";
import {
  FIREBASE_STORAGE_PREFIXES,
  STORAGE_KEYS,
  SYNC_BROWSER_TABS_TIMEOUT,
  CREATIONS_SIDEBAR_NAME,
} from "./app_constants";
import Collab, {
  CollabAPI,
  collabAPIAtom,
  isCollaboratingAtom,
  isOfflineAtom,
} from "./collab/Collab";
import {
  exportToBackend,
  getCollaborationLinkData,
  isCollaborationLink,
  loadScene,
} from "./data";
import {
  importFromLocalStorage,
  importUsernameFromLocalStorage,
} from "./data/localStorage";
import CustomStats from "./CustomStats";
import {
  restore,
  restoreAppState,
  RestoredDataState,
} from "../packages/excalidraw/data/restore";
import { updateStaleImageStatuses } from "./data/FileManager";
import { newElementWith } from "../packages/excalidraw/element/mutateElement";
import { isInitializedImageElement } from "../packages/excalidraw/element/typeChecks";
import { loadFilesFromFirebase } from "./data/firebase";
import {
  LibraryIndexedDBAdapter,
  LibraryLocalStorageMigrationAdapter,
  LocalData,
} from "./data/LocalData";
import { isBrowserStorageStateNewer } from "./data/tabSync";
import clsx from "clsx";
import { reconcileElements } from "./collab/reconciliation";
import {
  parseLibraryTokensFromUrl,
  useHandleLibrary,
} from "../packages/excalidraw/data/library";
import { AppMainMenu } from "./components/AppMainMenu";
import { AppWelcomeScreen } from "./components/AppWelcomeScreen";
import { AppFooter } from "./components/AppFooter";
import { atom, Provider, useAtom, useAtomValue } from "jotai";
import { useAtomWithInitialValue } from "../packages/excalidraw/jotai";
import {
  appJotaiStore,
  storageConfigAtom,
  userAtom,
  currentCanvasIdAtom,
  createCanvasDialogAtom,
  renameCanvasDialogAtom,
  saveAsDialogAtom,
} from "./app-jotai";
import { jwtDecode } from "jwt-decode";
import { useCanvasManagement } from "./hooks/useCanvasManagement";
import { useAuth } from "./hooks/useAuth";
import { CreateCanvasDialog } from "./components/CreateCanvasDialog";
import { RenameCanvasDialog } from "./components/RenameCanvasDialog";
import { SaveAsDialog } from "./components/SaveAsDialog";

import "./index.scss";
import { ResolutionType } from "../packages/excalidraw/utility-types";
import { ShareableLinkDialog } from "../packages/excalidraw/components/ShareableLinkDialog";
import { openConfirmModal } from "../packages/excalidraw/components/OverwriteConfirm/OverwriteConfirmState";
import { OverwriteConfirmDialog } from "../packages/excalidraw/components/OverwriteConfirm/OverwriteConfirm";
import Trans from "../packages/excalidraw/components/Trans";
import { ShareDialog, shareDialogStateAtom } from "./share/ShareDialog";
import CollabError, { collabErrorIndicatorAtom } from "./collab/CollabError";
import StorageSettingsDialog from "./components/StorageSettingsDialog";
import { LoadIcon } from "../packages/excalidraw/components/icons";
import {
  AuthError,
  BackendStorageAdapter,
} from "./data/storageAdapters/BackendStorageAdapter";
import { IndexedDBStorageAdapter } from "./data/storageAdapters/IndexedDBStorageAdapter";
import { CloudflareKVAdapter } from "./data/storageAdapters/CloudflareKVAdapter";
import { S3StorageAdapter } from "./data/storageAdapters/S3StorageAdapter";
import { CanvasData, IStorageAdapter } from "./data/storage";
import { MyCreationsTab } from "./components/MyCreationsTab";
import { SaveAsImageUI } from "./components/SaveAsImageUI";
import { Action } from "../packages/excalidraw/actions/types";
import {
  actionSaveFileToDisk,
  actionSaveToActiveFile,
} from "../packages/excalidraw/actions";
import { generateMermaidCode } from "./data/ai";
import { EditorLocalStorage } from "../packages/excalidraw/data/EditorLocalStorage";

polyfill();

window.EXCALIDRAW_THROTTLE_RENDER = true;

let isSelfEmbedding = false;

if (window.self !== window.top) {
  try {
    const parentUrl = new URL(document.referrer);
    const currentUrl = new URL(window.location.href);
    if (parentUrl.origin === currentUrl.origin) {
      isSelfEmbedding = true;
    }
  } catch (error) {
    // ignore
  }
}

const languageDetector = new LanguageDetector();
languageDetector.init({
  languageUtils: {},
});

const shareableLinkConfirmDialog = {
  title: t("overwriteConfirm.modal.shareableLink.title"),
  description: (
    <Trans
      i18nKey="overwriteConfirm.modal.shareableLink.description"
      bold={(text) => <strong>{text}</strong>}
      br={() => <br />}
    />
  ),
  actionLabel: t("overwriteConfirm.modal.shareableLink.button"),
  color: "danger",
} as const;

const initializeScene = async (opts: {
  collabAPI: CollabAPI | null;
  excalidrawAPI: ExcalidrawImperativeAPI;
}): Promise<
  { scene: ExcalidrawInitialDataState | null } & (
    | { isExternalScene: true; id: string; key: string }
    | { isExternalScene: false; id?: null; key?: null }
  )
> => {
  const searchParams = new URLSearchParams(window.location.search);
  const id = searchParams.get("id");
  const jsonBackendMatch = window.location.hash.match(
    /^#json=([a-zA-Z0-9_-]+),([a-zA-Z0-9_-]+)$/,
  );
  const externalUrlMatch = window.location.hash.match(/^#url=(.*)$/);

  const localDataState = importFromLocalStorage();

  let scene: RestoredDataState & {
    scrollToContent?: boolean;
  } = await loadScene(null, null, localDataState);

  let roomLinkData = getCollaborationLinkData(window.location.href);
  const isExternalScene = !!(id || jsonBackendMatch || roomLinkData);
  if (isExternalScene) {
    if (
      // don't prompt if scene is empty
      !scene.elements.length ||
      // don't prompt for collab scenes because we don't override local storage
      roomLinkData ||
      // otherwise, prompt whether user wants to override current scene
      (await openConfirmModal(shareableLinkConfirmDialog))
    ) {
      if (jsonBackendMatch) {
        scene = await loadScene(
          jsonBackendMatch[1],
          jsonBackendMatch[2],
          localDataState,
        );
      }
      scene.scrollToContent = true;
      if (!roomLinkData) {
        window.history.replaceState({}, APP_NAME, window.location.origin);
      }
    } else {
      // https://github.com/excalidraw/excalidraw/issues/1919
      if (document.hidden) {
        return new Promise((resolve, reject) => {
          window.addEventListener(
            "focus",
            () => initializeScene(opts).then(resolve).catch(reject),
            {
              once: true,
            },
          );
        });
      }

      roomLinkData = null;
      window.history.replaceState({}, APP_NAME, window.location.origin);
    }
  } else if (externalUrlMatch) {
    window.history.replaceState({}, APP_NAME, window.location.origin);

    const url = externalUrlMatch[1];
    try {
      const request = await fetch(window.decodeURIComponent(url));
      const data = await loadFromBlob(await request.blob(), null, null);
      if (
        !scene.elements.length ||
        (await openConfirmModal(shareableLinkConfirmDialog))
      ) {
        return { scene: data, isExternalScene };
      }
    } catch (error: any) {
      return {
        scene: {
          appState: {
            errorMessage: t("alerts.invalidSceneUrl"),
          },
        },
        isExternalScene,
      };
    }
  }

  if (roomLinkData && opts.collabAPI) {
    const { excalidrawAPI } = opts;

    const scene = await opts.collabAPI.startCollaboration(roomLinkData);

    return {
      // when collaborating, the state may have already been updated at this
      // point (we may have received updates from other clients), so reconcile
      // elements and appState with existing state
      scene: {
        ...scene,
        appState: {
          ...restoreAppState(
            {
              ...scene?.appState,
              theme: localDataState?.appState?.theme || scene?.appState?.theme,
            },
            excalidrawAPI.getAppState(),
          ),
          // necessary if we're invoking from a hashchange handler which doesn't
          // go through App.initializeScene() that resets this flag
          isLoading: false,
        },
        elements: reconcileElements(
          scene?.elements || [],
          excalidrawAPI.getSceneElementsIncludingDeleted(),
          excalidrawAPI.getAppState(),
        ),
      },
      isExternalScene: true,
      id: roomLinkData.roomId,
      key: roomLinkData.roomKey,
    };
  } else if (scene) {
    return isExternalScene && jsonBackendMatch
      ? {
          scene,
          isExternalScene,
          id: jsonBackendMatch[1],
          key: jsonBackendMatch[2],
        }
      : { scene, isExternalScene: false };
  }
  return { scene: null, isExternalScene: false };
};

const detectedLangCode = languageDetector.detect() || defaultLang.code;
export const appLangCodeAtom = atom(
  Array.isArray(detectedLangCode) ? detectedLangCode[0] : detectedLangCode,
);

const ExcalidrawWrapper = () => {
  const [errorMessage, setErrorMessage] = useState("");
  const [langCode, setLangCode] = useAtom(appLangCodeAtom);
  const [user, setUser] = useAtom(userAtom);
  const [storageConfig] = useAtom(storageConfigAtom);
  const [isStorageSettingsOpen, setIsStorageSettingsOpen] = useState(false);
  const isCollabDisabled = isRunningInIframe();
  const [currentCanvasId, setCurrentCanvasId] = useAtom(currentCanvasIdAtom);
  const [createCanvasDialogState] = useAtom(createCanvasDialogAtom);
  const [renameCanvasDialogState] = useAtom(renameCanvasDialogAtom);
  const [saveAsDialogState, setSaveAsDialog] = useAtom(saveAsDialogAtom);

  const [saveStatus, setSaveStatus] = useState<
    "saved" | "saving" | "unsaved" | "login-required"
  >("saved");
  const [lastSaveTime, setLastSaveTime] = useState<Date | null>(null);

  const storageAdapter: IStorageAdapter = useMemo(() => {
    if (storageConfig.type === "default" && user) {
      return new BackendStorageAdapter();
    }
    if (
      storageConfig.type === "kv" &&
      storageConfig.kvUrl &&
      storageConfig.kvApiToken
    ) {
      return new CloudflareKVAdapter({
        kv_url: storageConfig.kvUrl,
        apiToken: storageConfig.kvApiToken,
      });
    }
    if (
      storageConfig.type === "s3" &&
      storageConfig.s3AccessKeyId &&
      storageConfig.s3SecretAccessKey &&
      storageConfig.s3Region &&
      storageConfig.s3BucketName
    ) {
      return new S3StorageAdapter({
        accessKeyId: storageConfig.s3AccessKeyId,
        secretAccessKey: storageConfig.s3SecretAccessKey,
        region: storageConfig.s3Region,
        bucketName: storageConfig.s3BucketName,
      });
    }
    return new IndexedDBStorageAdapter();
  }, [storageConfig, user]);

  const initialStatePromiseRef = useRef<{
    promise: ResolvablePromise<ExcalidrawInitialDataState | null>;
  }>({ promise: null! });
  if (!initialStatePromiseRef.current.promise) {
    initialStatePromiseRef.current.promise =
      resolvablePromise<ExcalidrawInitialDataState | null>();
  }

  useEffect(() => {
    trackEvent("load", "frame", getFrame());
    setTimeout(() => {
      trackEvent("load", "version", getVersion());
    }, VERSION_TIMEOUT);
  }, []);

  const [excalidrawAPI, excalidrawRefCallback] =
    useCallbackRefState<ExcalidrawImperativeAPI>();

  const [, setShareDialogState] = useAtom(shareDialogStateAtom);
  const [collabAPI] = useAtom(collabAPIAtom);
  const [isCollaborating, setIsCollaborating] = useAtomWithInitialValue(
    isCollaboratingAtom,
    () => {
      return isCollaborationLink(window.location.href);
    },
  );
  const collabError = useAtomValue(collabErrorIndicatorAtom);

  const resetSaveStatus = useCallback(() => {
    setSaveStatus("saved");
    setLastSaveTime(null);
  }, []);

  const {
    canvases,
    handleCanvasSelect,
    handleCanvasDelete,
    handleCanvasCreate,
    handleCanvasRename,
    handleCanvasSaveAs,
    refreshCanvases,
  } = useCanvasManagement({
    storageAdapter,
    excalidrawAPI,
    user,
    setErrorMessage,
    resetSaveStatus,
  });

  const saveCanvas = useCallback(async () => {
    if (!excalidrawAPI) {
      return;
    }
    const { storageAdapter, currentCanvasId, refreshCanvases } =
      onChangeRef.current;
    if (currentCanvasId) {
      setSaveStatus("saving");
      try {
        await storageAdapter.saveCanvas(currentCanvasId, {
          elements: excalidrawAPI.getSceneElements(),
          appState: excalidrawAPI.getAppState(),
          files: excalidrawAPI.getFiles(),
        });
        setSaveStatus("saved");
        setLastSaveTime(new Date());
        await refreshCanvases();
      } catch (e: any) {
        if (e instanceof AuthError) {
          setSaveStatus("login-required");
        } else {
          setSaveStatus("unsaved");
        }
        console.error(e);
      }
    }
  }, [excalidrawAPI]);

  const renderTopLeftUI = useCallback(
    (isMobile: boolean) => {
      if (isMobile) {
        return null;
      }

      let statusMessage = "";
      if (saveStatus === "saving") {
        statusMessage = "正在保存...";
      } else if (saveStatus === "saved") {
        if (lastSaveTime) {
          statusMessage = `已保存于 ${lastSaveTime.toLocaleTimeString()}`;
        } else {
          statusMessage = "已保存";
        }
      } else if (saveStatus === "unsaved") {
        statusMessage = "存在未保存的更改";
      } else if (saveStatus === "login-required") {
        statusMessage = "您必须登录才能保存更改";
      }

      return (
        <div style={{ display: "flex", alignItems: "center" }}>
          <Sidebar.Trigger
            name={CREATIONS_SIDEBAR_NAME}
            icon={LoadIcon}
            title="My Creations"
          />
          {statusMessage && (
            <div
              style={{
                marginLeft: "0.5rem",
                color: "var(--color-gray-40)",
                fontSize: "0.8em",
                fontStyle: "italic",
              }}
            >
              {statusMessage}
            </div>
          )}
        </div>
      );
    },
    [saveStatus, lastSaveTime],
  );

  useAuth(setUser);

  useHandleLibrary({
    excalidrawAPI,
    adapter: LibraryIndexedDBAdapter,
    migrationAdapter: LibraryLocalStorageMigrationAdapter,
  });

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    const token = searchParams.get("token");
    if (token) {
      localStorage.setItem("token", token);
      window.history.replaceState({}, document.title, window.location.pathname);
    }

    const storedToken = localStorage.getItem("token");
    if (storedToken) {
      try {
        const decodedToken: any = jwtDecode(storedToken);
        if (decodedToken.exp * 1000 > Date.now()) {
          setUser({
            id: decodedToken.userId,
            githubId: decodedToken.githubId,
            login: decodedToken.login,
            avatarUrl: decodedToken.avatarUrl,
            name: decodedToken.name,
          });
        } else {
          localStorage.removeItem("token");
        }
      } catch (error) {
        console.error("Invalid token:", error);
        localStorage.removeItem("token");
      }
    }
  }, [setUser]);

  useEffect(() => {
    if (!excalidrawAPI || (!isCollabDisabled && !collabAPI)) {
      return;
    }

    const loadImages = (
      data: ResolutionType<typeof initializeScene>,
      isInitialLoad = false,
    ) => {
      if (!data.scene) {
        return;
      }
      if (collabAPI?.isCollaborating()) {
        if (data.scene.elements) {
          collabAPI
            .fetchImageFilesFromFirebase({
              elements: data.scene.elements,
              forceFetchFiles: true,
            })
            .then(({ loadedFiles, erroredFiles }) => {
              excalidrawAPI.addFiles(loadedFiles);
              updateStaleImageStatuses({
                excalidrawAPI,
                erroredFiles,
                elements: excalidrawAPI.getSceneElementsIncludingDeleted(),
              });
            });
        }
      } else {
        const fileIds =
          data.scene.elements?.reduce((acc, element) => {
            if (isInitializedImageElement(element)) {
              return acc.concat(element.fileId);
            }
            return acc;
          }, [] as FileId[]) || [];

        if (data.isExternalScene) {
          loadFilesFromFirebase(
            `${FIREBASE_STORAGE_PREFIXES.shareLinkFiles}/${data.id}`,
            data.key,
            fileIds,
          ).then(({ loadedFiles, erroredFiles }) => {
            excalidrawAPI.addFiles(loadedFiles);
            updateStaleImageStatuses({
              excalidrawAPI,
              erroredFiles,
              elements: excalidrawAPI.getSceneElementsIncludingDeleted(),
            });
          });
        } else if (isInitialLoad) {
          if (fileIds.length) {
            LocalData.fileStorage
              .getFiles(fileIds)
              .then(({ loadedFiles, erroredFiles }) => {
                if (loadedFiles.length) {
                  excalidrawAPI.addFiles(loadedFiles);
                }
                updateStaleImageStatuses({
                  excalidrawAPI,
                  erroredFiles,
                  elements: excalidrawAPI.getSceneElementsIncludingDeleted(),
                });
              });
          }
          LocalData.fileStorage.clearObsoleteFiles({ currentFileIds: fileIds });
        }
      }
    };

    const loadCanvas = async () => {
      const jsonMatch = window.location.hash.match(
        /^#json=([a-zA-Z0-9_-]+),([a-zA-Z0-9_-]+)$/,
      );
      const urlMatch = window.location.hash.match(/^#url=(.*)$/);
      const isCollab =
        isCollaborationLink(window.location.href) ||
        isCollaborationLink(document.referrer);

      if (isCollab || jsonMatch || urlMatch) {
        initializeScene({ collabAPI, excalidrawAPI }).then(async (data) => {
          loadImages(data, true);
          initialStatePromiseRef.current.promise.resolve(data.scene);
        });
      } else {
        let data: ResolutionType<typeof initializeScene> | null = null;

        if (!currentCanvasId) {
          try {
            const newCanvas = await storageAdapter.createCanvas({
              elements: [],
              appState: excalidrawAPI.getAppState(),
              files: {},
            });
            setCurrentCanvasId(newCanvas.id);
            data = {
              scene: {
                elements: [],
                appState: excalidrawAPI.getAppState(),
              },
              isExternalScene: false,
            };
          } catch (e) {
            console.error(e);
            setErrorMessage(
              e instanceof Error ? e.message : "Failed to create a new canvas.",
            );
            return;
          }
        } else {
          try {
            if (currentCanvasId) {
              const canvasData: CanvasData | null =
                await storageAdapter.loadCanvas(currentCanvasId);
              if (canvasData) {
                data = {
                  scene: {
                    elements: canvasData.elements,
                    appState: restoreAppState(
                      canvasData.appState,
                      excalidrawAPI.getAppState(),
                    ),
                    files: canvasData.files,
                  },
                  isExternalScene: false,
                };
              } else {
                // Canvas not found, create a new one
                setCurrentCanvasId(null); // Reset invalid id
                // This will trigger a re-render and the logic will create a new canvas
                return;
              }
            }
          } catch (e) {
            console.error("Failed to load canvas data.", e);
            const resetConfirmed = await openConfirmModal({
              title: "画布加载失败",
              description:
                "无法加载画布，它可能已损坏。您想重置并创建一个新的空白画布吗？",
              actionLabel: "重置画布",
              color: "danger",
            });

            if (resetConfirmed) {
              setCurrentCanvasId(null);
              // This will re-trigger the effect, and since currentCanvasId is null,
              // it will enter the `if (!currentCanvasId)` block and create a new canvas.
              // So we should just return.
              return;
            }
            // User cancelled. The app is in a broken state.
            // We can't load the canvas. We should probably show an error.
            // A simple error message might be enough.
            const errorMessage = "无法加载指定的画布。";
            setErrorMessage(errorMessage);
            initialStatePromiseRef.current.promise.resolve({
              appState: { errorMessage },
            });
            return;
          }
        }
        if (data) {
          loadImages(data, true);
          initialStatePromiseRef.current.promise.resolve(data.scene);
        } else {
          initializeScene({ collabAPI, excalidrawAPI }).then(async (data) => {
            loadImages(data, true);
            initialStatePromiseRef.current.promise.resolve(data.scene);
          });
        }
      }
    };

    loadCanvas();

    const onHashChange = async (event: HashChangeEvent) => {
      event.preventDefault();
      const libraryUrlTokens = parseLibraryTokensFromUrl();
      if (!libraryUrlTokens) {
        if (
          collabAPI?.isCollaborating() &&
          !isCollaborationLink(window.location.href)
        ) {
          collabAPI.stopCollaboration(false);
        }
        excalidrawAPI.updateScene({ appState: { isLoading: true } });

        initializeScene({ collabAPI, excalidrawAPI }).then((data) => {
          loadImages(data);
          if (data.scene) {
            excalidrawAPI.updateScene({
              ...data.scene,
              ...restore(data.scene, null, null, { repairBindings: true }),
              commitToHistory: true,
            });
          }
        });
      }
    };

    const titleTimeout = setTimeout(
      () => (document.title = APP_NAME),
      TITLE_TIMEOUT,
    );

    const syncData = debounce(() => {
      if (isTestEnv()) {
        return;
      }
      if (
        !document.hidden &&
        ((collabAPI && !collabAPI.isCollaborating()) || isCollabDisabled)
      ) {
        if (isBrowserStorageStateNewer(STORAGE_KEYS.VERSION_DATA_STATE)) {
          const localDataState = importFromLocalStorage();
          const username = importUsernameFromLocalStorage();
          let langCode = languageDetector.detect() || defaultLang.code;
          if (Array.isArray(langCode)) {
            langCode = langCode[0];
          }
          setLangCode(langCode);
          excalidrawAPI.updateScene({
            ...localDataState,
          });
          LibraryIndexedDBAdapter.load().then((data) => {
            if (data) {
              excalidrawAPI.updateLibrary({
                libraryItems: data.libraryItems,
              });
            }
          });
          collabAPI?.setUsername(username || "");
        }

        if (isBrowserStorageStateNewer(STORAGE_KEYS.VERSION_FILES)) {
          const elements = excalidrawAPI.getSceneElementsIncludingDeleted();
          const currFiles = excalidrawAPI.getFiles();
          const fileIds =
            elements?.reduce((acc, element) => {
              if (
                isInitializedImageElement(element) &&
                !currFiles[element.fileId]
              ) {
                return acc.concat(element.fileId);
              }
              return acc;
            }, [] as FileId[]) || [];
          if (fileIds.length) {
            LocalData.fileStorage
              .getFiles(fileIds)
              .then(({ loadedFiles, erroredFiles }) => {
                if (loadedFiles.length) {
                  excalidrawAPI.addFiles(loadedFiles);
                }
                updateStaleImageStatuses({
                  excalidrawAPI,
                  erroredFiles,
                  elements: excalidrawAPI.getSceneElementsIncludingDeleted(),
                });
              });
          }
        }
      }
    }, SYNC_BROWSER_TABS_TIMEOUT);

    const onUnload = () => {
      LocalData.flushSave();
    };

    const visibilityChange = (event: FocusEvent | Event) => {
      if (event.type === EVENT.BLUR || document.hidden) {
        LocalData.flushSave();
      }
      if (
        event.type === EVENT.VISIBILITY_CHANGE ||
        event.type === EVENT.FOCUS
      ) {
        syncData();
      }
    };

    window.addEventListener(EVENT.HASHCHANGE, onHashChange, false);
    window.addEventListener(EVENT.UNLOAD, onUnload, false);
    window.addEventListener(EVENT.BLUR, visibilityChange, false);
    document.addEventListener(EVENT.VISIBILITY_CHANGE, visibilityChange, false);
    window.addEventListener(EVENT.FOCUS, visibilityChange, false);
    return () => {
      window.removeEventListener(EVENT.HASHCHANGE, onHashChange, false);
      window.removeEventListener(EVENT.UNLOAD, onUnload, false);
      window.removeEventListener(EVENT.BLUR, visibilityChange, false);
      window.removeEventListener(EVENT.FOCUS, visibilityChange, false);
      document.removeEventListener(
        EVENT.VISIBILITY_CHANGE,
        visibilityChange,
        false,
      );
      clearTimeout(titleTimeout);
    };
  }, [
    isCollabDisabled,
    collabAPI,
    excalidrawAPI,
    setLangCode,
    user,
    storageAdapter,
    currentCanvasId,
    setCurrentCanvasId,
    setErrorMessage,
    resetSaveStatus,
  ]);

  useEffect(() => {
    if (!excalidrawAPI) {
      return;
    }
    excalidrawAPI.unregisterAction(actionSaveFileToDisk);
    excalidrawAPI.unregisterAction(actionSaveToActiveFile);

    const newSaveAction = {
      name: "saveFileToDisk",
      trackEvent: { category: "canvas" },
      perform: async () => {
        console.log("Manual saving...");
        await saveCanvas();
        return {
          commitToHistory: false,
        };
      },
      keyTest: (event: KeyboardEvent) =>
        !event.altKey &&
        !event.shiftKey &&
        event.key.toLowerCase() === "s" &&
        (event.ctrlKey || event.metaKey),
    } as Action;
    excalidrawAPI.registerAction(newSaveAction);
    return () => {
      excalidrawAPI.unregisterAction(newSaveAction);
      excalidrawAPI.registerAction(actionSaveFileToDisk);
      excalidrawAPI.registerAction(actionSaveToActiveFile);
    };
  }, [excalidrawAPI, saveCanvas]);

  useEffect(() => {
    const unloadHandler = (event: BeforeUnloadEvent) => {
      LocalData.flushSave();

      if (
        excalidrawAPI &&
        LocalData.fileStorage.shouldPreventUnload(
          excalidrawAPI.getSceneElements(),
        )
      ) {
        preventUnload(event);
      }
    };
    window.addEventListener(EVENT.BEFORE_UNLOAD, unloadHandler);
    return () => {
      window.removeEventListener(EVENT.BEFORE_UNLOAD, unloadHandler);
    };
  }, [excalidrawAPI]);

  useEffect(() => {
    languageDetector.cacheUserLanguage(langCode);
  }, [langCode]);

  const [theme, setTheme] = useState<Theme>(
    () =>
      (localStorage.getItem(
        STORAGE_KEYS.LOCAL_STORAGE_THEME,
      ) as Theme | null) ||
      importFromLocalStorage().appState?.theme ||
      THEME.LIGHT,
  );

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.LOCAL_STORAGE_THEME, theme);
    document.documentElement.classList.toggle("dark", theme === THEME.DARK);
  }, [theme]);

  const onChangeRef = useRef({
    storageAdapter,
    currentCanvasId,
    refreshCanvases,
    collabAPI,
  });
  onChangeRef.current = {
    storageAdapter,
    currentCanvasId,
    refreshCanvases,
    collabAPI,
  };

  const previousElementsRef = useRef<readonly ExcalidrawElement[] | null>(null);
  const previousFilesRef = useRef<BinaryFiles | null>(null);

  const debouncedSave = useMemo(() => {
    const save = async (
      elements: readonly NonDeletedExcalidrawElement[],
      appState: AppState,
      files: BinaryFiles,
    ) => {
      const { storageAdapter, currentCanvasId } = onChangeRef.current;
      if (currentCanvasId) {
        console.log("Saving...");
        setSaveStatus("saving");
        try {
          await storageAdapter.saveCanvas(currentCanvasId, {
            elements,
            appState,
            files,
          });
          setSaveStatus("saved");
          setLastSaveTime(new Date());
          await onChangeRef.current.refreshCanvases();
        } catch (e: any) {
          if (e instanceof AuthError) {
            setSaveStatus("login-required");
          } else {
            setSaveStatus("unsaved");
          }
          console.error(e);
        }
      }
    };

    return debounce(save, 5000);
  }, []);

  const onChange = (
    elements: readonly ExcalidrawElement[],
    appState: AppState,
    files: BinaryFiles,
  ) => {
    const { collabAPI, currentCanvasId } = onChangeRef.current;
    setTheme(appState.theme);

    const didElementsChange =
      previousElementsRef.current !== elements ||
      JSON.stringify(previousElementsRef.current) !== JSON.stringify(elements);

    const didFilesChange =
      previousFilesRef.current !== files ||
      JSON.stringify(previousFilesRef.current) !== JSON.stringify(files);

    if (collabAPI?.isCollaborating()) {
      collabAPI.syncElements(elements);
    } else if (currentCanvasId && (didElementsChange || didFilesChange)) {
      setSaveStatus("unsaved");
      debouncedSave(elements as NonDeletedExcalidrawElement[], appState, files);
    }

    // Update refs for the next comparison
    previousElementsRef.current = elements;
    previousFilesRef.current = files;

    if (!LocalData.isSavePaused()) {
      LocalData.save(elements, appState, files, () => {
        if (excalidrawAPI) {
          let didChange = false;

          const elements = excalidrawAPI
            .getSceneElementsIncludingDeleted()
            .map((element) => {
              if (
                LocalData.fileStorage.shouldUpdateImageElementStatus(element)
              ) {
                const newElement = newElementWith(element, { status: "saved" });
                if (newElement !== element) {
                  didChange = true;
                }
                return newElement;
              }
              return element;
            });

          if (didChange) {
            excalidrawAPI.updateScene({
              elements,
            });
          }
        }
      });
    }
  };

  const [latestShareableLink, setLatestShareableLink] = useState<string | null>(
    null,
  );

  const onExportToBackend = async (
    exportedElements: readonly NonDeletedExcalidrawElement[],
    appState: Partial<AppState>,
    files: BinaryFiles,
  ) => {
    if (exportedElements.length === 0) {
      throw new Error(t("alerts.cannotExportEmptyCanvas"));
    }
    try {
      const { url, errorMessage } = await exportToBackend(
        exportedElements,
        {
          ...appState,
          viewBackgroundColor: appState.exportBackground
            ? appState.viewBackgroundColor
            : getDefaultAppState().viewBackgroundColor,
        },
        files,
      );

      if (errorMessage) {
        throw new Error(errorMessage);
      }

      if (url) {
        setLatestShareableLink(url);
      }
    } catch (error: any) {
      if (error.name !== "AbortError") {
        const { width, height } = appState;
        console.error(error, {
          width,
          height,
          devicePixelRatio: window.devicePixelRatio,
        });
        throw new Error(error.message);
      }
    }
  };

  const renderCustomStats = (
    elements: readonly NonDeletedExcalidrawElement[],
    appState: UIAppState,
  ) => {
    return (
      <CustomStats
        setToast={(message) => excalidrawAPI!.setToast({ message })}
        appState={appState}
        elements={elements}
      />
    );
  };

  const isOffline = useAtomValue(isOfflineAtom);
  const [collabDialogShown, setCollabDialogShown] = useState(false);
  const onCollabDialogOpen = useCallback(() => setCollabDialogShown(true), []);

  if (isSelfEmbedding) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
          height: "100%",
        }}
      >
        <h1>I'm not a pretzel!</h1>
      </div>
    );
  }

  return (
    <div
      style={{ height: "100%" }}
      className={clsx("excalidraw-app", {
        "is-collaborating": isCollaborating,
      })}
    >
      <Excalidraw
        excalidrawAPI={excalidrawRefCallback}
        initialData={initialStatePromiseRef.current.promise}
        onChange={onChange}
        isCollaborating={isCollaborating}
        onPointerUpdate={collabAPI?.onPointerUpdate}
        langCode={langCode}
        renderCustomStats={renderCustomStats}
        detectScroll={false}
        handleKeyboardGlobally={true}
        theme={theme}
        renderTopLeftUI={renderTopLeftUI}
        renderLeftSidebar={() => (
          <Sidebar name={CREATIONS_SIDEBAR_NAME} position="left" __fallback>
            <MyCreationsTab
              canvases={canvases}
              onCanvasSelect={handleCanvasSelect}
              onCanvasDelete={handleCanvasDelete}
              currentCanvasId={currentCanvasId}
            />
          </Sidebar>
        )}
        UIOptions={{
          canvasActions: {
            toggleTheme: true,
            export: {
              onExportToBackend,
              renderCustomUI: excalidrawAPI
                ? () => {
                    return (
                      <SaveAsImageUI
                        onSuccess={() => {
                          excalidrawAPI.updateScene({
                            appState: { openDialog: { name: "imageExport" } },
                          });
                        }}
                      />
                    );
                  }
                : undefined,
            },
          },
        }}
        renderTopRightUI={(isMobile) => {
          if (isMobile || !collabAPI || isCollabDisabled) {
            return null;
          }
          return (
            <div className="top-right-ui">
              {collabError.message && <CollabError collabError={collabError} />}
              <LiveCollaborationTrigger
                isCollaborating={isCollaborating}
                onSelect={() =>
                  setShareDialogState({ isOpen: true, type: "share" })
                }
              />
            </div>
          );
        }}
      >
        <DefaultSidebar __fallback />
        <AppMainMenu
          onCollabDialogOpen={onCollabDialogOpen}
          isCollaborating={isCollaborating}
          isCollabEnabled={!isCollabDisabled}
          onStorageSettingsClick={() => setIsStorageSettingsOpen(true)}
        />
        <AppWelcomeScreen
          onCollabDialogOpen={onCollabDialogOpen}
          isCollabEnabled={!isCollabDisabled}
        />
        <OverwriteConfirmDialog>
          <OverwriteConfirmDialog.Actions.ExportToImage />
          <OverwriteConfirmDialog.Actions.SaveToDisk />
          <OverwriteConfirmDialog.Action
            title="另存为新画布"
            actionLabel="另存为..."
            onClick={() => {
              setSaveAsDialog({ isOpen: true });
            }}
          >
            将您当前的工作保存为一个新的画布，存入您所配置的存储中。
          </OverwriteConfirmDialog.Action>
        </OverwriteConfirmDialog>
        <AppFooter />
        <TTDDialog
          onTextSubmit={async (input) => {
            try {
              const openAIKey =
                EditorLocalStorage.get(EDITOR_LS_KEYS.OAI_API_KEY) || "123";
              const openAIUrl =
                EditorLocalStorage.get(EDITOR_LS_KEYS.OAI_BASE_URL) ||
                "/api/v2";
              const modelName =
                EditorLocalStorage.get(EDITOR_LS_KEYS.OAI_MODEL_NAME) ||
                "gpt-4.1-mini";

              if (!openAIKey || !openAIUrl) {
                throw new Error(
                  "OpenAI API key or URL are not configured in environment variables.",
                );
              }

              const generatedResponse = await generateMermaidCode(
                input,
                openAIKey as string,
                openAIUrl as string,
                modelName as string,
              );

              return { generatedResponse: generatedResponse.code };
            } catch (err: any) {
              throw new Error("Request failed");
            }
          }}
        />
        <TTDDialogTrigger />
        <ShareDialog
          collabAPI={collabAPI}
          onExportToBackend={async () => {
            if (excalidrawAPI) {
              try {
                await onExportToBackend(
                  excalidrawAPI.getSceneElements(),
                  excalidrawAPI.getAppState(),
                  excalidrawAPI.getFiles(),
                );
              } catch (error: any) {
                setErrorMessage(error.message);
              }
            }
          }}
        />
        {latestShareableLink && (
          <ShareableLinkDialog
            link={latestShareableLink}
            onCloseRequest={() => setLatestShareableLink(null)}
            setErrorMessage={setErrorMessage}
          />
        )}
        {excalidrawAPI && !isCollabDisabled && (
          <Collab excalidrawAPI={excalidrawAPI} />
        )}
        {isCollaborating && isOffline && (
          <div className="collab-offline-warning">
            {t("alerts.collabOfflineWarning")}
          </div>
        )}
        {isStorageSettingsOpen && (
          <StorageSettingsDialog
            onClose={() => setIsStorageSettingsOpen(false)}
          />
        )}
        {createCanvasDialogState.isOpen && (
          <CreateCanvasDialog onCanvasCreate={handleCanvasCreate} />
        )}
        {renameCanvasDialogState.isOpen && (
          <RenameCanvasDialog onCanvasRename={handleCanvasRename} />
        )}
        {saveAsDialogState.isOpen && (
          <SaveAsDialog onCanvasSaveAs={handleCanvasSaveAs} />
        )}
        {errorMessage && (
          <ErrorDialog onClose={() => setErrorMessage("")}>
            {errorMessage}
          </ErrorDialog>
        )}
      </Excalidraw>
    </div>
  );
};

const ExcalidrawApp = () => {
  return (
    <TopErrorBoundary>
      <Provider unstable_createStore={() => appJotaiStore as any}>
        <ExcalidrawWrapper />
      </Provider>
    </TopErrorBoundary>
  );
};

export default ExcalidrawApp;
