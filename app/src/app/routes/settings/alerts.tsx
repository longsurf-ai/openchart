// Purpose: Edit profile-wide alert sounds through Config and audition bundled audio without saving.
import { useOutletContext } from "react-router";
import type { AppRouteContext } from "@openchart/app/app/route-context";
import { Card, CardItem } from "@openchart/app/components/ui/settings/card";
import { NotificationSoundPicker } from "@openchart/app/features/alerts/components/notification-sound-picker";
import { useConfig } from "@openchart/app/hooks/use-config";
import { SettingsPage } from "./settings-page";

/** Saved choices apply to desktop alerts without a sound override; auditioning never saves or fires an alert. @example <AlertsSettings /> */
export default function AlertsSettings() {
  const { transport } = useOutletContext<AppRouteContext>();
  const settings = useConfig(transport);
  return (
    <SettingsPage title="Alerts" settings={settings}>
      {settings.config ? (
        <Card title="Desktop notifications">
          <CardItem
            title="Sound"
            htmlFor="alert-notification-sound"
            className="flex-wrap"
            actions={
              <NotificationSoundPicker
                id="alert-notification-sound"
                value={settings.config.notifications.sound}
                disabled={settings.isSaving || !!settings.readError}
                onChange={(sound) =>
                  settings.update({ notifications: { sound } })
                }
              />
            }
          />
        </Card>
      ) : null}
    </SettingsPage>
  );
}
