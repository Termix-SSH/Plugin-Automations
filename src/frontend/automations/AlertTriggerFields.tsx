import { useTranslation } from "@termix-ssh/plugin-sdk/frontend";
import {
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@termix-ssh/plugin-sdk/ui";
import type { AlertSeverity, Trigger } from "../../types";
import { HostSelectorField } from "./HostSelectorField";
import type { AutomationEditorOptions } from "./editor-types";

/** Categories official plugins send, offered as suggestions. */
const KNOWN_CATEGORIES = [
  "uptime.down",
  "uptime.up",
  "uptime.cert_expiring",
  "uptime.*",
  "docker.*",
  "backups.*",
  "host-metrics.*",
  "acme-ssl.*",
  "certificates.*",
  "web-endpoint.*",
  "*",
];

const ANY = "__any__";

type AlertTrigger = Extract<Trigger, { kind: "alert" }>;

export function AlertTriggerFields({
  trigger,
  options,
  onChange,
}: {
  trigger: AlertTrigger;
  options: AutomationEditorOptions;
  onChange: (next: Trigger) => void;
}) {
  const { t } = useTranslation();
  const base = "newUi.sidebar.automations";
  const patch = (changes: Partial<AlertTrigger>) =>
    onChange({ ...trigger, ...changes });
  const label =
    "text-[10px] font-bold uppercase tracking-widest text-muted-foreground";

  return (
    <>
      <p className="text-xs text-muted-foreground">
        {t(`${base}.alertTriggerHint`)}
      </p>
      <div className="space-y-1">
        <Label className={label}>{t(`${base}.fields.alertCategory`)}</Label>
        <Input
          className="h-8 border-border font-mono"
          list="automations-alert-categories"
          value={trigger.category}
          placeholder="uptime.down"
          onChange={(e) => patch({ category: e.target.value })}
        />
        <datalist id="automations-alert-categories">
          {KNOWN_CATEGORIES.map((category) => (
            <option key={category} value={category} />
          ))}
        </datalist>
        <p className="text-xs text-muted-foreground">
          {t(`${base}.fields.alertCategoryHint`)}
        </p>
      </div>
      <div className="flex gap-2">
        <div className="space-y-1 flex-1">
          <Label className={label}>{t(`${base}.fields.alertSeverity`)}</Label>
          <Select
            value={trigger.minSeverity ?? ANY}
            onValueChange={(value: string) =>
              patch({
                minSeverity:
                  value === ANY ? undefined : (value as AlertSeverity),
              })
            }
          >
            <SelectTrigger size="sm" className="w-full border-border">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>
                {t(`${base}.fields.alertSeverityAny`)}
              </SelectItem>
              <SelectItem value="warning">
                {t(`${base}.fields.alertSeverityWarning`)}
              </SelectItem>
              <SelectItem value="critical">
                {t(`${base}.fields.alertSeverityCritical`)}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1 flex-1">
          <Label className={label}>{t(`${base}.fields.cooldown`)}</Label>
          <Input
            type="number"
            min={0}
            className="h-8 border-border"
            value={trigger.cooldownMinutes}
            onChange={(e) =>
              patch({ cooldownMinutes: Math.max(0, Number(e.target.value)) })
            }
          />
        </div>
      </div>
      <div className="space-y-1">
        <Label className={label}>{t(`${base}.fields.alertTitle`)}</Label>
        <Input
          className="h-8 border-border"
          value={trigger.titleContains ?? ""}
          placeholder={t(`${base}.fields.alertTitlePlaceholder`)}
          onChange={(e) =>
            patch({ titleContains: e.target.value || undefined })
          }
        />
      </div>
      <HostSelectorField
        value={trigger.hostSelector ?? { kind: "all" }}
        options={options}
        allowTrigger={false}
        onChange={(hostSelector) =>
          patch({
            hostSelector:
              hostSelector.kind === "all" ? undefined : hostSelector,
          })
        }
      />
    </>
  );
}
