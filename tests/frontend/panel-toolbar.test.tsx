import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

afterEach(() => {
  cleanup();
  vi.resetModules();
  vi.doUnmock("@termix-ssh/plugin-sdk/ui");
});

async function load(withPanelToolbar: boolean) {
  vi.doMock("@termix-ssh/plugin-sdk/ui", async (importOriginal) => {
    const original = await importOriginal<Record<string, unknown>>();
    const copy: Record<string, unknown> = { ...original };
    if (withPanelToolbar) {
      copy.PanelToolbar = ({ addLabel }: { addLabel?: string }) => (
        <div data-testid="core-toolbar">{addLabel}</div>
      );
    } else {
      delete copy.PanelToolbar;
    }
    return copy;
  });
  return (await import("../../src/frontend/panel-toolbar")).Toolbar;
}

describe("Toolbar", () => {
  it("uses Termix's PanelToolbar when the server has it", async () => {
    const Toolbar = await load(true);
    render(
      <Toolbar
        search=""
        onSearchChange={() => {}}
        onAdd={() => {}}
        addLabel="Add"
      />,
    );
    expect(screen.getByTestId("core-toolbar").textContent).toBe("Add");
  });

  it("falls back to its own search and add button on older servers", async () => {
    const Toolbar = await load(false);
    const onAdd = vi.fn();
    const onSearchChange = vi.fn();
    render(
      <Toolbar
        search=""
        onSearchChange={onSearchChange}
        searchPlaceholder="Find"
        onAdd={onAdd}
        addLabel="Add"
        below={<span>under</span>}
      >
        <button type="button">extra</button>
      </Toolbar>,
    );
    fireEvent.change(screen.getByPlaceholderText("Find"), {
      target: { value: "web" },
    });
    expect(onSearchChange).toHaveBeenCalledWith("web");
    fireEvent.click(screen.getByLabelText("Add"));
    expect(onAdd).toHaveBeenCalledOnce();
    expect(screen.getByText("extra")).toBeTruthy();
    expect(screen.getByText("under")).toBeTruthy();
  });

  it("leaves out the add button without onAdd", async () => {
    const Toolbar = await load(false);
    render(<Toolbar search="" onSearchChange={() => {}} addLabel="Add" />);
    expect(screen.queryByLabelText("Add")).toBeNull();
  });
});
