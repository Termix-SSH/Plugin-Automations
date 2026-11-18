import type { ComponentType, ReactNode } from "react";
import * as sdkUi from "@termix-ssh/plugin-sdk/ui";
import { AddButton, PanelSearch, TOOLBAR_FIT } from "@termix-ssh/plugin-sdk/ui";

export interface ToolbarProps {
  search: string;
  onSearchChange: (next: string) => void;
  searchPlaceholder?: string;
  /** Shows the add button. */
  onAdd?: () => void;
  addLabel?: string;
  /** Icon buttons between search and add. */
  children?: ReactNode;
  /** Anything that needs its own line under the row. */
  below?: ReactNode;
}

// PanelToolbar comes with Termix 26.11.2. Older servers get the stacked toolbar.
const PanelToolbar =
  "PanelToolbar" in sdkUi
    ? (sdkUi as unknown as { PanelToolbar?: ComponentType<ToolbarProps> })
        .PanelToolbar
    : undefined;

/** The panel's search, buttons and add button, on one row where Termix can. */
export function Toolbar(props: ToolbarProps) {
  if (PanelToolbar) return <PanelToolbar {...props} />;
  const {
    search,
    onSearchChange,
    searchPlaceholder,
    onAdd,
    addLabel,
    children,
    below,
  } = props;
  return (
    <div
      className={`flex shrink-0 flex-col gap-2 border-b border-border px-3 py-2 ${TOOLBAR_FIT}`}
    >
      <PanelSearch
        value={search}
        onChange={onSearchChange}
        placeholder={searchPlaceholder}
        fill
      />
      {(onAdd || children) && (
        <div className="flex items-center gap-2">
          {onAdd && (
            <AddButton label={addLabel} onClick={onAdd} className="flex-1" />
          )}
          {children}
        </div>
      )}
      {below}
    </div>
  );
}
