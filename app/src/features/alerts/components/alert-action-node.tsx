// Purpose: Present one independently editable Trigger draft in the alert timeline.
import { useEffect, useId, useRef, type ReactNode } from "react";
import { BellIcon, BotIcon, XIcon } from "lucide-react";
import { Button } from "@openchart/app/components/ui/button";
import { Textarea } from "@openchart/app/components/ui/textarea";
import { nativeProviderBrand } from "@openchart/app/lib/agent/native-provider-brands";
import {
  defaultAlertAgentPrompt,
  type AlertPrompt,
  type TriggerTarget,
} from "@openchart/app/features/alerts/api/queries";
import type {
  AlertPromptEditor,
  AlertPromptEditorRenderer,
} from "./alert-rule-dialog";
import { AlertVariablesHelp } from "./alert-variables-help";
import { NotificationSoundPicker } from "./notification-sound-picker";

/** Unsaved Agent nodes may await model selection; persisted targets remain complete. */
export type AlertActionDraft = {
  id: string;
  name: string;
  enabled: boolean;
  target:
    | Extract<TriggerTarget, { kind: "notification" }>
    | (Omit<Extract<TriggerTarget, { kind: "agent_prompt" }>, "prompt"> & {
        prompt?: AlertPrompt;
      });
};

type ActionProps = {
  action: AlertActionDraft;
  label: "Then" | "And";
  disabled: boolean;
  focus: boolean;
  onRemove: () => void;
  onChange: (action: AlertActionDraft) => void;
  renderPromptEditor: AlertPromptEditorRenderer;
  onEditorChange: (id: string, editor: AlertPromptEditor | undefined) => void;
  onCancel: () => void;
};

/** Each Agent keeps its own composer runtime; notification edits stay in the parent draft.
 * @example <AlertActionNode {...props} label="Then" />
 */
export function AlertActionNode(props: ActionProps) {
  const { action } = props;
  const target = action.target;
  return target.kind === "agent_prompt" ? (
    props.renderPromptEditor({
      prompt: target.prompt,
      initialText: defaultAlertAgentPrompt,
      disabled: props.disabled,
      onCancel: props.onCancel,
      children: (editor) => <AgentActionNode {...props} editor={editor} />,
    })
  ) : (
    <ActionNode
      {...props}
      title="Desktop notification"
      icon={<BellIcon aria-hidden="true" />}
      headerAction={
        <NotificationSoundPicker
          iconOnly
          value={target.sound}
          disabled={props.disabled}
          onChange={(sound) =>
            props.onChange({ ...action, target: { ...target, sound } })
          }
          onDefault={() => {
            const inherited = { ...target };
            delete inherited.sound;
            props.onChange({ ...action, target: inherited });
          }}
        />
      }
    >
      <Textarea
        aria-label="Notification message"
        value={target.message}
        disabled={props.disabled}
        className="min-h-20 resize-y"
        onChange={(event) =>
          props.onChange({
            ...action,
            target: { ...target, message: event.target.value },
          })
        }
      />
    </ActionNode>
  );
}

function AgentActionNode(props: ActionProps & { editor: AlertPromptEditor }) {
  const { action, editor, onEditorChange } = props;
  useEffect(() => {
    onEditorChange(action.id, editor);
  }, [action.id, editor, onEditorChange]);
  useEffect(
    () => () => onEditorChange(action.id, undefined),
    [action.id, onEditorChange],
  );
  const provider =
    editor.model?.providerID ??
    (action.target.kind === "agent_prompt"
      ? action.target.prompt?.model.providerID
      : undefined);
  const brand = provider ? nativeProviderBrand(provider) : undefined;
  return (
    <ActionNode
      {...props}
      title={`Analyze with ${brand?.agent ?? provider ?? "Agent"}`}
      icon={brand ? <brand.Logo /> : <BotIcon aria-hidden="true" />}
    >
      {editor.content}
    </ActionNode>
  );
}

function ActionNode({
  action,
  label,
  disabled,
  focus,
  title,
  icon,
  headerAction,
  onRemove,
  onChange,
  children,
}: ActionProps & {
  title: string;
  icon: ReactNode;
  headerAction?: ReactNode;
  children: ReactNode;
}) {
  const id = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (focus) {
      heading.current?.focus({ preventScroll: true });
      heading.current?.scrollIntoView?.({ block: "nearest" });
    }
  }, [focus]);
  return (
    <section className="alert-workflow-step" aria-labelledby={id}>
      <div className="alert-workflow-label">{label}</div>
      <div className="alert-workflow-rail">
        <Button
          type="button"
          variant="outline"
          className="alert-workflow-icon alert-workflow-remove group p-0 shadow-none"
          disabled={disabled}
          aria-label={`Remove ${title}`}
          onClick={onRemove}
        >
          <span className="alert-workflow-action-icon" aria-hidden="true">
            {icon}
          </span>
          <XIcon className="alert-workflow-remove-icon" aria-hidden="true" />
        </Button>
      </div>
      <div className="min-w-0">
        <div className="alert-workflow-heading">
          <h3
            ref={heading}
            id={id}
            tabIndex={-1}
            className="alert-workflow-title flex-1 rounded-sm focus-visible:outline focus-visible:outline-ring"
          >
            {title}
          </h3>
          {headerAction || !action.enabled ? (
            <div className="ml-auto flex min-h-[var(--control-h-lg)] shrink-0 items-center gap-2">
              {!action.enabled && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={disabled}
                  onClick={() => onChange({ ...action, enabled: true })}
                >
                  Paused · Enable
                </Button>
              )}
              {headerAction}
            </div>
          ) : null}
        </div>
        <div className="mt-2 min-w-0">{children}</div>
        <AlertVariablesHelp />
      </div>
    </section>
  );
}
