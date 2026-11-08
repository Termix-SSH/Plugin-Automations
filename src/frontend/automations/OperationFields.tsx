import { useEffect, useState } from "react";
import { useTranslation } from "@termix-ssh/plugin-sdk/frontend";
import {
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  operationsApi,
} from "@termix-ssh/plugin-sdk/ui";
import type { Step, Trigger } from "../../types";
import { HostSelectorField } from "./HostSelectorField";
import type { AutomationEditorOptions } from "./editor-types";

interface CatalogField {
  key: string;
  type: string;
  label: string;
  description?: string;
  options?: { value: string }[];
  optionLabels?: Record<string, string>;
}

interface CatalogAction {
  id: string;
  title: string;
  pluginName: string;
  scope: "host" | "resource" | "server";
  inputs: CatalogField[];
  surfaces?: Record<string, boolean>;
  available: boolean;
}

interface Catalog {
  actions: CatalogAction[];
  events: { id: string; title: string; pluginId: string }[];
}

let shared: Promise<Catalog> | null = null;

function useCatalog(): Catalog | null {
  const { language } = useTranslation();
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  useEffect(() => {
    shared ??= operationsApi
      .get<Catalog>("/catalog", { params: { lang: language } })
      .then((response) => response.data)
      .catch(() => {
        shared = null;
        return { actions: [], events: [] };
      });
    void shared.then(setCatalog);
  }, [language]);
  return catalog;
}

const BASE = "newUi.sidebar.automations";

/** The fields of a "Run an action" step, drawn from the action's declaration. */
export function OperationStepFields({
  step,
  options,
  onChange,
}: {
  step: Extract<Step, { type: "operation" }>;
  options: AutomationEditorOptions;
  onChange: (next: Step) => void;
}) {
  const { t } = useTranslation();
  const catalog = useCatalog();
  const actions = (catalog?.actions ?? []).filter(
    (action) => action.surfaces?.automations !== false,
  );
  const action = actions.find((entry) => entry.id === step.actionId);
  const input = step.input ?? {};
  const patch = (changes: Partial<typeof step>) =>
    onChange({ ...step, ...changes } as Step);

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <Label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          {t(`${BASE}.fields.action`)}
        </Label>
        <Select
          value={step.actionId || ""}
          onValueChange={(actionId) => {
            const next = actions.find((entry) => entry.id === actionId);
            patch({
              actionId,
              input: {},
              resourceKey: undefined,
              hostSelector:
                next?.scope === "server"
                  ? undefined
                  : (step.hostSelector ?? { kind: "trigger" }),
            });
          }}
        >
          <SelectTrigger size="sm" className="border-border">
            <SelectValue placeholder={t(`${BASE}.fields.pickAction`)} />
          </SelectTrigger>
          <SelectContent>
            {actions.map((entry) => (
              <SelectItem key={entry.id} value={entry.id}>
                {entry.title} ({entry.pluginName})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {step.actionId && !action && catalog && (
          <p className="text-xs text-destructive">
            {t(`${BASE}.fields.actionMissing`)}
          </p>
        )}
      </div>

      {action && action.scope !== "server" && (
        <HostSelectorField
          value={step.hostSelector ?? { kind: "trigger" }}
          options={options}
          allowTrigger
          onChange={(hostSelector) => patch({ hostSelector })}
        />
      )}

      {action?.scope === "resource" && (
        <div className="space-y-1">
          <Label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            {t(`${BASE}.fields.actionTarget`)}
          </Label>
          <Input
            className="h-8 border-border"
            value={step.resourceKey ?? ""}
            onChange={(event) => patch({ resourceKey: event.target.value })}
          />
        </div>
      )}

      {action?.inputs.map((field) => (
        <div key={field.key} className="space-y-1">
          <Label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            {field.label}
          </Label>
          {field.type === "boolean" ? (
            <Switch
              checked={input[field.key] === true}
              onCheckedChange={(value) =>
                patch({ input: { ...input, [field.key]: value } })
              }
            />
          ) : field.type === "select" && field.options ? (
            <Select
              value={String(input[field.key] ?? "")}
              onValueChange={(value) =>
                patch({ input: { ...input, [field.key]: value } })
              }
            >
              <SelectTrigger size="sm" className="border-border">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {field.options.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {field.optionLabels?.[option.value] ?? option.value}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Input
              className="h-8 border-border"
              type={field.type === "secret" ? "password" : "text"}
              value={String(input[field.key] ?? "")}
              placeholder={field.description}
              onChange={(event) =>
                patch({ input: { ...input, [field.key]: event.target.value } })
              }
            />
          )}
        </div>
      ))}
    </div>
  );
}

const CORE_EVENTS = ["operation.failed", "operation.succeeded"];

/** The fields of an "An event happened" trigger. */
export function OperationEventFields({
  trigger,
  options,
  onChange,
}: {
  trigger: Extract<Trigger, { kind: "operation_event" }>;
  options: AutomationEditorOptions;
  onChange: (next: Trigger) => void;
}) {
  const { t } = useTranslation();
  const catalog = useCatalog();
  const events = [
    ...CORE_EVENTS.map((id) => ({ id, title: t(`${BASE}.events.${id}`) })),
    ...(catalog?.events ?? []),
  ];
  const patch = (changes: Partial<typeof trigger>) =>
    onChange({ ...trigger, ...changes } as Trigger);

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <Label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          {t(`${BASE}.fields.event`)}
        </Label>
        <Select
          value={trigger.event}
          onValueChange={(event) => patch({ event })}
        >
          <SelectTrigger size="sm" className="border-border">
            <SelectValue placeholder={t(`${BASE}.fields.pickEvent`)} />
          </SelectTrigger>
          <SelectContent>
            {events.map((event) => (
              <SelectItem key={event.id} value={event.id}>
                {event.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <HostSelectorField
        value={trigger.hostSelector ?? { kind: "all" }}
        options={options}
        allowTrigger={false}
        onChange={(hostSelector) => patch({ hostSelector })}
      />
      <div className="space-y-1">
        <Label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          {t(`${BASE}.fields.cooldown`)}
        </Label>
        <Input
          type="number"
          min={1}
          className="h-8 border-border"
          value={trigger.cooldownMinutes}
          onChange={(event) =>
            patch({ cooldownMinutes: Math.max(Number(event.target.value), 1) })
          }
        />
      </div>
    </div>
  );
}
