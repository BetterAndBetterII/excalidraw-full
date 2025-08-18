import React from "react";
import { MainMenu } from "../../packages/excalidraw/index";
import { LanguageList } from "./LanguageList";
import { useAtom, useSetAtom } from "jotai";
import { userAtom, saveAsDialogAtom } from "../app-jotai";
import {
  GithubIcon,
  saveAs,
  extraToolsIcon,
} from "../../packages/excalidraw/components/icons";
import DropdownMenuItemLink from "../../packages/excalidraw/components/dropdownMenu/DropdownMenuItemLink";

export const AppMainMenu: React.FC<{
  onCollabDialogOpen: () => any;
  isCollaborating: boolean;
  isCollabEnabled: boolean;
  onStorageSettingsClick: () => void;
}> = React.memo((props) => {
  const [user, setUser] = useAtom(userAtom);
  const setSaveAsDialog = useSetAtom(saveAsDialogAtom);

  const handleLogin = () => {
    window.location.href = "/auth/login";
  };

  const handleLogout = () => {
    localStorage.removeItem("token");
    setUser(null);
    window.location.reload(); // Reload to clear all state
  };

  return (
    <MainMenu>
      <MainMenu.DefaultItems.LoadScene />
      <MainMenu.DefaultItems.SaveToActiveFile />
      <MainMenu.Item
        onSelect={() => setSaveAsDialog({ isOpen: true })}
        icon={saveAs}
      >
        Save as New Canvas...
      </MainMenu.Item>
      <MainMenu.DefaultItems.Export />
      {props.isCollabEnabled && (
        <MainMenu.DefaultItems.LiveCollaborationTrigger
          isCollaborating={props.isCollaborating}
          onSelect={() => props.onCollabDialogOpen()}
        />
      )}

      <MainMenu.DefaultItems.Help />
      <MainMenu.DefaultItems.ClearCanvas />
      <MainMenu.Separator />
      <MainMenu.Item
        onSelect={props.onStorageSettingsClick}
        icon={extraToolsIcon}
      >
        Data Source Settings...
      </MainMenu.Item>
      <MainMenu.Separator />
      {user ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "0.5rem",
            padding: "0 0.5rem",
            width: "100%",
            fontSize: "14px",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
              overflow: "hidden",
              flexShrink: 1,
            }}
          >
            {user.avatarUrl && (
              <img
                src={user.avatarUrl}
                alt={user.login}
                style={{
                  width: "24px",
                  height: "24px",
                  borderRadius: "50%",
                  flexShrink: 0,
                }}
              />
            )}
            <span
              style={{
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {user.name || user.login}
            </span>
          </div>
          <button
            onClick={handleLogout}
            style={{
              background: "transparent",
              border: "none",
              cursor: "pointer",
              padding: "0.25rem 0.5rem",
              borderRadius: "4px",
              textAlign: "center",
              color: "inherit",
              flexShrink: 0,
              marginRight: "1rem",
              font: "var(--ui-font)",
              fontSize: "14px",
            }}
            onMouseOver={(e) =>
              (e.currentTarget.style.background = "var(--button-gray-1)")
            }
            onMouseOut={(e) =>
              (e.currentTarget.style.background = "transparent")
            }
          >
            Logout
          </button>
        </div>
      ) : (
        <MainMenu.Item onSelect={handleLogin} icon={GithubIcon}>
          Login
        </MainMenu.Item>
      )}
      <MainMenu.Separator />
      <DropdownMenuItemLink
        icon={GithubIcon}
        href="https://github.com/excalidraw/excalidraw"
        aria-label="GitHub"
      >
        GitHub
      </DropdownMenuItemLink>
      <MainMenu.Separator />
      <MainMenu.DefaultItems.ToggleTheme />
      <MainMenu.ItemCustom>
        <LanguageList style={{ width: "100%" }} />
      </MainMenu.ItemCustom>
      <MainMenu.DefaultItems.ChangeCanvasBackground />
    </MainMenu>
  );
});
