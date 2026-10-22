import {
  useCallback,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { ExternalLink, Play, Wrench } from "lucide-react";
import { toast } from "sonner";
import {
  usePermission,
  useSettings,
  useTabs,
  useTranslation,
  type CompanionDefaults,
  type CompanionProps,
  type DashboardCardProps,
} from "@termix-ssh/plugin-sdk/frontend";
import {
  Button,
  ListBadge,
  ListRow,
  ListRowAction,
  PanelList,
} from "@termix-ssh/plugin-sdk/ui";
import { computeNextDueAt } from "../backend/cron";
import type { RunStatus } from "../types";
import {
  useAutomationsApi,
  type AutomationRow,
  type AutomationRunRow,
} from "./automations-api";
import { timeAgo } from "./AutomationsPanel";
import type { MaintenanceStore } from "./maintenance-store";

const POLL_MS = 30_000;
const STATUS = "newUi.sidebar.automations.statuses";

type Translate = (key: string, options?: Record<string, unknown>) => string;

const TONES: Record<RunStatus, "brand" | "success" | "destructive" | "muted"> =
  {
    running: "brand",
    success: "success",
    failed: "destructive",
    timeout: "destructive",
    skipped: "muted",
    cancelled: "muted",
  };

/** Whether an automation's trigger or steps name this host. */
export function automationTouchesHost(
  row: Pick<AutomationRow, "definition">,
  hostId: number,
): boolean {
  const seen = (value: unknown): boolean => {
    if (Array.isArray(value)) return value.some(seen);
    if (!value || typeof value !== "object") return false;
    const node = value as Record<string, unknown>;
    if (node.kind === "host" && Number(node.hostId) === hostId) return true;
    if (
      node.kind === "hosts" &&
      Array.isArray(node.hostIds) &&
      node.hostIds.map(Number).includes(hostId)
    ) {
      return true;
    }
    if (node.type === "wol" && Number(node.hostId) === hostId) return true;
    return Object.values(node).some(seen);
  };
  return seen(row.definition);
}

/** When a schedule automation runs next, or null for other triggers. */
export function nextRunOf(row: AutomationRow, from = new Date()): Date | null {
  const trigger = row.definition?.trigger;
  if (!row.enabled || trigger?.kind !== "schedule") return null;
  try {
    const next = computeNextDueAt(trigger, from);
    return next ? new Date(next) : null;
  } catch {
    return null;
  }
}

/** "in 5m" style text for a time ahead. */
export function timeUntil(date: Date, t: Translate): string {
  const min = Math.max(0, Math.round((date.getTime() - Date.now()) / 60000));
  if (min < 60) return t("card.inMinutes", { count: min });
  const hr = Math.floor(min / 60);
  if (hr < 24) return t("card.inHours", { count: hr });
  return t("card.inDays", { count: Math.floor(hr / 24) });
}

/** Automations and recent runs, reloaded while visible. */
function useAutomationData(visible: boolean, runLimit: number) {
  const api = useAutomationsApi();
  const [rows, setRows] = useState<AutomationRow[] | null>(null);
  const [runs, setRuns] = useState<AutomationRunRow[]>([]);
  const [failed, setFailed] = useState("");

  const load = useCallback(async () => {
    try {
      const [list, history] = await Promise.all([
        api.list(),
        api.runs({ limit: runLimit }),
      ]);
      setRows(list);
      setRuns(history);
      setFailed("");
    } catch (error) {
      setFailed(error instanceof Error ? error.message : String(error));
    }
  }, [api, runLimit]);

  useEffect(() => {
    if (!visible) return;
    void load();
    const timer = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(timer);
  }, [visible, load]);

  const run = async (row: AutomationRow, t: Translate) => {
    try {
      const outcome = await api.run(row.id);
      toast.success(
        t("newUi.sidebar.automations.runFinished", { status: outcome.status }),
      );
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  return { rows, runs, failed, load, run };
}

function RunRows({ runs, t }: { runs: AutomationRunRow[]; t: Translate }) {
  return (
    <>
      {runs.map((runRow, index) => (
        <ListRow
          key={runRow.id}
          stripe={index}
          tone={TONES[runRow.status]}
          title={runRow.automation_name ?? `#${runRow.automation_id}`}
          badges={
            <ListBadge
              tone={
                TONES[runRow.status] === "brand"
                  ? "brand"
                  : TONES[runRow.status]
              }
            >
              {t(`${STATUS}.${runRow.status}`)}
            </ListBadge>
          }
          meta={[
            timeAgo(runRow.started_at, t),
            runRow.dry_run ? t("newUi.sidebar.automations.dryRunBadge") : "",
            runRow.error ?? "",
          ]
            .filter(Boolean)
            .join(" | ")}
        />
      ))}
    </>
  );
}

function Message({ children }: { children: ReactNode }) {
  return <p className="p-3 text-xs text-muted-foreground">{children}</p>;
}

/** Dashboard card: scheduled automations in the order they run next. */
export function UpcomingRunsCard({ isVisible, shell }: DashboardCardProps) {
  const { t } = useTranslation();
  const canView = usePermission("view");
  const canRun = usePermission("run");
  const { rows, failed, run } = useAutomationData(isVisible && canView, 1);
  if (!canView) return <Message>{t("maintenance.denied")}</Message>;
  if (failed) return <Message>{failed}</Message>;
  if (!rows) return <Message>{t("maintenance.loading")}</Message>;
  const upcoming = rows
    .map((row) => ({ row, next: nextRunOf(row) }))
    .filter(
      (entry): entry is { row: AutomationRow; next: Date } => !!entry.next,
    )
    .sort((a, b) => a.next.getTime() - b.next.getTime());
  return (
    <PanelList
      empty={
        <button
          type="button"
          onClick={() => shell.openSingletonTab("automations")}
          className="p-3 text-left text-xs text-muted-foreground hover:text-foreground"
        >
          {t("card.noUpcoming")}
        </button>
      }
    >
      {upcoming.map(({ row, next }, index) => (
        <ListRow
          key={row.id}
          stripe={index}
          tone="brand"
          title={row.name}
          meta={`${timeUntil(next, t)} | ${next.toLocaleString()}`}
          actions={
            canRun ? (
              <ListRowAction
                label={t("newUi.sidebar.automations.runNow")}
                tone="brand"
                onClick={() => void run(row, t)}
              >
                <Play />
              </ListRowAction>
            ) : undefined
          }
        />
      ))}
    </PanelList>
  );
}

/** Dashboard card: the latest automation runs. */
export function RecentRunsCard({ isVisible, shell }: DashboardCardProps) {
  const { t } = useTranslation();
  const canView = usePermission("view");
  const { runs, rows, failed } = useAutomationData(isVisible && canView, 20);
  if (!canView) return <Message>{t("maintenance.denied")}</Message>;
  if (failed) return <Message>{failed}</Message>;
  if (!rows) return <Message>{t("maintenance.loading")}</Message>;
  return (
    <PanelList
      empty={
        <button
          type="button"
          onClick={() => shell.openSingletonTab("automations")}
          className="p-3 text-left text-xs text-muted-foreground hover:text-foreground"
        >
          {t("newUi.sidebar.automations.emptyRuns")}
        </button>
      }
    >
      <RunRows runs={runs} t={t} />
    </PanelList>
  );
}

/** Starting state of the panel, from the user's settings. */
export function useAutomationsCompanionDefaults(): CompanionDefaults {
  const { values } = useSettings("user");
  const side = values.companionSide;
  return {
    open: values.companionAutoOpen === true,
    side: side === "left" || side === "bottom" ? side : "right",
    size: typeof values.companionSize === "number" ? values.companionSize : 320,
    edgeButton: values.companionEdgeButton !== false,
  };
}

/**
 * Beside a terminal: the host's maintenance state, the automations that
 * name it with run now, and their latest runs.
 */
export function AutomationsCompanion({
  host,
  isVisible,
  store,
  maintenanceOn,
}: CompanionProps & { store: MaintenanceStore; maintenanceOn: boolean }) {
  const { t } = useTranslation();
  const tabs = useTabs();
  const canRun = usePermission("run");
  const hostId = host ? Number(host.id) : 0;
  const { rows, runs, failed, run } = useAutomationData(isVisible, 50);
  const states = useSyncExternalStore(store.subscribe, store.snapshot);
  const active = states[hostId]?.active;

  const mine = (rows ?? []).filter((row) => automationTouchesHost(row, hostId));
  const ids = new Set(mine.map((row) => row.id));
  const mineRuns = runs.filter((r) => ids.has(r.automation_id)).slice(0, 10);

  return (
    <div className="flex h-full min-h-0 flex-col gap-1.5 overflow-y-auto p-1.5">
      {maintenanceOn && (
        <div className="flex items-center gap-2 border border-border px-2 py-1.5 text-xs">
          <Wrench className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate">
            {active
              ? `${t("maintenance.active")}: ${active.reasons.join("; ")}`
              : t("card.noMaintenance")}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="size-6"
            onClick={() => host && tabs.openTab(host, "host_maintenance")}
            title={t("maintenance.title")}
          >
            <ExternalLink className="size-3.5" />
          </Button>
        </div>
      )}
      <div className="flex items-center gap-1 px-1 pt-1">
        <span className="flex-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          {t("nav.automations")}
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="size-6"
          onClick={() => tabs.openSingletonTab("automations")}
          title={t("companion.openTab")}
        >
          <ExternalLink className="size-3.5" />
        </Button>
      </div>
      {failed ? (
        <p className="p-2 text-xs text-destructive">{failed}</p>
      ) : !rows ? (
        <p className="p-2 text-xs text-muted-foreground">
          {t("maintenance.loading")}
        </p>
      ) : (
        <>
          <PanelList empty={<Message>{t("card.noHostAutomations")}</Message>}>
            {mine.map((row, index) => {
              const next = nextRunOf(row);
              return (
                <ListRow
                  key={row.id}
                  stripe={index}
                  tone={
                    row.last_run_status ? TONES[row.last_run_status] : "none"
                  }
                  dimmed={!row.enabled}
                  title={row.name}
                  meta={[
                    next ? timeUntil(next, t) : "",
                    row.last_run_at ? timeAgo(row.last_run_at, t) : "",
                  ]
                    .filter(Boolean)
                    .join(" | ")}
                  actions={
                    canRun ? (
                      <ListRowAction
                        label={t("newUi.sidebar.automations.runNow")}
                        tone="brand"
                        onClick={() => void run(row, t)}
                      >
                        <Play />
                      </ListRowAction>
                    ) : undefined
                  }
                />
              );
            })}
          </PanelList>
          {mineRuns.length > 0 && (
            <>
              <span className="px-1 pt-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                {t("newUi.sidebar.automations.tabRuns")}
              </span>
              <PanelList>
                <RunRows runs={mineRuns} t={t} />
              </PanelList>
            </>
          )}
        </>
      )}
    </div>
  );
}
