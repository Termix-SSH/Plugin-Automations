import { useCallback, useEffect, useState } from "react";
import {
  invokeAction,
  useSettings,
  useTranslation,
} from "@termix-ssh/plugin-sdk/frontend";
import { toast } from "sonner";
import {
  Bell,
  Copy,
  ExternalLink,
  FlaskConical,
  Loader2,
  Play,
  SlidersHorizontal,
  Trash2,
  Workflow,
} from "lucide-react";
import {
  AddButton,
  Button,
  EmptyState,
  Facts,
  FormFooter,
  InlineView,
  ListBadge,
  ListRow,
  ListRowAction,
  PanelList,
  PanelSearch,
  TabStrip,
  type ListRowTone,
  getBasePath,
  useConfirm,
} from "@termix-ssh/plugin-sdk/ui";
import {
  useAutomationsApi,
  type AutomationRow,
  type AutomationRunRow,
  type AutomationRunStepRow,
} from "./automations-api";

import {
  AutomationEditor,
  emptyDraft,
  type AutomationDraft,
} from "./automations/AutomationEditor";
import {
  EMPTY_EDITOR_OPTIONS,
  type AutomationEditorOptions,
} from "./automations/editor-types";
import { docsUrl } from "./docs";
import {
  AutomationSettings,
  readAutomationSettings,
  rowActionProps,
} from "./AutomationSettings";

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

type PanelTab = "automations" | "runs";

const STATUS_CLASS: Record<string, string> = {
  success: "text-green-500",
  failed: "text-destructive",
  timeout: "text-destructive",
  running: "text-foreground",
  skipped: "text-muted-foreground",
  cancelled: "text-muted-foreground",
};

const RUN_TONE: Record<string, ListRowTone> = {
  success: "success",
  failed: "destructive",
  timeout: "destructive",
  running: "brand",
};

const RUN_BADGE: Record<
  string,
  "muted" | "brand" | "success" | "warning" | "destructive"
> = {
  success: "success",
  failed: "destructive",
  timeout: "destructive",
  running: "brand",
};

type Translate = (key: string, options?: Record<string, unknown>) => string;

function timeAgo(iso: string | null, t: Translate): string {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return "";
  const base = "newUi.sidebar.automations.ago";
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return t(`${base}.seconds`, { count: sec });
  const min = Math.floor(sec / 60);
  if (min < 60) return t(`${base}.minutes`, { count: min });
  const hr = Math.floor(min / 60);
  if (hr < 24) return t(`${base}.hours`, { count: hr });
  return t(`${base}.days`, { count: Math.floor(hr / 24) });
}

