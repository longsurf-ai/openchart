// Purpose: Offer the GitHub repository and Discord server from the sidebar account row.
import { communityUrls } from "@openchart/app/app/community-urls";
import { DiscordMark } from "@openchart/app/components/ui/brand/discord-mark";
import { GitHubMark } from "@openchart/app/components/ui/brand/github-mark";
import { Button } from "@openchart/app/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@openchart/app/components/ui/tooltip";

// Discord's mark carries its own color; GitHub's is monochrome and follows the text.
const links = [
  { label: "Discord", url: communityUrls.discord, Mark: DiscordMark },
  { label: "GitHub", url: communityUrls.github, Mark: GitHubMark },
];

/** Solid brand links that open in the system browser; Desktop routes new windows outside the app. @example <AccountButton actions={<CommunityLinks />} /> */
export function CommunityLinks() {
  return links.map(({ label, url, Mark }) => (
    <Tooltip key={label}>
      <TooltipTrigger asChild>
        <Button asChild variant="ghost" size="icon-sm">
          <a href={url} target="_blank" rel="noreferrer" aria-label={label}>
            <Mark className="size-4" />
          </a>
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  ));
}
