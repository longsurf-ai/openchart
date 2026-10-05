// Purpose: Access the current ordinary Feed client through React injection.
import { useContext } from "react";

import {
  FeedReactContext,
  FeedVersionContext,
} from "@openchart/app/lib/feed/provider";
/** Requires a FeedProvider above this consumer. @example const client = useDatafeed(); */
export function useDatafeed() {
  const client = useContext(FeedReactContext);
  if (!client) throw new Error("useDatafeed requires FeedProvider");
  return client;
}
/** Observe availability changes; undefined until the first version arrives. Requires FeedProvider and never changes its client. @example const version = useFeedVersion(); */
export function useFeedVersion() {
  useDatafeed();
  return useContext(FeedVersionContext);
}
/** Current Bars client. @example const bars = useBarsFeed(); */
export function useBarsFeed() {
  return useDatafeed().bars;
}
/** Current merged search client. @example const search = useSymbologyFeed(); */
export function useSymbologyFeed() {
  return useDatafeed().symbology;
}
/** Current Logos client. @example const logos = useLogosFeed(); */
export function useLogosFeed() {
  return useDatafeed().logos;
}
/** Current Calendar client. @example const calendar = useCalendarFeed(); */
export function useCalendarFeed() {
  return useDatafeed().calendar;
}