export function AutomationsPanel({ active = true }: { active?: boolean }) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const [query, setQuery] = useState("");
  const api = useAutomationsApi();
  const base = "newUi.sidebar.automations";

  const [tab, setTab] = useState<PanelTab>("automations");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settings = useSettings("user");
  const { alwaysShowActions } = readAutomationSettings(settings.values);
  const [automations, setAutomations] = useState<AutomationRow[]>([]);
  const [runs, setRuns] = useState<AutomationRunRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [options, setOptions] =
    useState<AutomationEditorOptions>(EMPTY_EDITOR_OPTIONS);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState<AutomationDraft>(emptyDraft());
  const [saving, setSaving] = useState(false);
  const [webhookToken, setWebhookToken] = useState<string | null>(null);

  const [expandedRun, setExpandedRun] = useState<number | null>(null);
  const [runSteps, setRunSteps] = useState<AutomationRunStepRow[]>([]);

  const loadAutomations = useCallback(async () => {
    setLoading(true);
    try {
      setAutomations(await api.list());
    } catch {
      // A failed load leaves the previous list on screen.
    } finally {
      setLoading(false);
    }
  }, [api]);

  const loadRuns = useCallback(async () => {
    try {
      setRuns(await api.runs({ limit: 100 }));
    } catch {
      // Non-fatal.
    }
  }, [api]);

  const loadOptions = useCallback(async () => {
    try {
      setOptions(await api.editorOptions());
    } catch {
      // The editor falls back to empty pickers.
    }
  }, [api]);

  useEffect(() => {
    if (!active) return;
    void loadAutomations();
    void loadOptions();
  }, [active, loadAutomations, loadOptions]);

  useEffect(() => {
    if (active && tab === "runs") void loadRuns();
  }, [active, tab, loadRuns]);

  function closeEditor() {
    setWebhookToken(null);
    setEditorOpen(false);
  }

  function openCreate() {
    setEditingId(null);
    setDraft(emptyDraft());
    setWebhookToken(null);
    setEditorOpen(true);
  }

  function openEdit(row: AutomationRow) {
    setEditingId(row.id);
    setDraft({
      name: row.name,
      description: row.description ?? "",
      enabled: !!row.enabled,
      concurrencyPolicy: row.concurrency_policy ?? "skip",
      definition: row.definition ?? emptyDraft().definition,
    });
    setWebhookToken(null);
    setEditorOpen(true);
  }

  async function save() {
    if (!draft.name.trim()) {
      toast.error(t(`${base}.nameRequired`));
      return;
    }

    setSaving(true);
    try {
      if (editingId === null) {
        const created = await api.create({
          name: draft.name.trim(),
          description: draft.description || null,
          enabled: draft.enabled,
          concurrencyPolicy: draft.concurrencyPolicy,
          definition: draft.definition,
        });
        toast.success(t(`${base}.created`));
        if (created.webhookToken) {
          setWebhookToken(created.webhookToken);
        } else {
          setEditorOpen(false);
        }
      } else {
        await api.update(editingId, {
          name: draft.name.trim(),
          description: draft.description || null,
          enabled: draft.enabled,
          concurrencyPolicy: draft.concurrencyPolicy,
          definition: draft.definition,
        });
        toast.success(t(`${base}.updated`));
        setEditorOpen(false);
      }
      await loadAutomations();
    } catch (error) {
      toast.error(getErrorMessage(error, String(error)));
    } finally {
      setSaving(false);
    }
  }

  async function remove(row: AutomationRow) {
    const ok = await confirm({
      title: t(`${base}.deleteConfirm`),
      confirmLabel: t("common.delete"),
    });
    if (!ok) return;
    try {
      await api.remove(row.id);
      toast.success(t(`${base}.deleted`));
      await loadAutomations();
    } catch (error) {
      toast.error(getErrorMessage(error, String(error)));
    }
  }

  async function run(row: AutomationRow, dryRun: boolean) {
    try {
      const outcome = await api.run(row.id, { dryRun });
      toast.success(t(`${base}.runFinished`, { status: outcome.status }));
      await loadAutomations();
      if (tab === "runs") await loadRuns();
    } catch (error) {
      toast.error(getErrorMessage(error, String(error)));
    }
  }

  async function toggleRun(runId: number) {
    if (expandedRun === runId) {
      setExpandedRun(null);
      return;
    }
    setExpandedRun(runId);
    try {
      setRunSteps(await api.runSteps(runId));
    } catch {
      setRunSteps([]);
    }
  }

  // Editing takes over the whole panel and widens the sidebar, the same way the
  // host manager does, rather than opening a dialog over the app.
  const webhookUrl = webhookToken
    ? `${window.location.origin}${getBasePath()}/plugin-api/automations/webhook/${webhookToken}`
    : "";

  const editorView = (
    <InlineView
      open={editorOpen}
      onOpenChange={(open) => {
        if (!open) closeEditor();
      }}
      title={
        editingId !== null && draft.name
          ? draft.name
          : t(`${base}.createAutomation`)
      }
      icon={<Workflow className="size-4" />}
      footer={
        webhookToken ? (
          <FormFooter onSave={closeEditor} saveLabel={t("common.close")} />
        ) : (
          <FormFooter
            onCancel={closeEditor}
            onSave={() => void save()}
            saving={saving}
            saveLabel={t(`${base}.save`)}
          />
        )
      }
    >
      {webhookToken ? (
        <div className="space-y-2">
          <p className="text-sm">{t(`${base}.webhookTokenTitle`)}</p>
          <p className="text-xs text-muted-foreground">
            {t(`${base}.webhookTokenDescription`)}
          </p>
          <div className="flex gap-2">
            <code className="flex-1 p-2 bg-muted text-xs break-all">
              {webhookUrl}
            </code>
            <Button
              size="icon"
              variant="outline"
              className="shrink-0"
              title={t(`${base}.copied`)}
              onClick={() => {
                navigator.clipboard?.writeText(webhookUrl);
                toast.success(t(`${base}.copied`));
              }}
            >
              <Copy size={14} />
            </Button>
          </div>
        </div>
      ) : (
        <AutomationEditor draft={draft} options={options} onChange={setDraft} />
      )}
    </InlineView>
  );

  const q = query.trim().toLowerCase();
  const shownAutomations = q
    ? automations.filter((row) => row.name.toLowerCase().includes(q))
    : automations;

  return (
    <div className="flex flex-col h-full min-h-0">
      {editorView}
      {settingsOpen && (
        <AutomationSettings
          settings={settings}
          onBack={() => setSettingsOpen(false)}
        />
      )}
      <div className="shrink-0 border-b border-border px-1">
        <TabStrip
          tabs={[
            {
              id: "automations",
              label: t(`${base}.tabAutomations`),
              count: automations.length,
            },
            { id: "runs", label: t(`${base}.tabRuns`) },
          ]}
          activeTab={tab}
          onTabChange={(id) => setTab(id as PanelTab)}
          trailing={
            <>
              <Button
                variant="ghost"
                size="icon-xs"
                title={t(`${base}.channelsHint`)}
                aria-label={t(`${base}.tabChannels`)}
                onClick={() => void invokeAction("alerts.openChannels")}
              >
                <Bell />
              </Button>
              <Button
                variant="ghost"
                size="icon-xs"
                title={t(`${base}.settingsTitle`)}
                aria-label={t(`${base}.settingsTitle`)}
                onClick={() => setSettingsOpen(true)}
              >
                <SlidersHorizontal />
              </Button>
              <Button variant="ghost" size="icon-xs" asChild>
                <a
                  href={docsUrl()}
                  target="_blank"
                  rel="noreferrer"
                  title={t(`${base}.docsLink`)}
                  aria-label={t(`${base}.docsLink`)}
                >
                  <ExternalLink />
                </a>
              </Button>
            </>
          }
        />
      </div>

      {tab === "automations" && (
        <>
          <div className="flex shrink-0 flex-col gap-2 border-b border-border px-3 py-2">
            <PanelSearch
              value={query}
              onChange={setQuery}
              placeholder={t(`${base}.search`)}
              fill
            />
            <AddButton
              label={t(`${base}.createAutomation`)}
              onClick={openCreate}
              className="w-full"
            />
          </div>
          <PanelList
            empty={
              loading && automations.length === 0 ? (
                <div className="flex justify-center p-4">
                  <Loader2 size={16} className="animate-spin" />
                </div>
              ) : (
                <EmptyState
                  icon={Workflow}
                  title={t(
                    automations.length === 0
                      ? `${base}.empty`
                      : `${base}.noMatches`,
                  )}
                />
              )
            }
          >
            {shownAutomations.map((row, index) => (
              <ListRow
                key={row.id}
                stripe={index}
                tone={
                  row.missingPlugins?.length
                    ? "destructive"
                    : row.enabled
                      ? "brand"
                      : "muted"
                }
                dimmed={!row.enabled}
                icon={<Workflow />}
                title={row.name}
                onClick={() => openEdit(row)}
                badges={
                  <>
                    {!!row.missingPlugins?.length && (
                      <ListBadge tone="destructive">
                        {t(`${base}.needsPlugin`, {
                          plugin: row.missingPlugins.join(", "),
                        })}
                      </ListBadge>
                    )}
                    {!row.enabled && (
                      <ListBadge>{t(`${base}.offBadge`)}</ListBadge>
                    )}
                  </>
                }
                meta={
                  <Facts>
                    {row.definition && (
                      <span>
                        {t(
                          `${base}.triggerKinds.${row.definition.trigger.kind}`,
                        )}
                      </span>
                    )}
                    {row.last_run_status && (
                      <span>{timeAgo(row.last_run_at, t)}</span>
                    )}
                  </Facts>
                }
                {...rowActionProps(
                  alwaysShowActions,
                  <>
                    <ListRowAction
                      label={t(`${base}.testRun`)}
                      onClick={() => run(row, true)}
                    >
                      <FlaskConical />
                    </ListRowAction>
                    <ListRowAction
                      label={t(`${base}.runNow`)}
                      tone="brand"
                      onClick={() => run(row, false)}
                    >
                      <Play />
                    </ListRowAction>
                    <ListRowAction
                      label={t("common.delete")}
                      tone="destructive"
                      onClick={() => remove(row)}
                    >
                      <Trash2 />
                    </ListRowAction>
                  </>,
                )}
              />
            ))}
          </PanelList>
        </>
      )}

      {tab === "runs" && (
        <PanelList
          empty={<EmptyState icon={Workflow} title={t(`${base}.emptyRuns`)} />}
        >
          {runs.map((entry, index) => (
            <div key={entry.id}>
              <ListRow
                stripe={index}
                tone={RUN_TONE[entry.status] ?? "muted"}
                selected={expandedRun === entry.id}
                title={entry.automation_name ?? `#${entry.automation_id}`}
                onClick={() => toggleRun(entry.id)}
                badges={
                  <>
                    {entry.dry_run ? (
                      <ListBadge>{t(`${base}.dryRunBadge`)}</ListBadge>
                    ) : null}
                    <ListBadge
                      tone={RUN_BADGE[entry.status] ?? "muted"}
                      className="ml-auto"
                    >
                      {t(`${base}.statuses.${entry.status}`)}
                    </ListBadge>
                  </>
                }
                meta={
                  <Facts>
                    <span>{timeAgo(entry.started_at, t)}</span>
                    {entry.duration_ms !== null && (
                      <span>{Math.round(entry.duration_ms / 100) / 10}s</span>
                    )}
                  </Facts>
                }
              >
                {entry.error && (
                  <span className="truncate text-[11px] text-destructive">
                    {entry.error}
                  </span>
                )}
              </ListRow>

              {expandedRun === entry.id && (
                <div className="space-y-1 border-b border-border/40 bg-muted/10 py-2 pl-5 pr-3">
                  {runSteps.map((step) => (
                    <div key={step.id} className="text-[11px]">
                      <div className="flex gap-2">
                        <span className="text-muted-foreground">
                          {step.step_index + 1}.
                        </span>
                        <span className="flex-1">
                          {t(`${base}.stepTypes.${step.step_type}`, {
                            defaultValue: step.step_type,
                          })}
                        </span>
                        <span className={STATUS_CLASS[step.status] ?? ""}>
                          {step.status}
                        </span>
                      </div>
                      {step.output && (
                        <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-all border border-border bg-background p-1.5 text-[10px]">
                          {step.output}
                        </pre>
                      )}
                      {step.error && (
                        <div className="text-destructive">{step.error}</div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </PanelList>
      )}
    </div>
  );
}
