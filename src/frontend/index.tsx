import { Workflow, Wrench } from "lucide-react";
import type {
  PanelProps,
  TabProps,
  TermixApp,
} from "@termix-ssh/plugin-sdk/frontend";
import { AutomationsPanel } from "./AutomationsPanel";
import { createAutomationsApi } from "./automations-api";

import { createMaintenanceStore } from "./maintenance-store";
import { HostMaintenance, MaintenanceBadge } from "./HostMaintenance";
import {
  AutomationsCompanion,
  RecentRunsCard,
  UpcomingRunsCard,
  useAutomationsCompanionDefaults,
} from "./AutomationsDashboard";

const VIEW_ID = "automations";

function maintenanceEnabled(host: object | null | undefined): boolean {
  const all = (host as { pluginSettings?: unknown } | null | undefined)
    ?.pluginSettings as
    Record<string, Record<string, unknown> | undefined> | undefined;
  return all?.[VIEW_ID]?.enableMaintenance === true;
}

export function automationsPanelEnabled(
  host: object | null | undefined,
): boolean {
  const all = (host as { pluginSettings?: unknown } | null | undefined)
    ?.pluginSettings as
    Record<string, Record<string, unknown> | undefined> | undefined;
  return all?.[VIEW_ID]?.showPanel !== false;
}

function Panel({ active }: PanelProps) {
  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <AutomationsPanel active={active} />
    </div>
  );
}

function AutomationsTab({ isVisible }: TabProps) {
  return <AutomationsPanel active={isVisible} />;
}

export function activate(app: TermixApp): void {
  const maintenance = createMaintenanceStore(app.api);
  app.onDispose(() => maintenance.dispose());
  app.registerTab(
    "host_maintenance",
    ({ host, isVisible }) =>
      host ? (
        <HostMaintenance host={host} store={maintenance} visible={isVisible} />
      ) : null,
    {
      icon: Wrench,
      titleKey: "maintenance.title",
    },
  );
  app.registerHostAction({
    id: "maintenance",
    titleKey: "maintenance.title",
    icon: Wrench,
    kind: "open",
    tabType: "host_maintenance",
    tray: false,
    when: (host) => Number(host.id) > 0 && maintenanceEnabled(host),
  });
  app.registerHostBadge({
    id: "maintenance",
    when: (host) => Number(host.id) > 0,
    component: ({ host }) => (
      <MaintenanceBadge host={host} store={maintenance} />
    ),
  });
  app.registerRailItem({
    id: VIEW_ID,
    icon: Workflow,
    titleKey: "nav.automations",
    promotable: true,
    after: "macros",
    order: 30,
  });
  app.registerPanel(VIEW_ID, Panel);
  app.registerTab(VIEW_ID, AutomationsTab, {
    icon: Workflow,
    titleKey: "nav.automations",
    singleton: true,
    hostless: true,
    panelFrame: true,
  });

  // The assistant's @-mentions list automations through this.
  const api = createAutomationsApi(app.api);
  app.registerAction("automations.list", () => api.list());

  app.registerDashboardCard({
    id: "automations-upcoming",
    titleKey: "card.upcoming",
    defaultPanel: "side",
    defaultHeight: 200,
    frame: "framed",
    component: UpcomingRunsCard,
  });
  app.registerDashboardCard({
    id: "automations-runs",
    titleKey: "card.recentRuns",
    defaultPanel: "side",
    defaultHeight: 240,
    frame: "framed",
    component: RecentRunsCard,
  });

  // Cores before 26.10.3 have no panels beside tabs.
  if (typeof app.registerCompanion === "function") {
    // Companion filters run synchronously, so the permission is read once.
    let canView = true;
    void app.hasPermission("view").then((allowed) => {
      canView = allowed;
    });
    app.registerCompanion(
      VIEW_ID,
      (props) => (
        <AutomationsCompanion
          {...props}
          store={maintenance}
          maintenanceOn={maintenanceEnabled(props.host)}
        />
      ),
      {
        icon: Workflow,
        titleKey: "nav.automations",
        order: 100,
        tabTypes: ["terminal"],
        when: (_tab, host) =>
          canView && Number(host?.id) > 0 && automationsPanelEnabled(host),
        useDefaults: useAutomationsCompanionDefaults,
      },
    );
    app.registerAction("automations.togglePanel", ((
      _handle: unknown,
      tab: unknown,
    ) => app.toggleCompanion(tab as never, VIEW_ID)) as never);
    app.registerSlotContribution("tab.menu", {
      actionId: "automations.togglePanel",
      titleKey: "companion.toggle",
      icon: Workflow,
      kind: "button",
      order: 13,
      when: (context) => {
        const tab = context.tab as {
          type?: string;
          host?: unknown;
          hostConfig?: unknown;
        } | null;
        return (
          tab?.type === "terminal" &&
          automationsPanelEnabled((tab.host ?? tab.hostConfig) as object)
        );
      },
    });
  }
}
